"""Create canonical market-data tables and hypertables.

Revision ID: 20260914_0003
Revises: 20260913_0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260914_0003"
down_revision: str | None = "20260913_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

instrument_type = postgresql.ENUM(
    "spot",
    "index",
    "perpetual",
    "future",
    "option",
    name="market_instrument_type",
    create_type=False,
)
instrument_status = postgresql.ENUM(
    "active", "inactive", "delisted", name="market_instrument_status", create_type=False
)
market_interval = postgresql.ENUM("1m", "1h", "1d", name="market_interval", create_type=False)
numeric_value = sa.Numeric(precision=38, scale=18)


def upgrade() -> None:
    bind = op.get_bind()
    instrument_type.create(bind, checkfirst=False)
    instrument_status.create(bind, checkfirst=False)
    market_interval.create(bind, checkfirst=False)

    op.create_table(
        "market_instruments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("provider_instrument_id", sa.String(length=255), nullable=False),
        sa.Column("instrument_type", instrument_type, nullable=False),
        sa.Column("base_currency", sa.String(length=32), nullable=False),
        sa.Column("quote_currency", sa.String(length=32), nullable=False),
        sa.Column("venue", sa.String(length=128), nullable=True),
        sa.Column("status", instrument_status, server_default="active", nullable=False),
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
        sa.CheckConstraint(
            "provider = lower(provider)", name="ck_market_instruments_provider_lower"
        ),
        sa.CheckConstraint(
            "base_currency = upper(base_currency)", name="ck_market_instruments_base_upper"
        ),
        sa.CheckConstraint(
            "quote_currency = upper(quote_currency)", name="ck_market_instruments_quote_upper"
        ),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider", "provider_instrument_id", name="uq_market_instrument_provider_identity"
        ),
    )
    op.create_index("ix_market_instruments_asset_id", "market_instruments", ["asset_id"])
    op.create_index("ix_market_instruments_status", "market_instruments", ["status"])

    op.create_table(
        "market_quotes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("market_instrument_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("price", numeric_value, nullable=False),
        sa.Column("bid", numeric_value, nullable=True),
        sa.Column("ask", numeric_value, nullable=True),
        sa.Column("bid_size", numeric_value, nullable=True),
        sa.Column("ask_size", numeric_value, nullable=True),
        sa.Column("base_currency", sa.String(length=32), nullable=False),
        sa.Column("quote_currency", sa.String(length=32), nullable=False),
        sa.Column("provider_timestamp", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "ingested_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "quality_flags",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.CheckConstraint("price > 0", name="ck_market_quotes_positive_price"),
        sa.CheckConstraint("provider = lower(provider)", name="ck_market_quotes_provider_lower"),
        sa.CheckConstraint(
            "base_currency = upper(base_currency)", name="ck_market_quotes_base_upper"
        ),
        sa.CheckConstraint(
            "quote_currency = upper(quote_currency)", name="ck_market_quotes_quote_upper"
        ),
        sa.CheckConstraint("bid IS NULL OR bid > 0", name="ck_market_quotes_positive_bid"),
        sa.CheckConstraint("ask IS NULL OR ask > 0", name="ck_market_quotes_positive_ask"),
        sa.CheckConstraint("bid_size IS NULL OR bid_size >= 0", name="ck_market_quotes_bid_size"),
        sa.CheckConstraint("ask_size IS NULL OR ask_size >= 0", name="ck_market_quotes_ask_size"),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["market_instrument_id"], ["market_instruments.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", "observed_at"),
    )
    op.create_index("ix_market_quotes_asset_observed", "market_quotes", ["asset_id", "observed_at"])
    op.create_index(
        "ix_market_quotes_instrument_observed",
        "market_quotes",
        ["market_instrument_id", "observed_at"],
    )

    op.create_table(
        "market_candles",
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("market_instrument_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("interval", market_interval, nullable=False),
        sa.Column("open_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("close_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("open", numeric_value, nullable=False),
        sa.Column("high", numeric_value, nullable=False),
        sa.Column("low", numeric_value, nullable=False),
        sa.Column("close", numeric_value, nullable=False),
        sa.Column("volume", numeric_value, nullable=True),
        sa.Column("quote_volume", numeric_value, nullable=True),
        sa.Column("is_closed", sa.Boolean(), nullable=False),
        sa.Column("provider_timestamp", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "ingested_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "quality_flags",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.CheckConstraint("close_time > open_time", name="ck_market_candles_time_order"),
        sa.CheckConstraint("provider = lower(provider)", name="ck_market_candles_provider_lower"),
        sa.CheckConstraint(
            "open > 0 AND high > 0 AND low > 0 AND close > 0",
            name="ck_market_candles_positive_prices",
        ),
        sa.CheckConstraint(
            "high >= open AND high >= close AND low <= open AND low <= close AND high >= low",
            name="ck_market_candles_ohlc_bounds",
        ),
        sa.CheckConstraint("volume IS NULL OR volume >= 0", name="ck_market_candles_volume"),
        sa.CheckConstraint(
            "quote_volume IS NULL OR quote_volume >= 0", name="ck_market_candles_quote_volume"
        ),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["market_instrument_id"], ["market_instruments.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("provider", "market_instrument_id", "interval", "open_time"),
    )
    op.create_index("ix_market_candles_asset_open", "market_candles", ["asset_id", "open_time"])

    op.execute(
        "SELECT create_hypertable('market_quotes', by_range('observed_at'), if_not_exists => TRUE)"
    )
    op.execute(
        "SELECT create_hypertable('market_candles', by_range('open_time'), if_not_exists => TRUE)"
    )


def downgrade() -> None:
    op.drop_table("market_candles")
    op.drop_table("market_quotes")
    op.drop_table("market_instruments")
    market_interval.drop(op.get_bind(), checkfirst=False)
    instrument_status.drop(op.get_bind(), checkfirst=False)
    instrument_type.drop(op.get_bind(), checkfirst=False)
