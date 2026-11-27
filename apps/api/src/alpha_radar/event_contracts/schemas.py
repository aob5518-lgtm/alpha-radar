from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from alpha_radar.event_contracts.strategy import VERSION, Assessment, Horizon


class Observation(BaseModel):
    id: UUID
    direction: Literal["up", "down"]
    generated_at: datetime
    entry_at: datetime
    expires_at: datetime
    entry_price: Decimal | None
    settlement_price: Decimal | None
    outcome: Literal["pending", "up", "down", "tie", "missing"]
    matched_direction: bool | None


class ResearchResponse(BaseModel):
    version: str = VERSION
    asset_id: UUID
    symbol: str
    market_instrument_id: UUID | None
    provider: Literal["binance_index"] = "binance_index"
    horizon_minutes: Horizon
    availability: Literal["disabled", "warming_up", "ready", "stale", "unavailable"]
    validation_status: Literal["unvalidated"] = "unvalidated"
    settlement_basis: Literal["next_minute_index_open_proxy"] = "next_minute_index_open_proxy"
    settlement_basis_verified: Literal[False] = False
    probability: None = None
    expected_value: None = None
    last_updated_at: datetime | None
    valid_until: datetime | None
    assessment: Assessment
    observations: list[Observation]
