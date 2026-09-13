"""Create canonical asset tables.

Revision ID: 20260913_0002
Revises: 20260913_0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260913_0002"
down_revision: str | None = "20260913_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

asset_type = postgresql.ENUM(
    "crypto",
    "equity",
    "etf",
    "commodity",
    "currency",
    "bond",
    "index",
    "macro",
    name="asset_type",
    create_type=False,
)
asset_status = postgresql.ENUM(
    "active", "inactive", "delisted", name="asset_status", create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()
    asset_type.create(bind, checkfirst=False)
    asset_status.create(bind, checkfirst=False)

    op.create_table(
        "assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("slug", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("asset_type", asset_type, nullable=False),
        sa.Column("sector", sa.String(length=128), nullable=True),
        sa.Column("industry", sa.String(length=128), nullable=True),
        sa.Column("chain", sa.String(length=128), nullable=True),
        sa.Column("country", sa.String(length=2), nullable=True),
        sa.Column("market_cap", sa.Numeric(precision=30, scale=8), nullable=True),
        sa.Column("status", asset_status, server_default="active", nullable=False),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("slug = lower(slug)", name="ck_assets_slug_lowercase"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_assets_slug"),
    )
    op.create_index("ix_assets_asset_type", "assets", ["asset_type"])
    op.create_index("ix_assets_status", "assets", ["status"])
    op.create_index("ix_assets_symbol_lower", "assets", [sa.text("lower(symbol)")])
    op.create_index("ix_assets_name_lower", "assets", [sa.text("lower(name)")])

    op.create_table(
        "asset_provider_mappings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("provider_asset_id", sa.String(length=255), nullable=False),
        sa.Column("provider_symbol", sa.String(length=64), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("provider = lower(provider)", name="ck_provider_mapping_lowercase"),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_asset_id", name="uq_provider_asset_identifier"),
    )
    op.create_index("ix_asset_provider_mappings_asset_id", "asset_provider_mappings", ["asset_id"])

    op.create_table(
        "asset_aliases",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("alias", sa.String(length=255), nullable=False),
        sa.Column("alias_type", sa.String(length=64), nullable=True),
        sa.Column("normalized_alias", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_id", "normalized_alias", name="uq_asset_normalized_alias"),
    )
    op.create_index("ix_asset_aliases_asset_id", "asset_aliases", ["asset_id"])
    op.create_index("ix_asset_aliases_normalized_alias", "asset_aliases", ["normalized_alias"])


def downgrade() -> None:
    op.drop_table("asset_aliases")
    op.drop_table("asset_provider_mappings")
    op.drop_table("assets")
    asset_status.drop(op.get_bind(), checkfirst=False)
    asset_type.drop(op.get_bind(), checkfirst=False)
