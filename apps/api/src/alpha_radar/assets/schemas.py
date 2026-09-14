from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from alpha_radar.assets.models import AssetStatus, AssetType


class AssetProviderMappingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    provider: str
    provider_asset_id: str
    provider_symbol: str | None
    metadata: dict[str, Any] = Field(validation_alias="metadata_")


class AssetAliasResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    alias: str
    alias_type: str | None
    normalized_alias: str


class AssetSummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    symbol: str
    slug: str
    name: str
    asset_type: AssetType
    sector: str | None
    industry: str | None
    chain: str | None
    country: str | None
    market_cap: Decimal | None
    status: AssetStatus


class AssetDetailResponse(AssetSummaryResponse):
    metadata: dict[str, Any] = Field(validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime
    provider_mappings: list[AssetProviderMappingResponse]
    aliases: list[AssetAliasResponse]


class PaginationMetadata(BaseModel):
    page: int
    page_size: int
    total_items: int
    total_pages: int


class AssetListResponse(BaseModel):
    items: list[AssetSummaryResponse]
    pagination: PaginationMetadata
