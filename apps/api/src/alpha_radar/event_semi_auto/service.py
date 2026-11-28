from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Never
from uuid import UUID, uuid4

from sqlalchemy import select

from alpha_radar.errors import AppError
from alpha_radar.event_contracts.shadow_models import EventShadowSignal
from alpha_radar.event_contracts.shadow_repository import ShadowRepository
from alpha_radar.event_contracts.shadow_rules import FRESHNESS
from alpha_radar.event_contracts.strategy import utc
from alpha_radar.event_semi_auto.models import LiveIntent, RealBet, SemiAutoSettings
from alpha_radar.event_semi_auto.repository import Repository
from alpha_radar.event_semi_auto.rules import (
    PENDING,
    TTL,
    apply_loss,
    breakeven,
    drift,
    returns,
    risk_block,
)
from alpha_radar.event_semi_auto.schemas import (
    VERSION,
    Confirm,
    Control,
    IntentAction,
    RiskSettings,
    Settle,
)
from alpha_radar.event_simulator.repository import SimulatorRepository
from alpha_radar.event_simulator.rules import frozen_assessment


def problem(code: str, *, status: int = 409) -> AppError:
    return AppError(
        status_code=status, code=code, message=code.replace("_", " ").capitalize() + "."
    )


async def control(repo: Repository, payload: Control, at: datetime | None = None) -> None:
    await repo.lock()
    now = at or datetime.now(UTC)
    state = await repo.configuration()
    if payload.revision != (state.revision if state else None):
        raise problem("stale_settings")
    if state is None:
        state = SemiAutoSettings(id=1, settings=RiskSettings().model_dump(mode="json"))
        repo.db.add(state)
    if payload.action == "enable":
        if not state.acknowledged_at and not payload.acknowledged:
            raise problem("acknowledgement_required")
        state.acknowledged_at = state.acknowledged_at or now
        state.enabled, state.killed, state.accept_after = True, False, now
    elif payload.action == "settings":
        if payload.settings is None:
            raise problem("invalid_settings", status=422)
        state.settings = payload.settings.model_dump(mode="json")
        state.accept_after = now if state.enabled else None
    else:
        state.enabled = False
        state.killed = state.killed or payload.action == "kill"
        state.accept_after = None
    state.revision = uuid4()
    for intent in await repo.pending():
        intent.status = "CANCELLED_BY_RISK"
        intent.risk_reason = "settings_changed" if state.enabled else "disabled"
        repo.audit("risk_blocked", now, intent, intent.risk_reason)
    repo.audit("settings_" + payload.action, now)
    await repo.db.commit()


async def tick(repo: Repository, at: datetime | None = None) -> dict[str, int]:
    await repo.lock()
    now = at or datetime.now(UTC)
    for intent in await repo.pending():
        if now >= utc(intent.expires_at):
            intent.status = "EXPIRED"
            repo.audit("intent_expired", now, intent, "signal_expired")
    opened = blocked = 0
    state = await repo.configuration()
    if state and state.enabled and not state.killed and state.accept_after:
        settings = RiskSettings.model_validate(state.settings)
        active = await repo.active()
        daily = await repo.daily_pnl(now)
        shadow = ShadowRepository(repo.db)
        for signal in await repo.candidates(utc(state.accept_after), now):
            assessment = frozen_assessment(signal)
            if assessment is None or signal.horizon_minutes not in (10, 30):
                continue
            horizon = signal.horizon_minutes
            reason = None
            atr = None
            if assessment.state not in ("STRONG_HIGHER", "STRONG_LOWER"):
                reason = "signal_not_strong"
            elif signal.score < settings.minimum_score:
                reason = "score_below_threshold"
            elif signal.symbol not in settings.markets:
                reason = "market_disabled"
            elif horizon not in settings.horizons:
                reason = "horizon_disabled"
            elif now >= utc(signal.confirmed_at) + FRESHNESS or signal.result != "pending":
                reason = "signal_expired"
            elif not await SimulatorRepository(repo.db).has_closed_trigger(signal):
                reason = "invalid_trigger"
            elif await shadow.macro_blocked(now, known_at=now):
                reason = "macro_event"
            else:
                atr = await repo.atr(signal, horizon)
                if (
                    atr is None
                    or await repo.index_price(signal.reference_instrument_id, now) is None
                ):
                    reason = "stale_data"
                else:
                    reason = risk_block(
                        state,
                        settings,
                        (signal.market_instrument_id, horizon),
                        active,
                        daily,
                        settings.fixed_stake,
                        now,
                    )
            expiry = min(utc(signal.generated_at) + TTL[horizon], utc(signal.expires_at))
            if expiry <= now:
                reason = "signal_expired"
            minimum = settings.minimum_payout(horizon)
            intent = LiveIntent(
                id=uuid4(),
                settings_revision=state.revision,
                event_signal_id=signal.id,
                market_instrument_id=signal.market_instrument_id,
                symbol=signal.symbol,
                horizon_minutes=horizon,
                direction=signal.direction,
                signal_state=assessment.state,
                signal_score=signal.score,
                signal_version=signal.version,
                strategy_version=VERSION,
                signal_reference_price=signal.reference_price,
                signal_reference_source=signal.reference_source,
                signal_atr=atr,
                generated_at=signal.generated_at,
                created_at=now,
                expires_at=expiry,
                status="CANCELLED_BY_RISK" if reason else "PENDING_REVIEW",
                risk_reason=reason,
                settings_snapshot=state.settings.copy(),
                suggested_stake=settings.fixed_stake,
                minimum_payout=minimum,
                breakeven_probability=breakeven(minimum),
            )
            repo.db.add(intent)
            await repo.db.flush()
            repo.audit("signal_received", now, intent)
            repo.audit("risk_blocked" if reason else "intent_created", now, intent, reason)
            blocked += int(reason is not None)
            opened += int(reason is None)
    await repo.db.commit()
    return {"opened": opened, "blocked": blocked}


async def get_intent(repo: Repository, intent_id: UUID) -> LiveIntent:
    intent = await repo.db.get(LiveIntent, intent_id)
    if intent is None:
        raise problem("intent_not_found", status=404)
    return intent


async def reject_attempt(repo: Repository, intent: LiveIntent, reason: str, now: datetime) -> Never:
    repo.audit("action_blocked", now, intent, reason)
    await repo.db.commit()
    raise problem(reason)


async def valid_pending(repo: Repository, intent: LiveIntent, now: datetime) -> None:
    if intent.status == "EXPIRED" or (intent.status in PENDING and now >= utc(intent.expires_at)):
        if intent.status != "EXPIRED":
            intent.status = "EXPIRED"
            repo.audit("intent_expired", now, intent, "signal_expired")
        await reject_attempt(repo, intent, "signal_expired", now)
    if intent.status not in PENDING:
        raise problem("intent_not_actionable")


async def review_risk(
    repo: Repository, intent: LiveIntent, stake: Decimal, now: datetime
) -> Decimal:
    await valid_pending(repo, intent, now)
    state = await repo.configuration()
    if not state or not state.enabled or state.killed or state.revision != intent.settings_revision:
        await reject_attempt(repo, intent, "disabled", now)
    settings = RiskSettings.model_validate(intent.settings_snapshot)
    reason = risk_block(
        state,
        settings,
        (intent.market_instrument_id, intent.horizon_minutes),
        await repo.active(),
        await repo.daily_pnl(now),
        stake,
        now,
    )
    if reason is None and await ShadowRepository(repo.db).macro_blocked(now, known_at=now):
        reason = "macro_event"
    if reason is not None:
        await reject_attempt(repo, intent, reason, now)
    signal = await repo.db.get(EventShadowSignal, intent.event_signal_id)
    observed = await repo.index_price(signal.reference_instrument_id, now) if signal else None
    distance = drift(intent, observed)
    if distance is None:
        await reject_attempt(repo, intent, "stale_data", now)
    return distance


async def decide(
    repo: Repository, intent_id: UUID, payload: IntentAction, at: datetime | None = None
) -> LiveIntent:
    await repo.lock()
    now = at or datetime.now(UTC)
    intent = await get_intent(repo, intent_id)
    if payload.action == "reject":
        if intent.status == "REJECTED_BY_USER":
            return intent
        await valid_pending(repo, intent, now)
        intent.status = "REJECTED_BY_USER"
        intent.reject_reason = payload.reason
        repo.audit("intent_rejected", now, intent, payload.reason)
    else:
        if not payload.acknowledged:
            raise problem("acknowledgement_required")
        await review_risk(repo, intent, intent.suggested_stake, now)
        if payload.action == "approve":
            if payload.payout is None or payload.payout < intent.minimum_payout:
                await reject_attempt(repo, intent, "payout_low", now)
            intent.status = "APPROVED_BY_USER"
            intent.approved_payout = payload.payout
            repo.audit("intent_approved", now, intent)
        else:
            repo.audit("binance_handoff", now, intent)
    await repo.db.commit()
    return intent


async def confirm(
    repo: Repository, intent_id: UUID, payload: Confirm, at: datetime | None = None
) -> RealBet:
    await repo.lock()
    now = at or datetime.now(UTC)
    intent = await get_intent(repo, intent_id)
    existing = await repo.db.scalar(select(RealBet).where(RealBet.intent_id == intent.id))
    reference = (payload.order_reference or "").strip() or None
    notes = (payload.notes or "").strip() or None
    if existing:
        if (
            existing.actual_premium == payload.actual_premium
            and existing.actual_payout == payload.actual_payout
            and utc(existing.actual_open_at) == utc(payload.actual_open_at)
            and utc(existing.expiry_at) == utc(payload.actual_expiry_at)
            and existing.actual_open_price == payload.actual_open_price
            and existing.direction == payload.direction
            and existing.horizon_minutes == payload.horizon_minutes
            and existing.order_reference == reference
            and existing.notes == notes
        ):
            return existing
        raise problem("already_executed")
    await valid_pending(repo, intent, now)
    if intent.status != "APPROVED_BY_USER":
        raise problem("approval_required")
    if payload.direction != intent.direction or payload.horizon_minutes != intent.horizon_minutes:
        raise problem("identity_mismatch")
    if payload.actual_payout < intent.minimum_payout:
        await reject_attempt(repo, intent, "payout_low", now)
    if not (
        utc(intent.generated_at)
        <= utc(payload.actual_open_at)
        <= now
        < utc(payload.actual_expiry_at)
        <= utc(payload.actual_open_at) + timedelta(minutes=intent.horizon_minutes + 1)
        and utc(payload.actual_expiry_at)
        >= utc(payload.actual_open_at) + timedelta(minutes=intent.horizon_minutes - 1)
    ):
        raise problem("invalid_execution_times", status=422)
    distance = await review_risk(repo, intent, payload.actual_premium, now)
    if distance > RiskSettings.model_validate(intent.settings_snapshot).max_drift_atr:
        if not payload.drift_acknowledged:
            await reject_attempt(repo, intent, "price_drift", now)
        repo.audit("drift_acknowledged", now, intent, "price_drift")
    if reference and await repo.db.scalar(
        select(RealBet.id).where(RealBet.order_reference == reference)
    ):
        await reject_attempt(repo, intent, "duplicate_order_reference", now)
    bet = RealBet(
        id=uuid4(),
        intent_id=intent.id,
        event_signal_id=intent.event_signal_id,
        market_instrument_id=intent.market_instrument_id,
        symbol=intent.symbol,
        horizon_minutes=intent.horizon_minutes,
        direction=intent.direction,
        signal_score=intent.signal_score,
        signal_reference_price=intent.signal_reference_price,
        actual_open_price=payload.actual_open_price,
        actual_open_at=utc(payload.actual_open_at),
        expiry_at=utc(payload.actual_expiry_at),
        actual_premium=payload.actual_premium,
        actual_payout=payload.actual_payout,
        breakeven_probability=breakeven(payload.actual_payout),
        order_reference=reference,
        notes=notes,
        settings_snapshot=intent.settings_snapshot.copy(),
        status="OPEN",
        settlement_source="UNKNOWN",
        created_at=now,
    )
    intent.status = "EXECUTED_MANUALLY"
    repo.db.add(bet)
    repo.audit("execution_confirmed", now, intent)
    await repo.db.commit()
    return bet


async def settle(
    repo: Repository, bet_id: UUID, payload: Settle, at: datetime | None = None
) -> RealBet:
    await repo.lock()
    now = at or datetime.now(UTC)
    bet = await repo.db.get(RealBet, bet_id)
    if not bet:
        raise problem("real_bet_not_found", status=404)
    if now < utc(bet.expiry_at):
        raise problem("awaiting_expiry")
    try:
        gross, pnl = returns(
            bet.actual_premium, bet.actual_payout, payload.result, payload.actual_return
        )
    except ValueError as exc:
        raise problem("actual_return_required", status=422) from exc
    if payload.actual_return is not None and payload.actual_return != gross:
        raise problem("return_mismatch", status=422)
    if bet.status != "OPEN":
        if (
            bet.status == payload.result
            and bet.gross_return == gross
            and bet.settlement_price == payload.settlement_price
        ):
            return bet
        raise problem("already_settled")
    intent = await get_intent(repo, bet.intent_id)
    state = await repo.configuration()
    if state is None:
        raise problem("settings_unavailable")
    apply_loss(state, RiskSettings.model_validate(state.settings), payload.result, now)
    bet.status = payload.result
    bet.settlement_source = "MANUAL_CONFIRMATION"
    bet.settlement_confidence = "operator_reported"
    bet.settlement_price = payload.settlement_price
    bet.settled_at = now
    bet.gross_return, bet.net_pnl = gross, pnl
    intent.status = "SETTLED"
    repo.audit("settlement_confirmed", now, intent, payload.result)
    await repo.db.commit()
    return bet
