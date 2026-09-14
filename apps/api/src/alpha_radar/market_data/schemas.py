from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from alpha_radar.market_data.constants import Freshness, MarketInterval


class MarketQuoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    asset_id: UUID
    symbol: str
    market_instrument_id: UUID
    provider_instrument_id: str
    price: Decimal
    bid: Decimal | None
    ask: Decimal | None
    bid_size: Decimal | None
    ask_size: Decimal | None
    base_currency: str
    quote_currency: str
    provider: str
    provider_timestamp: datetime | None
    observed_at: datetime
    ingested_at: datetime
    quality_flags: list[str]
    freshness: Freshness
    is_stale: bool


class MarketCandleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    market_instrument_id: UUID
    provider: str
    interval: MarketInterval
    open_time: datetime
    close_time: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal | None
    quote_volume: Decimal | None
    is_closed: bool
    provider_timestamp: datetime | None
    ingested_at: datetime
    quality_flags: list[str]


class MarketHistoryResponse(BaseModel):
    asset_id: UUID
    symbol: str
    market_instrument_id: UUID
    provider_instrument_id: str
    base_currency: str
    quote_currency: str
    provider: str
    interval: MarketInterval
    items: list[MarketCandleResponse]
