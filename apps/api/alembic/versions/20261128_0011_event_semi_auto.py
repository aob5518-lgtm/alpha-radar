"""Add the private Event Contract intent and execution ledger."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20261128_0011"
down_revision = "20261128_0010"
branch_labels = None
depends_on = None

N = sa.Numeric(38, 18)
TS = sa.DateTime(timezone=True)
J = JSONB()
IDENTITY = "horizon_minutes IN (10,30) AND direction IN ('higher','lower')"
INTENT = (
    "status IN ('PENDING_REVIEW','APPROVED_BY_USER','REJECTED_BY_USER','EXPIRED',"
    "'EXECUTED_MANUALLY','CANCELLED_BY_RISK','SETTLED')"
)
BET = "status IN ('OPEN','WIN','LOSS','TIE','CANCELLED')"
EXECUTION = (
    "actual_premium > 0 AND actual_payout > 1 AND actual_open_price > 0 "
    "AND expiry_at > actual_open_at"
)


def C(
    name: str, kind: sa.types.TypeEngine[object], *, fk: str | None = None, nullable: bool = False
) -> sa.Column[object]:
    if fk:
        return sa.Column(name, kind, sa.ForeignKey(fk), nullable=nullable)
    return sa.Column(name, kind, nullable=nullable)


def identity() -> tuple[sa.Column[object], ...]:
    return (
        C("event_signal_id", sa.Uuid(), fk="event_shadow_signals.id"),
        C("market_instrument_id", sa.Uuid(), fk="market_instruments.id"),
        C("symbol", sa.String(16)),
        C("horizon_minutes", sa.Integer()),
        C("direction", sa.String(8)),
        C("signal_score", sa.Integer()),
        C("signal_reference_price", N),
        C("created_at", TS),
        C("settings_snapshot", J),
    )


def upgrade() -> None:
    op.create_table(
        "event_semi_auto_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        C("revision", sa.Uuid()),
        C("enabled", sa.Boolean()),
        C("killed", sa.Boolean()),
        C("acknowledged_at", TS, nullable=True),
        C("accept_after", TS, nullable=True),
        C("cooldown_until", TS, nullable=True),
        C("loss_count", sa.Integer()),
        C("settings", J),
        sa.CheckConstraint("id = 1", name="ck_semi_settings_singleton"),
    )
    op.create_table(
        "event_live_bet_intents",
        sa.Column("id", sa.Uuid(), primary_key=True),
        *identity(),
        C("settings_revision", sa.Uuid()),
        C("signal_version", sa.String(32)),
        C("strategy_version", sa.String(32)),
        C("signal_state", sa.String(16)),
        C("generated_at", TS),
        C("signal_reference_source", sa.String(64)),
        C("signal_atr", N, nullable=True),
        C("expires_at", TS),
        C("suggested_stake", N),
        C("minimum_payout", N),
        C("breakeven_probability", N),
        C("status", sa.String(24)),
        C("risk_reason", sa.String(40), nullable=True),
        C("reject_reason", sa.String(24), nullable=True),
        C("approved_payout", N, nullable=True),
        sa.UniqueConstraint("event_signal_id", name="uq_live_intent_signal"),
        sa.CheckConstraint(IDENTITY, name="ck_live_intent_identity"),
        sa.CheckConstraint(INTENT, name="ck_live_intent_status"),
    )
    op.create_table(
        "event_real_bets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        *identity(),
        C("intent_id", sa.Uuid(), fk="event_live_bet_intents.id"),
        C("actual_open_price", N),
        C("actual_open_at", TS),
        C("expiry_at", TS),
        C("actual_premium", N),
        C("actual_payout", N),
        C("breakeven_probability", N),
        C("order_reference", sa.String(128), nullable=True),
        C("notes", sa.String(500), nullable=True),
        C("status", sa.String(12)),
        C("settlement_source", sa.String(24)),
        C("settlement_confidence", sa.String(24), nullable=True),
        C("settlement_price", N, nullable=True),
        C("settled_at", TS, nullable=True),
        C("gross_return", N, nullable=True),
        C("net_pnl", N, nullable=True),
        sa.UniqueConstraint("intent_id", name="uq_real_bet_intent"),
        sa.UniqueConstraint("order_reference", name="uq_real_bet_order_reference"),
        sa.CheckConstraint(IDENTITY, name="ck_real_bet_identity"),
        sa.CheckConstraint(EXECUTION, name="ck_real_bet_execution"),
        sa.CheckConstraint(BET, name="ck_real_bet_status"),
    )
    op.create_table(
        "event_execution_audit",
        sa.Column("id", sa.Uuid(), primary_key=True),
        C("intent_id", sa.Uuid(), fk="event_live_bet_intents.id", nullable=True),
        C("event_signal_id", sa.Uuid(), fk="event_shadow_signals.id", nullable=True),
        C("event", sa.String(40)),
        C("reason", sa.String(40), nullable=True),
        C("created_at", TS),
    )
    op.create_index("ix_live_intent_history", "event_live_bet_intents", ["created_at", "id"])
    op.create_index("ix_live_intent_expiry", "event_live_bet_intents", ["status", "expires_at"])
    op.create_index("ix_real_bet_history", "event_real_bets", ["created_at", "id"])
    op.create_index("ix_real_bet_settled", "event_real_bets", ["settled_at", "id"])
    op.create_index(
        "uq_real_active_identity",
        "event_real_bets",
        ["market_instrument_id", "horizon_minutes"],
        unique=True,
        postgresql_where=sa.text("status = 'OPEN'"),
    )
    op.create_index(
        "ix_execution_audit_intent", "event_execution_audit", ["intent_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_table("event_execution_audit")
    op.drop_table("event_real_bets")
    op.drop_table("event_live_bet_intents")
    op.drop_table("event_semi_auto_settings")
