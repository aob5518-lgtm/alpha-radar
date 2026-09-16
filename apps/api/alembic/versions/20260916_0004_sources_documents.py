"""Source registry and append-only document revisions (ordinary PostgreSQL tables).

Revision ID: 20260916_0004
Revises: 20260914_0003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260916_0004"
down_revision: str | None = "20260914_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def identity() -> sa.Column:
    return sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True)


def strings(fields: dict[str, int], nullable: set[str] | None = None) -> list[sa.Column]:
    return [
        sa.Column(name, sa.String(length), nullable=name in (nullable or set()))
        for name, length in fields.items()
    ]


def times(names: list[str], nullable: set[str] | None = None) -> list[sa.Column]:
    return [
        sa.Column(name, sa.DateTime(timezone=True), nullable=name in (nullable or set()))
        for name in names
    ]


def metadata() -> sa.Column:
    return sa.Column(
        "metadata", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
    )


def row_times() -> list[sa.Column]:
    return [
        sa.Column(name, sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())
        for name in ("created_at", "updated_at")
    ]


def upgrade() -> None:
    op.create_table(
        "sources",
        identity(),
        *strings(
            {
                "slug": 128,
                "name": 255,
                "source_type": 32,
                "source_tier": 32,
                "provider": 64,
                "base_url": 2048,
                "language": 32,
                "status": 32,
                "latency_class": 32,
                "license_class": 32,
                "terms_url": 2048,
            },
            {"language", "terms_url"},
        ),
        metadata(),
        *row_times(),
        sa.UniqueConstraint("slug", name="uq_sources_slug"),
        sa.CheckConstraint("slug = lower(slug)", name="ck_sources_slug_lower"),
    )
    op.create_table(
        "source_documents",
        identity(),
        sa.Column(
            "source_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sources.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        *strings(
            {
                "external_id": 512,
                "canonical_url": 2048,
                "document_type": 64,
                "title": 1000,
                "author": 255,
                "language": 32,
                "current_content_hash": 64,
                "status": 32,
            },
            {"external_id", "author", "language"},
        ),
        *times(
            [
                "published_at",
                "publisher_updated_at",
                "first_observed_at",
                "last_observed_at",
                "first_fetched_at",
                "last_fetched_at",
                "ingested_at",
            ],
            {"published_at", "publisher_updated_at"},
        ),
        metadata(),
        *row_times(),
        sa.UniqueConstraint("source_id", "external_id", name="uq_source_document_external"),
        sa.UniqueConstraint("source_id", "canonical_url", name="uq_source_document_url"),
    )
    op.create_index("ix_source_documents_source_id", "source_documents", ["source_id"])
    op.create_index("ix_source_documents_published", "source_documents", ["published_at", "id"])
    op.create_index("ix_source_documents_type", "source_documents", ["document_type"])
    op.create_index("ix_source_documents_hash", "source_documents", ["current_content_hash"])
    op.create_table(
        "source_document_versions",
        identity(),
        sa.Column(
            "source_document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("source_documents.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("version_number", sa.Integer(), nullable=False),
        *strings(
            {"content_hash": 64, "title": 1000, "raw_content_locator": 2048},
            {"raw_content_locator"},
        ),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("excerpt", sa.Text(), nullable=True),
        *times(
            ["published_at", "publisher_updated_at", "observed_at", "fetched_at", "ingested_at"],
            {"published_at", "publisher_updated_at"},
        ),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        metadata(),
        sa.UniqueConstraint(
            "source_document_id", "version_number", name="uq_document_version_number"
        ),
        sa.CheckConstraint("version_number > 0", name="ck_document_version_positive"),
    )
    op.create_index(
        "ix_source_document_versions_content_hash", "source_document_versions", ["content_hash"]
    )
    op.create_index(
        "uq_document_current_version",
        "source_document_versions",
        ["source_document_id"],
        unique=True,
        postgresql_where=sa.text("is_current"),
    )


def downgrade() -> None:
    # Explicit operator rollback only; upgrade does not alter existing Asset/Market tables.
    op.drop_table("source_document_versions")
    op.drop_table("source_documents")
    op.drop_table("sources")
