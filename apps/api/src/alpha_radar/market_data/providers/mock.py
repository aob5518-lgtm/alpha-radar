from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal

from alpha_radar.market_data.constants import INTERVAL_DEFINITIONS, MarketInterval
from alpha_radar.market_data.providers.base import (
    MarketInstrumentRef,
    ProviderCandle,
    ProviderQuote,
)


class MockMarketDataProvider:
    name = "mock"

    def __init__(
        self,
        *,
        clock: Callable[[], datetime] | None = None,
        price: Decimal = Decimal("50000.125"),
    ) -> None:
        self.clock = clock or (lambda: datetime.now(UTC))
        self.price = price

    async def get_quote(self, instrument: MarketInstrumentRef) -> ProviderQuote:
        observed_at = self.clock()
        return ProviderQuote(
            provider=self.name,
            provider_instrument_id=instrument.provider_instrument_id,
            price=self.price,
            bid=self.price - Decimal("0.125"),
            ask=self.price + Decimal("0.125"),
            bid_size=Decimal("1.5"),
            ask_size=Decimal("2.5"),
            base_currency=instrument.base_currency,
            quote_currency=instrument.quote_currency,
            provider_timestamp=observed_at,
            observed_at=observed_at,
            metadata={"source": "deterministic-test-provider"},
        )

    async def get_candles(
        self,
        instrument: MarketInstrumentRef,
        interval: MarketInterval,
        *,
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 300,
    ) -> list[ProviderCandle]:
        definition = INTERVAL_DEFINITIONS[interval]
        effective_end = end or self.clock()
        count = max(0, limit)
        first_open = start or (effective_end - definition.duration * count)
        candles: list[ProviderCandle] = []
        for index in range(count):
            open_time = first_open + definition.duration * index
            close_time = open_time + definition.duration
            if open_time >= effective_end:
                break
            open_price = self.price + Decimal(index)
            candles.append(
                ProviderCandle(
                    provider=self.name,
                    provider_instrument_id=instrument.provider_instrument_id,
                    interval=interval,
                    open_time=open_time,
                    close_time=close_time,
                    open=open_price,
                    high=open_price + Decimal("2"),
                    low=open_price - Decimal("1"),
                    close=open_price + Decimal("1"),
                    volume=Decimal("10.25") + Decimal(index),
                    quote_volume=None,
                    is_closed=close_time <= effective_end,
                )
            )
        return candles
