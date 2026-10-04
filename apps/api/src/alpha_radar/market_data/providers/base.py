from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal, Protocol, runtime_checkable

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


class ProviderTick(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider: str
    provider_instrument_id: str
    price: Decimal = Field(gt=0)
    observed_at: AwareDatetime
    provider_timestamp: AwareDatetime
    open_24h: Decimal | None = Field(default=None, gt=0)
    volume_24h: Decimal | None = Field(default=None, ge=0)


class ProviderPriceUpdate(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["price"] = "price"
    provider: str
    provider_instrument_id: str
    price: Decimal = Field(gt=0)
    change_24h: Decimal | None = None
    provider_timestamp: AwareDatetime


class ProviderTradeUpdate(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["trade"] = "trade"
    provider: str
    provider_instrument_id: str
    price: Decimal = Field(gt=0)
    size: Decimal = Field(ge=0)
    side: Literal["Buy", "Sell"]
    trade_id: str
    provider_timestamp: AwareDatetime


class ProviderCandleUpdate(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: Literal["candle"] = "candle"
    candle: ProviderCandle


ProviderStreamUpdate = ProviderPriceUpdate | ProviderTradeUpdate | ProviderCandleUpdate


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


@runtime_checkable
class StreamingMarketDataProvider(Protocol):
    def stream_ticks(self, instrument: MarketInstrumentRef) -> AsyncIterator[ProviderTick]: ...


@runtime_checkable
class StreamingCandleMarketDataProvider(Protocol):
    def stream_candles(
        self, instrument: MarketInstrumentRef, interval: MarketInterval
    ) -> AsyncIterator[ProviderCandle]: ...


@runtime_checkable
class StreamingInstrumentMarketDataProvider(Protocol):
    def stream_market(
        self, instrument: MarketInstrumentRef, interval: MarketInterval
    ) -> AsyncIterator[ProviderStreamUpdate]: ...


@runtime_checkable
class PaginatedHistoricalMarketDataProvider(Protocol):
    def iter_candle_pages(
        self,
        instrument: MarketInstrumentRef,
        interval: MarketInterval,
        *,
        end: datetime,
        horizon: datetime | None,
        max_pages: int,
    ) -> AsyncIterator[list[ProviderCandle]]: ...
