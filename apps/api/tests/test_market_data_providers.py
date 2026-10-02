from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from pydantic import ValidationError

from alpha_radar.market_data.constants import (
    COINBASE_MAX_CANDLES_PER_REQUEST,
    MarketInterval,
)
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


def test_core_3_market_intervals_are_centralized() -> None:
    assert [interval.value for interval in MarketInterval] == [
        "1m",
        "5m",
        "15m",
        "1h",
        "4h",
        "1d",
        "1w",
    ]


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


@pytest.mark.asyncio
async def test_coinbase_adapter_aggregates_four_hour_candles_without_inventing_bars() -> None:
    start = int(datetime(2026, 9, 14, 0, 0, tzinfo=UTC).timestamp())
    rows = [
        [start + index * 3600, "99", str(102 + index), str(100 + index), str(101 + index), "2"]
        for index in range(4)
    ]

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=rows)

    provider = CoinbaseMarketDataProvider(
        base_url="https://api.exchange.coinbase.com",
        transport=httpx.MockTransport(handler),
    )
    candles = await provider.get_candles(instrument_ref(), MarketInterval.FOUR_HOURS, limit=1)

    assert len(candles) == 1
    assert candles[0].interval == MarketInterval.FOUR_HOURS
    assert candles[0].open == Decimal("100")
    assert candles[0].close == Decimal("104")
    assert candles[0].high == Decimal("105")
    assert candles[0].low == Decimal("99")
    assert candles[0].volume == Decimal("8")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("interval", "limit", "expected_minimum_requests"),
    [
        (MarketInterval.FOUR_HOURS, 300, 5),
        (MarketInterval.ONE_DAY, 300, 2),
        (MarketInterval.ONE_WEEK, 500, 12),
    ],
)
async def test_coinbase_adapter_paginates_enough_history_for_technical_analysis(
    interval: MarketInterval,
    limit: int,
    expected_minimum_requests: int,
) -> None:
    now = datetime(2026, 9, 14, 0, 0, tzinfo=UTC)  # Monday boundary.
    requests: list[httpx.Request] = []
    waits: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        granularity = int(request.url.params["granularity"])
        start = datetime.fromisoformat(request.url.params["start"])
        end = datetime.fromisoformat(request.url.params["end"])
        timestamps = range(int(start.timestamp()), int(end.timestamp()), granularity)
        return httpx.Response(
            200,
            json=[
                [timestamp, "99", "102", "100", "101", "2"]
                for timestamp in reversed(list(timestamps))
            ],
        )

    async def record_wait(seconds: float) -> None:
        waits.append(seconds)

    provider = CoinbaseMarketDataProvider(
        base_url="https://api.exchange.coinbase.com",
        transport=httpx.MockTransport(handler),
        clock=lambda: now,
        sleep=record_wait,
    )
    candles = await provider.get_candles(instrument_ref(), interval, limit=limit)

    assert len(candles) == limit
    assert len(requests) >= expected_minimum_requests
    assert len(waits) == len(requests) - 1
    assert all(candle.is_closed for candle in candles)
    assert all(candle.interval == interval for candle in candles)
    for request in requests:
        granularity = int(request.url.params["granularity"])
        start = datetime.fromisoformat(request.url.params["start"])
        end = datetime.fromisoformat(request.url.params["end"])
        assert (end - start).total_seconds() <= (COINBASE_MAX_CANDLES_PER_REQUEST * granularity)


def test_weekly_aggregation_uses_monday_utc_and_rejects_gaps() -> None:
    monday = int(datetime(2026, 9, 7, 0, 0, tzinfo=UTC).timestamp())
    complete_rows = [
        (
            monday + day * 86_400,
            Decimal("99"),
            Decimal(str(102 + day)),
            Decimal(str(100 + day)),
            Decimal(str(101 + day)),
            Decimal("2"),
        )
        for day in range(7)
    ]

    aggregated = CoinbaseMarketDataProvider._aggregate_rows(  # pyright: ignore[reportPrivateUsage]
        complete_rows,
        interval=MarketInterval.ONE_WEEK,
        source_seconds=86_400,
        aggregation=7,
    )
    assert len(aggregated) == 1
    assert aggregated[0][0] == monday
    assert datetime.fromtimestamp(aggregated[0][0], UTC).weekday() == 0

    with_gap = [row for index, row in enumerate(complete_rows) if index != 3]
    assert (
        CoinbaseMarketDataProvider._aggregate_rows(  # pyright: ignore[reportPrivateUsage]
            with_gap,
            interval=MarketInterval.ONE_WEEK,
            source_seconds=86_400,
            aggregation=7,
        )
        == []
    )
