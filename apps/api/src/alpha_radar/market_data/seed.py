from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.models import Asset
from alpha_radar.assets.repository import AssetRepository
from alpha_radar.assets.service import AssetService
from alpha_radar.db.session import async_session_factory
from alpha_radar.market_data.constants import MarketInterval
from alpha_radar.market_data.models import InstrumentType, MarketInstrument
from alpha_radar.market_data.providers import MockMarketDataProvider
from alpha_radar.market_data.repository import MarketDataRepository
from alpha_radar.market_data.service import MarketDataService


@dataclass(frozen=True)
class InstrumentSeed:
    asset_slug: str
    provider: str
    provider_instrument_id: str
    base_currency: str
    quote_currency: str
    venue: str | None

    @property
    def id(self) -> UUID:
        return uuid5(
            NAMESPACE_URL,
            f"alpha-radar:market-instrument:{self.provider}:{self.provider_instrument_id}",
        )


INSTRUMENTS = (
    InstrumentSeed("bitcoin", "coinbase", "BTC-USD", "BTC", "USD", "Coinbase Exchange"),
    InstrumentSeed("ethereum", "coinbase", "ETH-USD", "ETH", "USD", "Coinbase Exchange"),
    InstrumentSeed("solana", "coinbase", "SOL-USD", "SOL", "USD", "Coinbase Exchange"),
    InstrumentSeed("bitcoin", "mock", "BTC-USD-SAMPLE", "BTC", "USD", "Deterministic Test"),
)


async def seed_market_instruments(session: AsyncSession) -> int:
    existing = set(
        (
            await session.execute(
                select(MarketInstrument.provider, MarketInstrument.provider_instrument_id)
            )
        )
        .tuples()
        .all()
    )
    assets = {
        asset.slug: asset
        for asset in (
            await session.scalars(
                select(Asset).where(Asset.slug.in_({seed.asset_slug for seed in INSTRUMENTS}))
            )
        ).all()
    }
    created = 0
    for seed in INSTRUMENTS:
        identity = (seed.provider, seed.provider_instrument_id)
        if identity in existing:
            continue
        asset = assets.get(seed.asset_slug)
        if asset is None:
            raise RuntimeError(f"Asset seed must run before market-data seed: {seed.asset_slug}")
        session.add(
            MarketInstrument(
                id=seed.id,
                asset_id=asset.id,
                provider=seed.provider,
                provider_instrument_id=seed.provider_instrument_id,
                instrument_type=InstrumentType.SPOT,
                base_currency=seed.base_currency,
                quote_currency=seed.quote_currency,
                venue=seed.venue,
                metadata_={"seeded": True},
            )
        )
        existing.add(identity)
        created += 1
    await session.commit()
    return created


async def seed_sample_market_data(session: AsyncSession) -> tuple[int, int]:
    await seed_market_instruments(session)
    repository = MarketDataRepository(session)
    instrument = await repository.get_instrument_by_provider_identity("mock", "BTC-USD-SAMPLE")
    if instrument is None:
        raise RuntimeError("Mock market instrument was not created")
    fixed_now = datetime(2026, 9, 14, 2, 0, tzinfo=UTC)
    provider = MockMarketDataProvider(clock=lambda: fixed_now, price=Decimal("60000.12345678"))
    service = MarketDataService(
        repository,
        AssetService(AssetRepository(session)),
        quote_freshness=timedelta(seconds=90),
        future_tolerance=timedelta(seconds=30),
    )
    await service.fetch_and_ingest_quote(instrument, provider)
    candles = await provider.get_candles(
        service.instrument_ref(instrument),
        MarketInterval.ONE_HOUR,
        end=fixed_now,
        limit=3,
    )
    ingested = await service.ingest_candles(instrument, candles)
    return 1, ingested


async def main() -> None:
    async with async_session_factory() as session:
        instruments = await seed_market_instruments(session)
        quotes, candles = await seed_sample_market_data(session)
    print(
        f"Market-data seed complete: {instruments} instruments created, "
        f"{quotes} quote persisted, {candles} candles upserted."
    )


if __name__ == "__main__":
    asyncio.run(main())
