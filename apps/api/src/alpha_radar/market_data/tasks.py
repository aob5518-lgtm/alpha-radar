from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from alpha_radar.assets.repository import AssetRepository
from alpha_radar.assets.service import AssetService
from alpha_radar.config import get_settings
from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.market_data.constants import (
    BYBIT_HISTORY_RETENTION,
    BYBIT_MAX_BACKFILL_PAGES,
    MarketInterval,
)
from alpha_radar.market_data.factory import create_market_data_provider
from alpha_radar.market_data.providers.base import PaginatedHistoricalMarketDataProvider
from alpha_radar.market_data.repository import MarketDataRepository
from alpha_radar.market_data.service import MarketDataService
from alpha_radar.worker import app


def _service(repository: MarketDataRepository) -> MarketDataService:
    settings = get_settings()
    return MarketDataService(
        repository,
        AssetService(AssetRepository(repository.session)),
        quote_freshness=timedelta(seconds=settings.market_data_quote_freshness_seconds),
        future_tolerance=timedelta(seconds=settings.market_data_future_tolerance_seconds),
    )


async def _fetch_quotes() -> int:
    settings = get_settings()
    if not settings.market_data_ingestion_enabled:
        return 0
    provider = create_market_data_provider(settings)
    try:
        async with async_session_factory() as session:
            repository = MarketDataRepository(session)
            instruments = await repository.list_active_instruments(provider.name)
            service = _service(repository)
            for instrument in instruments:
                await service.fetch_and_ingest_quote(instrument, provider)
            return len(instruments)
    finally:
        await engine.dispose()


async def _fetch_candles(interval: MarketInterval, limit: int = 3) -> int:
    settings = get_settings()
    if not settings.market_data_ingestion_enabled:
        return 0
    provider = create_market_data_provider(settings)
    try:
        async with async_session_factory() as session:
            repository = MarketDataRepository(session)
            instruments = await repository.list_active_instruments(provider.name)
            service = _service(repository)
            count = 0
            for instrument in instruments:
                count += await service.fetch_and_ingest_closed_candles(
                    instrument, provider, interval, limit=min(max(limit, 1), 10)
                )
            return count
    finally:
        await engine.dispose()


async def _backfill_technical_history(interval: MarketInterval, max_pages: int) -> int:
    settings = get_settings()
    if not settings.market_data_ingestion_enabled:
        return 0
    provider = create_market_data_provider(settings)
    try:
        async with async_session_factory() as session:
            repository = MarketDataRepository(session)
            instruments = await repository.list_active_instruments(provider.name)
            service = _service(repository)
            count = 0
            for instrument in instruments:
                if isinstance(provider, PaginatedHistoricalMarketDataProvider):
                    retention = BYBIT_HISTORY_RETENTION[interval]
                    end = datetime.now(UTC)
                    horizon = end - retention if retention is not None else None
                    pages = provider.iter_candle_pages(
                        service.instrument_ref(instrument),
                        interval,
                        end=end,
                        horizon=horizon,
                        max_pages=max_pages,
                    )
                    async for page in pages:
                        count += await service.ingest_candles(
                            instrument, [candle for candle in page if candle.is_closed]
                        )
                else:
                    count += await service.fetch_and_ingest_candles(
                        instrument, provider, interval, limit=1000
                    )
            return count
    finally:
        await engine.dispose()


@app.task(  # pyright: ignore[reportUnknownMemberType, reportUntypedFunctionDecorator]
    name="alpha_radar.market_data.fetch_quotes"
)
def fetch_quotes() -> int:
    return asyncio.run(_fetch_quotes())


@app.task(  # pyright: ignore[reportUnknownMemberType, reportUntypedFunctionDecorator]
    name="alpha_radar.market_data.fetch_candles"
)
def fetch_candles(interval: str = MarketInterval.ONE_MINUTE.value, limit: int = 3) -> int:
    return asyncio.run(_fetch_candles(MarketInterval(interval), limit))


@app.task(  # pyright: ignore[reportUnknownMemberType, reportUntypedFunctionDecorator]
    name="alpha_radar.market_data.backfill_technical_history"
)
def backfill_technical_history(interval: str, max_pages: int = 64) -> int:
    """Explicit bounded backfill; intentionally absent from the periodic schedule."""
    market_interval = MarketInterval(interval)
    bounded_pages = min(max(max_pages, 1), BYBIT_MAX_BACKFILL_PAGES)
    return asyncio.run(_backfill_technical_history(market_interval, bounded_pages))
