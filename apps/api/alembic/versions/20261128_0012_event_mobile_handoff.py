"""Persist mobile handoffs and historical execution disclosures."""

import sqlalchemy as sa
from alembic import op

revision = "20261128_0012"
down_revision = "20261128_0011"
branch_labels = None
depends_on = None

INTENTS = "event_live_bet_intents"
BETS = "event_real_bets"
TIMES = ("handoff_started_at", "returned_at")
FLAGS = (
    "late_execution_confirmation",
    "payout_below_policy",
    "direction_mismatch",
    "horizon_mismatch",
)
DRIFTS = ("price_drift_absolute", "price_drift_percent", "price_drift_atr")
LATENCIES = ("signal_to_handoff_ms", "handoff_to_execution_ms", "signal_to_execution_ms")


def upgrade() -> None:
    for name in TIMES:
        op.add_column(INTENTS, sa.Column(name, sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_live_intent_handoff", INTENTS, ["handoff_started_at"])
    for name in FLAGS:
        op.add_column(
            BETS, sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.false())
        )
    for name in DRIFTS:
        op.add_column(BETS, sa.Column(name, sa.Numeric(38, 18), nullable=True))
    for name in LATENCIES:
        op.add_column(BETS, sa.Column(name, sa.BigInteger(), nullable=True))


def downgrade() -> None:
    for name in (*LATENCIES, *DRIFTS, *FLAGS):
        op.drop_column(BETS, name)
    op.drop_index("ix_live_intent_handoff", table_name=INTENTS)
    for name in reversed(TIMES):
        op.drop_column(INTENTS, name)
