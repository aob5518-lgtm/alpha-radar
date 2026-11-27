from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from alpha_radar.event_contracts.shadow_rules import Direction, State
from alpha_radar.event_contracts.shadow_schemas import ShadowAssessment
from alpha_radar.event_contracts.strategy import Horizon

Market = Literal["BTCUSDT", "ETHUSDT"]
SessionStatus = Literal["running", "paused", "archived"]
BetStatus = Literal["active", "win", "loss", "void"]
DecisionReason = Literal[
    "opened",
    "eligible",
    "no_session",
    "signal_unavailable",
    "invalid_signal",
    "signal_expired",
    "signal_not_strong",
    "score_below_threshold",
    "existing_active_bet",
    "daily_loss_limit",
    "cooldown",
    "market_disabled",
    "horizon_disabled",
    "simulation_paused",
    "duplicate_signal",
    "max_active_bets",
    "insufficient_bankroll",
]

VERSION = "event-paper-simulator-v1"
PAYOUT_SOURCE = "simulation_assumption"


class SimulationSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    starting_bankroll: Decimal = Field(
        default=Decimal("10000"), ge=1, le=10_000_000, decimal_places=2
    )
    markets: tuple[Market, ...] = Field(default=("BTCUSDT", "ETHUSDT"), min_length=1, max_length=2)
    horizons: tuple[Horizon, ...] = Field(default=(10, 30), min_length=1, max_length=2)
    allow_regular_signals: bool = False
    minimum_score: int = Field(default=85, ge=75, le=100)
    stake_mode: Literal["fixed", "percentage"] = "percentage"
    fixed_stake: Decimal = Field(
        default=Decimal("100"), ge=Decimal("0.01"), le=200_000, decimal_places=2
    )
    stake_percent: Decimal = Field(default=Decimal("1"), ge=Decimal("0.01"), le=2, decimal_places=2)
    payout_10m: Decimal = Field(default=Decimal("1.80"), gt=1, le=10, decimal_places=2)
    payout_30m: Decimal = Field(default=Decimal("1.80"), gt=1, le=10, decimal_places=2)
    max_daily_loss_percent: Decimal = Field(
        default=Decimal("5"), ge=Decimal("0.01"), le=100, decimal_places=2
    )
    max_consecutive_losses: int = Field(default=5, ge=1, le=50)
    cooldown_minutes: int = Field(default=60, ge=1, le=1440)
    max_active_bets: int = Field(default=4, ge=1, le=4)

    @field_validator("markets", "horizons")
    @classmethod
    def unique_values(cls, value: tuple[object, ...]) -> tuple[object, ...]:
        if len(set(value)) != len(value):
            raise ValueError("Selections must be unique")
        return value

    def payout(self, horizon: Horizon) -> Decimal:
        return self.payout_10m if horizon == 10 else self.payout_30m


class Stats(BaseModel):
    bets: int = 0
    wins: int = 0
    losses: int = 0
    voids: int = 0
    winning_pnl: Decimal = Decimal(0)
    losing_pnl: Decimal = Decimal(0)
    current_losing_streak: int = 0
    max_losing_streak: int = 0


class Performance(Stats):
    win_rate: Decimal | None
    net_pnl: Decimal
    return_percent: Decimal
    profit_factor: Decimal | None
    average_win: Decimal | None
    average_loss: Decimal | None


class SessionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    started_at: datetime
    stopped_at: datetime | None
    status: SessionStatus


class SessionView(SessionSummary):
    strategy_version: str
    signal_version: str
    settlement_version: str
    settings_snapshot: SimulationSettings
    current_bankroll: Decimal
    available_bankroll: Decimal
    max_bankroll: Decimal
    max_drawdown: Decimal
    cooldown_until: datetime | None
    daily_limit_reached: bool
    total_bets: int
    settled_bets: int
    active_bets: int
    net_pnl: Decimal


class PaperBet(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    simulation_session_id: UUID
    event_signal_id: UUID
    market_instrument_id: UUID
    symbol: Market
    horizon_minutes: Horizon
    direction: Direction
    signal_state: State
    signal_score: int
    signal_version: str
    signal_generated_at: datetime
    bet_created_at: datetime
    reference_price: Decimal
    reference_source: str
    expiry_at: datetime
    virtual_stake: Decimal
    payout_multiplier: Decimal
    payout_source: Literal["simulation_assumption"]
    breakeven_probability: Decimal
    assessment: ShadowAssessment
    settings_snapshot: SimulationSettings
    status: BetStatus
    settled_at: datetime | None
    settlement_price: Decimal | None
    settlement_source: str
    gross_return: Decimal | None
    net_pnl: Decimal | None
    bankroll_before: Decimal | None
    bankroll_after: Decimal | None


class Decision(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    event_signal_id: UUID
    reason: DecisionReason
    decided_at: datetime
    symbol: Market
    horizon_minutes: Horizon


class CurrentSignal(BaseModel):
    symbol: Market
    horizon_minutes: Horizon
    assessment: ShadowAssessment
    reference_price: Decimal | None = None
    eligibility: DecisionReason


class EquityPoint(BaseModel):
    at: datetime
    bankroll: Decimal


class SimulatorState(BaseModel):
    last_tick_at: datetime | None = None
    current_session_id: UUID | None
    session: SessionView | None
    defaults: SimulationSettings
    sessions: list[SessionSummary]
    next_session_cursor: UUID | None = None
    signals: list[CurrentSignal]
    active_bets: list[PaperBet]
    history: list[PaperBet]
    next_cursor: UUID | None = None
    performance: Performance
    markets: dict[str, Performance]
    score_buckets: dict[str, Performance]
    directions: dict[str, Performance]
    equity: list[EquityPoint]
    decisions: list[Decision]


class NewSimulation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_session_id: UUID | None
    settings: SimulationSettings


class ControlSimulation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: UUID
    action: Literal["start", "pause"]
