from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from alpha_radar.assets.models import TimestampMixin, json_type, uuid_type
from alpha_radar.db.base import Base


class Source(TimestampMixin, Base):
    __tablename__ = "sources"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_sources_slug"),
        CheckConstraint("slug = lower(slug)", name="ck_sources_slug_lower"),
    )
    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(128))
    name: Mapped[str] = mapped_column(String(255))
    source_type: Mapped[str] = mapped_column(String(32))
    source_tier: Mapped[str] = mapped_column(String(32))
    provider: Mapped[str] = mapped_column(String(64))
    base_url: Mapped[str] = mapped_column(String(2048))
    language: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="active")
    latency_class: Mapped[str] = mapped_column(String(32), default="periodic")
    license_class: Mapped[str] = mapped_column(String(32), default="unknown")
    terms_url: Mapped[str | None] = mapped_column(String(2048))
    metadata_: Mapped[dict[str, object]] = mapped_column(
        "metadata", json_type, default=dict, server_default="{}"
    )


class SourceDocument(TimestampMixin, Base):
    __tablename__ = "source_documents"
    __table_args__ = (
        UniqueConstraint("source_id", "external_id", name="uq_source_document_external"),
        UniqueConstraint("source_id", "canonical_url", name="uq_source_document_url"),
        Index("ix_source_documents_published", "published_at", "id"),
        Index("ix_source_documents_type", "document_type"),
        Index("ix_source_documents_hash", "current_content_hash"),
    )
    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    source_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("sources.id", ondelete="RESTRICT"), index=True
    )
    external_id: Mapped[str | None] = mapped_column(String(512))
    canonical_url: Mapped[str] = mapped_column(String(2048))
    document_type: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(1000))
    author: Mapped[str | None] = mapped_column(String(255))
    language: Mapped[str | None] = mapped_column(String(32))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    publisher_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    first_fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    current_content_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="available")
    metadata_: Mapped[dict[str, object]] = mapped_column(
        "metadata", json_type, default=dict, server_default="{}"
    )


class SourceDocumentVersion(Base):
    __tablename__ = "source_document_versions"
    __table_args__ = (
        UniqueConstraint("source_document_id", "version_number", name="uq_document_version_number"),
        CheckConstraint("version_number > 0", name="ck_document_version_positive"),
        Index(
            "uq_document_current_version",
            "source_document_id",
            unique=True,
            postgresql_where=text("is_current"),
            sqlite_where=text("is_current = 1"),
        ),
    )
    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    source_document_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("source_documents.id", ondelete="RESTRICT")
    )
    version_number: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(1000))
    summary: Mapped[str | None] = mapped_column(Text)
    excerpt: Mapped[str | None] = mapped_column(Text)
    raw_content_locator: Mapped[str | None] = mapped_column(String(2048))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    publisher_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    metadata_: Mapped[dict[str, object]] = mapped_column(
        "metadata", json_type, default=dict, server_default="{}"
    )
