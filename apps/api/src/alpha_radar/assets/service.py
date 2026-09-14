from math import ceil
from uuid import UUID

from alpha_radar.assets.models import Asset, AssetType
from alpha_radar.assets.repository import AssetRepository, AssetSortField, SortOrder
from alpha_radar.assets.schemas import (
    AssetListResponse,
    AssetSummaryResponse,
    PaginationMetadata,
)
from alpha_radar.errors import AppError


class AssetService:
    def __init__(self, repository: AssetRepository) -> None:
        self.repository = repository

    async def list_assets(
        self,
        *,
        page: int,
        page_size: int,
        search: str | None,
        asset_type: AssetType | None,
        sort_by: AssetSortField,
        sort_order: SortOrder,
    ) -> AssetListResponse:
        asset_page = await self.repository.list_assets(
            page=page,
            page_size=page_size,
            search=search,
            asset_type=asset_type,
            sort_by=sort_by,
            sort_order=sort_order,
        )
        return AssetListResponse(
            items=[AssetSummaryResponse.model_validate(asset) for asset in asset_page.items],
            pagination=PaginationMetadata(
                page=page,
                page_size=page_size,
                total_items=asset_page.total_items,
                total_pages=ceil(asset_page.total_items / page_size),
            ),
        )

    async def resolve_asset(self, identifier: str) -> Asset:
        try:
            asset_id = UUID(identifier)
        except ValueError:
            asset_id = None

        if asset_id is not None:
            asset = await self.repository.get_by_id(asset_id)
            if asset is None:
                raise self._not_found(identifier)
            return asset

        asset = await self.repository.get_by_slug(identifier)
        if asset is not None:
            return asset

        matches = await self.repository.get_by_symbol(identifier)
        if not matches:
            raise self._not_found(identifier)
        if len(matches) > 1:
            raise AppError(
                code="ambiguous_asset_identifier",
                message=f"Asset identifier '{identifier}' is ambiguous",
                status_code=409,
                details={"matching_slugs": [match.slug for match in matches]},
            )
        return matches[0]

    @staticmethod
    def _not_found(identifier: str) -> AppError:
        return AppError(
            code="asset_not_found",
            message=f"Asset '{identifier}' was not found",
            status_code=404,
        )
