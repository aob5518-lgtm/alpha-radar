from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.config import Settings
from alpha_radar.db.session import get_db_session
from alpha_radar.main import create_app
from alpha_radar.sources.adapters import FedSourceAdapter, MockSourceAdapter, SECSourceAdapter
from alpha_radar.sources.errors import SourceError
from alpha_radar.sources.factory import create_source_adapter
from alpha_radar.sources.models import Source, SourceDocument
from alpha_radar.sources.normalization import canonical_url, content_hash
from alpha_radar.sources.policy import storage_policy
from alpha_radar.sources.repository import SourceRepository
from alpha_radar.sources.seed import seed_sources
from alpha_radar.sources.service import SourceService, utc
from alpha_radar.sources.transport import SourceTransport, retry_delay


async def setup(session: AsyncSession) -> tuple[Source, SourceService]:
    await seed_sources(session, include_mock=True)
    repo = SourceRepository(session)
    source = await repo.source("mock-source")
    assert source
    return source, SourceService(repo)


async def test_source_seed_uniqueness(session: AsyncSession) -> None:
    await seed_sources(session)
    await seed_sources(session)
    assert await session.scalar(select(func.count()).select_from(Source)) == 2
    sec = await SourceRepository(session).source("sec")
    assert sec
    session.add(
        Source(
            id=uuid4(),
            slug=sec.slug,
            name="Duplicate",
            source_type="regulator",
            source_tier="primary",
            provider="sec",
            base_url=sec.base_url,
        )
    )
    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()


async def test_identity_revision_and_timestamp_provenance(session: AsyncSession) -> None:
    source, service = await setup(session)
    dto = (await MockSourceAdapter().fetch_recent())[0]
    document = await service.ingest(source, dto)
    identifier = document.id
    later = dto.model_copy(
        update={
            "observed_at": dto.observed_at + timedelta(seconds=10),
            "fetched_at": dto.fetched_at + timedelta(seconds=10),
        }
    )
    assert content_hash(dto) == content_hash(later)
    await service.ingest(source, later)
    assert await session.scalar(select(func.count()).select_from(SourceDocument)) == 1
    assert len(await service.repository.versions(identifier)) == 1
    assert utc(document.first_observed_at) == dto.observed_at
    assert utc(document.last_fetched_at) == later.fetched_at
    assert document.published_at is None
    revised = (await MockSourceAdapter(2).fetch_recent())[0]
    await service.ingest(source, revised)
    versions = await service.repository.versions(identifier)
    assert len(versions) == 2
    assert versions[0].title == dto.title and not versions[0].is_current
    assert versions[1].is_current and versions[1].content_hash != versions[0].content_hash
    assert (await service.repository.current(identifier)).version_number == 2
    assert versions[0].published_at is None
    assert versions[0].metadata_["provider"] == "mock"
    assert versions[0].metadata_["external_id"] == dto.external_id
    with pytest.raises(SourceError, match="Out-of-order"):
        await service.ingest(source, dto)
    await session.rollback()


async def test_external_id_and_url_dedup(session: AsyncSession) -> None:
    source, service = await setup(session)
    dto = (await MockSourceAdapter().fetch_recent())[0]
    document = await service.ingest(source, dto)
    tracked = dto.model_copy(
        update={"canonical_url": dto.canonical_url + "?utm_source=test#section"}
    )
    assert (await service.ingest(source, tracked)).id == document.id
    no_external = tracked.model_copy(update={"external_id": None})
    assert (await service.ingest(source, no_external)).id == document.id
    conflict = dto.model_copy(update={"external_id": "other"})
    with pytest.raises(SourceError, match="conflicting"):
        await service.ingest(source, conflict)
    await session.rollback()
    assert (
        canonical_url("HTTPS://EXAMPLE.COM:443/a?b=2&utm_campaign=x&a=1#frag")
        == "https://example.com/a?a=1&b=2"
    )
    with pytest.raises(ValueError):
        canonical_url("javascript:alert(1)")


async def test_storage_policies(session: AsyncSession) -> None:
    source, service = await setup(session)
    source.license_class = "metadata_only"
    await session.commit()
    dto = (await MockSourceAdapter().fetch_recent())[0]
    document = await service.ingest(source, dto)
    version = await service.repository.current(document.id)
    assert (
        version.summary is None and version.excerpt is None and version.raw_content_locator is None
    )
    assert not storage_policy("unknown").excerpt
    assert not storage_policy("licensed").full_content
    assert storage_policy("public_official").excerpt
    source.license_class = "restricted"
    await session.commit()
    with pytest.raises(SourceError) as error:
        await service.ingest(source, dto)
    assert error.value.kind == "policy_restricted"


def test_official_adapter_normalization() -> None:
    now = datetime(2026, 9, 15, tzinfo=UTC)
    payload = {
        "cik": 1234,
        "name": "Example Issuer",
        "filings": {
            "recent": {
                "form": ["8-K", "S-1"],
                "accessionNumber": ["0000001234-26-000001", "0000001234-26-000002"],
                "filingDate": ["2026-09-14", "2026-09-14"],
                "reportDate": ["2026-09-13", ""],
                "primaryDocument": ["release.htm", "other.htm"],
            }
        },
    }
    documents = SECSourceAdapter.normalize(payload, now, now)
    assert len(documents) == 1
    assert documents[0].metadata["cik"] == "0000001234"
    assert documents[0].published_at is None  # filing date is not an invented midnight timestamp
    assert documents[0].external_id == "0000001234-26-000001"
    with pytest.raises(SourceError):
        SECSourceAdapter.normalize({}, now, now)
    rss = (
        b"<rss><channel><item><title>Policy announcement</title>"
        b"<link>https://www.federalreserve.gov/newsevents/pressreleases/example.htm</link>"
        b"<guid>stable-guid</guid><pubDate>Mon, 14 Sep 2026 18:00:00 GMT</pubDate>"
        b"<description>Short summary</description></item></channel></rss>"
    )
    fed = FedSourceAdapter.normalize(rss, now, now)
    assert fed[0].external_id == "stable-guid"
    assert fed[0].published_at == datetime(2026, 9, 14, 18, tzinfo=UTC)
    assert (
        FedSourceAdapter.normalize(
            rss.replace(b"<pubDate>Mon, 14 Sep 2026 18:00:00 GMT</pubDate>", b""), now, now
        )[0].published_at
        is None
    )
    with pytest.raises(SourceError):
        FedSourceAdapter.normalize(b"<!DOCTYPE test><rss/>", now, now)
    with pytest.raises(SourceError):
        FedSourceAdapter.normalize(b"malformed", now, now)


class Gate:
    def __init__(self) -> None:
        self.calls = 0
        self.cooldowns: list[float] = []

    async def acquire(self) -> None:
        self.calls += 1

    async def defer(self, seconds: float) -> None:
        self.cooldowns.append(seconds)


@pytest.mark.parametrize(
    "status,kind",
    [
        (403, "policy_restricted"),
        (429, "rate_limited"),
        (503, "temporary_source_error"),
        (404, "document_not_found"),
    ],
)
async def test_rate_limit_and_failure_policy(status: int, kind: str) -> None:
    gate = Gate()

    def respond(request: httpx.Request) -> httpx.Response:
        assert request.headers["User-Agent"] == "Test organization test@example.invalid"
        return httpx.Response(status, headers={"Retry-After": "600"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        transport = SourceTransport(gate, "Test organization test@example.invalid", client=client)
        with pytest.raises(SourceError) as error:
            await transport.get(FedSourceAdapter.feed_url)
        assert error.value.kind == kind
    assert gate.calls == 1  # no aggressive in-request retry
    if status != 404:
        assert gate.cooldowns[0] >= 600
    assert retry_delay("invalid") == 300
    assert retry_delay("1") == 300


async def test_mock_and_disabled_real_adapters() -> None:
    mock = MockSourceAdapter()
    assert await mock.fetch_document("mock-document-1") == (await mock.fetch_recent())[0]
    with pytest.raises(SourceError):
        await mock.fetch_document("missing")
    with pytest.raises(SourceError):
        create_source_adapter("sec", Settings())


async def test_document_api_filters_and_detail(session: AsyncSession) -> None:
    source, service = await setup(session)
    dto = (await MockSourceAdapter().fetch_recent())[0]
    document = await service.ingest(source, dto)
    second = dto.model_copy(
        update={
            "external_id": "second",
            "canonical_url": "https://example.invalid/second",
            "title": "Published source",
            "published_at": datetime(2026, 9, 14, tzinfo=UTC),
        }
    )
    await service.ingest(source, second)
    app = create_app()

    async def override() -> AsyncSession:
        return session

    app.dependency_overrides[get_db_session] = override
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.get("/api/v1/documents", params={"page_size": 1})
        assert result.status_code == 200
        assert result.json()["pagination"]["total_items"] == 2
        assert result.json()["items"][0]["title"] == "Published source"
        for query in (
            {"source": "mock-source"},
            {"source_type": "government"},
            {"document_type": "sample_release"},
        ):
            assert (await client.get("/api/v1/documents", params=query)).json()["pagination"][
                "total_items"
            ] == 2
        for query in (
            {"search": "Published"},
            {"published_after": "2026-09-13T00:00:00Z", "published_before": "2026-09-15T00:00:00Z"},
        ):
            assert (await client.get("/api/v1/documents", params=query)).json()["pagination"][
                "total_items"
            ] == 1
        assert (await client.get("/api/v1/documents", params={"search": "%"})).json()["items"] == []
        assert (await client.get("/api/v1/documents", params={"page_size": 101})).status_code == 422
        assert (
            await client.get("/api/v1/documents", params={"published_after": "2026-09-15T00:00:00"})
        ).status_code == 422
        detail = await client.get(f"/api/v1/documents/{document.id}")
        assert detail.status_code == 200
        assert detail.json()["current_version"]["version_number"] == 1
        assert "metadata" not in detail.json()  # no provider raw payload exposure
        assert (await client.get(f"/api/v1/documents/{uuid4()}")).status_code == 404
        assert (await client.get("/api/v1/sources")).json()["pagination"]["total_items"] == 3
