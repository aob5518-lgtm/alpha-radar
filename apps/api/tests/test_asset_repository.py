from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.models import AssetProviderMapping, AssetType
from alpha_radar.assets.repository import AssetRepository
from alpha_radar.assets.seed import seed_assets


@pytest.mark.asyncio
async def test_repository_paginates_filters_and_searches(session: AsyncSession) -> None:
    await seed_assets(session)
    repository = AssetRepository(session)

    first_page = await repository.list_assets(
        page=1,
        page_size=3,
        search=None,
        asset_type=AssetType.CRYPTO,
        sort_by="symbol",
        sort_order="asc",
    )
    search_result = await repository.list_assets(
        page=1,
        page_size=20,
        search="NVIDIA",
        asset_type=None,
        sort_by="name",
        sort_order="asc",
    )

    assert first_page.total_items == 8
    assert len(first_page.items) == 3
    assert [asset.symbol for asset in first_page.items] == ["ADA", "AVAX", "BTC"]
    assert [asset.symbol for asset in search_result.items] == ["NVDA"]


@pytest.mark.asyncio
async def test_provider_mapping_identifier_is_unique_per_provider(session: AsyncSession) -> None:
    await seed_assets(session)
    ethereum = await AssetRepository(session).get_by_slug("ethereum")
    assert ethereum is not None

    session.add(
        AssetProviderMapping(
            id=uuid4(),
            asset_id=ethereum.id,
            provider="binance",
            provider_asset_id="BTCUSDT",
        )
    )

    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()
