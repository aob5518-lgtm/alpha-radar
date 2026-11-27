from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from alpha_radar.event_contracts.shadow_rules import Direction, Reason, Regime, Result, State
from alpha_radar.event_contracts.strategy import Horizon


class ShadowAssessment(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    state: State = "WAIT"
    reason: Reason
    direction: Direction | None = None
    score: int | None = Field(default=None, ge=0, le=100)
    evidence: dict[str, bool] = Field(default_factory=dict)
    points: dict[str, int] = Field(default_factory=dict)
    features: dict[str, float] = Field(default_factory=dict)
    regime: Regime | None = None
    as_of: datetime | None = None
    episode_at: datetime | None = None


class ShadowObservation(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    direction: Direction
    score: int
    confirmed_at: datetime
    generated_at: datetime
    expires_at: datetime
    reference_price: Decimal
    settled_price: Decimal | None
    result: Result


class ShadowResponse(BaseModel):
    version: Literal["event-signal-v1"] = "event-signal-v1"
    settlement_version: Literal["event-shadow-v1"] = "event-shadow-v1"
    mode: Literal["shadow"] = "shadow"
    validation_status: Literal["unvalidated"] = "unvalidated"
    asset_id: UUID
    market_instrument_id: UUID
    reference_instrument_id: UUID | None = None
    symbol: str
    horizon_minutes: Horizon
    signal_source: Literal["bybit"] = "bybit"
    reference_source: Literal["binance_index_minute_close_proxy"] = (
        "binance_index_minute_close_proxy"
    )
    settlement_source: Literal["binance_index_minute_close_proxy"] = (
        "binance_index_minute_close_proxy"
    )
    settlement_basis_verified: Literal[False] = False
    probability: None = None
    expected_value: None = None
    generated_at: datetime | None = None
    valid_until: datetime | None = None
    assessment: ShadowAssessment
    signal: ShadowObservation | None = None
    observations: list[ShadowObservation] = Field(default_factory=lambda: [])
