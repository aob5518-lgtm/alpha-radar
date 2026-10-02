"""Add Core 3 chart intervals.

Revision ID: 20261002_0005
Revises: 20260916_0004
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261002_0005"
down_revision: str | None = "20260916_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for value in ("5m", "15m", "4h", "1w"):
        op.execute(f"ALTER TYPE market_interval ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # PostgreSQL enum value removal requires a destructive type/table rewrite.
    # Retaining the additional accepted values is the safe downgrade behavior.
    pass
