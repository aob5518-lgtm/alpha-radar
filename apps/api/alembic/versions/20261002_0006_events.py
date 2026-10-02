"""Add canonical events and provenance links.

Revision ID: 20261002_0006
Revises: 20261002_0005
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261002_0006"
down_revision: str | None = "20261002_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("external_key", sa.String(255), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("scheduled_date", sa.Date(), nullable=True),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scheduled_timezone", sa.String(64), nullable=True),
        sa.Column("actual_release_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("importance", sa.String(16), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("why_it_matters", sa.Text(), nullable=False),
        sa.Column("actual", sa.String(128), nullable=True),
        sa.Column("forecast", sa.String(128), nullable=True),
        sa.Column("previous", sa.String(128), nullable=True),
        sa.Column("impact_analysis", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("bull_case", sa.Text(), nullable=True),
        sa.Column("bear_case", sa.Text(), nullable=True),
        sa.Column("watch_next", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("external_key", name="uq_events_external_key"),
    )
    op.create_index("ix_events_event_type", "events", ["event_type"])
    op.create_index("ix_events_status", "events", ["status"])
    op.create_index("ix_events_importance", "events", ["importance"])
    op.create_index("ix_events_detected_at", "events", ["detected_at"])
    op.create_index(
        "ix_events_schedule_importance",
        "events",
        ["scheduled_at", "scheduled_date", "importance"],
    )
    op.create_table(
        "event_assets",
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("relationship", sa.String(32), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", "asset_id"),
        sa.UniqueConstraint("event_id", "asset_id", name="uq_event_assets"),
    )
    op.create_index("ix_event_assets_asset_id", "event_assets", ["asset_id"])
    op.create_table(
        "event_source_references",
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("evidence_role", sa.String(32), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["source_document_id"], ["source_documents.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("event_id", "source_document_id"),
        sa.UniqueConstraint("event_id", "source_document_id", name="uq_event_sources"),
    )
    op.create_index(
        "ix_event_source_references_source_document_id",
        "event_source_references",
        ["source_document_id"],
    )


def downgrade() -> None:
    op.drop_table("event_source_references")
    op.drop_table("event_assets")
    op.drop_table("events")
