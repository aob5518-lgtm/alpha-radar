from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
from pydantic import AwareDatetime, BaseModel, TypeAdapter
from websockets.asyncio.client import connect

from alpha_radar.market_data.constants import (
    COINBASE_MAX_BACKFILL_TARGET_CANDLES,
    COINBASE_MAX_CANDLES_PER_REQUEST,
    INTERVAL_DEFINITIONS,
    MarketInterval,
)
from alpha_radar.market_data.providers.base import (
    MarketInstrumentRef,
    ProviderCandle,
    ProviderQuote,
    ProviderTick,
)


class _CoinbaseTicker(BaseModel):
    price: Decimal
    bid: Decimal
    ask: Decimal
    size: Decimal
    volume: Decimal
    time: AwareDatetime
    trade_id: int


CandleRow = tuple[int, Decimal, Decimal, Decimal, Decimal, Decimal]
_candle_rows = TypeAdapter(list[CandleRow])


class CoinbaseMarketDataProvider:
    name = "coinbase"

    def __init__(
        self,
        *,
        base_url: str,
        websocket_url: str = "wss://ws-feed.exchange.coinbase.com",
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

    async def stream_ticks(self, instrument: MarketInstrumentRef) -> AsyncIterator[ProviderTick]:
        subscription = {
            "type": "subscribe",
            "product_ids": [instrument.provider_instrument_id],
            "channels": ["ticker"],
        }
        async with connect(self.websocket_url, open_timeout=self.timeout_seconds) as socket:
            await socket.send(json.dumps(subscription))
            async for raw in socket:
                payload = json.loads(raw)
                if (
                    payload.get("type") != "ticker"
                    or payload.get("product_id") != instrument.provider_instrument_id
                ):
                    continue
                timestamp = datetime.fromisoformat(str(payload["time"]).replace("Z", "+00:00"))
                if timestamp.tzinfo is None:
                    continue
                yield ProviderTick(
                    provider=self.name,
                    provider_instrument_id=instrument.provider_instrument_id,
                    price=Decimal(payload["price"]),
                    observed_at=self._as_utc(self.clock()),
                    provider_timestamp=timestamp,
                    open_24h=Decimal(payload["open_24h"]) if payload.get("open_24h") else None,
                    volume_24h=Decimal(payload["volume_24h"])
                    if payload.get("volume_24h")
                    else None,
                )

    async def get_quote(self, instrument: MarketInstrumentRef) -> ProviderQuote:
        payload = await self._get(f"/products/{instrument.provider_instrument_id}/ticker")
        ticker = _CoinbaseTicker.model_validate(payload)
        return ProviderQuote(
            provider=self.name,
            provider_instrument_id=instrument.provider_instrument_id,
            price=ticker.price,
            bid=ticker.bid,
            ask=ticker.ask,
            base_currency=instrument.base_currency,
            quote_currency=instrument.quote_currency,
            provider_timestamp=ticker.time,
            observed_at=self._as_utc(self.clock()),
            metadata={"trade_id": ticker.trade_id, "last_size": str(ticker.size)},
        )

    async def get_candles(
        self,
        instrument: MarketInstrumentRef,
        interval: MarketInterval,
        *,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = COINBASE_MAX_CANDLES_PER_REQUEST,
    ) -> list[ProviderCandle]:
        if limit <= 0:
            return []
        definition = INTERVAL_DEFINITIONS[interval]
        bounded_limit = min(limit, COINBASE_MAX_BACKFILL_TARGET_CANDLES)
        observed_at = self._as_utc(self.clock())
        effective_end = self._as_utc(end) if end is not None else observed_at
        effective_start = self._as_utc(start) if start is not None else None
        rows = await self._fetch_candle_rows(
            instrument,
            granularity=definition.coinbase_granularity,
            aggregation=definition.coinbase_aggregation,
            target_limit=bounded_limit,
            start=effective_start,
            end=effective_end,
        )
        normalized_rows = self._aggregate_rows(
            rows,
            interval=interval,
            source_seconds=definition.coinbase_granularity,
            aggregation=definition.coinbase_aggregation,
        )
        candles = [
            ProviderCandle(
                provider=self.name,
                provider_instrument_id=instrument.provider_instrument_id,
                interval=interval,
                open_time=datetime.fromtimestamp(timestamp, UTC),
                close_time=datetime.fromtimestamp(timestamp, UTC) + definition.duration,
                low=low,
                high=high,
                open=open_price,
                close=close,
                volume=volume,
                is_closed=datetime.fromtimestamp(timestamp, UTC) + definition.duration
                <= observed_at,
            )
            for timestamp, low, high, open_price, close, volume in normalized_rows
        ]
        return [candle for candle in candles if candle.is_closed][-bounded_limit:]

    async def _fetch_candle_rows(
        self,
        instrument: MarketInstrumentRef,
        *,
        granularity: int,
        aggregation: int,
        target_limit: int,
        start: datetime | None,
        end: datetime,
    ) -> list[CandleRow]:
        # One extra target bucket covers alignment and a possibly open trailing bucket.
        source_remaining = target_limit * aggregation + aggregation
        cursor_end = end
        rows_by_timestamp: dict[int, CandleRow] = {}
        request_number = 0
        while source_remaining > 0 and (start is None or cursor_end > start):
            request_size = min(source_remaining, COINBASE_MAX_CANDLES_PER_REQUEST)
            cursor_start = cursor_end - timedelta(seconds=granularity * request_size)
            if start is not None and cursor_start < start:
                cursor_start = start
            if cursor_start >= cursor_end:
                break
            if request_number > 0:
                await self.sleep(self.request_interval_seconds)
            payload = await self._get(
                f"/products/{instrument.provider_instrument_id}/candles",
                params={
                    "granularity": granularity,
                    "start": cursor_start.isoformat(),
                    "end": cursor_end.isoformat(),
                },
            )
            for row in _candle_rows.validate_python(payload):
                rows_by_timestamp[row[0]] = row
            source_remaining -= request_size
            cursor_end = cursor_start
            request_number += 1
        return [rows_by_timestamp[timestamp] for timestamp in sorted(rows_by_timestamp)]

    @classmethod
    def _aggregate_rows(
        cls,
        rows: list[CandleRow],
        *,
        interval: MarketInterval,
        source_seconds: int,
        aggregation: int,
    ) -> list[CandleRow]:
        unique = {row[0]: row for row in rows}
        ordered_rows = [unique[timestamp] for timestamp in sorted(unique)]
        if aggregation == 1:
            return ordered_rows
        buckets: dict[int, list[CandleRow]] = {}
        for row in ordered_rows:
            bucket = cls._bucket_start(row[0], interval)
            buckets.setdefault(bucket, []).append(row)
        result: list[CandleRow] = []
        for timestamp, values in sorted(buckets.items()):
            ordered = sorted(values, key=lambda row: row[0])
            expected_timestamps = [
                timestamp + index * source_seconds for index in range(aggregation)
            ]
            if [row[0] for row in ordered] != expected_timestamps:
                continue
            result.append(
                (
                    timestamp,
                    min(row[1] for row in ordered),
                    max(row[2] for row in ordered),
                    ordered[0][3],
                    ordered[-1][4],
                    sum((row[5] for row in ordered), start=Decimal("0")),
                )
            )
        return result

    @staticmethod
    def _bucket_start(timestamp: int, interval: MarketInterval) -> int:
        if interval == MarketInterval.ONE_WEEK:
            value = datetime.fromtimestamp(timestamp, UTC)
            day_start = value.replace(hour=0, minute=0, second=0, microsecond=0)
            monday = day_start - timedelta(days=day_start.weekday())
            return int(monday.timestamp())
        duration_seconds = int(INTERVAL_DEFINITIONS[interval].duration.total_seconds())
        return timestamp - (timestamp % duration_seconds)

    async def _get(self, path: str, *, params: dict[str, str | int] | None = None) -> object:
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout_seconds,
            headers={"User-Agent": "Alpha-Radar/0.1"},
            transport=self.transport,
        ) as client:
            response = await client.get(path, params=params)
            response.raise_for_status()
            return response.json()

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
