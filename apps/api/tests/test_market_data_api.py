from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.repository import AssetRepository
from alpha_radar.assets.seed import seed_assets
from alpha_radar.assets.service import AssetService
from alpha_radar.db.session import get_db_session
from alpha_radar.main import create_app
from alpha_radar.market_data.constants import MarketInterval
from alpha_radar.market_data.providers import MockMarketDataProvider
from alpha_radar.market_data.providers.base import ProviderCandle, ProviderQuote
from alpha_radar.market_data.repository import MarketDataRepository
from alpha_radar.market_data.seed import seed_market_instruments
from alpha_radar.market_data.service import MarketDataService


@pytest.mark.asyncio
async def test_quote_and_history_api_read_persisted_market_data(session: AsyncSession) -> None:
    await seed_assets(session)
    await seed_market_instruments(session)
    repository = MarketDataRepository(session)
    instrument = await repository.get_instrument_by_provider_identity("mock", "BTC-USD-SAMPLE")
    assert instrument is not None
    now = datetime.now(UTC).replace(microsecond=0)
    provider = MockMarketDataProvider(clock=lambda: now, price=Decimal("61234.125"))
    service = MarketDataService(
        repository,
        AssetService(AssetRepository(session)),
        quote_freshness=timedelta(seconds=90),
        future_tolerance=timedelta(seconds=30),
    )
    await service.fetch_and_ingest_quote(instrument, provider)
    await service.fetch_and_ingest_candles(instrument, provider, MarketInterval.ONE_HOUR, limit=2)

    application = create_app()

    async def override_session() -> AsyncIterator[AsyncSession]:
        yield session

    application.dependency_overrides[get_db_session] = override_session
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        quote = await client.get("/api/v1/assets/bitcoin/quote")
        history = await client.get(
            "/api/v1/assets/bitcoin/history", params={"interval": "1h", "limit": 2}
        )
        invalid_limit = await client.get("/api/v1/assets/bitcoin/history", params={"limit": 1001})

    assert quote.status_code == 200
    assert quote.json()["price"] == "61234.125000000000000000"
    assert quote.json()["symbol"] == "BTC"
    assert quote.json()["quote_currency"] == "USD"
    assert history.status_code == 200
    assert len(history.json()["items"]) == 2
    assert history.json()["items"][0]["open_time"] < history.json()["items"][1]["open_time"]
    assert history.json()["has_more"] is False
    assert history.json()["next_end"] is None
    assert invalid_limit.status_code == 422


@pytest.mark.asyncio
async def test_instrument_api_keeps_quote_and_history_on_exact_perpetual(
    session: AsyncSession,
) -> None:
    await seed_assets(session)
    await seed_market_instruments(session)
    repository = MarketDataRepository(session)
    instrument = await repository.get_instrument_by_provider_identity("bybit", "BTCUSDT")
    assert instrument is not None
    now = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)
    service = MarketDataService(
        repository,
        AssetService(AssetRepository(session)),
        quote_freshness=timedelta(seconds=90),
        future_tolerance=timedelta(seconds=30),
    )
    await service.ingest_quote(
        instrument,
        ProviderQuote(
            provider="bybit",
            provider_instrument_id="BTCUSDT",
            price=Decimal("62000"),
            base_currency="BTC",
            quote_currency="USDT",
            provider_timestamp=now,
            observed_at=now,
        ),
    )
    await service.ingest_candles(
        instrument,
        [
            ProviderCandle(
                provider="bybit",
                provider_instrument_id="BTCUSDT",
                interval=MarketInterval.ONE_HOUR,
                open_time=now - timedelta(hours=1),
                close_time=now,
                open=Decimal("61000"),
                high=Decimal("62100"),
                low=Decimal("60900"),
                close=Decimal("62000"),
                volume=Decimal("10"),
                is_closed=True,
                provider_timestamp=now,
            )
        ],
    )

    application = create_app()

    async def override_session() -> AsyncIterator[AsyncSession]:
        yield session

    application.dependency_overrides[get_db_session] = override_session
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        instruments = await client.get(
            "/api/v1/market-instruments",
            params={"provider": "bybit", "instrument_type": "perpetual"},
        )
        quote = await client.get(f"/api/v1/market-instruments/{instrument.id}/quote")
        history = await client.get(
            f"/api/v1/market-instruments/{instrument.id}/history",
            params={"interval": "1h"},
        )

    assert instruments.status_code == 200
    assert len(instruments.json()["items"]) == 12
    selected = next(
        item for item in instruments.json()["items"] if item["provider_instrument_id"] == "BTCUSDT"
    )
    assert selected["id"] == str(instrument.id)
    assert selected["instrument_type"] == "perpetual"
    assert selected["asset_id"] == str(instrument.asset_id)
    assert quote.json()["market_instrument_id"] == str(instrument.id)
    assert quote.json()["provider"] == "bybit"
    assert quote.json()["quote_currency"] == "USDT"
    assert history.json()["market_instrument_id"] == str(instrument.id)
    assert history.json()["items"][0]["market_instrument_id"] == str(instrument.id)
