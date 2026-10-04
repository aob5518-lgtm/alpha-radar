from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from alpha_radar.assets.models import TimestampMixin, json_type, uuid_type
from alpha_radar.db.base import Base


class Event(TimestampMixin, Base):
    __tablename__ = "events"
    __table_args__ = (
        UniqueConstraint("external_key", name="uq_events_external_key"),
        Index("ix_events_schedule_importance", "scheduled_at", "scheduled_date", "importance"),
        Index("ix_events_category_importance", "category", "importance"),
        Index("ix_events_detected_at", "detected_at"),
        CheckConstraint("category IN ('macro', 'crypto')", name="ck_events_category"),
        CheckConstraint(
            "recommended_action IS NULL OR recommended_action IN "
            "('watch', 'research', 'prepare', 'wait_for_confirmation', 'caution', 'avoid')",
            name="ck_events_recommended_action",
        ),
        CheckConstraint(
            "opportunity_signal IS NULL OR opportunity_signal IN "
            "('none', 'watch', 'research', 'prepare', 'wait', 'avoid')",
            name="ck_events_opportunity_signal",
        ),
        CheckConstraint(
            "confidence IS NULL OR confidence IN ('low', 'medium', 'high')",
            name="ck_events_confidence",
        ),
    )

    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    external_key: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(500))
    category: Mapped[str] = mapped_column(String(16), default="macro", server_default="macro")
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    scheduled_date: Mapped[date | None] = mapped_column(Date)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scheduled_timezone: Mapped[str | None] = mapped_column(String(64))
    actual_release_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    importance: Mapped[str] = mapped_column(String(16), index=True)
    summary: Mapped[str] = mapped_column(Text)
    signal: Mapped[str | None] = mapped_column(Text)
    why_it_matters: Mapped[str] = mapped_column(Text)
    risk: Mapped[str | None] = mapped_column(Text)
    recommended_action: Mapped[str | None] = mapped_column(String(32))
    opportunity_signal: Mapped[str | None] = mapped_column(String(16))
    confidence: Mapped[str | None] = mapped_column(String(16))
    contract_address: Mapped[str | None] = mapped_column(String(255))
    actual: Mapped[str | None] = mapped_column(String(128))
    forecast: Mapped[str | None] = mapped_column(String(128))
    previous: Mapped[str | None] = mapped_column(String(128))
    impact_analysis: Mapped[dict[str, object]] = mapped_column(json_type, default=dict)
    bull_case: Mapped[str | None] = mapped_column(Text)
    bear_case: Mapped[str | None] = mapped_column(Text)
    watch_next: Mapped[list[str]] = mapped_column(json_type, default=list)


class EventAsset(Base):
    __tablename__ = "event_assets"
    __table_args__ = (UniqueConstraint("event_id", "asset_id", name="uq_event_assets"),)

    event_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("assets.id", ondelete="RESTRICT"), primary_key=True, index=True
    )
    relationship: Mapped[str] = mapped_column(String(32), default="macro_exposure")


class EventSourceReference(Base):
    __tablename__ = "event_source_references"
    __table_args__ = (UniqueConstraint("event_id", "source_document_id", name="uq_event_sources"),)

    event_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    source_document_id: Mapped[UUID] = mapped_column(
        uuid_type,
        ForeignKey("source_documents.id", ondelete="RESTRICT"),
        primary_key=True,
        index=True,
    )
    evidence_role: Mapped[str] = mapped_column(String(32), default="schedule")
