"""Persist paper simulation sessions, bets and decisions."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "20261128_0010"
down_revision = "20261127_0009"
branch_labels = None
depends_on = None


def stamp(name: str, *, nullable: bool = False) -> sa.Column[object]:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def cash(name: str, *, nullable: bool = False) -> sa.Column[object]:
    return sa.Column(name, sa.Numeric(28, 2), nullable=nullable)


def upgrade() -> None:
    op.create_table(
        "event_simulation_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        stamp("created_at"),
        stamp("started_at"),
        stamp("stopped_at", nullable=True),
        stamp("accept_after"),
        sa.Column("status", sa.String(12), nullable=False),
        cash("starting_bankroll"),
        cash("current_bankroll"),
        cash("max_bankroll"),
        sa.Column("max_drawdown", sa.Numeric(20, 10), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        cash("day_start_bankroll"),
        sa.Column("risk_loss_count", sa.Integer(), nullable=False),
        stamp("cooldown_until", nullable=True),
        sa.Column("strategy_version", sa.String(32), nullable=False),
        sa.Column("signal_version", sa.String(32), nullable=False),
        sa.Column("settlement_version", sa.String(32), nullable=False),
        sa.Column("settings_snapshot", JSONB(), nullable=False),
        sa.Column("stats", JSONB(), nullable=False),
        sa.Column("total_bets", sa.Integer(), nullable=False),
        sa.Column("settled_bets", sa.Integer(), nullable=False),
        sa.CheckConstraint("status IN ('running','paused','archived')", name="ck_sim_status"),
        sa.CheckConstraint("current_bankroll >= 0", name="ck_sim_bankroll"),
    )
    op.create_index(
        "uq_sim_current",
        "event_simulation_sessions",
        [sa.text("(1)")],
        unique=True,
        postgresql_where=sa.text("status <> 'archived'"),
    )
    op.create_index("ix_sim_created", "event_simulation_sessions", ["created_at", "id"])
    op.create_table(
        "event_paper_bets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "simulation_session_id",
            sa.Uuid(),
            sa.ForeignKey("event_simulation_sessions.id"),
            nullable=False,
        ),
        sa.Column(
            "event_signal_id", sa.Uuid(), sa.ForeignKey("event_shadow_signals.id"), nullable=False
        ),
        sa.Column(
            "market_instrument_id",
            sa.Uuid(),
            sa.ForeignKey("market_instruments.id"),
            nullable=False,
        ),
        sa.Column("symbol", sa.String(16), nullable=False),
        sa.Column("horizon_minutes", sa.Integer(), nullable=False),
        sa.Column("direction", sa.String(12), nullable=False),
        sa.Column("signal_state", sa.String(16), nullable=False),
        sa.Column("signal_score", sa.Integer(), nullable=False),
        sa.Column("signal_version", sa.String(32), nullable=False),
        stamp("signal_generated_at"),
        stamp("bet_created_at"),
        sa.Column("reference_price", sa.Numeric(38, 18), nullable=False),
        sa.Column("reference_source", sa.String(64), nullable=False),
        stamp("expiry_at"),
        cash("virtual_stake"),
        sa.Column("payout_multiplier", sa.Numeric(20, 10), nullable=False),
        sa.Column("payout_source", sa.String(32), nullable=False),
        sa.Column("breakeven_probability", sa.Numeric(20, 10), nullable=False),
        sa.Column("assessment", JSONB(), nullable=False),
        sa.Column("settings_snapshot", JSONB(), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        stamp("settled_at", nullable=True),
        sa.Column("settlement_sequence", sa.Integer()),
        sa.Column("settlement_price", sa.Numeric(38, 18)),
        sa.Column("settlement_source", sa.String(64), nullable=False),
        cash("gross_return", nullable=True),
        cash("net_pnl", nullable=True),
        cash("bankroll_before", nullable=True),
        cash("bankroll_after", nullable=True),
        sa.UniqueConstraint("simulation_session_id", "event_signal_id", name="uq_paper_signal"),
        sa.CheckConstraint("status IN ('active','win','loss','void')", name="ck_paper_state"),
        sa.CheckConstraint("horizon_minutes IN (10,30)", name="ck_paper_horizon"),
        sa.CheckConstraint("virtual_stake > 0 AND payout_multiplier > 1", name="ck_paper_stake"),
    )
    op.create_index(
        "uq_paper_active_exposure",
        "event_paper_bets",
        ["simulation_session_id", "market_instrument_id", "horizon_minutes"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_index(
        "ix_paper_history", "event_paper_bets", ["simulation_session_id", "bet_created_at", "id"]
    )
    op.create_index(
        "ix_paper_equity", "event_paper_bets", ["simulation_session_id", "settlement_sequence"]
    )
    op.create_index(
        "ix_paper_due",
        "event_paper_bets",
        ["expiry_at"],
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_table(
        "event_simulation_decisions",
        sa.Column(
            "simulation_session_id",
            sa.Uuid(),
            sa.ForeignKey("event_simulation_sessions.id"),
            primary_key=True,
        ),
        sa.Column(
            "event_signal_id", sa.Uuid(), sa.ForeignKey("event_shadow_signals.id"), primary_key=True
        ),
        sa.Column("symbol", sa.String(16), nullable=False),
        sa.Column("horizon_minutes", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(32), nullable=False),
        stamp("decided_at"),
    )
    op.create_index(
        "ix_sim_decision_time",
        "event_simulation_decisions",
        ["simulation_session_id", "decided_at"],
    )


def downgrade() -> None:
    op.drop_table("event_simulation_decisions")
    op.drop_table("event_paper_bets")
    op.drop_table("event_simulation_sessions")
