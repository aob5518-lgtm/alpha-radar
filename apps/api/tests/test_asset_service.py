from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.models import Asset, AssetType
from alpha_radar.assets.repository import AssetRepository
from alpha_radar.assets.seed import seed_assets
from alpha_radar.assets.service import AssetService
from alpha_radar.errors import AppError


@pytest.mark.asyncio
async def test_asset_lookup_supports_uuid_slug_and_symbol(session: AsyncSession) -> None:
    await seed_assets(session)
    service = AssetService(AssetRepository(session))
    bitcoin = await service.resolve_asset("bitcoin")

    assert (await service.resolve_asset(str(bitcoin.id))).id == bitcoin.id
    assert (await service.resolve_asset("BTC")).id == bitcoin.id
    assert bitcoin.provider_mappings
    assert bitcoin.aliases


@pytest.mark.asyncio
async def test_asset_lookup_returns_not_found(session: AsyncSession) -> None:
    service = AssetService(AssetRepository(session))

    for identifier in ("missing", str(uuid4())):
        with pytest.raises(AppError) as exc_info:
            await service.resolve_asset(identifier)

        assert exc_info.value.code == "asset_not_found"
        assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_ambiguous_symbol_is_not_resolved_arbitrarily(session: AsyncSession) -> None:
    await seed_assets(session)
    session.add(
        Asset(
            id=uuid4(),
            symbol="BTC",
            slug="btc-example-equity",
            name="BTC Example Equity",
            asset_type=AssetType.EQUITY,
            country="US",
        )
    )
    await session.commit()

    with pytest.raises(AppError) as exc_info:
        await AssetService(AssetRepository(session)).resolve_asset("BTC")

    assert exc_info.value.code == "ambiguous_asset_identifier"
    assert exc_info.value.status_code == 409
    assert exc_info.value.details == {"matching_slugs": ["bitcoin", "btc-example-equity"]}
