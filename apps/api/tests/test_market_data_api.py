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
    assert invalid_limit.status_code == 422
