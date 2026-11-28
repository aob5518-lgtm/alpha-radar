from typing import Literal
from uuid import UUID

from alpha_radar.event_semi_auto.execution_contract import (
    AdapterHealth,
    AdapterKind,
    ExecutionRequest,
    ExecutionResult,
    LiveExecutionAdapter,
)


class OperatorAdapter:
    """Local workflow only. The operator places the order externally."""

    def __init__(self, kind: AdapterKind) -> None:
        self.kind: AdapterKind = kind

    def availability(self) -> bool:
        return self.kind != "RESEARCH_DISABLED"

    def health(self) -> AdapterHealth:
        available = self.availability()
        return AdapterHealth(adapter=self.kind, available=available, healthy=available)

    def prepare(self, request: ExecutionRequest) -> None:
        if not self.availability():
            raise RuntimeError("Execution adapter unavailable")

    async def execute(self, request: ExecutionRequest) -> ExecutionResult:
        self.prepare(request)
        status: Literal["HANDOFF_STARTED", "EXECUTING"] = (
            "HANDOFF_STARTED" if self.kind == "MOBILE_HANDOFF" else "EXECUTING"
        )
        return ExecutionResult(
            execution_id=request.execution_id,
            intent_id=request.intent_id,
            provider="operator_reported",
            status=status,
        )

    def reconcile(self, result: ExecutionResult) -> ExecutionResult:
        # The service verifies the operator evidence and uniqueness before the ledger append.
        return result

    def cancel(self, intent_id: UUID) -> None:
        # There is no external order cancellation for the operator workflows.
        return


ADAPTER_KINDS: tuple[AdapterKind, ...] = ("MANUAL", "MOBILE_HANDOFF", "RESEARCH_DISABLED")


def adapter_for(kind: AdapterKind) -> LiveExecutionAdapter:
    return OperatorAdapter(kind)
