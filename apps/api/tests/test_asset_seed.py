import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.models import Asset, AssetAlias, AssetProviderMapping
from alpha_radar.assets.seed import seed_assets


@pytest.mark.asyncio
async def test_seed_is_idempotent(session: AsyncSession) -> None:
    first = await seed_assets(session)
    second = await seed_assets(session)

    assert first.assets_created == 16
    assert first.mappings_created == 9
    assert first.aliases_created > 0
    assert second.assets_created == 0
    assert second.mappings_created == 0
    assert second.aliases_created == 0
    assert await session.scalar(select(func.count()).select_from(Asset)) == 16
    assert await session.scalar(select(func.count()).select_from(AssetProviderMapping)) == 9
    assert (
        await session.scalar(select(func.count()).select_from(AssetAlias)) == first.aliases_created
    )
