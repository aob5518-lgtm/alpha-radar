from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from alpha_radar.assets.models import json_type, uuid_type
from alpha_radar.db.base import Base
from alpha_radar.event_semi_auto.execution_contract import (
    AdapterKind,
    ExecutionError,
    ExecutionStatus,
)
from alpha_radar.market_data.models import financial_numeric as number

timestamp = sa.DateTime(timezone=True)


class SemiAutoSettings(Base):
    __tablename__ = "event_semi_auto_settings"
    __table_args__ = (sa.CheckConstraint("id = 1", name="ck_semi_settings_singleton"),)

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    revision: Mapped[UUID] = mapped_column(uuid_type, default=uuid4)
    enabled: Mapped[bool] = mapped_column(default=False)
    killed: Mapped[bool] = mapped_column(default=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(timestamp)
    accept_after: Mapped[datetime | None] = mapped_column(timestamp)
    cooldown_until: Mapped[datetime | None] = mapped_column(timestamp)
    loss_count: Mapped[int] = mapped_column(default=0)
    settings: Mapped[dict[str, object]] = mapped_column(json_type)


class FrozenIdentity:
    event_signal_id: Mapped[UUID] = mapped_column(
        uuid_type, sa.ForeignKey("event_shadow_signals.id")
    )
    market_instrument_id: Mapped[UUID] = mapped_column(
        uuid_type, sa.ForeignKey("market_instruments.id")
    )
    symbol: Mapped[str] = mapped_column(sa.String(16))
    horizon_minutes: Mapped[int]
    direction: Mapped[str] = mapped_column(sa.String(8))
    signal_score: Mapped[int]
    signal_reference_price: Mapped[Decimal] = mapped_column(number)
    created_at: Mapped[datetime] = mapped_column(timestamp)
    settings_snapshot: Mapped[dict[str, object]] = mapped_column(json_type)


class LiveIntent(FrozenIdentity, Base):
    __tablename__ = "event_live_bet_intents"
    __table_args__ = (
        sa.UniqueConstraint("event_signal_id", name="uq_live_intent_signal"),
        sa.Index("ix_live_intent_history", "created_at", "id"),
        sa.Index("ix_live_intent_expiry", "status", "expires_at"),
        sa.Index("ix_live_intent_handoff", "handoff_started_at"),
        sa.Index("ix_live_intent_execution_status", "execution_status"),
        sa.CheckConstraint(
            "(execution_adapter IS NULL AND execution_deadline IS NULL "
            "AND execution_status IS NULL)"
            " OR (execution_adapter IS NOT NULL"
            " AND execution_adapter IN ('MANUAL','MOBILE_HANDOFF','RESEARCH_DISABLED')"
            " AND execution_deadline IS NOT NULL AND execution_deadline <= expires_at"
            " AND execution_status IS NOT NULL"
            " AND execution_status IN ('CREATED','RISK_APPROVED','READY_FOR_EXECUTION',"
            "'HANDOFF_STARTED','EXECUTING','EXECUTED','FAILED','EXPIRED','CANCELLED',"
            "'RECONCILIATION_REQUIRED','SETTLED'))",
            name="ck_live_execution_lifecycle",
        ),
        sa.CheckConstraint(
            "horizon_minutes IN (10,30) AND direction IN ('higher','lower')",
            name="ck_live_intent_identity",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING_REVIEW','APPROVED_BY_USER','REJECTED_BY_USER','EXPIRED',"
            "'EXECUTED_MANUALLY','CANCELLED_BY_RISK','SETTLED')",
            name="ck_live_intent_status",
        ),
    )

    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    settings_revision: Mapped[UUID] = mapped_column(uuid_type)
    signal_version: Mapped[str] = mapped_column(sa.String(32))
    strategy_version: Mapped[str] = mapped_column(sa.String(32))
    signal_state: Mapped[str] = mapped_column(sa.String(16))
    generated_at: Mapped[datetime] = mapped_column(timestamp)
    signal_reference_source: Mapped[str] = mapped_column(sa.String(64))
    signal_atr: Mapped[Decimal | None] = mapped_column(number)
    expires_at: Mapped[datetime] = mapped_column(timestamp)
    suggested_stake: Mapped[Decimal] = mapped_column(number)
    minimum_payout: Mapped[Decimal] = mapped_column(number)
    breakeven_probability: Mapped[Decimal] = mapped_column(number)
    status: Mapped[str] = mapped_column(sa.String(24))
    risk_reason: Mapped[str | None] = mapped_column(sa.String(40))
    reject_reason: Mapped[str | None] = mapped_column(sa.String(24))
    approved_payout: Mapped[Decimal | None] = mapped_column(number)
    handoff_started_at: Mapped[datetime | None] = mapped_column(timestamp)
    returned_at: Mapped[datetime | None] = mapped_column(timestamp)
    execution_adapter: Mapped[AdapterKind | None] = mapped_column(sa.String(24))
    execution_status: Mapped[ExecutionStatus | None] = mapped_column(sa.String(32))
    execution_deadline: Mapped[datetime | None] = mapped_column(timestamp)
    execution_id: Mapped[UUID | None] = mapped_column(uuid_type)
    execution_started_at: Mapped[datetime | None] = mapped_column(timestamp)
    execution_completed_at: Mapped[datetime | None] = mapped_column(timestamp)
    adapter_completed_at: Mapped[datetime | None] = mapped_column(timestamp)
    adapter_error: Mapped[ExecutionError | None] = mapped_column(sa.String(32))
    pre_execution_drift_absolute: Mapped[Decimal | None] = mapped_column(number)
    pre_execution_drift_percent: Mapped[Decimal | None] = mapped_column(number)
    pre_execution_drift_atr: Mapped[Decimal | None] = mapped_column(number)


class RealBet(FrozenIdentity, Base):
    __tablename__ = "event_real_bets"
    __table_args__ = (
        sa.UniqueConstraint("intent_id", name="uq_real_bet_intent"),
        sa.UniqueConstraint("order_reference", name="uq_real_bet_order_reference"),
        sa.Index("ix_real_bet_history", "created_at", "id"),
        sa.Index("ix_real_bet_settled", "settled_at", "id"),
        sa.Index(
            "uq_real_active_identity",
            "market_instrument_id",
            "horizon_minutes",
            unique=True,
            postgresql_where=sa.text("status = 'OPEN'"),
            sqlite_where=sa.text("status = 'OPEN'"),
        ),
        sa.CheckConstraint(
            "horizon_minutes IN (10,30) AND direction IN ('higher','lower')",
            name="ck_real_bet_identity",
        ),
        sa.CheckConstraint(
            "actual_premium > 0 AND actual_payout > 1 AND actual_open_price > 0 "
            "AND expiry_at > actual_open_at",
            name="ck_real_bet_execution",
        ),
        sa.CheckConstraint(
            "status IN ('OPEN','WIN','LOSS','TIE','CANCELLED')", name="ck_real_bet_status"
        ),
    )

    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    intent_id: Mapped[UUID] = mapped_column(uuid_type, sa.ForeignKey("event_live_bet_intents.id"))
    actual_open_price: Mapped[Decimal] = mapped_column(number)
    actual_open_at: Mapped[datetime] = mapped_column(timestamp)
    expiry_at: Mapped[datetime] = mapped_column(timestamp)
    actual_premium: Mapped[Decimal] = mapped_column(number)
    actual_payout: Mapped[Decimal] = mapped_column(number)
    breakeven_probability: Mapped[Decimal] = mapped_column(number)
    order_reference: Mapped[str | None] = mapped_column(sa.String(128))
    notes: Mapped[str | None] = mapped_column(sa.String(500))
    status: Mapped[str] = mapped_column(sa.String(12))
    settlement_source: Mapped[str] = mapped_column(sa.String(24))
    settlement_confidence: Mapped[str | None] = mapped_column(sa.String(24))
    settlement_price: Mapped[Decimal | None] = mapped_column(number)
    settled_at: Mapped[datetime | None] = mapped_column(timestamp)
    gross_return: Mapped[Decimal | None] = mapped_column(number)
    net_pnl: Mapped[Decimal | None] = mapped_column(number)
    late_execution_confirmation: Mapped[bool] = mapped_column(server_default=sa.false())
    payout_below_policy: Mapped[bool] = mapped_column(server_default=sa.false())
    direction_mismatch: Mapped[bool] = mapped_column(server_default=sa.false())
    horizon_mismatch: Mapped[bool] = mapped_column(server_default=sa.false())
    price_drift_absolute: Mapped[Decimal | None] = mapped_column(number)
    price_drift_percent: Mapped[Decimal | None] = mapped_column(number)
    price_drift_atr: Mapped[Decimal | None] = mapped_column(number)
    signal_to_handoff_ms: Mapped[int | None] = mapped_column(sa.BigInteger())
    handoff_to_execution_ms: Mapped[int | None] = mapped_column(sa.BigInteger())
    signal_to_execution_ms: Mapped[int | None] = mapped_column(sa.BigInteger())


class ExecutionAudit(Base):
    __tablename__ = "event_execution_audit"
    __table_args__ = (sa.Index("ix_execution_audit_intent", "intent_id", "created_at"),)

    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    intent_id: Mapped[UUID | None] = mapped_column(
        uuid_type, sa.ForeignKey("event_live_bet_intents.id")
    )
    event_signal_id: Mapped[UUID | None] = mapped_column(
        uuid_type, sa.ForeignKey("event_shadow_signals.id")
    )
    event: Mapped[str] = mapped_column(sa.String(40))
    reason: Mapped[str | None] = mapped_column(sa.String(40))
    created_at: Mapped[datetime] = mapped_column(timestamp)
