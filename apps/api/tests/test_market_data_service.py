from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.repository import AssetRepository
from alpha_radar.assets.seed import seed_assets
from alpha_radar.assets.service import AssetService
from alpha_radar.errors import AppError
from alpha_radar.market_data.constants import Freshness, MarketInterval
from alpha_radar.market_data.models import MarketCandle, MarketInstrument
from alpha_radar.market_data.providers import MockMarketDataProvider
from alpha_radar.market_data.providers.base import ProviderCandle
from alpha_radar.market_data.repository import MarketDataRepository
from alpha_radar.market_data.seed import seed_market_instruments
from alpha_radar.market_data.service import MarketDataService


async def configured_service(
    session: AsyncSession,
) -> tuple[MarketDataService, MarketInstrument, datetime]:
    await seed_assets(session)
    await seed_market_instruments(session)
    repository = MarketDataRepository(session)
    instrument = await repository.get_instrument_by_provider_identity("mock", "BTC-USD-SAMPLE")
    assert instrument is not None
    service = MarketDataService(
        repository,
        AssetService(AssetRepository(session)),
        quote_freshness=timedelta(seconds=90),
        future_tolerance=timedelta(seconds=30),
    )
    return service, instrument, datetime(2026, 9, 14, 2, 0, tzinfo=UTC)


@pytest.mark.asyncio
async def test_instrument_identity_is_unique_and_links_asset_uuid(session: AsyncSession) -> None:
    _, instrument, _ = await configured_service(session)
    assert instrument.asset_id is not None
    session.add(
        MarketInstrument(
            asset_id=instrument.asset_id,
            provider=instrument.provider,
            provider_instrument_id=instrument.provider_instrument_id,
            instrument_type=instrument.instrument_type,
            base_currency=instrument.base_currency,
            quote_currency=instrument.quote_currency,
        )
    )
    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()


@pytest.mark.asyncio
async def test_seed_contains_only_the_bounded_bybit_perpetual_universe(
    session: AsyncSession,
) -> None:
    await seed_assets(session)
    await seed_market_instruments(session)
    instruments = await MarketDataRepository(session).list_active_instruments("bybit")

    assert [item.provider_instrument_id for item in instruments] == sorted(
        [
            "BTCUSDT",
            "ETHUSDT",
            "SOLUSDT",
            "BNBUSDT",
            "XRPUSDT",
            "DOGEUSDT",
            "ADAUSDT",
            "SUIUSDT",
            "LINKUSDT",
            "AVAXUSDT",
            "LTCUSDT",
            "BCHUSDT",
        ]
    )
    assert all(item.instrument_type.value == "perpetual" for item in instruments)
    assert all(item.quote_currency == "USDT" for item in instruments)


@pytest.mark.asyncio
async def test_quote_round_trip_preserves_decimal_and_freshness(session: AsyncSession) -> None:
    service, instrument, now = await configured_service(session)
    provider = MockMarketDataProvider(clock=lambda: now, price=Decimal("60000.125"))
    await service.fetch_and_ingest_quote(instrument, provider)

    fresh = await service.get_quote("bitcoin", now=now + timedelta(seconds=89))
    stale = await service.get_quote("BTC", now=now + timedelta(seconds=91))

    assert isinstance(fresh.price, Decimal)
    assert fresh.price == Decimal("60000.125000000000000000")
    assert fresh.asset_id == instrument.asset_id
    assert fresh.freshness == Freshness.FRESH
    assert stale.freshness == Freshness.STALE
    assert stale.is_stale is True


@pytest.mark.asyncio
async def test_candle_ingestion_is_idempotent_and_history_is_ordered(
    session: AsyncSession,
) -> None:
    service, instrument, now = await configured_service(session)
    provider = MockMarketDataProvider(clock=lambda: now)
    candles = await provider.get_candles(
        service.instrument_ref(instrument), MarketInterval.ONE_HOUR, end=now, limit=3
    )

    await service.ingest_candles(instrument, list(reversed(candles)))
    await service.ingest_candles(instrument, candles)
    history = await service.get_history(
        "bitcoin", interval=MarketInterval.ONE_HOUR, start=None, end=None, limit=10
    )

    count = await session.scalar(select(func.count()).select_from(MarketCandle))
    assert count == 3
    assert [item.open_time.replace(tzinfo=UTC) for item in history.items] == sorted(
        candle.open_time for candle in candles
    )
    assert all("duplicate" in item.quality_flags for item in history.items)

    latest_page = await service.get_history(
        "bitcoin", interval=MarketInterval.ONE_HOUR, start=None, end=None, limit=2
    )
    assert latest_page.has_more is True
    assert latest_page.next_end == latest_page.items[0].open_time
    older_page = await service.get_history(
        "bitcoin",
        interval=MarketInterval.ONE_HOUR,
        start=None,
        end=latest_page.next_end,
        limit=2,
    )
    assert older_page.has_more is False
    assert [item.open_time for item in older_page.items] == [history.items[0].open_time]


@pytest.mark.asyncio
async def test_all_timeframe_maintenance_is_bounded_closed_and_idempotent(
    session: AsyncSession,
) -> None:
    service, instrument, now = await configured_service(session)
    provider = MockMarketDataProvider(clock=lambda: now)

    for interval in MarketInterval:
        first = await service.fetch_and_ingest_closed_candles(
            instrument, provider, interval, limit=3
        )
        second = await service.fetch_and_ingest_closed_candles(
            instrument, provider, interval, limit=3
        )
        assert first == second == 3

    count = await session.scalar(select(func.count()).select_from(MarketCandle))
    assert count == len(MarketInterval) * 3
    assert not list(
        await session.scalars(select(MarketCandle).where(MarketCandle.is_closed.is_(False)))
    )

    closed = (
        await provider.get_candles(
            service.instrument_ref(instrument), MarketInterval.ONE_MINUTE, end=now, limit=1
        )
    )[0]

    class OpenTailProvider(MockMarketDataProvider):
        async def get_candles(self, *args: object, **kwargs: object) -> list[ProviderCandle]:
            return [closed, closed.model_copy(update={"open_time": now, "is_closed": False})]

    ingested = await service.fetch_and_ingest_closed_candles(
        instrument, OpenTailProvider(clock=lambda: now), MarketInterval.ONE_MINUTE, limit=3
    )
    assert ingested == 1


@pytest.mark.asyncio
async def test_history_rejects_invalid_or_excessive_ranges(session: AsyncSession) -> None:
    service, _, now = await configured_service(session)

    for start, end in (
        (now, now),
        (now, now - timedelta(minutes=1)),
        (now - timedelta(days=8), now),
        (now - timedelta(days=1), None),
    ):
        with pytest.raises(AppError) as exc_info:
            await service.get_history(
                "bitcoin",
                interval=MarketInterval.ONE_MINUTE,
                start=start,
                end=end,
                limit=100,
            )
        assert exc_info.value.status_code == 422
