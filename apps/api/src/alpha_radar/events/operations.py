from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from redis.asyncio import Redis

CRYPTO_EVENT_SYNC_STATE_KEY = "alpha-radar:crypto-event-sync:status"

CryptoSyncStatus = Literal[
    "disabled",
    "never",
    "healthy",
    "degraded",
    "failed",
    "unavailable",
    "invalid",
]


class CryptoSyncRun(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["healthy", "degraded", "failed"]
    last_run: datetime
    sources_attempted: list[str]
    sources_succeeded: list[str]
    sources_failed: list[str]
    events_ingested: int = Field(ge=0)

    @classmethod
    def from_results(
        cls,
        *,
        attempted: list[str],
        succeeded: list[str],
        failed: list[str],
        events_ingested: int,
        last_run: datetime | None = None,
    ) -> CryptoSyncRun:
        status: Literal["healthy", "degraded", "failed"]
        if failed and succeeded:
            status = "degraded"
        elif failed:
            status = "failed"
        else:
            status = "healthy"
        return cls(
            status=status,
            last_run=last_run or datetime.now(UTC),
            sources_attempted=attempted,
            sources_succeeded=succeeded,
            sources_failed=failed,
            events_ingested=events_ingested,
        )


class CryptoSyncOperations(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    status: CryptoSyncStatus
    last_run: datetime | None
    sources_attempted: list[str]
    sources_succeeded: list[str]
    sources_failed: list[str]
    events_ingested: int = Field(ge=0)


async def record_crypto_sync_run(client: Redis, run: CryptoSyncRun) -> None:
    await client.set(  # pyright: ignore[reportUnknownMemberType]
        CRYPTO_EVENT_SYNC_STATE_KEY,
        run.model_dump_json(),
        ex=172800,
    )


async def get_crypto_sync_operations(client: Redis, *, enabled: bool) -> CryptoSyncOperations:
    if not enabled:
        return _empty_operations(enabled=False, status="disabled")
    try:
        raw = await client.get(CRYPTO_EVENT_SYNC_STATE_KEY)  # pyright: ignore[reportUnknownMemberType]
    except Exception:
        return _empty_operations(enabled=True, status="unavailable")
    if not raw:
        return _empty_operations(enabled=True, status="never")
    try:
        run = CryptoSyncRun.model_validate_json(raw)
    except (ValueError, TypeError, json.JSONDecodeError):
        return _empty_operations(enabled=True, status="invalid")
    return CryptoSyncOperations(enabled=True, **run.model_dump())


def _empty_operations(
    *, enabled: bool, status: Literal["disabled", "never", "unavailable", "invalid"]
) -> CryptoSyncOperations:
    return CryptoSyncOperations(
        enabled=enabled,
        status=status,
        last_run=None,
        sources_attempted=[],
        sources_succeeded=[],
        sources_failed=[],
        events_ingested=0,
    )
