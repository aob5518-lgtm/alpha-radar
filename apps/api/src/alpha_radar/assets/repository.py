from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.sql.elements import ColumnElement

from alpha_radar.assets.models import Asset, AssetType

AssetSortField = Literal["symbol", "name", "asset_type", "created_at"]
SortOrder = Literal["asc", "desc"]


@dataclass(frozen=True)
class AssetPage:
    items: list[Asset]
    total_items: int


class AssetRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_assets(
        self,
        *,
        page: int,
        page_size: int,
        search: str | None,
        asset_type: AssetType | None,
        sort_by: AssetSortField,
        sort_order: SortOrder,
    ) -> AssetPage:
        filters: list[ColumnElement[bool]] = []
        if search:
            pattern = f"%{search.strip()}%"
            filters.append(
                or_(
                    Asset.symbol.ilike(pattern),
                    Asset.name.ilike(pattern),
                    Asset.slug.ilike(pattern),
                )
            )
        if asset_type is not None:
            filters.append(Asset.asset_type == asset_type)

        count_query = select(func.count()).select_from(Asset).where(*filters)
        total_items = int((await self.session.scalar(count_query)) or 0)

        sort_column = {
            "symbol": Asset.symbol,
            "name": Asset.name,
            "asset_type": Asset.asset_type,
            "created_at": Asset.created_at,
        }[sort_by]
        ordering = sort_column.asc() if sort_order == "asc" else sort_column.desc()
        query = (
            select(Asset)
            .where(*filters)
            .order_by(ordering, Asset.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        items = list((await self.session.scalars(query)).all())
        return AssetPage(items=items, total_items=total_items)

    async def get_by_id(self, asset_id: UUID) -> Asset | None:
        return await self._get_one(select(Asset).where(Asset.id == asset_id))

    async def get_by_slug(self, slug: str) -> Asset | None:
        return await self._get_one(select(Asset).where(Asset.slug == slug.lower()))

    async def get_by_symbol(self, symbol: str) -> list[Asset]:
        query = (
            select(Asset)
            .where(func.lower(Asset.symbol) == symbol.lower())
            .options(selectinload(Asset.provider_mappings), selectinload(Asset.aliases))
            .order_by(Asset.slug.asc())
        )
        return list((await self.session.scalars(query)).all())

    async def _get_one(self, query: Select[tuple[Asset]]) -> Asset | None:
        query = query.options(selectinload(Asset.provider_mappings), selectinload(Asset.aliases))
        return (await self.session.scalars(query)).one_or_none()
