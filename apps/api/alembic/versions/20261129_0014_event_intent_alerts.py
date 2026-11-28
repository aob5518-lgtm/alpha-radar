"""Add private alert outbox and device delivery tracking."""

import sqlalchemy as sa
from alembic import op

revision = "20261129_0014"
down_revision = "20261128_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    timestamp = sa.DateTime(timezone=True)
    op.create_table(
        "event_intent_alerts",
        sa.Column(
            "intent_id",
            sa.Uuid(),
            sa.ForeignKey("event_live_bet_intents.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("created_at", timestamp, nullable=False),
        sa.Column("opened_at", timestamp),
    )
    op.create_index("ix_event_intent_alerts_created_at", "event_intent_alerts", ["created_at"])
    op.create_table(
        "event_push_devices",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("endpoint", sa.String(2048), unique=True, nullable=False),
        sa.Column("p256dh", sa.String(87), nullable=False),
        sa.Column("auth", sa.String(22), nullable=False),
        sa.Column("label", sa.String(60), nullable=False),
        sa.Column("locale", sa.String(5), nullable=False),
        sa.Column("detailed", sa.Boolean(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", timestamp, nullable=False),
        sa.Column("last_success_at", timestamp),
        sa.Column("last_test_at", timestamp),
    )
    op.create_table(
        "event_push_deliveries",
        sa.Column(
            "intent_id",
            sa.Uuid(),
            sa.ForeignKey("event_intent_alerts.intent_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "device_id",
            sa.Uuid(),
            sa.ForeignKey("event_push_devices.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("retry_at", timestamp, nullable=False),
        sa.Column("attempted_at", timestamp),
        sa.Column("accepted_at", timestamp),
        sa.Column("failure_code", sa.String(32)),
    )
    op.create_index("ix_event_push_pending", "event_push_deliveries", ["status", "retry_at"])


def downgrade() -> None:
    op.drop_table("event_push_deliveries")
    op.drop_table("event_push_devices")
    op.drop_table("event_intent_alerts")
