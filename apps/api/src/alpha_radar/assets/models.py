from __future__ import annotations

import enum
from datetime import datetime
from decimal import Decimal
from typing import Any, cast
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PostgreSQLUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from alpha_radar.db.base import Base


class AssetType(str, enum.Enum):
    CRYPTO = "crypto"
    EQUITY = "equity"
    ETF = "etf"
    COMMODITY = "commodity"
    CURRENCY = "currency"
    BOND = "bond"
    INDEX = "index"
    MACRO = "macro"


class AssetStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    DELISTED = "delisted"


def enum_values(enum_type: type[enum.Enum]) -> list[str]:
    return [cast(str, member.value) for member in enum_type]


uuid_type = PostgreSQLUUID(as_uuid=True).with_variant(Uuid(as_uuid=True), "sqlite")
json_type = JSONB().with_variant(JSON(), "sqlite")


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Asset(TimestampMixin, Base):
    __tablename__ = "assets"
    __table_args__ = (
        CheckConstraint("slug = lower(slug)", name="ck_assets_slug_lowercase"),
        UniqueConstraint("slug", name="uq_assets_slug"),
        Index("ix_assets_symbol_lower", text("lower(symbol)")),
        Index("ix_assets_name_lower", text("lower(name)")),
        Index("ix_assets_asset_type", "asset_type"),
        Index("ix_assets_status", "status"),
    )

    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    asset_type: Mapped[AssetType] = mapped_column(
        Enum(
            AssetType,
            name="asset_type",
            values_callable=enum_values,
        ),
        nullable=False,
    )
    sector: Mapped[str | None] = mapped_column(String(128))
    industry: Mapped[str | None] = mapped_column(String(128))
    chain: Mapped[str | None] = mapped_column(String(128))
    country: Mapped[str | None] = mapped_column(String(2))
    market_cap: Mapped[Decimal | None] = mapped_column(Numeric(30, 8))
    status: Mapped[AssetStatus] = mapped_column(
        Enum(
            AssetStatus,
            name="asset_status",
            values_callable=enum_values,
        ),
        nullable=False,
        default=AssetStatus.ACTIVE,
        server_default=AssetStatus.ACTIVE.value,
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", json_type, nullable=False, default=dict, server_default="{}"
    )

    provider_mappings: Mapped[list[AssetProviderMapping]] = relationship(
        back_populates="asset", cascade="all, delete-orphan", lazy="raise"
    )
    aliases: Mapped[list[AssetAlias]] = relationship(
        back_populates="asset", cascade="all, delete-orphan", lazy="raise"
    )


class AssetProviderMapping(TimestampMixin, Base):
    __tablename__ = "asset_provider_mappings"
    __table_args__ = (
        CheckConstraint("provider = lower(provider)", name="ck_provider_mapping_lowercase"),
        UniqueConstraint("provider", "provider_asset_id", name="uq_provider_asset_identifier"),
        Index("ix_asset_provider_mappings_asset_id", "asset_id"),
    )

    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    asset_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_asset_id: Mapped[str] = mapped_column(String(255), nullable=False)
    provider_symbol: Mapped[str | None] = mapped_column(String(64))
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", json_type, nullable=False, default=dict, server_default="{}"
    )

    asset: Mapped[Asset] = relationship(back_populates="provider_mappings")


class AssetAlias(Base):
    __tablename__ = "asset_aliases"
    __table_args__ = (
        UniqueConstraint("asset_id", "normalized_alias", name="uq_asset_normalized_alias"),
        Index("ix_asset_aliases_normalized_alias", "normalized_alias"),
        Index("ix_asset_aliases_asset_id", "asset_id"),
    )

    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    asset_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False
    )
    alias: Mapped[str] = mapped_column(String(255), nullable=False)
    alias_type: Mapped[str | None] = mapped_column(String(64))
    normalized_alias: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    asset: Mapped[Asset] = relationship(back_populates="aliases")
