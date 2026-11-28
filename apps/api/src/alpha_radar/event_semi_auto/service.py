import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Never
from uuid import UUID, uuid4

from sqlalchemy import select

from alpha_radar.config import get_settings
from alpha_radar.errors import AppError
from alpha_radar.event_contracts.shadow_models import EventShadowSignal
from alpha_radar.event_contracts.shadow_repository import ShadowRepository
from alpha_radar.event_contracts.shadow_rules import FRESHNESS
from alpha_radar.event_contracts.strategy import utc
from alpha_radar.event_semi_auto.execution_contract import (
    ExecutionError,
    ExecutionRequest,
    ExecutionResult,
)
from alpha_radar.event_semi_auto.execution_lifecycle import (
    PRE_EXECUTION,
    STARTED,
    elapsed_ms,
    owns_dispatch_claim,
    transition,
)
from alpha_radar.event_semi_auto.models import LiveIntent, RealBet, SemiAutoSettings
from alpha_radar.event_semi_auto.repository import RECOVERABLE_HANDOFF, Repository
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
        if intent.execution_status in STARTED:
            continue
        intent.status = "CANCELLED_BY_RISK"
        transition(intent, "CANCELLED")
        intent.risk_reason = "settings_changed" if state.enabled else "disabled"
        repo.audit("risk_blocked", now, intent, intent.risk_reason)
    repo.audit("settings_" + payload.action, now)
    await repo.db.commit()


async def tick(repo: Repository, at: datetime | None = None) -> dict[str, int]:
    await repo.lock()
    now = at or datetime.now(UTC)
    for intent in await repo.pending():
        if now >= utc(intent.execution_deadline or intent.expires_at):
            intent.status = "EXPIRED"
            if intent.execution_status in STARTED:
                transition(intent, "RECONCILIATION_REQUIRED")
                repo.audit("reconciliation_required", now, intent, "execution_outcome_unknown")
            else:
                transition(intent, "EXPIRED")
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
                execution_adapter=get_settings().live_execution_adapter,
                execution_status="CREATED",
                execution_deadline=expiry,
            )
            transition(intent, "CANCELLED" if reason else "RISK_APPROVED")
            repo.db.add(intent)
            await repo.db.flush()
            repo.audit("signal_received", now, intent)
            repo.audit("intent_created", now, intent)
            repo.audit("risk_blocked" if reason else "risk_approved", now, intent, reason)
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
    if intent.status == "EXPIRED" or (
        intent.status in PENDING and now >= utc(intent.execution_deadline or intent.expires_at)
    ):
        if intent.status != "EXPIRED":
            intent.status = "EXPIRED"
            if intent.execution_status in STARTED:
                transition(intent, "RECONCILIATION_REQUIRED")
                repo.audit("reconciliation_required", now, intent, "execution_outcome_unknown")
            else:
                transition(intent, "EXPIRED")
            repo.audit("intent_expired", now, intent, "signal_expired")
        await reject_attempt(repo, intent, "signal_expired", now)
    if intent.status not in PENDING:
        raise problem("intent_not_actionable")


async def review_risk(
    repo: Repository, intent: LiveIntent, stake: Decimal, now: datetime, *, save_drift: bool = False
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
    if save_drift and observed is not None:
        absolute = abs(observed - intent.signal_reference_price)
        intent.pre_execution_drift_absolute = absolute
        intent.pre_execution_drift_percent = absolute * 100 / intent.signal_reference_price
        intent.pre_execution_drift_atr = distance
    return distance


async def start_execution(
    repo: Repository, intent: LiveIntent, payload: IntentAction, now: datetime, at: datetime | None
) -> LiveIntent:
    await valid_pending(repo, intent, now)
    if intent.execution_status not in PRE_EXECUTION or intent.execution_id is not None:
        raise problem("intent_not_actionable")
    if not repo.execution_enabled:
        await reject_attempt(repo, intent, "live_execution_disabled", now)
    kind = intent.execution_adapter
    deadline = intent.execution_deadline
    if kind is None or deadline is None:
        await reject_attempt(repo, intent, "intent_not_actionable", now)
    if await repo.unresolved(intent.id):
        await reject_attempt(repo, intent, "reconciliation_pending", now)
    adapter = repo.execution_adapter(kind)
    health = adapter.health()
    if not adapter.availability() or not health.available or not health.healthy:
        await reject_attempt(repo, intent, "adapter_unavailable", now)
    if (payload.action == "handoff") != (kind == "MOBILE_HANDOFF"):
        await reject_attempt(repo, intent, "adapter_mismatch", now)
    distance = await review_risk(repo, intent, intent.suggested_stake, now, save_drift=True)
    payout = payload.payout
    if payout is None or payout < intent.minimum_payout:
        await reject_attempt(repo, intent, "BLOCKED_PAYOUT", now)
    if distance > RiskSettings.model_validate(intent.settings_snapshot).max_drift_atr:
        if not payload.drift_acknowledged:
            await reject_attempt(repo, intent, "price_drift", now)
        repo.audit("drift_acknowledged", now, intent, "price_drift")
    if intent.execution_status == "RISK_APPROVED":
        transition(intent, "READY_FOR_EXECUTION")
    transition(intent, "EXECUTING")
    execution_id = uuid4()
    intent.execution_id = execution_id
    intent.execution_started_at = now
    intent.approved_payout = payout
    intent.status = "APPROVED_BY_USER"
    repo.audit("execution_started", now, intent)
    # Commit the one-time claim before dispatch. A process exit leaves a recoverable
    # attempt, so no later request can dispatch the same intent.
    await repo.db.commit()
    await repo.lock()
    await repo.db.refresh(intent)
    now = at or datetime.now(UTC)
    state = await repo.configuration()
    if not owns_dispatch_claim(intent, execution_id):
        raise problem("intent_not_actionable")
    if (
        not repo.execution_enabled
        or not state
        or not state.enabled
        or state.killed
        or state.revision != intent.settings_revision
        or now >= utc(deadline)
    ):
        transition(intent, "CANCELLED")
        intent.status = "CANCELLED_BY_RISK"
        await reject_attempt(
            repo, intent, "signal_expired" if now >= utc(deadline) else "disabled", now
        )
    limits = RiskSettings.model_validate(intent.settings_snapshot)
    changed_risk = risk_block(
        state,
        limits,
        (intent.market_instrument_id, intent.horizon_minutes),
        await repo.active(),
        await repo.daily_pnl(now),
        intent.suggested_stake,
        now,
    )
    if changed_risk:
        transition(intent, "CANCELLED")
        intent.status = "CANCELLED_BY_RISK"
        intent.risk_reason = changed_risk
        await reject_attempt(repo, intent, changed_risk, now)
    request = ExecutionRequest(
        execution_id=execution_id,
        intent_id=intent.id,
        signal_id=intent.event_signal_id,
        market_instrument_id=intent.market_instrument_id,
        symbol=intent.symbol,
        horizon_minutes=intent.horizon_minutes,
        direction=intent.direction,
        premium=intent.suggested_stake,
        checked_payout=payout,
        reference_price=intent.signal_reference_price,
        deadline=deadline,
    )
    error: ExecutionError | None = None
    try:
        adapter.prepare(request)
    except Exception:
        error = "adapter_failed"
    else:
        try:
            async with asyncio.timeout(min(2.0, (utc(deadline) - now).total_seconds())):
                result = await adapter.execute(request)
            if result.intent_id != intent.id or result.execution_id != execution_id:
                error = "execution_outcome_unknown"
            elif result.status == "FAILED":
                error = "adapter_failed"
            elif result.status != ("HANDOFF_STARTED" if kind == "MOBILE_HANDOFF" else "EXECUTING"):
                error = "execution_outcome_unknown"
        except Exception:
            error = "execution_outcome_unknown"
    completed = at or datetime.now(UTC)
    intent.adapter_completed_at = completed
    if error:
        intent.adapter_error = error
        if error == "adapter_failed":
            transition(intent, "FAILED")
            intent.execution_completed_at = completed
            intent.status = "CANCELLED_BY_RISK"
            repo.audit("execution_failed", completed, intent, error)
        else:
            transition(intent, "RECONCILIATION_REQUIRED")
            repo.audit("reconciliation_required", completed, intent, error)
        await reject_attempt(repo, intent, error, completed)
    if kind == "MOBILE_HANDOFF":
        transition(intent, "HANDOFF_STARTED")
        intent.handoff_started_at = completed
        repo.audit("binance_handoff", completed, intent)
    await repo.db.commit()
    return intent


async def decide(
    repo: Repository, intent_id: UUID, payload: IntentAction, at: datetime | None = None
) -> LiveIntent:
    await repo.lock()
    now = at or datetime.now(UTC)
    intent = await get_intent(repo, intent_id)
    if payload.action == "return":
        if intent.handoff_started_at is None:
            raise problem("handoff_required")
        mark_return(repo, intent, now)
    elif payload.action in ("reject", "reconcile_no_order"):
        if intent.status == "REJECTED_BY_USER":
            return intent
        if intent.execution_status in STARTED:
            if payload.action != "reconcile_no_order" or not payload.acknowledged:
                raise problem("execution_evidence_required")
            if intent.execution_adapter is not None:
                repo.execution_adapter(intent.execution_adapter).cancel(intent.id)
            repo.audit("execution_no_order_verified", now, intent)
            intent.execution_completed_at = now
            if intent.handoff_started_at is not None:
                mark_return(repo, intent, now)
        elif payload.action == "reconcile_no_order":
            raise problem("intent_not_actionable")
        elif intent.handoff_started_at and intent.status in RECOVERABLE_HANDOFF:
            mark_return(repo, intent, now)  # grandfather a pre-migration handoff
        else:
            await valid_pending(repo, intent, now)
        intent.status = "REJECTED_BY_USER"
        transition(intent, "CANCELLED")
        intent.reject_reason = payload.reason
        repo.audit("intent_rejected", now, intent, payload.reason)
    else:
        if not payload.acknowledged:
            raise problem("acknowledgement_required")
        if payload.action != "approve":
            return await start_execution(repo, intent, payload, now, at)
        await valid_pending(repo, intent, now)
        if intent.execution_status not in PRE_EXECUTION:
            raise problem("intent_not_actionable")
        if not repo.execution_enabled:
            await reject_attempt(repo, intent, "live_execution_disabled", now)
        await review_risk(repo, intent, intent.suggested_stake, now)
        if payload.payout is None or payload.payout < intent.minimum_payout:
            await reject_attempt(repo, intent, "BLOCKED_PAYOUT", now)
        transition(intent, "READY_FOR_EXECUTION")
        intent.status = "APPROVED_BY_USER"
        intent.approved_payout = payload.payout
        repo.audit("intent_approved", now, intent)
    await repo.db.commit()
    return intent


def mark_return(repo: Repository, intent: LiveIntent, now: datetime) -> None:
    if intent.returned_at is None:
        intent.returned_at = now
        repo.audit("binance_returned", now, intent)


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
    direction_mismatch = payload.direction != intent.direction
    horizon_mismatch = payload.horizon_minutes != intent.horizon_minutes
    payout_below = payload.actual_payout < intent.minimum_payout
    earliest = utc(intent.generated_at)
    started_at = intent.handoff_started_at or intent.execution_started_at
    if intent.execution_status is not None:
        if (
            not started_at
            or intent.execution_status not in STARTED
            or (intent.adapter_completed_at is None and intent.execution_status == "EXECUTING")
        ):
            await valid_pending(repo, intent, now)
            raise problem("approval_required")
        if (
            intent.execution_status == "RECONCILIATION_REQUIRED"
            or now >= utc(intent.execution_deadline or intent.expires_at)
        ) and reference is None:
            raise problem("execution_evidence_required")
    elif not payload.record_handoff or intent.handoff_started_at is None:
        await valid_pending(repo, intent, now)
        raise problem("approval_required")
    recorded_handoff = payload.record_handoff or intent.execution_status in STARTED
    if recorded_handoff:
        if started_at is None or intent.status not in RECOVERABLE_HANDOFF:
            raise problem("handoff_required")
        earliest = utc(started_at).replace(microsecond=0)
        if utc(started_at) >= utc(intent.execution_deadline or intent.expires_at):
            raise problem("handoff_required")
        if (direction_mismatch or horizon_mismatch) and not payload.mismatch_acknowledged:
            raise problem("identity_mismatch")
    opened = utc(payload.actual_open_at)
    expiry = utc(payload.actual_expiry_at)
    if not (
        earliest <= opened <= now
        and opened < utc(intent.execution_deadline or intent.expires_at)
        and opened + timedelta(minutes=payload.horizon_minutes - 1)
        <= expiry
        <= opened + timedelta(minutes=payload.horizon_minutes + 1)
    ):
        raise problem("invalid_execution_times", status=422)
    if any(
        bet.market_instrument_id == intent.market_instrument_id
        and bet.horizon_minutes == payload.horizon_minutes
        for bet in await repo.active()
    ):
        raise problem("existing_active_bet")
    if reference and await repo.db.scalar(
        select(RealBet.id).where(RealBet.order_reference == reference)
    ):
        await reject_attempt(repo, intent, "duplicate_order_reference", now)
    late = now >= utc(intent.expires_at)
    absolute_drift = abs(payload.actual_open_price - intent.signal_reference_price)
    handed_at = utc(intent.handoff_started_at) if intent.handoff_started_at else None
    if handed_at:
        mark_return(repo, intent, now)
    if late:
        repo.audit("late_execution_confirmation", now, intent)
    if payout_below:
        repo.audit("payout_below_policy", now, intent)
    if direction_mismatch or horizon_mismatch:
        repo.audit("execution_identity_mismatch", now, intent)
    if intent.execution_adapter is not None and intent.execution_id is not None:
        result = ExecutionResult(
            execution_id=intent.execution_id,
            intent_id=intent.id,
            provider="operator_reported",
            status="EXECUTED",
            actual_premium=payload.actual_premium,
            actual_payout=payload.actual_payout,
            actual_open_price=payload.actual_open_price,
            actual_open_time=opened,
            external_reference=reference,
        )
        if repo.execution_adapter(intent.execution_adapter).reconcile(result) != result:
            await reject_attempt(repo, intent, "execution_evidence_required", now)
        intent.execution_completed_at = now
    bet = RealBet(
        id=uuid4(),
        intent_id=intent.id,
        event_signal_id=intent.event_signal_id,
        market_instrument_id=intent.market_instrument_id,
        symbol=intent.symbol,
        horizon_minutes=payload.horizon_minutes,
        direction=payload.direction,
        signal_score=intent.signal_score,
        signal_reference_price=intent.signal_reference_price,
        actual_open_price=payload.actual_open_price,
        actual_open_at=opened,
        expiry_at=expiry,
        actual_premium=payload.actual_premium,
        actual_payout=payload.actual_payout,
        breakeven_probability=breakeven(payload.actual_payout),
        order_reference=reference,
        notes=notes,
        settings_snapshot=intent.settings_snapshot.copy(),
        status="OPEN",
        settlement_source="UNKNOWN",
        created_at=now,
        late_execution_confirmation=late,
        payout_below_policy=payout_below,
        direction_mismatch=direction_mismatch,
        horizon_mismatch=horizon_mismatch,
        price_drift_absolute=absolute_drift,
        price_drift_percent=(
            absolute_drift * 100 / intent.signal_reference_price
            if intent.signal_reference_price > 0
            else None
        ),
        price_drift_atr=absolute_drift / intent.signal_atr if intent.signal_atr else None,
        signal_to_handoff_ms=(
            int((handed_at - utc(intent.generated_at)).total_seconds() * 1000)
            if handed_at
            else None
        ),
        handoff_to_execution_ms=(
            max(0, int((opened - handed_at).total_seconds() * 1000)) if handed_at else None
        ),
        signal_to_execution_ms=(elapsed_ms(intent.generated_at, opened) if started_at else None),
    )
    intent.status = "EXECUTED_MANUALLY"
    transition(intent, "EXECUTED")
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
    transition(intent, "SETTLED")
    repo.audit("settlement_confirmed", now, intent, payload.result)
    await repo.db.commit()
    return bet
