from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime
from decimal import Decimal

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter
from websockets.asyncio.client import connect

from alpha_radar.market_data.constants import (
    BYBIT_MAX_BACKFILL_TARGET_CANDLES,
    BYBIT_MAX_CANDLES_PER_REQUEST,
    INTERVAL_DEFINITIONS,
    MarketInterval,
)
from alpha_radar.market_data.providers.base import (
    MarketInstrumentRef,
    ProviderCandle,
    ProviderQuote,
)


class _BybitEnvelope(BaseModel):
    model_config = ConfigDict(extra="allow")

    retCode: int
    retMsg: str = ""
    result: dict[str, object]
    time: int | None = None


class _BybitTicker(BaseModel):
    symbol: str
    lastPrice: Decimal = Field(gt=0)
    bid1Price: Decimal | None = Field(default=None, gt=0)
    ask1Price: Decimal | None = Field(default=None, gt=0)
    bid1Size: Decimal | None = Field(default=None, ge=0)
    ask1Size: Decimal | None = Field(default=None, ge=0)


class _BybitKlineUpdate(BaseModel):
    start: int
    end: int
    interval: str
    open: Decimal = Field(gt=0)
    high: Decimal = Field(gt=0)
    low: Decimal = Field(gt=0)
    close: Decimal = Field(gt=0)
    volume: Decimal | None = Field(default=None, ge=0)
    turnover: Decimal | None = Field(default=None, ge=0)
    confirm: bool
    timestamp: int


BybitKlineRow = tuple[str, str, str, str, str, str, str]
_ticker_rows = TypeAdapter(list[_BybitTicker])
_kline_rows = TypeAdapter(list[BybitKlineRow])
_kline_updates = TypeAdapter(list[_BybitKlineUpdate])
_message = TypeAdapter(dict[str, object])


class BybitMarketDataProvider:
    """Bybit V5 public adapter for USDT linear perpetual market data."""

    name = "bybit"

    def __init__(
        self,
        *,
        base_url: str,
        websocket_url: str = "wss://stream.bybit.com/v5/public/linear",
        timeout_seconds: float = 10.0,
        requests_per_second: float = 8.0,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], datetime] | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.websocket_url = websocket_url
        self.timeout_seconds = timeout_seconds
        self.request_interval_seconds = 1 / requests_per_second
        self.transport = transport
        self.clock = clock or (lambda: datetime.now(UTC))
        self.sleep = sleep
        self._request_lock = asyncio.Lock()
        self._last_request_at: float | None = None

    async def get_quote(self, instrument: MarketInstrumentRef) -> ProviderQuote:
        envelope = await self._get(
            "/v5/market/tickers",
            params={"category": "linear", "symbol": instrument.provider_instrument_id},
        )
        rows = _ticker_rows.validate_python(envelope.result.get("list"))
        if not rows:
            raise ValueError("Bybit returned no ticker for the requested instrument")
        ticker = rows[0]
        if ticker.symbol != instrument.provider_instrument_id:
            raise ValueError("Bybit ticker identity does not match the requested instrument")
        provider_timestamp = self._from_milliseconds(envelope.time) if envelope.time else None
        return ProviderQuote(
            provider=self.name,
            provider_instrument_id=ticker.symbol,
            price=ticker.lastPrice,
            bid=ticker.bid1Price,
            ask=ticker.ask1Price,
            bid_size=ticker.bid1Size,
            ask_size=ticker.ask1Size,
            base_currency=instrument.base_currency,
            quote_currency=instrument.quote_currency,
            provider_timestamp=provider_timestamp,
            observed_at=self._as_utc(self.clock()),
            metadata={"category": "linear", "market": "perpetual"},
        )

    async def get_candles(
        self,
        instrument: MarketInstrumentRef,
        interval: MarketInterval,
        *,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = BYBIT_MAX_BACKFILL_TARGET_CANDLES,
    ) -> list[ProviderCandle]:
        if limit <= 0:
            return []
        definition = INTERVAL_DEFINITIONS[interval]
        bounded_limit = min(limit, BYBIT_MAX_BACKFILL_TARGET_CANDLES, BYBIT_MAX_CANDLES_PER_REQUEST)
        params: dict[str, str | int] = {
            "category": "linear",
            "symbol": instrument.provider_instrument_id,
            "interval": definition.bybit_interval,
            "limit": bounded_limit,
        }
        if start is not None:
            params["start"] = int(self._as_utc(start).timestamp() * 1000)
        if end is not None:
            params["end"] = int(self._as_utc(end).timestamp() * 1000)
        envelope = await self._get("/v5/market/kline", params=params)
        result_symbol = envelope.result.get("symbol")
        if result_symbol != instrument.provider_instrument_id:
            raise ValueError("Bybit Kline identity does not match the requested instrument")
        rows = _kline_rows.validate_python(envelope.result.get("list"))
        observed_at = self._as_utc(self.clock())
        provider_timestamp = self._from_milliseconds(envelope.time) if envelope.time else None
        candles: list[ProviderCandle] = []
        for raw in reversed(rows):
            open_time = self._from_milliseconds(int(raw[0]))
            close_time = open_time + definition.duration
            candles.append(
                ProviderCandle(
                    provider=self.name,
                    provider_instrument_id=instrument.provider_instrument_id,
                    interval=interval,
                    open_time=open_time,
                    close_time=close_time,
                    open=Decimal(str(raw[1])),
                    high=Decimal(str(raw[2])),
                    low=Decimal(str(raw[3])),
                    close=Decimal(str(raw[4])),
                    volume=Decimal(str(raw[5])),
                    quote_volume=Decimal(str(raw[6])),
                    is_closed=close_time <= observed_at,
                    provider_timestamp=provider_timestamp,
                    metadata={"category": "linear", "market": "perpetual"},
                )
            )
        return candles[-bounded_limit:]

    async def stream_candles(
        self, instrument: MarketInstrumentRef, interval: MarketInterval
    ) -> AsyncIterator[ProviderCandle]:
        topic = (
            f"kline.{INTERVAL_DEFINITIONS[interval].bybit_interval}."
            f"{instrument.provider_instrument_id}"
        )
        async with connect(self.websocket_url, open_timeout=self.timeout_seconds) as socket:
            await socket.send(json.dumps({"op": "subscribe", "args": [topic]}))
            async for raw in socket:
                payload: object = json.loads(raw)
                for candle in self.normalize_websocket_message(
                    payload, instrument=instrument, interval=interval
                ):
                    yield candle

    @classmethod
    def normalize_websocket_message(
        cls,
        payload: object,
        *,
        instrument: MarketInstrumentRef,
        interval: MarketInterval,
    ) -> list[ProviderCandle]:
        if not isinstance(payload, dict):
            return []
        message = _message.validate_python(payload)
        expected_interval = INTERVAL_DEFINITIONS[interval].bybit_interval
        expected_topic = f"kline.{expected_interval}.{instrument.provider_instrument_id}"
        if message.get("topic") != expected_topic:
            return []
        result: list[ProviderCandle] = []
        for update in _kline_updates.validate_python(message.get("data")):
            if update.interval != expected_interval:
                continue
            result.append(
                ProviderCandle(
                    provider=cls.name,
                    provider_instrument_id=instrument.provider_instrument_id,
                    interval=interval,
                    open_time=cls._from_milliseconds(update.start),
                    close_time=cls._from_milliseconds(update.end + 1),
                    open=update.open,
                    high=update.high,
                    low=update.low,
                    close=update.close,
                    volume=update.volume,
                    quote_volume=update.turnover,
                    is_closed=update.confirm,
                    provider_timestamp=cls._from_milliseconds(update.timestamp),
                    metadata={"category": "linear", "market": "perpetual"},
                )
            )
        return result

    async def _get(self, path: str, *, params: dict[str, str | int]) -> _BybitEnvelope:
        async with self._request_lock:
            now = asyncio.get_running_loop().time()
            if self._last_request_at is not None:
                wait = self.request_interval_seconds - (now - self._last_request_at)
                if wait > 0:
                    await self.sleep(wait)
            self._last_request_at = asyncio.get_running_loop().time()
            async with httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout_seconds,
                headers={"User-Agent": "Alpha-Radar/0.1"},
                transport=self.transport,
            ) as client:
                response = await client.get(path, params=params)
                response.raise_for_status()
                envelope = _BybitEnvelope.model_validate(response.json())
        if envelope.retCode != 0:
            raise ValueError(f"Bybit request failed: {envelope.retMsg}")
        return envelope

    @staticmethod
    def _from_milliseconds(value: int) -> datetime:
        return datetime.fromtimestamp(value / 1000, UTC)

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
