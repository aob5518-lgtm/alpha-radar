from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from alpha_radar.event_contracts.shadow_rules import Direction
from alpha_radar.event_contracts.shadow_schemas import ShadowAssessment
from alpha_radar.event_contracts.strategy import Horizon
from alpha_radar.event_semi_auto.execution_contract import (
    AdapterHealth,
    AdapterKind,
    ExecutionError,
    ExecutionResult,
    ExecutionStatus,
)
from alpha_radar.event_simulator.schemas import Market

VERSION = "event-semi-auto-v1"
MarketList = Annotated[tuple[Market, ...], Field(min_length=1, max_length=2)]
HorizonList = Annotated[tuple[Horizon, ...], Field(min_length=1, max_length=2)]
Premium = Annotated[Decimal, Field(ge=Decimal(".01"), le=10000, decimal_places=2)]
Payout = Annotated[Decimal, Field(gt=1, le=100, decimal_places=6)]
Price = Annotated[Decimal, Field(gt=0, max_digits=26, decimal_places=12)]
IntentStatus = Literal[
    "PENDING_REVIEW",
    "APPROVED_BY_USER",
    "REJECTED_BY_USER",
    "EXPIRED",
    "EXECUTED_MANUALLY",
    "CANCELLED_BY_RISK",
    "SETTLED",
]
Result = Literal["WIN", "LOSS", "TIE", "CANCELLED"]
SettlementSource = Literal[
    "BINANCE_EVENT_VERIFIED", "BINANCE_INDEX_PROXY", "MANUAL_CONFIRMATION", "UNKNOWN"
]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RiskSettings(Input):
    markets: MarketList = ("BTCUSDT", "ETHUSDT")
    horizons: HorizonList = (10, 30)
    minimum_score: int = Field(default=85, ge=85, le=100)
    fixed_stake: Premium = Decimal(10)
    max_stake: Premium = Decimal(25)
    max_daily_loss: Premium = Decimal(50)
    max_consecutive_losses: int = Field(default=3, ge=1, le=20)
    cooldown_minutes: int = Field(default=120, ge=1, le=1440)
    max_active_real_bets: int = Field(default=1, ge=1, le=4)
    minimum_payout_10m: Payout = Decimal("1.80")
    minimum_payout_30m: Payout = Decimal("1.80")
    max_drift_atr: Decimal = Field(default=Decimal(".25"), gt=0, le=2, decimal_places=3)

    @model_validator(mode="after")
    def validate_limits(self) -> Self:
        if not self.fixed_stake <= self.max_stake <= self.max_daily_loss:
            raise ValueError("Require fixed stake <= max stake <= daily loss limit.")
        if len(set(self.markets)) != len(self.markets) or len(set(self.horizons)) != len(
            self.horizons
        ):
            raise ValueError("Markets and horizons must be unique.")
        return self

    def minimum_payout(self, horizon: Horizon) -> Decimal:
        return self.minimum_payout_10m if horizon == 10 else self.minimum_payout_30m


class Control(Input):
    revision: UUID | None
    action: Literal["enable", "disable", "kill", "settings"]
    acknowledged: bool = False
    settings: RiskSettings | None = None


class IntentAction(Input):
    action: Literal["approve", "reject", "handoff", "execute", "return", "reconcile_no_order"]
    acknowledged: bool = False
    drift_acknowledged: bool = False
    payout: Payout | None = None
    reason: Literal["payout_low", "location", "discretion", "other"] | None = None


class Confirm(Input):
    acknowledged: Literal[True]
    drift_acknowledged: bool = False
    record_handoff: bool = False
    mismatch_acknowledged: bool = False
    actual_premium: Premium
    actual_payout: Payout
    actual_open_at: AwareDatetime
    actual_expiry_at: AwareDatetime
    actual_open_price: Price
    direction: Direction
    horizon_minutes: Horizon
    order_reference: str | None = Field(default=None, min_length=1, max_length=128)
    notes: str | None = Field(default=None, max_length=500)


class Settle(Input):
    result: Result
    settlement_price: Price | None = None
    actual_return: Decimal | None = Field(default=None, ge=0, le=1000000, decimal_places=2)


class View(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class IntentView(View):
    id: UUID
    event_signal_id: UUID
    market_instrument_id: UUID
    symbol: Market
    horizon_minutes: Horizon
    direction: Direction
    signal_state: Literal["STRONG_HIGHER", "STRONG_LOWER", "HIGHER", "LOWER"]
    signal_score: int
    signal_version: str
    strategy_version: str
    generated_at: datetime
    created_at: datetime
    expires_at: datetime
    signal_reference_price: Decimal
    signal_reference_source: str
    signal_atr: Decimal | None
    suggested_stake: Decimal
    stake_mode: Literal["fixed"] = "fixed"
    minimum_payout: Decimal
    breakeven_probability: Decimal
    status: IntentStatus
    risk_reason: str | None
    reject_reason: str | None
    approved_payout: Decimal | None
    handoff_started_at: datetime | None
    returned_at: datetime | None
    drift_atr: Decimal | None = None
    drift_warning: bool = False
    settings_snapshot: RiskSettings
    execution_adapter: AdapterKind | None
    execution_status: ExecutionStatus | None
    execution_deadline: datetime | None
    execution_id: UUID | None
    execution_started_at: datetime | None
    execution_completed_at: datetime | None
    adapter_error: ExecutionError | None
    pre_execution_drift_absolute: Decimal | None
    pre_execution_drift_percent: Decimal | None
    pre_execution_drift_atr: Decimal | None
    signal_to_intent_ms: int | None = None
    intent_to_execution_ms: int | None = None
    execution: ExecutionResult | None = None


class BetView(View):
    id: UUID
    intent_id: UUID
    event_signal_id: UUID
    market_instrument_id: UUID
    symbol: Market
    horizon_minutes: Horizon
    direction: Direction
    signal_score: int
    signal_reference_price: Decimal
    actual_open_price: Decimal
    actual_open_at: datetime
    expiry_at: datetime
    actual_premium: Decimal
    actual_payout: Decimal
    breakeven_probability: Decimal
    order_reference: str | None
    notes: str | None
    status: Literal["OPEN", "WIN", "LOSS", "TIE", "CANCELLED"]
    settlement_source: SettlementSource
    settlement_confidence: Literal["operator_reported"] | None
    settlement_price: Decimal | None
    settled_at: datetime | None
    gross_return: Decimal | None
    net_pnl: Decimal | None
    created_at: datetime
    late_execution_confirmation: bool
    payout_below_policy: bool
    direction_mismatch: bool
    horizon_mismatch: bool
    price_drift_absolute: Decimal | None
    price_drift_percent: Decimal | None
    price_drift_atr: Decimal | None
    signal_to_handoff_ms: int | None
    handoff_to_execution_ms: int | None
    signal_to_execution_ms: int | None
    execution: ExecutionResult | None = None
    signal_to_intent_ms: int | None = None
    intent_to_execution_ms: int | None = None


class HandoffMetrics(BaseModel):
    opened: int
    executed: int
    skipped: int
    expired_during_handoff: int
    payout_below_policy: int
    median_signal_to_execution_ms: int | None
    p90_signal_to_execution_ms: int | None
    drift_within_limit: int
    drift_above_limit: int
    drift_unavailable: int


class SignalCard(BaseModel):
    symbol: Market
    horizon_minutes: Horizon
    assessment: ShadowAssessment | None = None
    intent: IntentView | None = None
    minimum_payout: Decimal
    suggested_stake: Decimal


class Metrics(BaseModel):
    bets: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: Decimal | None = None
    net_pnl: Decimal = Decimal(0)
    return_on_premium: Decimal | None = None
    max_drawdown: Decimal = Decimal(0)
    max_losing_streak: int = 0
    average_payout: Decimal | None = None
    average_premium: Decimal | None = None
    median_signal_to_execution_ms: int | None = None
    average_price_drift_atr: Decimal | None = None


class ComparisonRow(BaseModel):
    symbol: Market
    horizon_minutes: Horizon
    paper: Metrics
    real: Metrics


class State(BaseModel):
    enabled: bool
    acknowledged: bool
    killed: bool
    live_execution_enabled: bool
    execution_adapters: list[AdapterHealth]
    revision: UUID | None
    settings: RiskSettings
    cooldown_until: datetime | None
    daily_pnl: Decimal
    signals: list[SignalCard]
    intents: list[IntentView]
    handoffs: list[IntentView]
    handoff_metrics: HandoffMetrics
    active: list[BetView]
    history: list[BetView]
    next_intent_before: UUID | None
    next_bet_before: UUID | None
    real: Metrics
    decisions: dict[str, int]
    comparison: list[ComparisonRow]
    comparison_start: datetime | None
    comparison_end: datetime | None
