from datetime import datetime
from decimal import Decimal
from math import ceil
from statistics import median
from uuid import UUID

from pydantic import ValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import func, select

from alpha_radar.config import get_settings
from alpha_radar.event_contracts.shadow_models import EventShadowSignal
from alpha_radar.event_contracts.shadow_repository import ShadowRepository
from alpha_radar.event_contracts.shadow_rules import snapshot_key
from alpha_radar.event_contracts.shadow_schemas import ShadowResponse
from alpha_radar.event_contracts.strategy import utc
from alpha_radar.event_semi_auto.execution_adapters import ADAPTER_KINDS
from alpha_radar.event_semi_auto.execution_contract import AdapterHealth, ExecutionResult
from alpha_radar.event_semi_auto.execution_lifecycle import STARTED, elapsed_ms
from alpha_radar.event_semi_auto.models import LiveIntent, RealBet
from alpha_radar.event_semi_auto.repository import Repository
from alpha_radar.event_semi_auto.rules import PENDING, drift, performance
from alpha_radar.event_semi_auto.schemas import (
    BetView,
    ComparisonRow,
    HandoffMetrics,
    IntentView,
    RiskSettings,
    SignalCard,
    State,
)
from alpha_radar.event_simulator.models import SimulationBet, SimulationSession


async def intent_view(repo: Repository, intent: LiveIntent, now: datetime) -> IntentView:
    view = IntentView.model_validate(intent)
    if intent.execution_adapter is not None:
        view.signal_to_intent_ms = elapsed_ms(intent.generated_at, intent.created_at)
        if intent.execution_started_at is not None:
            view.intent_to_execution_ms = elapsed_ms(intent.created_at, intent.execution_started_at)
        if intent.execution_id is not None and intent.execution_status in (
            "FAILED",
            "RECONCILIATION_REQUIRED",
        ):
            view.execution = ExecutionResult(
                execution_id=intent.execution_id,
                intent_id=intent.id,
                provider="operator_reported",
                status=intent.execution_status,
                error_code=intent.adapter_error or "execution_outcome_unknown",
                error_message_safe=(
                    "The execution adapter failed before producing a usable result."
                    if intent.execution_status == "FAILED"
                    else "Verify the exchange order history before resolving this intent."
                ),
            )
    if intent.status not in PENDING or intent.execution_status in STARTED:
        return view
    if utc(intent.expires_at) <= now:
        return view.model_copy(
            update={
                "status": "EXPIRED",
                "risk_reason": "signal_expired",
                "execution_status": "EXPIRED" if intent.execution_status is not None else None,
            }
        )
    signal = await repo.db.get(EventShadowSignal, intent.event_signal_id)
    price = await repo.index_price(signal.reference_instrument_id, now) if signal else None
    distance = drift(intent, price)
    return view.model_copy(
        update={
            "drift_atr": distance,
            "drift_warning": distance is not None
            and distance > view.settings_snapshot.max_drift_atr,
            "risk_reason": "stale_data" if distance is None else view.risk_reason,
        }
    )


async def cards(repo: Repository, settings: RiskSettings, now: datetime) -> list[SignalCard]:
    shadow = ShadowRepository(repo.db)
    pending = {
        (item.market_instrument_id, item.horizon_minutes): item
        for item in await repo.pending()
        if utc(item.expires_at) > now and item.execution_status not in STARTED
    }
    values: list[SignalCard] = []
    redis = Redis.from_url(get_settings().redis_url)  # pyright: ignore[reportUnknownMemberType]
    try:
        for symbol in ("BTCUSDT", "ETHUSDT"):
            instrument = await shadow.instrument(symbol=symbol)
            for horizon in (10, 30):
                card = SignalCard(
                    symbol=symbol,
                    horizon_minutes=horizon,
                    minimum_payout=settings.minimum_payout(horizon),
                    suggested_stake=settings.fixed_stake,
                )
                values.append(card)
                if instrument is None:
                    continue
                item = pending.get((instrument.id, horizon))
                if item:
                    card.intent = await intent_view(repo, item, now)
                try:
                    value = await redis.get(snapshot_key(instrument.id, horizon))
                    snapshot = ShadowResponse.model_validate_json(value) if value else None
                except (RedisError, ValidationError):
                    continue
                if (
                    snapshot
                    and snapshot.market_instrument_id == instrument.id
                    and snapshot.asset_id == instrument.asset_id
                    and snapshot.horizon_minutes == horizon
                    and snapshot.valid_until
                    and utc(snapshot.valid_until) > now
                ):
                    card.assessment = snapshot.assessment
    finally:
        await redis.aclose()
    return values


async def handoff_metrics(repo: Repository, now: datetime) -> HandoffMetrics:
    intents = LiveIntent
    bets = RealBet
    statuses = (
        (
            await repo.db.execute(
                select(intents.status, intents.expires_at, intents.returned_at).where(
                    intents.handoff_started_at.is_not(None)
                )
            )
        )
        .tuples()
        .all()
    )
    executions = (
        (
            await repo.db.execute(
                select(
                    bets.signal_to_execution_ms,
                    bets.payout_below_policy,
                    bets.price_drift_atr,
                    bets.settings_snapshot,
                ).where(bets.signal_to_handoff_ms.is_not(None))
            )
        )
        .tuples()
        .all()
    )
    latencies = sorted(ms for ms, _, _, _ in executions if ms is not None)
    above = sum(
        atr is not None and atr > RiskSettings.model_validate(snapshot).max_drift_atr
        for _, _, atr, snapshot in executions
    )
    unavailable = sum(atr is None for _, _, atr, _ in executions)
    return HandoffMetrics(
        opened=len(statuses),
        executed=len(executions),
        skipped=sum(status == "REJECTED_BY_USER" for status, _, _ in statuses),
        expired_during_handoff=sum(
            utc(expires) <= utc(returned)
            if returned
            else status == "EXPIRED" or (status == "APPROVED_BY_USER" and utc(expires) <= now)
            for status, expires, returned in statuses
        ),
        payout_below_policy=sum(below for _, below, _, _ in executions),
        median_signal_to_execution_ms=int(median(latencies)) if latencies else None,
        p90_signal_to_execution_ms=latencies[ceil(len(latencies) * 0.9) - 1] if latencies else None,
        drift_within_limit=len(executions) - above - unavailable,
        drift_above_limit=above,
        drift_unavailable=unavailable,
    )


def bet_view(bet: RealBet, intent: LiveIntent | None) -> BetView:
    view = BetView.model_validate(bet)
    if intent is not None and intent.execution_id is not None:
        view.execution = ExecutionResult(
            execution_id=intent.execution_id,
            intent_id=intent.id,
            provider="operator_reported",
            status="EXECUTED",
            actual_premium=bet.actual_premium,
            actual_payout=bet.actual_payout,
            actual_open_price=bet.actual_open_price,
            actual_open_time=bet.actual_open_at,
            external_reference=bet.order_reference,
        )
        view.signal_to_intent_ms = elapsed_ms(intent.generated_at, intent.created_at)
        view.intent_to_execution_ms = elapsed_ms(intent.created_at, bet.actual_open_at)
    return view


async def adapter_health(repo: Repository) -> list[AdapterHealth]:
    i = LiveIntent
    rows = (
        (
            await repo.db.execute(
                select(
                    i.execution_adapter,
                    func.max(i.adapter_completed_at).filter(i.adapter_error.is_(None)),
                    func.max(i.adapter_completed_at).filter(i.adapter_error.is_not(None)),
                    func.count(),
                    func.count(i.adapter_error),
                    func.max(i.adapter_completed_at),
                )
                .where(i.adapter_completed_at.is_not(None))
                .group_by(i.execution_adapter)
            )
        )
        .tuples()
        .all()
    )
    summaries = {
        kind: (success, failure, total, errors, last)
        for kind, success, failure, total, errors, last in rows
    }
    health: list[AdapterHealth] = []
    for kind in ADAPTER_KINDS:
        status = repo.execution_adapter(kind).health()
        summary = summaries.get(kind)
        if summary:
            success, failure, total, errors, last = summary
            latest = await repo.db.scalar(
                select(i.execution_started_at)
                .where(i.execution_adapter == kind, i.adapter_completed_at == last)
                .order_by(i.id)
                .limit(1)
            )
            status.last_success = success
            status.last_failure = failure
            status.error_rate = errors / total
            status.latency_ms = elapsed_ms(latest, last) if latest and last else None
        health.append(status)
    return health


async def read_state(
    repo: Repository, now: datetime, intent_before: UUID | None, bet_before: UUID | None
) -> State:
    config = await repo.configuration()
    settings = RiskSettings.model_validate(config.settings) if config else RiskSettings()
    intents, next_intent = await repo.page(LiveIntent, intent_before)
    history, next_bet = await repo.page(RealBet, bet_before)
    real_rows = (
        (
            await repo.db.execute(
                select(
                    RealBet.symbol,
                    RealBet.horizon_minutes,
                    RealBet.actual_open_at,
                    RealBet.status,
                    RealBet.actual_premium,
                    RealBet.actual_payout,
                    RealBet.net_pnl,
                    RealBet.signal_to_execution_ms,
                    RealBet.price_drift_atr,
                ).order_by(RealBet.settled_at.asc().nulls_last(), RealBet.id)
            )
        )
        .tuples()
        .all()
    )
    real = performance(
        [(status, stake, payout, net) for _, _, _, status, stake, payout, net, _, _ in real_rows]
    )
    latency = [ms for *_, ms, _ in real_rows if ms is not None]
    drifts = [atr for *_, atr in real_rows if atr is not None]
    real.median_signal_to_execution_ms = int(median(latency)) if latency else None
    real.average_price_drift_atr = sum(drifts, Decimal(0)) / len(drifts) if drifts else None
    counts = dict(
        (await repo.db.execute(select(LiveIntent.status, func.count()).group_by(LiveIntent.status)))
        .tuples()
        .all()
    )
    paper = await repo.db.scalar(
        select(SimulationSession).where(SimulationSession.status != "archived")
    )
    comparison: list[ComparisonRow] = []
    start = end = None
    if paper and real_rows:
        start = max(utc(paper.started_at), min(utc(row[2]) for row in real_rows))
        end = min(now, utc(paper.stopped_at) if paper.stopped_at else now)
        if start < end:
            paper_rows = (
                (
                    await repo.db.execute(
                        select(
                            SimulationBet.symbol,
                            SimulationBet.horizon_minutes,
                            SimulationBet.status,
                            SimulationBet.virtual_stake,
                            SimulationBet.payout_multiplier,
                            SimulationBet.net_pnl,
                        )
                        .where(
                            SimulationBet.simulation_session_id == paper.id,
                            SimulationBet.bet_created_at.between(start, end),
                        )
                        .order_by(SimulationBet.settled_at.asc().nulls_last(), SimulationBet.id)
                    )
                )
                .tuples()
                .all()
            )
            for symbol in ("BTCUSDT", "ETHUSDT"):
                for horizon in (10, 30):
                    comparison.append(
                        ComparisonRow(
                            symbol=symbol,
                            horizon_minutes=horizon,
                            paper=performance(
                                [
                                    (status.upper(), stake, payout, net)
                                    for sym, term, status, stake, payout, net in paper_rows
                                    if sym == symbol and term == horizon
                                ]
                            ),
                            real=performance(
                                [
                                    (status, stake, payout, net)
                                    for sym, term, at, status, stake, payout, net, _, _ in real_rows
                                    if sym == symbol and term == horizon and start <= utc(at) <= end
                                ]
                            ),
                        )
                    )
    active = await repo.active()
    bet_intent_ids = {bet.intent_id for bet in (*active, *history)}
    bet_intents = (
        {
            item.id: item
            for item in await repo.db.scalars(
                select(LiveIntent).where(LiveIntent.id.in_(bet_intent_ids))
            )
        }
        if bet_intent_ids
        else {}
    )
    return State(
        enabled=bool(config and config.enabled),
        acknowledged=bool(config and config.acknowledged_at),
        killed=bool(config and config.killed),
        live_execution_enabled=repo.execution_enabled,
        execution_adapters=await adapter_health(repo),
        revision=config.revision if config else None,
        settings=settings,
        cooldown_until=config.cooldown_until if config else None,
        daily_pnl=await repo.daily_pnl(now),
        signals=await cards(repo, settings, now),
        intents=[await intent_view(repo, item, now) for item in intents],
        handoffs=[await intent_view(repo, item, now) for item in await repo.handoffs()],
        handoff_metrics=await handoff_metrics(repo, now),
        active=[bet_view(item, bet_intents.get(item.intent_id)) for item in active],
        history=[bet_view(item, bet_intents.get(item.intent_id)) for item in history],
        next_intent_before=next_intent,
        next_bet_before=next_bet,
        real=real,
        decisions={
            "eligible": sum(v for k, v in counts.items() if k != "CANCELLED_BY_RISK")
            + int(
                await repo.db.scalar(
                    select(func.count())
                    .select_from(LiveIntent)
                    .where(
                        LiveIntent.status == "CANCELLED_BY_RISK",
                        LiveIntent.risk_reason.in_(("disabled", "settings_changed")),
                    )
                )
                or 0
            ),
            "executed": counts.get("EXECUTED_MANUALLY", 0) + counts.get("SETTLED", 0),
            "rejected": counts.get("REJECTED_BY_USER", 0),
            "expired": counts.get("EXPIRED", 0),
            "blocked": counts.get("CANCELLED_BY_RISK", 0),
        },
        comparison=comparison,
        comparison_start=start if comparison else None,
        comparison_end=end if comparison else None,
    )
