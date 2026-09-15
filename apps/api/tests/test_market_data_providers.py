from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from pydantic import ValidationError

from alpha_radar.market_data.constants import MarketInterval
from alpha_radar.market_data.models import InstrumentType
from alpha_radar.market_data.providers import (
    CoinbaseMarketDataProvider,
    MarketInstrumentRef,
    MockMarketDataProvider,
    ProviderCandle,
    ProviderQuote,
)
from alpha_radar.market_data.quality import timestamp_quality_flags


def instrument_ref() -> MarketInstrumentRef:
    return MarketInstrumentRef(
        provider_instrument_id="BTC-USD",
        instrument_type=InstrumentType.SPOT,
        base_currency="BTC",
        quote_currency="USD",
    )


@pytest.mark.asyncio
async def test_mock_provider_is_deterministic_and_preserves_decimal() -> None:
    now = datetime(2026, 9, 14, 2, 0, tzinfo=UTC)
    provider = MockMarketDataProvider(clock=lambda: now, price=Decimal("50000.123456789"))

    quote = await provider.get_quote(instrument_ref())
    candles = await provider.get_candles(
        instrument_ref(), MarketInterval.ONE_MINUTE, end=now, limit=2
    )

    assert quote.price == Decimal("50000.123456789")
    assert quote.quote_currency == "USD"
    assert [candle.open for candle in candles] == [
        Decimal("50000.123456789"),
        Decimal("50001.123456789"),
    ]


def test_invalid_prices_and_ohlc_are_rejected() -> None:
    now = datetime(2026, 9, 14, 2, 0, tzinfo=UTC)
    with pytest.raises(ValidationError):
        ProviderQuote(
            provider="mock",
            provider_instrument_id="BTC-USD",
            price=Decimal("-1"),
            base_currency="BTC",
            quote_currency="USD",
            observed_at=now,
        )
    with pytest.raises(ValidationError):
        ProviderCandle(
            provider="mock",
            provider_instrument_id="BTC-USD",
            interval=MarketInterval.ONE_MINUTE,
            open_time=now,
            close_time=datetime(2026, 9, 14, 2, 1, tzinfo=UTC),
            open=Decimal("100"),
            high=Decimal("99"),
            low=Decimal("98"),
            close=Decimal("100"),
            is_closed=True,
        )


def test_timestamp_quality_flags_future_and_old_provider_times() -> None:
    observed_at = datetime(2026, 9, 14, 2, 0, tzinfo=UTC)

    assert timestamp_quality_flags(
        provider_timestamp=observed_at + timedelta(seconds=31),
        observed_at=observed_at,
        future_tolerance=timedelta(seconds=30),
        stale_after=timedelta(seconds=90),
    ) == ["future_timestamp"]
    assert timestamp_quality_flags(
        provider_timestamp=observed_at - timedelta(seconds=91),
        observed_at=observed_at,
        future_tolerance=timedelta(seconds=30),
        stale_after=timedelta(seconds=90),
    ) == ["old_timestamp"]


@pytest.mark.asyncio
async def test_coinbase_adapter_normalizes_ticker_and_candles() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/ticker"):
            return httpx.Response(
                200,
                json={
                    "trade_id": 42,
                    "price": "60123.12345678",
                    "size": "0.25",
                    "time": "2026-09-14T01:59:30Z",
                    "bid": "60123.12",
                    "ask": "60123.13",
                    "volume": "1200.5",
                },
            )
        return httpx.Response(
            200,
            json=[[1789350900, "60000", "60200", "60050", "60100", "12.5"]],
        )

    provider = CoinbaseMarketDataProvider(
        base_url="https://api.exchange.coinbase.com",
        transport=httpx.MockTransport(handler),
    )
    quote = await provider.get_quote(instrument_ref())
    candles = await provider.get_candles(instrument_ref(), MarketInterval.ONE_MINUTE, limit=1)

    assert quote.provider == "coinbase"
    assert quote.price == Decimal("60123.12345678")
    assert quote.provider_timestamp == datetime(2026, 9, 14, 1, 59, 30, tzinfo=UTC)
    assert candles[0].low == Decimal("60000")
    assert candles[0].high == Decimal("60200")
    assert candles[0].provider_timestamp is None
