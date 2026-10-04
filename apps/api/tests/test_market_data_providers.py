from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from pydantic import ValidationError

from alpha_radar.config import Settings
from alpha_radar.market_data.constants import (
    COINBASE_MAX_CANDLES_PER_REQUEST,
    MarketInterval,
)
from alpha_radar.market_data.factory import create_market_data_provider
from alpha_radar.market_data.models import InstrumentType
from alpha_radar.market_data.providers import (
    BybitMarketDataProvider,
    CoinbaseMarketDataProvider,
    MarketInstrumentRef,
    MockMarketDataProvider,
    ProviderCandle,
    ProviderQuote,
)
from alpha_radar.market_data.providers.base import (
    ProviderCandleUpdate,
    ProviderPriceUpdate,
    ProviderTick,
    ProviderTradeUpdate,
    StreamingMarketDataProvider,
)
from alpha_radar.market_data.quality import timestamp_quality_flags


def instrument_ref() -> MarketInstrumentRef:
    return MarketInstrumentRef(
        provider_instrument_id="BTC-USD",
        instrument_type=InstrumentType.SPOT,
        base_currency="BTC",
        quote_currency="USD",
    )


def perpetual_ref() -> MarketInstrumentRef:
    return MarketInstrumentRef(
        provider_instrument_id="BTCUSDT",
        instrument_type=InstrumentType.PERPETUAL,
        base_currency="BTC",
        quote_currency="USDT",
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


def test_bybit_maps_all_core_3_intervals_to_native_kline_intervals() -> None:
    from alpha_radar.market_data.constants import INTERVAL_DEFINITIONS

    assert {
        interval.value: INTERVAL_DEFINITIONS[interval].bybit_interval for interval in MarketInterval
    } == {
        "1m": "1",
        "5m": "5",
        "15m": "15",
        "1h": "60",
        "4h": "240",
        "1d": "D",
        "1w": "W",
    }


def test_bybit_is_selectable_through_provider_configuration() -> None:
    provider = create_market_data_provider(Settings(market_data_provider="bybit"))
    assert isinstance(provider, BybitMarketDataProvider)


@pytest.mark.asyncio
async def test_bybit_adapter_normalizes_quote_and_rest_klines() -> None:
    now = datetime(2026, 10, 3, 12, 1, tzinfo=UTC)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["category"] == "linear"
        assert request.url.params["symbol"] == "BTCUSDT"
        if request.url.path.endswith("/tickers"):
            return httpx.Response(
                200,
                json={
                    "retCode": 0,
                    "retMsg": "OK",
                    "time": 1791028860000,
                    "result": {
                        "category": "linear",
                        "list": [
                            {
                                "symbol": "BTCUSDT",
                                "lastPrice": "61234.5",
                                "bid1Price": "61234.4",
                                "ask1Price": "61234.6",
                                "bid1Size": "2.5",
                                "ask1Size": "1.5",
                            }
                        ],
                    },
                },
            )
        assert request.url.path.endswith("/kline")
        assert request.url.params["interval"] == "60"
        return httpx.Response(
            200,
            json={
                "retCode": 0,
                "retMsg": "OK",
                "time": 1791028860000,
                "result": {
                    "category": "linear",
                    "symbol": "BTCUSDT",
                    "list": [
                        ["1791028800000", "61200", "61300", "61100", "61250", "12", "735000"],
                        ["1791025200000", "61000", "61250", "60900", "61200", "20", "1224000"],
                    ],
                },
            },
        )

    provider = BybitMarketDataProvider(
        base_url="https://api.bybit.com",
        transport=httpx.MockTransport(handler),
        clock=lambda: now,
    )
    quote = await provider.get_quote(perpetual_ref())
    candles = await provider.get_candles(perpetual_ref(), MarketInterval.ONE_HOUR, limit=2)

    assert quote.provider == "bybit"
    assert quote.price == Decimal("61234.5")
    assert quote.quote_currency == "USDT"
    assert [candle.open for candle in candles] == [Decimal("61000"), Decimal("61200")]
    assert candles[0].is_closed is True
    assert candles[1].is_closed is False
    assert candles[0].volume == Decimal("20")
    assert candles[0].quote_volume == Decimal("1224000")


def test_bybit_websocket_kline_preserves_exchange_confirm_semantics() -> None:
    data = {
        "start": 1672324800000,
        "end": 1672325099999,
        "interval": "5",
        "open": "16649.5",
        "close": "16677",
        "high": "16677",
        "low": "16608",
        "volume": "2.081",
        "turnover": "34666.4005",
        "confirm": False,
        "timestamp": 1672324988882,
    }
    payload: dict[str, object] = {
        "topic": "kline.5.BTCUSDT",
        "type": "snapshot",
        "ts": 1672324988882,
        "data": [data],
    }
    partial = BybitMarketDataProvider.normalize_websocket_message(
        payload, instrument=perpetual_ref(), interval=MarketInterval.FIVE_MINUTES
    )[0]
    closed = BybitMarketDataProvider.normalize_websocket_message(
        {
            **payload,
            "data": [{**data, "confirm": True}],
        },
        instrument=perpetual_ref(),
        interval=MarketInterval.FIVE_MINUTES,
    )[0]

    assert partial.is_closed is False
    assert closed.is_closed is True
    assert partial.open == Decimal("16649.5")
    assert partial.close == Decimal("16677")
    assert partial.volume == Decimal("2.081")
    assert partial.close_time == datetime(2022, 12, 29, 14, 45, tzinfo=UTC)


def test_bybit_normalizes_ticker_trade_and_authoritative_kline_updates() -> None:
    ticker = BybitMarketDataProvider.normalize_stream_message(
        {
            "topic": "tickers.BTCUSDT",
            "ts": 1672324988882,
            "data": {"symbol": "BTCUSDT", "lastPrice": "16677", "price24hPcnt": "0.01"},
        },
        instrument=perpetual_ref(),
        interval=MarketInterval.FIVE_MINUTES,
    )[0]
    trade = BybitMarketDataProvider.normalize_stream_message(
        {
            "topic": "publicTrade.BTCUSDT",
            "ts": 1672324988882,
            "data": [
                {
                    "T": 1672324988882,
                    "s": "BTCUSDT",
                    "S": "Buy",
                    "v": "0.2",
                    "p": "16678",
                    "i": "trade-1",
                }
            ],
        },
        instrument=perpetual_ref(),
        interval=MarketInterval.FIVE_MINUTES,
    )[0]
    candle = BybitMarketDataProvider.normalize_stream_message(
        {
            "topic": "kline.5.BTCUSDT",
            "data": [
                {
                    "start": 1672324800000,
                    "end": 1672325099999,
                    "interval": "5",
                    "open": "16649.5",
                    "close": "16677",
                    "high": "16677",
                    "low": "16608",
                    "volume": "2.081",
                    "turnover": "34666",
                    "confirm": True,
                    "timestamp": 1672324988882,
                }
            ],
        },
        instrument=perpetual_ref(),
        interval=MarketInterval.FIVE_MINUTES,
    )[0]
    assert isinstance(ticker, ProviderPriceUpdate)
    assert isinstance(trade, ProviderTradeUpdate)
    assert isinstance(candle, ProviderCandleUpdate)
    assert candle.candle.is_closed is True
    assert trade.trade_id == "trade-1"


@pytest.mark.asyncio
async def test_bybit_backward_pagination_advances_before_earliest_candle() -> None:
    requests: list[httpx.Request] = []
    now = datetime(2026, 10, 3, 12, tzinfo=UTC)

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        end = int(request.url.params["end"])
        rows = [
            [str(end - index * 60_000), "100", "101", "99", "100", "1", "100"]
            for index in range(1000)
        ]
        return httpx.Response(
            200,
            json={
                "retCode": 0,
                "retMsg": "OK",
                "time": end,
                "result": {"symbol": "BTCUSDT", "list": rows},
            },
        )

    provider = BybitMarketDataProvider(
        base_url="https://api.bybit.com",
        transport=httpx.MockTransport(handler),
        clock=lambda: now,
        requests_per_second=100000,
    )
    pages = [
        page
        async for page in provider.iter_candle_pages(
            perpetual_ref(), MarketInterval.ONE_MINUTE, end=now, horizon=None, max_pages=2
        )
    ]
    assert len(pages) == 2
    assert len(pages[0]) == len(pages[1]) == 1000
    assert int(requests[1].url.params["end"]) < int(pages[0][0].open_time.timestamp() * 1000)
    assert pages[0][0].open_time < pages[0][-1].open_time


def test_coinbase_exposes_normalized_streaming_capability() -> None:
    provider = CoinbaseMarketDataProvider(base_url="https://example.test")
    assert isinstance(provider, StreamingMarketDataProvider)
    tick = ProviderTick(
        provider="coinbase",
        provider_instrument_id="BTC-USD",
        price=Decimal("60000.12"),
        observed_at=datetime(2026, 10, 2, 12, 30, tzinfo=UTC),
        provider_timestamp=datetime(2026, 10, 2, 12, 30, tzinfo=UTC),
        open_24h=Decimal("59000"),
    )
    assert tick.price == Decimal("60000.12")


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
