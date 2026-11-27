"""Add versioned event-contract research decisions; existing market schema is retained."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261127_0008"
down_revision = "20261004_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "event_contract_decisions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("asset_id", sa.Uuid(), sa.ForeignKey("assets.id"), nullable=False),
        sa.Column(
            "market_instrument_id",
            sa.Uuid(),
            sa.ForeignKey("market_instruments.id"),
            nullable=False,
        ),
        sa.Column("horizon_minutes", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(80), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("direction", sa.String(20), nullable=False),
        sa.Column("assessment", postgresql.JSONB(), nullable=False),
        sa.Column("episode_key", sa.String(128)),
        sa.Column("entry_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("entry_price", sa.Numeric(38, 18)),
        sa.Column("settlement_price", sa.Numeric(38, 18)),
        sa.Column("outcome", sa.String(20), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint(
            "market_instrument_id",
            "horizon_minutes",
            "version",
            "confirmed_at",
            name="uq_event_contract_decision_identity",
        ),
        sa.UniqueConstraint(
            "market_instrument_id",
            "horizon_minutes",
            "version",
            "episode_key",
            name="uq_event_contract_episode",
        ),
        sa.CheckConstraint("horizon_minutes IN (10, 30)", name="ck_ec_horizon"),
        sa.CheckConstraint(
            "direction IN ('up','down','wait','unavailable')", name="ck_ec_direction"
        ),
        sa.CheckConstraint(
            "outcome IN ('not_applicable','pending','up','down','tie','missing')",
            name="ck_ec_outcome",
        ),
    )
    op.create_index(
        "ix_ec_instrument_horizon_time",
        "event_contract_decisions",
        ["market_instrument_id", "horizon_minutes", "confirmed_at"],
    )
    op.create_index("ix_ec_pending", "event_contract_decisions", ["outcome", "expires_at"])


def downgrade() -> None:
    op.drop_table("event_contract_decisions")
