"""Verify required PostgreSQL extensions.

Revision ID: 20260913_0001
Revises:
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260913_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")


def downgrade() -> None:
    # Extensions may be shared by future schema objects, so rollback intentionally preserves them.
    pass
