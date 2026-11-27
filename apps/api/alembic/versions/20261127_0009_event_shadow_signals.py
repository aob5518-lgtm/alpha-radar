"""Persist frozen Event Signal V1 shadow observations."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261127_0009"
down_revision = "20261127_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "event_shadow_signals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("asset_id", sa.Uuid(), sa.ForeignKey("assets.id"), nullable=False),
        sa.Column(
            "market_instrument_id",
            sa.Uuid(),
            sa.ForeignKey("market_instruments.id"),
            nullable=False,
        ),
        sa.Column(
            "reference_instrument_id",
            sa.Uuid(),
            sa.ForeignKey("market_instruments.id"),
            nullable=False,
        ),
        sa.Column("symbol", sa.String(16), nullable=False),
        sa.Column("horizon_minutes", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("settlement_version", sa.String(32), nullable=False),
        sa.Column("direction", sa.String(12), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("episode_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reference_price", sa.Numeric(38, 18), nullable=False),
        sa.Column("reference_source", sa.String(64), nullable=False),
        sa.Column("settlement_source", sa.String(64), nullable=False),
        sa.Column("assessment", postgresql.JSONB(), nullable=False),
        sa.Column("result", sa.String(12), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True)),
        sa.Column("settled_price", sa.Numeric(38, 18)),
        sa.Column("payout_assumption", sa.Numeric(38, 18)),
        sa.UniqueConstraint(
            "market_instrument_id",
            "horizon_minutes",
            "version",
            "confirmed_at",
            name="uq_shadow_cutoff",
        ),
        sa.UniqueConstraint(
            "market_instrument_id",
            "horizon_minutes",
            "version",
            "direction",
            "episode_at",
            name="uq_shadow_episode",
        ),
        sa.CheckConstraint("horizon_minutes IN (10, 30)", name="ck_shadow_horizon"),
        sa.CheckConstraint("score BETWEEN 75 AND 100", name="ck_shadow_score"),
        sa.CheckConstraint("direction IN ('higher', 'lower')", name="ck_shadow_direction"),
        sa.CheckConstraint(
            "result IN ('pending', 'win', 'loss', 'missing')", name="ck_shadow_result"
        ),
        sa.CheckConstraint("reference_price > 0", name="ck_shadow_reference"),
        sa.CheckConstraint(
            "confirmed_at <= generated_at AND generated_at < expires_at", name="ck_shadow_times"
        ),
    )
    op.create_index(
        "ix_shadow_pending",
        "event_shadow_signals",
        ["reference_instrument_id", "result", "expires_at"],
    )


def downgrade() -> None:
    op.drop_table("event_shadow_signals")
