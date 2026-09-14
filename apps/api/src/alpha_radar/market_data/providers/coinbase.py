from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import httpx
from pydantic import AwareDatetime, BaseModel, TypeAdapter

from alpha_radar.market_data.constants import (
    COINBASE_MAX_CANDLES_PER_REQUEST,
    INTERVAL_DEFINITIONS,
    MarketInterval,
)
from alpha_radar.market_data.providers.base import (
    MarketInstrumentRef,
    ProviderCandle,
    ProviderQuote,
)


class _CoinbaseTicker(BaseModel):
    price: Decimal
    bid: Decimal
    ask: Decimal
    size: Decimal
    volume: Decimal
    time: AwareDatetime
    trade_id: int


_candle_rows = TypeAdapter(list[tuple[int, Decimal, Decimal, Decimal, Decimal, Decimal]])


class CoinbaseMarketDataProvider:
    name = "coinbase"

    def __init__(
        self,
        *,
        base_url: str,
        timeout_seconds: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.transport = transport

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
            observed_at=datetime.now(UTC),
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
        definition = INTERVAL_DEFINITIONS[interval]
        bounded_limit = min(limit, COINBASE_MAX_CANDLES_PER_REQUEST)
        params: dict[str, str | int] = {"granularity": definition.coinbase_granularity}
        if end is not None:
            params["end"] = end.isoformat()
        if start is not None:
            params["start"] = start.isoformat()
        elif end is not None:
            params["start"] = (end - definition.duration * bounded_limit).isoformat()

        payload = await self._get(
            f"/products/{instrument.provider_instrument_id}/candles", params=params
        )
        rows = _candle_rows.validate_python(payload)
        observed_at = datetime.now(UTC)
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
            for timestamp, low, high, open_price, close, volume in rows[:bounded_limit]
        ]
        return sorted(candles, key=lambda candle: candle.open_time)

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
