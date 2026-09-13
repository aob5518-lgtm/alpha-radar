from __future__ import annotations

import asyncio
from dataclasses import dataclass
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.models import (
    Asset,
    AssetAlias,
    AssetProviderMapping,
    AssetType,
)
from alpha_radar.db.session import async_session_factory


@dataclass(frozen=True)
class AssetSeed:
    symbol: str
    slug: str
    name: str
    asset_type: AssetType
    sector: str | None = None
    industry: str | None = None
    chain: str | None = None
    country: str | None = None

    @property
    def id(self) -> UUID:
        return uuid5(NAMESPACE_URL, f"alpha-radar:asset:{self.slug}")


@dataclass(frozen=True)
class MappingSeed:
    asset_slug: str
    provider: str
    provider_asset_id: str
    provider_symbol: str | None = None


@dataclass(frozen=True)
class AliasSeed:
    asset_slug: str
    alias: str
    alias_type: str

    @property
    def normalized_alias(self) -> str:
        return normalize_alias(self.alias)


@dataclass(frozen=True)
class SeedResult:
    assets_created: int
    mappings_created: int
    aliases_created: int


ASSETS = (
    AssetSeed(
        "BTC", "bitcoin", "Bitcoin", AssetType.CRYPTO, sector="Digital assets", chain="Bitcoin"
    ),
    AssetSeed(
        "ETH", "ethereum", "Ethereum", AssetType.CRYPTO, sector="Smart contracts", chain="Ethereum"
    ),
    AssetSeed(
        "SOL", "solana", "Solana", AssetType.CRYPTO, sector="Smart contracts", chain="Solana"
    ),
    AssetSeed("XRP", "xrp", "XRP", AssetType.CRYPTO, sector="Payments", chain="XRP Ledger"),
    AssetSeed(
        "ADA", "cardano", "Cardano", AssetType.CRYPTO, sector="Smart contracts", chain="Cardano"
    ),
    AssetSeed(
        "LINK", "chainlink", "Chainlink", AssetType.CRYPTO, sector="Oracle", chain="Ethereum"
    ),
    AssetSeed(
        "AVAX",
        "avalanche",
        "Avalanche",
        AssetType.CRYPTO,
        sector="Smart contracts",
        chain="Avalanche",
    ),
    AssetSeed(
        "DOGE", "dogecoin", "Dogecoin", AssetType.CRYPTO, sector="Digital assets", chain="Dogecoin"
    ),
    AssetSeed(
        "COIN",
        "coinbase-global",
        "Coinbase Global",
        AssetType.EQUITY,
        sector="Financials",
        industry="Capital Markets",
        country="US",
    ),
    AssetSeed(
        "CRCL",
        "circle-internet-group",
        "Circle Internet Group",
        AssetType.EQUITY,
        sector="Financials",
        industry="Financial Infrastructure",
        country="US",
    ),
    AssetSeed(
        "NVDA",
        "nvidia",
        "NVIDIA",
        AssetType.EQUITY,
        sector="Technology",
        industry="Semiconductors",
        country="US",
    ),
    AssetSeed(
        "MSTR",
        "strategy",
        "Strategy",
        AssetType.EQUITY,
        sector="Technology",
        industry="Software",
        country="US",
    ),
    AssetSeed(
        "SPY",
        "spdr-sp-500-etf-trust",
        "SPDR S&P 500 ETF Trust",
        AssetType.ETF,
        sector="Broad Market",
        country="US",
    ),
    AssetSeed(
        "QQQ",
        "invesco-qqq-trust",
        "Invesco QQQ Trust",
        AssetType.ETF,
        sector="Large Cap Growth",
        country="US",
    ),
    AssetSeed(
        "GLD",
        "spdr-gold-shares",
        "SPDR Gold Shares",
        AssetType.ETF,
        sector="Commodities",
        country="US",
    ),
    AssetSeed(
        "IBIT",
        "ishares-bitcoin-trust-etf",
        "iShares Bitcoin Trust ETF",
        AssetType.ETF,
        sector="Digital Assets",
        country="US",
    ),
)

MAPPINGS = (
    MappingSeed("bitcoin", "binance", "BTCUSDT", "BTCUSDT"),
    MappingSeed("bitcoin", "coinbase", "BTC-USD", "BTC-USD"),
    MappingSeed("bitcoin", "coingecko", "bitcoin", "BTC"),
    MappingSeed("ethereum", "binance", "ETHUSDT", "ETHUSDT"),
    MappingSeed("ethereum", "coinbase", "ETH-USD", "ETH-USD"),
    MappingSeed("ethereum", "coingecko", "ethereum", "ETH"),
    MappingSeed("solana", "binance", "SOLUSDT", "SOLUSDT"),
    MappingSeed("solana", "coinbase", "SOL-USD", "SOL-USD"),
    MappingSeed("solana", "coingecko", "solana", "SOL"),
)

ALIASES = tuple(
    AliasSeed(asset.slug, alias, alias_type)
    for asset in ASSETS
    for alias, alias_type in (
        (asset.name, "name"),
        (asset.symbol, "symbol"),
        (asset.slug, "slug"),
    )
) + (AliasSeed("bitcoin", "XBT", "symbol"),)


def normalize_alias(alias: str) -> str:
    return " ".join(alias.casefold().split())


async def seed_assets(session: AsyncSession) -> SeedResult:
    asset_rows = (await session.execute(select(Asset.slug, Asset.id))).tuples().all()
    existing_assets: dict[str, UUID] = {slug: asset_id for slug, asset_id in asset_rows}
    assets_created = 0
    for seed in ASSETS:
        if seed.slug in existing_assets:
            continue
        session.add(
            Asset(
                id=seed.id,
                symbol=seed.symbol,
                slug=seed.slug,
                name=seed.name,
                asset_type=seed.asset_type,
                sector=seed.sector,
                industry=seed.industry,
                chain=seed.chain,
                country=seed.country,
            )
        )
        existing_assets[seed.slug] = seed.id
        assets_created += 1
    await session.flush()

    mapping_rows = (
        await session.execute(
            select(AssetProviderMapping.provider, AssetProviderMapping.provider_asset_id)
        )
    ).tuples()
    existing_mappings: set[tuple[str, str]] = set(mapping_rows.all())
    mappings_created = 0
    for seed in MAPPINGS:
        key = (seed.provider, seed.provider_asset_id)
        if key in existing_mappings:
            continue
        session.add(
            AssetProviderMapping(
                id=uuid5(
                    NAMESPACE_URL, f"alpha-radar:mapping:{seed.provider}:{seed.provider_asset_id}"
                ),
                asset_id=existing_assets[seed.asset_slug],
                provider=seed.provider,
                provider_asset_id=seed.provider_asset_id,
                provider_symbol=seed.provider_symbol,
            )
        )
        existing_mappings.add(key)
        mappings_created += 1

    alias_rows = (
        await session.execute(select(AssetAlias.asset_id, AssetAlias.normalized_alias))
    ).tuples()
    existing_aliases: set[tuple[UUID, str]] = set(alias_rows.all())
    aliases_created = 0
    for seed in ALIASES:
        asset_id = existing_assets[seed.asset_slug]
        key = (asset_id, seed.normalized_alias)
        if key in existing_aliases:
            continue
        session.add(
            AssetAlias(
                id=uuid5(
                    NAMESPACE_URL, f"alpha-radar:alias:{seed.asset_slug}:{seed.normalized_alias}"
                ),
                asset_id=asset_id,
                alias=seed.alias,
                alias_type=seed.alias_type,
                normalized_alias=seed.normalized_alias,
            )
        )
        existing_aliases.add(key)
        aliases_created += 1

    await session.commit()
    return SeedResult(
        assets_created=assets_created,
        mappings_created=mappings_created,
        aliases_created=aliases_created,
    )


async def main() -> None:
    async with async_session_factory() as session:
        result = await seed_assets(session)
    print(
        "Asset seed complete: "
        f"{result.assets_created} assets, "
        f"{result.mappings_created} mappings, "
        f"{result.aliases_created} aliases created."
    )


if __name__ == "__main__":
    asyncio.run(main())
