from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Protocol

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from alpha_radar.market_data.constants import MarketInterval
from alpha_radar.market_data.models import InstrumentType


class MarketInstrumentRef(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider_instrument_id: str
    instrument_type: InstrumentType
    base_currency: str
    quote_currency: str


class ProviderQuote(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider: str
    provider_instrument_id: str
    price: Decimal = Field(gt=0)
    bid: Decimal | None = Field(default=None, gt=0)
    ask: Decimal | None = Field(default=None, gt=0)
    bid_size: Decimal | None = Field(default=None, ge=0)
    ask_size: Decimal | None = Field(default=None, ge=0)
    base_currency: str
    quote_currency: str
    provider_timestamp: AwareDatetime | None = None
    observed_at: AwareDatetime
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProviderCandle(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider: str
    provider_instrument_id: str
    interval: MarketInterval
    open_time: AwareDatetime
    close_time: AwareDatetime
    open: Decimal = Field(gt=0)
    high: Decimal = Field(gt=0)
    low: Decimal = Field(gt=0)
    close: Decimal = Field(gt=0)
    volume: Decimal | None = Field(default=None, ge=0)
    quote_volume: Decimal | None = Field(default=None, ge=0)
    is_closed: bool
    provider_timestamp: AwareDatetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_candle(self) -> ProviderCandle:
        if self.close_time <= self.open_time:
            raise ValueError("close_time must be after open_time")
        if self.high < max(self.open, self.close) or self.low > min(self.open, self.close):
            raise ValueError("OHLC values are inconsistent")
        if self.high < self.low:
            raise ValueError("high must be greater than or equal to low")
        return self


class MarketDataProvider(Protocol):
    name: str

    async def get_quote(self, instrument: MarketInstrumentRef) -> ProviderQuote: ...

    async def get_candles(
        self,
        instrument: MarketInstrumentRef,
        interval: MarketInterval,
        *,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 300,
    ) -> list[ProviderCandle]: ...
