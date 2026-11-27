from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import ValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.config import get_settings
from alpha_radar.errors import AppError
from alpha_radar.event_contracts.shadow_models import EventShadowSignal
from alpha_radar.event_contracts.shadow_repository import ShadowRepository
from alpha_radar.event_contracts.shadow_rules import HORIZONS, snapshot_key
from alpha_radar.event_contracts.shadow_schemas import ShadowAssessment, ShadowResponse
from alpha_radar.event_contracts.strategy import Horizon, utc
from alpha_radar.event_simulator.models import SimulationBet, SimulationDecision, SimulationSession
from alpha_radar.event_simulator.repository import SimulatorRepository
from alpha_radar.event_simulator.rules import (
    SimulationStats,
    day_budget,
    eligibility,
    frozen_assessment,
    performance,
)
from alpha_radar.event_simulator.schemas import (
    CurrentSignal,
    Decision,
    DecisionReason,
    EquityPoint,
    Market,
    PaperBet,
    SessionSummary,
    SessionView,
    SimulationSettings,
    SimulatorState,
    Stats,
)

LAST_TICK_KEY = "alpha-radar:event-simulator-v1:last-tick"
MARKETS: tuple[Market, ...] = ("BTCUSDT", "ETHUSDT")


async def snapshot(
    redis: Redis,
    shadow: ShadowRepository,
    symbol: Market,
    horizon: Horizon,
    now: datetime,
    run: SimulationSession | None,
    active: list[SimulationBet],
) -> CurrentSignal:
    fallback = CurrentSignal(
        symbol=symbol,
        horizon_minutes=horizon,
        assessment=ShadowAssessment(reason="warming_up"),
        eligibility="signal_unavailable",
    )
    instrument = await shadow.instrument(symbol=symbol)
    if instrument is None:
        return fallback
    try:
        raw = await redis.get(snapshot_key(instrument.id, horizon))
        sample = ShadowResponse.model_validate_json(raw) if isinstance(raw, str | bytes) else None
    except (RedisError, ValidationError):
        return fallback
    if (
        sample is None
        or sample.asset_id != instrument.asset_id
        or sample.market_instrument_id != instrument.id
        or sample.symbol != instrument.base_currency
        or sample.horizon_minutes != horizon
        or sample.valid_until is None
        or utc(sample.valid_until) <= now
    ):
        return fallback
    reference_price = sample.signal.reference_price if sample.signal else None
    if reference_price is None and sample.reference_instrument_id and sample.assessment.as_of:
        reference_price = await shadow.index_close(
            sample.reference_instrument_id, utc(sample.assessment.as_of)
        )
    reason: DecisionReason = "no_session" if run is None else "signal_unavailable"
    if run and run.status != "running":
        reason = "simulation_paused"
    if run and sample.signal:
        decision = await shadow.session.get(SimulationDecision, (run.id, sample.signal.id))
        if decision is not None:
            reason = decision.reason
        elif run.status == "running":
            signal = await shadow.session.get(EventShadowSignal, sample.signal.id)
            assembly = frozen_assessment(signal) if signal else None
            if signal and assembly:
                reason = eligibility(
                    run,
                    SimulationSettings.model_validate(run.settings_snapshot),
                    signal,
                    assembly,
                    active,
                    now,
                )
                if reason == "opened":
                    reason = "eligible"
    return CurrentSignal(
        symbol=symbol,
        horizon_minutes=horizon,
        assessment=sample.assessment,
        reference_price=reference_price,
        eligibility=reason,
    )


async def state(
    db: AsyncSession,
    run_id: UUID | None,
    before: UUID | None,
    sessions_before: UUID | None,
) -> SimulatorState:
    now = datetime.now(UTC)
    repo = SimulatorRepository(db)
    current = await repo.current()
    run = await db.get(SimulationSession, run_id) if run_id else current
    if run_id is not None and run is None:
        raise AppError(
            status_code=404, code="simulation_not_found", message="Simulation was not found."
        )
    sessions, next_session = await repo.sessions_page(sessions_before)
    defaults = SimulationSettings()
    stats = SimulationStats.model_validate(run.stats) if run else SimulationStats()
    session_view = None
    equity: list[EquityPoint] = []
    active: list[SimulationBet] = []
    history: list[SimulationBet] = []
    decisions: list[SimulationDecision] = []
    next_cursor = None
    starting = run.starting_bankroll if run else defaults.starting_bankroll
    if run:
        active = await repo.active(run.id)
        settings = SimulationSettings.model_validate(run.settings_snapshot)
        reserved = sum((bet.virtual_stake for bet in active), Decimal(0))
        session_view = SessionView(
            **SessionSummary.model_validate(run).model_dump(),
            strategy_version=run.strategy_version,
            signal_version=run.signal_version,
            settlement_version=run.settlement_version,
            settings_snapshot=settings,
            current_bankroll=run.current_bankroll,
            available_bankroll=run.current_bankroll - reserved,
            max_bankroll=run.max_bankroll,
            max_drawdown=run.max_drawdown,
            cooldown_until=run.cooldown_until
            if run.cooldown_until and utc(run.cooldown_until) > now
            else None,
            daily_limit_reached=day_budget(run, settings, now) <= reserved,
            total_bets=run.total_bets,
            settled_bets=run.settled_bets,
            active_bets=len(active),
            net_pnl=run.current_bankroll - starting,
        )
        history, next_cursor = await repo.history(run.id, before)
        decisions = await repo.decisions(run.id)
        equity = [EquityPoint(at=run.started_at, bankroll=starting)]
        for trade in await repo.equity(run):
            if trade.settled_at is not None and trade.bankroll_after is not None:
                equity.append(EquityPoint(at=trade.settled_at, bankroll=trade.bankroll_after))
    current_active = (
        active
        if current is not None and run is not None and current.id == run.id
        else await repo.active(current.id)
        if current is not None
        else []
    )
    shadow = ShadowRepository(db)
    async with Redis.from_url(get_settings().redis_url, socket_timeout=1) as redis:  # pyright: ignore[reportUnknownMemberType]
        signals = [
            await snapshot(redis, shadow, symbol, horizon, now, current, current_active)
            for symbol in MARKETS
            for horizon in HORIZONS
        ]
        last_tick = None
        try:
            raw = await redis.get(LAST_TICK_KEY)
            if isinstance(raw, bytes):
                last_tick = datetime.fromisoformat(raw.decode())
        except (RedisError, ValueError):
            pass
    return SimulatorState(
        last_tick_at=last_tick,
        current_session_id=current.id if current else None,
        session=session_view,
        defaults=defaults,
        sessions=[SessionSummary.model_validate(item) for item in sessions],
        next_session_cursor=next_session,
        signals=signals,
        active_bets=[PaperBet.model_validate(item) for item in active],
        history=[PaperBet.model_validate(item) for item in history],
        next_cursor=next_cursor,
        performance=performance(stats.overall, starting),
        markets={
            key: performance(stats.markets.get(key, Stats()), starting)
            for key in (f"{symbol}:{horizon}" for symbol in MARKETS for horizon in HORIZONS)
        },
        score_buckets={
            key: performance(stats.score_buckets.get(key, Stats()), starting)
            for key in ("<85", "85–89", "90–94", "95–100")
        },
        directions={
            key: performance(stats.directions.get(key, Stats()), starting)
            for key in ("higher", "lower")
        },
        equity=equity,
        decisions=[Decision.model_validate(item) for item in decisions],
    )
