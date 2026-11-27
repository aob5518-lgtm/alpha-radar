from datetime import datetime, timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from alpha_radar.event_contracts.shadow_models import EventShadowSignal
from alpha_radar.event_contracts.shadow_rules import FRESHNESS, PROXY, SETTLEMENT_VERSION, VERSION
from alpha_radar.event_contracts.shadow_schemas import ShadowAssessment
from alpha_radar.event_contracts.strategy import utc
from alpha_radar.event_simulator.models import SimulationBet, SimulationSession
from alpha_radar.event_simulator.schemas import (
    DecisionReason,
    Performance,
    SimulationSettings,
    Stats,
)

CENT = Decimal(".01")
RATIO = Decimal(".0000000001")
PERCENT = Decimal(100)


class SimulationStats(BaseModel):
    overall: Stats = Field(default_factory=Stats)
    markets: dict[str, Stats] = Field(default_factory=dict)
    score_buckets: dict[str, Stats] = Field(default_factory=dict)
    directions: dict[str, Stats] = Field(default_factory=dict)

    def groups(self, bet: SimulationBet) -> list[Stats]:
        score = bet.signal_score
        bucket = (
            "<85" if score < 85 else "85–89" if score < 90 else "90–94" if score < 95 else "95–100"
        )
        return [
            self.overall,
            self.markets.setdefault(f"{bet.symbol}:{bet.horizon_minutes}", Stats()),
            self.score_buckets.setdefault(bucket, Stats()),
            self.directions.setdefault(bet.direction, Stats()),
        ]

    def opened(self, bet: SimulationBet) -> None:
        for group in self.groups(bet):
            group.bets += 1

    def settled(
        self, bet: SimulationBet, result: Literal["win", "loss", "void"], pnl: Decimal
    ) -> None:
        for group in self.groups(bet):
            if result == "win":
                group.wins += 1
                group.winning_pnl += pnl
                group.current_losing_streak = 0
            elif result == "loss":
                group.losses += 1
                group.losing_pnl -= pnl
                group.current_losing_streak += 1
                group.max_losing_streak = max(group.max_losing_streak, group.current_losing_streak)
            else:
                group.voids += 1


def performance(stats: Stats, starting_bankroll: Decimal) -> Performance:
    resolved = stats.wins + stats.losses
    net = stats.winning_pnl - stats.losing_pnl
    return Performance(
        **stats.model_dump(),
        win_rate=(stats.wins * PERCENT / resolved).quantize(RATIO) if resolved else None,
        net_pnl=net,
        return_percent=(net * PERCENT / starting_bankroll).quantize(RATIO),
        profit_factor=(stats.winning_pnl / stats.losing_pnl).quantize(RATIO)
        if stats.losing_pnl
        else None,
        average_win=(stats.winning_pnl / stats.wins).quantize(CENT) if stats.wins else None,
        average_loss=(stats.losing_pnl / stats.losses).quantize(CENT) if stats.losses else None,
    )


def roll_day(run: SimulationSession, now: datetime) -> None:
    if run.day < now.date():
        run.day = now.date()
        run.day_start_bankroll = run.current_bankroll


def day_budget(run: SimulationSession, settings: SimulationSettings, now: datetime) -> Decimal:
    baseline = run.day_start_bankroll if run.day == now.date() else run.current_bankroll
    return baseline * settings.max_daily_loss_percent / PERCENT + min(
        Decimal(0), run.current_bankroll - baseline
    )


def stake_for(settings: SimulationSettings, bankroll: Decimal) -> Decimal:
    requested = (
        settings.fixed_stake
        if settings.stake_mode == "fixed"
        else (bankroll * settings.stake_percent / PERCENT)
    )
    return min(requested, bankroll * Decimal(".02")).quantize(CENT, rounding=ROUND_DOWN)


def frozen_assessment(signal: EventShadowSignal) -> ShadowAssessment | None:
    try:
        assessment = ShadowAssessment.model_validate(signal.assessment)
    except ValidationError:
        return None
    confirmed = utc(signal.confirmed_at)
    generated = utc(signal.generated_at)
    if (
        signal.version != VERSION
        or signal.settlement_version != SETTLEMENT_VERSION
        or signal.reference_source != PROXY
        or signal.settlement_source != PROXY
        or signal.reference_instrument_id == signal.market_instrument_id
        or signal.reference_price <= 0
        or signal.horizon_minutes not in (10, 30)
        or signal.direction not in ("higher", "lower")
        or assessment.state not in (signal.direction.upper(), f"STRONG_{signal.direction.upper()}")
        or assessment.direction != signal.direction
        or assessment.score != signal.score
        or assessment.as_of is None
        or utc(assessment.as_of) != confirmed
        or assessment.episode_at is None
        or utc(assessment.episode_at) != utc(signal.episode_at)
        or not confirmed <= generated < confirmed + FRESHNESS
        or utc(signal.expires_at) != confirmed + timedelta(minutes=signal.horizon_minutes)
    ):
        return None
    return assessment


def eligibility(
    run: SimulationSession,
    settings: SimulationSettings,
    signal: EventShadowSignal,
    assessment: ShadowAssessment,
    active: list[SimulationBet],
    now: datetime,
) -> DecisionReason:
    if run.status != "running" or utc(signal.confirmed_at) < utc(run.accept_after):
        return "simulation_paused"
    if (
        not utc(signal.generated_at) <= now < utc(signal.confirmed_at) + FRESHNESS
        or signal.result != "pending"
    ):
        return "signal_expired"
    if signal.symbol not in settings.markets:
        return "market_disabled"
    if signal.horizon_minutes not in settings.horizons:
        return "horizon_disabled"
    if assessment.state == "WAIT" or (
        assessment.state not in ("STRONG_HIGHER", "STRONG_LOWER")
        and not settings.allow_regular_signals
    ):
        return "signal_not_strong"
    if signal.score < settings.minimum_score:
        return "score_below_threshold"
    if run.cooldown_until and now < utc(run.cooldown_until):
        return "cooldown"
    if any(
        bet.market_instrument_id == signal.market_instrument_id
        and bet.horizon_minutes == signal.horizon_minutes
        for bet in active
    ):
        return "existing_active_bet"
    if len(active) >= settings.max_active_bets:
        return "max_active_bets"
    stake = stake_for(settings, run.current_bankroll)
    reserved = sum((bet.virtual_stake for bet in active), Decimal(0))
    if stake < CENT or stake > run.current_bankroll - reserved:
        return "insufficient_bankroll"
    if day_budget(run, settings, now) < stake + reserved:
        return "daily_loss_limit"
    return "opened"


def cash_result(
    stake: Decimal, multiplier: Decimal, result: Literal["win", "loss", "void"]
) -> tuple[Decimal, Decimal]:
    gross = (
        (stake * multiplier).quantize(CENT, rounding=ROUND_HALF_UP)
        if result == "win"
        else stake
        if result == "void"
        else Decimal("0.00")
    )
    return gross, gross - stake
