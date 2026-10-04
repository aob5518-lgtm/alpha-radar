"""Add structured crypto Event presentation and evidence fields.

Revision ID: 20261004_0007
Revises: 20261002_0006
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261004_0007"
down_revision: str | None = "20261002_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("category", sa.String(16), server_default="macro", nullable=False),
    )
    op.add_column("events", sa.Column("signal", sa.Text(), nullable=True))
    op.add_column("events", sa.Column("risk", sa.Text(), nullable=True))
    op.add_column("events", sa.Column("recommended_action", sa.String(32), nullable=True))
    op.add_column("events", sa.Column("opportunity_signal", sa.String(16), nullable=True))
    op.add_column("events", sa.Column("confidence", sa.String(16), nullable=True))
    op.add_column("events", sa.Column("contract_address", sa.String(255), nullable=True))
    op.create_index("ix_events_category_importance", "events", ["category", "importance"])
    op.create_check_constraint(
        "ck_events_category",
        "events",
        "category IN ('macro', 'crypto')",
    )
    op.create_check_constraint(
        "ck_events_recommended_action",
        "events",
        "recommended_action IS NULL OR recommended_action IN "
        "('watch', 'research', 'prepare', 'wait_for_confirmation', 'caution', 'avoid')",
    )
    op.create_check_constraint(
        "ck_events_opportunity_signal",
        "events",
        "opportunity_signal IS NULL OR opportunity_signal IN "
        "('none', 'watch', 'research', 'prepare', 'wait', 'avoid')",
    )
    op.create_check_constraint(
        "ck_events_confidence",
        "events",
        "confidence IS NULL OR confidence IN ('low', 'medium', 'high')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_events_confidence", "events", type_="check")
    op.drop_constraint("ck_events_opportunity_signal", "events", type_="check")
    op.drop_constraint("ck_events_recommended_action", "events", type_="check")
    op.drop_constraint("ck_events_category", "events", type_="check")
    op.drop_index("ix_events_category_importance", table_name="events")
    op.drop_column("events", "contract_address")
    op.drop_column("events", "confidence")
    op.drop_column("events", "opportunity_signal")
    op.drop_column("events", "recommended_action")
    op.drop_column("events", "risk")
    op.drop_column("events", "signal")
    op.drop_column("events", "category")
