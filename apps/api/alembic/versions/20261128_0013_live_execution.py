"""Persist the execution adapter lifecycle without assigning provenance to older rows."""

import sqlalchemy as sa
from alembic import op

revision = "20261128_0013"
down_revision = "20261128_0012"
branch_labels = None
depends_on = None

TABLE = "event_live_bet_intents"
COLUMNS = {
    "execution_adapter": sa.String(24),
    "execution_status": sa.String(32),
    "execution_deadline": sa.DateTime(timezone=True),
    "execution_id": sa.Uuid(),
    "execution_started_at": sa.DateTime(timezone=True),
    "execution_completed_at": sa.DateTime(timezone=True),
    "adapter_completed_at": sa.DateTime(timezone=True),
    "adapter_error": sa.String(32),
    "pre_execution_drift_absolute": sa.Numeric(38, 18),
    "pre_execution_drift_percent": sa.Numeric(38, 18),
    "pre_execution_drift_atr": sa.Numeric(38, 18),
}


def upgrade() -> None:
    for name, kind in COLUMNS.items():
        op.add_column(TABLE, sa.Column(name, kind, nullable=True))
    op.create_check_constraint(
        "ck_live_execution_lifecycle",
        TABLE,
        "(execution_adapter IS NULL AND execution_deadline IS NULL AND execution_status IS NULL)"
        " OR (execution_adapter IS NOT NULL"
        " AND execution_adapter IN ('MANUAL','MOBILE_HANDOFF','RESEARCH_DISABLED')"
        " AND execution_deadline IS NOT NULL AND execution_deadline <= expires_at"
        " AND execution_status IS NOT NULL"
        " AND execution_status IN ('CREATED','RISK_APPROVED','READY_FOR_EXECUTION',"
        "'HANDOFF_STARTED','EXECUTING','EXECUTED','FAILED','EXPIRED','CANCELLED',"
        "'RECONCILIATION_REQUIRED','SETTLED'))",
    )
    op.create_index("ix_live_intent_execution_status", TABLE, ["execution_status"])


def downgrade() -> None:
    op.drop_index("ix_live_intent_execution_status", table_name=TABLE)
    op.drop_constraint("ck_live_execution_lifecycle", TABLE, type_="check")
    for name in reversed(COLUMNS):
        op.drop_column(TABLE, name)
