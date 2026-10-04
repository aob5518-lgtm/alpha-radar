from __future__ import annotations

from datetime import UTC, datetime
from typing import cast

import pytest
from redis.asyncio import Redis

from alpha_radar.config import CryptoEventFeedSettings
from alpha_radar.events.crypto import CryptoEventCandidate
from alpha_radar.events.operations import CryptoSyncRun, get_crypto_sync_operations
from alpha_radar.events.tasks import (
    crypto_event_user_agent,
    official_event_user_agent,
    sync_crypto_source_adapters,
)
from alpha_radar.sources.schemas import FetchedSourceDocument


def candidate(identifier: str) -> CryptoEventCandidate:
    moment = datetime(2026, 10, 5, 12, tzinfo=UTC)
    source = CryptoEventFeedSettings(
        slug=f"source-{identifier}",
        name=f"Source {identifier}",
        source_type="protocol",
        base_url="https://example.org",
        feed_url="https://example.org/feed.xml",
        event_type="protocol_upgrade",
    )
    return CryptoEventCandidate(
        source=source,
        evidence=FetchedSourceDocument(
            external_id=identifier,
            canonical_url=f"https://example.org/{identifier}",
            document_type="official_crypto_announcement",
            title=f"Protocol upgrade {identifier}",
            published_at=moment,
            observed_at=moment,
            fetched_at=moment,
        ),
    )


class FakeAdapter:
    def __init__(
        self,
        source_slug: str,
        candidates: list[CryptoEventCandidate] | None = None,
        error: Exception | None = None,
    ) -> None:
        self.source_slug = source_slug
        self.candidates = candidates or []
        self.error = error
        self.fetched = False

    async def fetch(self, limit: int | None = None) -> list[CryptoEventCandidate]:
        del limit
        self.fetched = True
        if self.error is not None:
            raise self.error
        return self.candidates


class FakeIngestor:
    def __init__(self, fail_on: str | None = None) -> None:
        self.fail_on = fail_on
        self.committed: list[str] = []

    async def ingest(self, candidate: CryptoEventCandidate) -> bool:
        identifier = candidate.evidence.external_id
        assert identifier is not None
        if identifier == self.fail_on:
            raise RuntimeError("candidate failed")
        self.committed.append(identifier)
        return True


class RollbackRecorder:
    def __init__(self) -> None:
        self.calls = 0

    async def __call__(self) -> None:
        self.calls += 1


class FakeRedis:
    def __init__(self, value: str | None) -> None:
        self.value = value

    async def get(self, _key: str) -> str | None:
        return self.value


def test_contact_identity_policy_is_split_without_fake_contact_data() -> None:
    assert crypto_event_user_agent("") == "AlphaRadar/0.1"
    assert crypto_event_user_agent("Alpha Radar Operations") == "AlphaRadar/0.1"
    assert crypto_event_user_agent("Alpha Radar ops@example.com") == (
        "AlphaRadar/0.1 Alpha Radar ops@example.com"
    )
    with pytest.raises(ValueError, match="organization/contact identity"):
        official_event_user_agent("")
    with pytest.raises(ValueError, match="organization/contact identity"):
        official_event_user_agent("Alpha Radar Operations")
    assert official_event_user_agent("Alpha Radar ops@example.com") == (
        "AlphaRadar/0.1 Alpha Radar ops@example.com"
    )


async def test_first_source_failure_does_not_prevent_second_source() -> None:
    first = FakeAdapter("ethereum-foundation-blog", error=TimeoutError("unavailable"))
    second = FakeAdapter("solana-news", [candidate("solana")])
    service = FakeIngestor()
    rollback = RollbackRecorder()

    run = await sync_crypto_source_adapters([first, second], service, rollback)

    assert first.fetched and second.fetched
    assert run.status == "degraded"
    assert run.sources_attempted == ["ethereum-foundation-blog", "solana-news"]
    assert run.sources_succeeded == ["solana-news"]
    assert run.sources_failed == ["ethereum-foundation-blog"]
    assert run.events_ingested == 1
    assert service.committed == ["solana"]
    assert rollback.calls == 1


async def test_later_source_failure_preserves_committed_first_source_events() -> None:
    first = FakeAdapter("ethereum-foundation-blog", [candidate("ethereum")])
    second = FakeAdapter("solana-news", [candidate("solana")])
    service = FakeIngestor(fail_on="solana")
    rollback = RollbackRecorder()

    run = await sync_crypto_source_adapters([first, second], service, rollback)

    assert run.status == "degraded"
    assert run.sources_succeeded == ["ethereum-foundation-blog"]
    assert run.sources_failed == ["solana-news"]
    assert run.events_ingested == 1
    assert service.committed == ["ethereum"]
    assert rollback.calls == 1


async def test_crypto_sync_healthy_and_all_failed_states_are_explicit() -> None:
    healthy = await sync_crypto_source_adapters(
        [
            FakeAdapter("ethereum-foundation-blog", [candidate("ethereum")]),
            FakeAdapter("solana-news", []),
        ],
        FakeIngestor(),
        RollbackRecorder(),
    )
    failed = await sync_crypto_source_adapters(
        [
            FakeAdapter("ethereum-foundation-blog", error=TimeoutError()),
            FakeAdapter("solana-news", error=RuntimeError()),
        ],
        FakeIngestor(),
        RollbackRecorder(),
    )

    assert healthy.status == "healthy"
    assert healthy.sources_succeeded == ["ethereum-foundation-blog", "solana-news"]
    assert healthy.sources_failed == []
    assert healthy.events_ingested == 1
    assert failed.status == "failed"
    assert failed.sources_succeeded == []
    assert failed.sources_failed == ["ethereum-foundation-blog", "solana-news"]
    healthy_operations = await get_crypto_sync_operations(
        cast(Redis, FakeRedis(healthy.model_dump_json())), enabled=True
    )
    failed_operations = await get_crypto_sync_operations(
        cast(Redis, FakeRedis(failed.model_dump_json())), enabled=True
    )
    assert healthy_operations.status == "healthy"
    assert failed_operations.status == "failed"


async def test_crypto_sync_operational_status_reports_degraded_run() -> None:
    run = CryptoSyncRun.from_results(
        attempted=["ethereum-foundation-blog", "solana-news"],
        succeeded=["ethereum-foundation-blog"],
        failed=["solana-news"],
        events_ingested=1,
        last_run=datetime(2026, 10, 5, 12, tzinfo=UTC),
    )
    operations = await get_crypto_sync_operations(
        cast(Redis, FakeRedis(run.model_dump_json())), enabled=True
    )

    assert operations.status == "degraded"
    assert operations.last_run == datetime(2026, 10, 5, 12, tzinfo=UTC)
    assert operations.sources_attempted == ["ethereum-foundation-blog", "solana-news"]
    assert operations.sources_succeeded == ["ethereum-foundation-blog"]
    assert operations.sources_failed == ["solana-news"]
    assert operations.events_ingested == 1
