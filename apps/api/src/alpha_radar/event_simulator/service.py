from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.errors import AppError
from alpha_radar.event_contracts.shadow_models import EventShadowSignal
from alpha_radar.event_contracts.shadow_rules import SETTLEMENT_VERSION
from alpha_radar.event_contracts.shadow_rules import VERSION as SIGNAL_VERSION
from alpha_radar.event_contracts.shadow_schemas import ShadowAssessment
from alpha_radar.event_contracts.shadow_strategy import proxy_result
from alpha_radar.event_contracts.strategy import utc
from alpha_radar.event_simulator.models import SimulationBet, SimulationDecision, SimulationSession
from alpha_radar.event_simulator.repository import SimulatorRepository
from alpha_radar.event_simulator.rules import (
    RATIO,
    SimulationStats,
    cash_result,
    eligibility,
    frozen_assessment,
    roll_day,
    stake_for,
)
from alpha_radar.event_simulator.schemas import PAYOUT_SOURCE, VERSION, SimulationSettings


async def new_run(
    session: AsyncSession,
    settings: SimulationSettings,
    expected: UUID | None,
    *,
    at: datetime | None = None,
) -> SimulationSession:
    repo = SimulatorRepository(session)
    await repo.lock()
    now = at or datetime.now(UTC)
    current = await repo.current()
    if expected != (current.id if current else None):
        raise AppError(
            status_code=409, code="stale_simulation", message="Reload the current simulation."
        )
    if current:
        current.status = "archived"
        current.stopped_at = current.stopped_at or now
        await session.flush()
    amount = settings.starting_bankroll
    run = SimulationSession(
        created_at=now,
        started_at=now,
        accept_after=now,
        status="running",
        starting_bankroll=amount,
        current_bankroll=amount,
        max_bankroll=amount,
        max_drawdown=Decimal(0),
        day=now.date(),
        day_start_bankroll=amount,
        risk_loss_count=0,
        cooldown_until=None,
        strategy_version=VERSION,
        signal_version=SIGNAL_VERSION,
        settlement_version=SETTLEMENT_VERSION,
        settings_snapshot=settings.model_dump(mode="json"),
        stats=SimulationStats().model_dump(mode="json"),
        total_bets=0,
        settled_bets=0,
    )
    session.add(run)
    await session.commit()
    return run


async def control_run(
    session: AsyncSession,
    expected: UUID,
    *,
    running: bool,
    at: datetime | None = None,
) -> SimulationSession:
    repo = SimulatorRepository(session)
    await repo.lock()
    now = at or datetime.now(UTC)
    current = await repo.current()
    if current is None or current.id != expected:
        raise AppError(
            status_code=409, code="stale_simulation", message="Reload the current simulation."
        )
    if running and current.status == "paused":
        current.status = "running"
        current.stopped_at = None
        current.accept_after = now
    elif not running and current.status == "running":
        current.status = "paused"
        current.stopped_at = now
    await session.commit()
    return current


def open_bet(
    run: SimulationSession,
    settings: SimulationSettings,
    signal: EventShadowSignal,
    assessment: ShadowAssessment,
    now: datetime,
) -> SimulationBet:
    if signal.symbol not in ("BTCUSDT", "ETHUSDT") or signal.horizon_minutes not in (10, 30):
        raise ValueError("Unsupported frozen signal")
    payout = settings.payout(signal.horizon_minutes)
    if signal.direction not in ("higher", "lower"):
        raise ValueError("Unsupported frozen direction")
    return SimulationBet(
        simulation_session_id=run.id,
        event_signal_id=signal.id,
        market_instrument_id=signal.market_instrument_id,
        symbol=signal.symbol,
        horizon_minutes=signal.horizon_minutes,
        direction=signal.direction,
        signal_state=assessment.state,
        signal_score=signal.score,
        signal_version=signal.version,
        signal_generated_at=utc(signal.generated_at),
        bet_created_at=now,
        reference_price=signal.reference_price,
        reference_source=signal.reference_source,
        expiry_at=utc(signal.expires_at),
        virtual_stake=stake_for(settings, run.current_bankroll),
        payout_multiplier=payout,
        payout_source=PAYOUT_SOURCE,
        breakeven_probability=(Decimal(1) / payout).quantize(RATIO),
        assessment=assessment.model_dump(mode="json"),
        settings_snapshot=settings.model_dump(mode="json"),
        status="active",
        settlement_source=signal.settlement_source,
    )


def settle_bet(
    run: SimulationSession,
    bet: SimulationBet,
    signal: EventShadowSignal,
    now: datetime,
) -> bool:
    if (
        bet.status != "active"
        or utc(bet.expiry_at) > now
        or signal.settled_at is None
        or utc(signal.settled_at) < utc(bet.expiry_at)
        or utc(signal.settled_at) > now
    ):
        return False
    price = signal.settled_price
    if signal.result == "missing" and price is None:
        result = "void"
    elif signal.result in ("win", "loss") and price is not None and price > 0:
        outcome = proxy_result(bet.direction, bet.reference_price, price)
        if outcome not in ("win", "loss"):
            return False
        result = outcome
    else:
        return False

    settings = SimulationSettings.model_validate(bet.settings_snapshot)
    roll_day(run, now)
    gross, pnl = cash_result(bet.virtual_stake, bet.payout_multiplier, result)
    bet.bankroll_before = run.current_bankroll
    run.current_bankroll += pnl
    bet.bankroll_after = run.current_bankroll
    run.max_bankroll = max(run.max_bankroll, run.current_bankroll)
    run.max_drawdown = max(
        run.max_drawdown,
        ((run.max_bankroll - run.current_bankroll) / run.max_bankroll).quantize(RATIO),
    )
    if result == "win":
        run.risk_loss_count = 0
    elif result == "loss" and not (run.cooldown_until and now < utc(run.cooldown_until)):
        run.risk_loss_count += 1
        if run.risk_loss_count >= settings.max_consecutive_losses:
            run.cooldown_until = now + timedelta(minutes=settings.cooldown_minutes)
            run.risk_loss_count = 0
    run.settled_bets += 1
    bet.status, bet.settlement_price, bet.settled_at = result, price, now
    bet.settlement_sequence = run.settled_bets
    bet.gross_return, bet.net_pnl = gross, pnl
    stats = SimulationStats.model_validate(run.stats)
    stats.settled(bet, result, pnl)
    run.stats = stats.model_dump(mode="json")
    return True


async def process_tick(session: AsyncSession, *, at: datetime | None = None) -> dict[str, int]:
    repo = SimulatorRepository(session)
    await repo.lock()
    now = at or datetime.now(UTC)
    settled = opened = skipped = 0
    for bet, signal in await repo.due(now):
        owner = await session.get(SimulationSession, bet.simulation_session_id)
        if owner is not None and settle_bet(owner, bet, signal, now):
            settled += 1
    run = await repo.current()
    if run is not None:
        roll_day(run, now)
        settings = SimulationSettings.model_validate(run.settings_snapshot)
        stats = SimulationStats.model_validate(run.stats)
        active = await repo.active(run.id)
        for signal in await repo.undecided(run, now):
            assessment = frozen_assessment(signal)
            reason = (
                eligibility(run, settings, signal, assessment, active, now)
                if assessment
                else "invalid_signal"
            )
            if reason == "opened" and not await repo.has_closed_trigger(signal):
                reason = "invalid_signal"
            if reason == "opened" and assessment:
                bet = open_bet(run, settings, signal, assessment, now)
                session.add(bet)
                active.append(bet)
                run.total_bets += 1
                stats.opened(bet)
                opened += 1
            else:
                skipped += 1
            if signal.symbol in ("BTCUSDT", "ETHUSDT"):
                session.add(
                    SimulationDecision(
                        simulation_session_id=run.id,
                        event_signal_id=signal.id,
                        symbol=signal.symbol,
                        horizon_minutes=signal.horizon_minutes,
                        reason=reason,
                        decided_at=now,
                    )
                )
        run.stats = stats.model_dump(mode="json")
    await session.commit()
    return {"opened": opened, "settled": settled, "skipped": skipped}
