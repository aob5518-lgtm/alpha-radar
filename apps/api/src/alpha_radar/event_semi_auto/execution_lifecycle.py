from datetime import datetime
from uuid import UUID

from alpha_radar.event_contracts.strategy import utc
from alpha_radar.event_semi_auto.execution_contract import ExecutionStatus
from alpha_radar.event_semi_auto.models import LiveIntent

PRE_EXECUTION = frozenset(("CREATED", "RISK_APPROVED", "READY_FOR_EXECUTION"))
STARTED = frozenset(("HANDOFF_STARTED", "EXECUTING", "RECONCILIATION_REQUIRED"))
TRANSITIONS: dict[ExecutionStatus, frozenset[ExecutionStatus]] = {
    "CREATED": frozenset(("RISK_APPROVED", "CANCELLED")),
    "RISK_APPROVED": frozenset(("READY_FOR_EXECUTION", "EXPIRED", "CANCELLED")),
    "READY_FOR_EXECUTION": frozenset(("EXECUTING", "EXPIRED", "CANCELLED")),
    "EXECUTING": frozenset(
        ("HANDOFF_STARTED", "EXECUTED", "FAILED", "RECONCILIATION_REQUIRED", "CANCELLED")
    ),
    "HANDOFF_STARTED": frozenset(("EXECUTED", "CANCELLED", "RECONCILIATION_REQUIRED")),
    "RECONCILIATION_REQUIRED": frozenset(("EXECUTED", "CANCELLED")),
    "EXECUTED": frozenset(("SETTLED",)),
    "FAILED": frozenset(),
    "EXPIRED": frozenset(),
    "CANCELLED": frozenset(),
    "SETTLED": frozenset(),
}


def transition(intent: LiveIntent, target: ExecutionStatus) -> None:
    current = intent.execution_status
    if current is None or current == target:
        return
    if target not in TRANSITIONS[current]:
        raise ValueError(f"Invalid execution transition: {current} -> {target}")
    intent.execution_status = target


def elapsed_ms(start: datetime, end: datetime) -> int:
    return max(0, int((utc(end) - utc(start)).total_seconds() * 1000))


def owns_dispatch_claim(intent: LiveIntent, execution_id: UUID) -> bool:
    return intent.execution_status == "EXECUTING" and intent.execution_id == execution_id
