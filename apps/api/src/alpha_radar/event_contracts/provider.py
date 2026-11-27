from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Protocol

import httpx
from pydantic import RootModel

from alpha_radar.event_contracts.strategy import Bar

PROVIDER = "binance_index"
SYMBOLS = ("BTCUSDT", "ETHUSDT")


class IndexProvider(Protocol):
    async def fetch(
        self,
        symbol: str,
        *,
        end: datetime,
        limit: int = 1000,
    ) -> list[Bar]: ...


class BinanceIndexProvider:
    """Public USD-M index candles; deliberately not mark/trade/perpetual prices."""

    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client

    async def fetch(self, symbol: str, *, end: datetime, limit: int = 1000) -> list[Bar]:
        if symbol not in SYMBOLS or not 1 <= limit <= 1000:
            raise ValueError("Only reviewed BTC/ETH index pairs and bounded pages are supported")
        response = await self.client.get(
            "https://fapi.binance.com/fapi/v1/indexPriceKlines",
            params={
                "pair": symbol,
                "interval": "1m",
                "limit": limit,
                "endTime": int(end.timestamp() * 1000) - 1,
            },
        )
        response.raise_for_status()
        rows = RootModel[list[list[str | int | float]]].model_validate(response.json()).root
        bars: list[Bar] = []
        for row in rows:
            if len(row) < 7:
                raise ValueError("Malformed Binance index candle")
            start = datetime.fromtimestamp(int(row[0]) / 1000, UTC)
            close = start + timedelta(minutes=1)
            # Binance's inclusive final millisecond is normalized to an exclusive boundary.
            if int(row[6]) != int(close.timestamp() * 1000) - 1:
                raise ValueError("Unexpected Binance index candle boundary")
            bar = Bar(
                open_time=start,
                close_time=close,
                open=Decimal(str(row[1])),
                high=Decimal(str(row[2])),
                low=Decimal(str(row[3])),
                close=Decimal(str(row[4])),
                is_closed=close <= end,
            )
            if bar.high < max(bar.open, bar.close) or bar.low > min(bar.open, bar.close):
                raise ValueError("Invalid Binance index OHLC")
            if bar.is_closed:
                bars.append(bar)
        ordered = sorted(bars, key=lambda bar: bar.open_time)
        if len({bar.open_time for bar in ordered}) != len(ordered):
            raise ValueError("Duplicate Binance index timestamp")
        return ordered
