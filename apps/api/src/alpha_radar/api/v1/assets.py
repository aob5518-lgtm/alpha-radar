from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.models import AssetType
from alpha_radar.assets.repository import AssetRepository, AssetSortField, SortOrder
from alpha_radar.assets.schemas import AssetDetailResponse, AssetListResponse
from alpha_radar.assets.service import AssetService
from alpha_radar.db.session import get_db_session

router = APIRouter(prefix="/assets", tags=["assets"])


def get_asset_service(session: Annotated[AsyncSession, Depends(get_db_session)]) -> AssetService:
    return AssetService(AssetRepository(session))


@router.get("", response_model=AssetListResponse)
async def list_assets(
    service: Annotated[AssetService, Depends(get_asset_service)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    search: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
    asset_type: AssetType | None = None,
    sort_by: AssetSortField = "symbol",
    sort_order: SortOrder = "asc",
) -> AssetListResponse:
    return await service.list_assets(
        page=page,
        page_size=page_size,
        search=search,
        asset_type=asset_type,
        sort_by=sort_by,
        sort_order=sort_order,
    )


@router.get("/{identifier}", response_model=AssetDetailResponse)
async def get_asset(
    identifier: str,
    service: Annotated[AssetService, Depends(get_asset_service)],
) -> AssetDetailResponse:
    asset = await service.resolve_asset(identifier)
    return AssetDetailResponse.model_validate(asset)
