from datetime import datetime
from decimal import Decimal
from typing import Literal, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict

AdapterKind = Literal["MANUAL", "MOBILE_HANDOFF", "RESEARCH_DISABLED"]
ExecutionStatus = Literal[
    "CREATED",
    "RISK_APPROVED",
    "READY_FOR_EXECUTION",
    "HANDOFF_STARTED",
    "EXECUTING",
    "EXECUTED",
    "FAILED",
    "EXPIRED",
    "CANCELLED",
    "RECONCILIATION_REQUIRED",
    "SETTLED",
]
ExecutionError = Literal["adapter_failed", "execution_outcome_unknown", "BLOCKED_PAYOUT"]


class AdapterHealth(BaseModel):
    adapter: AdapterKind
    available: bool
    healthy: bool
    last_success: datetime | None = None
    last_failure: datetime | None = None
    latency_ms: int | None = None
    error_rate: float | None = None


class ExecutionRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    execution_id: UUID
    intent_id: UUID
    signal_id: UUID
    market_instrument_id: UUID
    symbol: str
    horizon_minutes: int
    direction: str
    premium: Decimal
    checked_payout: Decimal
    reference_price: Decimal
    deadline: datetime


class ExecutionResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    execution_id: UUID
    intent_id: UUID
    provider: Literal["operator_reported"]
    status: Literal["HANDOFF_STARTED", "EXECUTING", "EXECUTED", "FAILED", "RECONCILIATION_REQUIRED"]
    actual_premium: Decimal | None = None
    actual_payout: Decimal | None = None
    actual_open_price: Decimal | None = None
    actual_open_time: datetime | None = None
    external_reference: str | None = None
    error_code: ExecutionError | None = None
    error_message_safe: str | None = None


class LiveExecutionAdapter(Protocol):
    kind: AdapterKind

    def availability(self) -> bool: ...
    def health(self) -> AdapterHealth: ...
    def prepare(self, request: ExecutionRequest) -> None: ...
    async def execute(self, request: ExecutionRequest) -> ExecutionResult: ...
    def reconcile(self, result: ExecutionResult) -> ExecutionResult: ...
    def cancel(self, intent_id: UUID) -> None: ...
