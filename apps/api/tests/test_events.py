import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.seed import seed_assets
from alpha_radar.config import CryptoEventFeedSettings, Settings
from alpha_radar.db.session import get_db_session
from alpha_radar.events.crypto import (
    BybitAnnouncementAdapter,
    CoinbaseBlogAdapter,
    CryptoEventCandidate,
    CryptoEventClassification,
    CryptoEventIngestionService,
    EthereumFoundationFeedAdapter,
    OfficialCryptoFeedAdapter,
    OpenAICryptoEventClassifier,
    SolanaNewsFeedAdapter,
    deterministic_relevance,
    official_crypto_source_settings,
)
from alpha_radar.events.models import Event, EventAsset, EventSourceReference
from alpha_radar.events.repository import EventRepository
from alpha_radar.events.seed import seed_events
from alpha_radar.events.service import EventService
from alpha_radar.events.sync import (
    EventSyncService,
    OfficialCalendarAdapter,
    OfficialEventUpdate,
    extract_release_values,
)
from alpha_radar.main import create_app
from alpha_radar.sources.errors import SourceError
from alpha_radar.sources.models import SourceDocument
from alpha_radar.sources.schemas import FetchedSourceDocument
from alpha_radar.sources.transport import SourceTransport

FIXTURES = Path(__file__).parent / "fixtures" / "crypto"


class NoopGate:
    async def acquire(self) -> None:
        return None

    async def defer(self, seconds: float) -> None:
        del seconds
        return None


def fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def source_transport() -> SourceTransport:
    return SourceTransport(NoopGate(), "Alpha Radar tests test@example.invalid")


async def test_seed_is_idempotent_and_events_retain_provenance(session: AsyncSession) -> None:
    await seed_assets(session)
    first = await seed_events(session)
    second = await seed_events(session)

    assert first == (14, 42, 14)
    assert second == (0, 0, 0)
    assert await session.scalar(select(func.count()).select_from(Event)) == 14
    assert await session.scalar(select(func.count()).select_from(EventAsset)) == 42
    assert await session.scalar(select(func.count()).select_from(EventSourceReference)) == 14

    result = await EventService(EventRepository(session)).list(
        page=1,
        page_size=20,
        start=datetime(2026, 10, 1, tzinfo=UTC),
        end=datetime(2026, 11, 1, tzinfo=UTC),
        importances=["critical", "high"],
        category=None,
        event_type=None,
        status="scheduled",
        asset_id=None,
    )
    assert result.pagination.total_items == 5
    assert result.items[0].scheduled_timezone == "America/New_York"
    assert result.items[0].sources[0].source_name.startswith("U.S. Bureau")
    assert {asset.symbol for asset in result.items[0].affected_assets} == {"BTC", "QQQ", "SPY"}


async def test_date_only_event_does_not_invent_a_time(session: AsyncSession) -> None:
    event = Event(
        external_key="date-only:test",
        title="Date-only event",
        event_type="regulation",
        status="scheduled",
        scheduled_date=datetime(2026, 10, 20).date(),
        scheduled_at=None,
        scheduled_timezone=None,
        detected_at=datetime.now(UTC),
        importance="high",
        summary="FACT: Date only.",
        why_it_matters="ANALYSIS: Material if confirmed.",
        impact_analysis={},
        watch_next=[],
    )
    session.add(event)
    await session.commit()

    detail = await EventService(EventRepository(session)).detail(event.id)
    assert detail.scheduled_date is not None
    assert detail.scheduled_date.isoformat() == "2026-10-20"
    assert detail.scheduled_at is None
    listed = await EventService(EventRepository(session)).list(
        page=1,
        page_size=10,
        start=datetime(2026, 10, 20, tzinfo=UTC),
        end=datetime(2026, 10, 21, tzinfo=UTC),
        importances=["high"],
        category=None,
        event_type=None,
        status=None,
        asset_id=None,
    )
    assert [item.id for item in listed.items] == [event.id]


async def test_event_list_and_detail_api(session: AsyncSession) -> None:
    await seed_assets(session)
    await seed_events(session)
    app = create_app()

    async def override_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_db_session] = override_session
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        listing = await client.get(
            "/api/v1/events", params=[("importance", "critical"), ("importance", "high")]
        )
        assert listing.status_code == 200
        payload = listing.json()
        assert payload["pagination"]["total_items"] == 14
        detail = await client.get(f"/api/v1/events/{payload['items'][0]['id']}")
        assert detail.status_code == 200
        assert detail.json()["sources"][0]["source_name"].startswith("U.S. Bureau")


def official_evidence(
    *, published_at: datetime | None, suffix: str = "release"
) -> FetchedSourceDocument:
    observed = datetime(2026, 10, 2, 12, 31, tzinfo=UTC)
    return FetchedSourceDocument(
        external_id=f"bls-{suffix}",
        canonical_url=f"https://www.bls.gov/news.release/{suffix}.htm",
        document_type="official_release",
        title="Employment Situation official release",
        summary="Total nonfarm payroll employment increased by 162,000.",
        language="en",
        published_at=published_at,
        observed_at=observed,
        fetched_at=observed,
        metadata={"fixture": True},
    )


async def test_official_event_sync_revises_schedule_then_completes_with_evidence(
    session: AsyncSession,
) -> None:
    await seed_assets(session)
    await seed_events(session)
    service = EventSyncService(session)
    revised_at = datetime(2026, 10, 3, 12, 30, tzinfo=UTC)
    revision = OfficialEventUpdate(
        external_key="bls:employment:2026-09",
        event_type="nfp",
        source_slug="bls-release-calendar",
        evidence=official_evidence(published_at=None, suffix="schedule-revision"),
        scheduled_date=revised_at.date(),
        scheduled_at=revised_at,
        scheduled_timezone="America/New_York",
    )
    assert await service.apply(revision)
    event = await session.scalar(
        select(Event).where(Event.external_key == "bls:employment:2026-09")
    )
    assert event is not None
    assert event.status == "scheduled"
    assert event.scheduled_date == revised_at.date()
    assert event.actual_release_at is None

    release_at = datetime(2026, 10, 3, 12, 30, tzinfo=UTC)
    release = OfficialEventUpdate(
        external_key="bls:employment:2026-09",
        event_type="nfp",
        source_slug="bls-release-calendar",
        evidence=official_evidence(published_at=release_at),
        released=True,
        actual_release_at=release_at,
        actual="+162,000",
        previous=None,
    )
    assert await service.apply(release)
    await session.refresh(event)
    assert event.status == "completed"
    actual_release_at = event.actual_release_at
    assert actual_release_at is not None
    assert actual_release_at.replace(tzinfo=UTC) == release_at
    assert event.actual == "+162,000"
    assert event.previous is None
    assert event.forecast is None
    assert (
        await session.scalar(
            select(func.count())
            .select_from(EventSourceReference)
            .where(EventSourceReference.event_id == event.id)
        )
        == 3
    )


async def test_release_without_official_values_preserves_nulls(session: AsyncSession) -> None:
    await seed_assets(session)
    await seed_events(session)
    release_at = datetime(2026, 10, 14, 12, 30, tzinfo=UTC)
    update = OfficialEventUpdate(
        external_key="bls:cpi:2026-09",
        event_type="cpi",
        source_slug="bls-release-calendar",
        evidence=official_evidence(published_at=release_at, suffix="cpi-release"),
        released=True,
        actual_release_at=release_at,
    )
    assert await EventSyncService(session).apply(update)
    event = await session.scalar(select(Event).where(Event.external_key == update.external_key))
    assert event is not None
    assert event.status == "completed"
    assert event.actual is None
    assert event.previous is None
    assert event.forecast is None


def test_official_value_extraction_is_strict_and_never_invents_consensus() -> None:
    assert extract_release_values(
        "nfp", "Total nonfarm payroll employment increased by 162,000 in September."
    ) == ("+162,000", None)
    assert extract_release_values("cpi", "No headline value is present.") == (None, None)


def test_official_calendar_fixture_normalizes_schedule_revision() -> None:
    moment = datetime(2026, 10, 1, 12, tzinfo=UTC)
    updates = OfficialCalendarAdapter.normalize(
        "bls-release-calendar",
        "https://www.bls.gov/schedule/2026/home.htm",
        b"<html><body>Employment Situation Friday, October 3, 2026 08:30 AM</body></html>",
        moment,
        moment,
    )
    assert len(updates) == 1
    assert updates[0].event_type == "nfp"
    assert updates[0].scheduled_date == datetime(2026, 10, 3).date()
    assert updates[0].scheduled_at == datetime(2026, 10, 3, 12, 30, tzinfo=UTC)


async def test_official_crypto_feed_reuses_event_pipeline_and_is_idempotent(
    session: AsyncSession,
) -> None:
    await seed_assets(session)
    moment = datetime(2026, 10, 3, 12, tzinfo=UTC)
    feed = CryptoEventFeedSettings(
        slug="example-protocol",
        name="Example Protocol",
        source_type="protocol",
        base_url="https://example.org",
        feed_url="https://example.org/releases.xml",
        event_type="protocol_upgrade",
        asset_symbols=["BTC"],
        recommended_action="wait_for_confirmation",
        opportunity_signal="wait",
        confidence="high",
    )
    candidates = OfficialCryptoFeedAdapter.normalize(
        feed,
        b"""<rss><channel><item><title>Protocol upgrade announced</title>
        <link>https://example.org/releases/upgrade</link><guid>upgrade-1</guid>
        <pubDate>Sat, 03 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>""",
        observed_at=moment,
        fetched_at=moment,
    )
    service = CryptoEventIngestionService(session)
    assert await service.ingest(candidates[0]) is True
    assert await service.ingest(candidates[0]) is False
    event = await session.scalar(select(Event).where(Event.category == "crypto"))
    assert event is not None
    detail = await EventService(EventRepository(session)).detail(event.id)
    assert detail.event_type == "protocol_upgrade"
    assert detail.recommended_action == "prepare"
    assert detail.confidence == "medium"
    assert detail.contract_address is None
    assert detail.sources[0].source_type == "protocol"
    assert detail.sources[0].source_tier == "primary"
    assert detail.sources[0].evidence_role == "fact"
    assert {asset.symbol for asset in detail.affected_assets} == {"BTC"}


async def test_crypto_relevance_gate_rejects_noise_and_downgrades_feed_high(
    session: AsyncSession,
) -> None:
    await seed_assets(session)
    moment = datetime(2026, 10, 3, 12, tzinfo=UTC)
    feed = CryptoEventFeedSettings(
        slug="high-feed",
        name="High Feed",
        source_type="company",
        base_url="https://example.org",
        feed_url="https://example.org/feed.xml",
        event_type="project_update",
        asset_symbols=["BTC"],
        importance="high",
        recommended_action="prepare",
        confidence="high",
    )

    def candidate(identifier: str, title: str, summary: str = "") -> CryptoEventCandidate:
        return OfficialCryptoFeedAdapter.normalize(
            feed,
            (
                "<rss><channel><item>"
                f"<title>{title}</title><link>https://example.org/{identifier}</link>"
                f"<guid>{identifier}</guid><description>{summary}</description>"
                "<pubDate>Sat, 03 Oct 2026 12:00:00 GMT</pubDate>"
                "</item></channel></rss>"
            ).encode(),
            observed_at=moment,
            fetched_at=moment,
        )[0]

    service = CryptoEventIngestionService(session)
    assert await service.ingest(candidate("docs", "Documentation update and tutorial")) is False
    assert await service.ingest(candidate("community", "Community meetup and AMA")) is False
    assert await service.ingest(candidate("uncertain", "October ecosystem notes")) is False
    assert (
        await service.ingest(
            candidate("partnership", "Major partnership announced", "Official integration")
        )
        is True
    )
    event = await session.scalar(select(Event).where(Event.external_key.like("%partnership%")))
    if event is None:
        event = await session.scalar(select(Event).where(Event.category == "crypto"))
    assert event is not None
    assert event.importance == "medium"
    assert event.recommended_action == "research"
    assert event.confidence == "medium"
    assert event.contract_address is None
    assert await session.scalar(select(func.count()).select_from(Event)) == 1
    assert await session.scalar(select(func.count()).select_from(SourceDocument)) == 4


async def test_optional_ai_can_reject_but_failure_falls_back_to_deterministic(
    session: AsyncSession,
) -> None:
    await seed_assets(session)
    moment = datetime(2026, 10, 3, 12, tzinfo=UTC)
    feed = CryptoEventFeedSettings(
        slug="ai-feed",
        name="AI Feed",
        source_type="protocol",
        base_url="https://example.org",
        feed_url="https://example.org/feed.xml",
        event_type="protocol_upgrade",
        asset_symbols=["BTC"],
        importance="high",
    )
    candidates = OfficialCryptoFeedAdapter.normalize(
        feed,
        b"""<rss><channel>
        <item><title>Protocol upgrade announced</title><link>https://example.org/upgrade</link><guid>upgrade</guid></item>
        <item><title>Hard fork confirmed</title><link>https://example.org/fork</link><guid>fork</guid></item>
        </channel></rss>""",
        observed_at=moment,
        fetched_at=moment,
    )

    async def reject(_candidate: CryptoEventCandidate) -> CryptoEventClassification:
        return CryptoEventClassification.model_validate(
            {
                "relevant": False,
                "event_type": "protocol_upgrade",
                "importance": "low",
                "recommended_action": "watch",
                "confidence": "low",
                "reason": "Not material enough",
            }
        )

    assert await CryptoEventIngestionService(session, reject).ingest(candidates[0]) is False

    async def unavailable(_candidate: CryptoEventCandidate) -> CryptoEventClassification:
        raise TimeoutError("provider unavailable")

    assert await CryptoEventIngestionService(session, unavailable).ingest(candidates[1]) is True
    event = await session.scalar(select(Event).where(Event.category == "crypto"))
    assert event is not None
    assert event.impact_analysis["classification_source"] == "deterministic_fallback"


async def test_openai_classifier_rejects_arbitrary_action_and_importance() -> None:
    moment = datetime(2026, 10, 3, 12, tzinfo=UTC)
    feed = CryptoEventFeedSettings(
        slug="strict-ai",
        name="Strict AI",
        source_type="protocol",
        base_url="https://example.org",
        feed_url="https://example.org/feed.xml",
        event_type="protocol_upgrade",
    )
    candidate = OfficialCryptoFeedAdapter.normalize(
        feed,
        b"<rss><channel><item><title>Protocol upgrade</title><link>https://example.org/u</link></item></channel></rss>",
        observed_at=moment,
        fetched_at=moment,
    )[0]

    def handler(_request: httpx.Request) -> httpx.Response:
        invalid = {
            "relevant": True,
            "event_type": "protocol_upgrade",
            "importance": "urgent",
            "recommended_action": "buy_now",
            "confidence": "high",
            "reason": "Invalid enums",
        }
        return httpx.Response(
            200,
            json={"output": [{"content": [{"type": "output_text", "text": json.dumps(invalid)}]}]},
        )

    classifier = OpenAICryptoEventClassifier(
        model="test-model",
        api_key="server-only-test-key",
        base_url="https://api.openai.com/v1",
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(ValidationError):
        await classifier.classify(candidate)


def test_crypto_social_provider_remains_disabled() -> None:
    assert Settings().crypto_social_provider == "disabled"
    with pytest.raises(ValidationError):
        Settings.model_validate({"crypto_social_provider": "x_scraper"})


def test_only_reviewed_official_crypto_source_keys_are_configurable() -> None:
    settings = Settings.model_validate(
        {"crypto_event_official_sources": ["ethereum-foundation-blog", "solana-news"]}
    )
    assert settings.crypto_event_official_sources == [
        "ethereum-foundation-blog",
        "solana-news",
    ]
    with pytest.raises(ValidationError):
        Settings.model_validate({"crypto_event_official_sources": ["arbitrary-html-source"]})


def test_crypto_event_action_contract_rejects_unsafe_free_text() -> None:
    with pytest.raises(ValidationError):
        CryptoEventFeedSettings.model_validate(
            {
                "slug": "unsafe-source",
                "name": "Unsafe",
                "source_type": "company",
                "base_url": "https://example.org",
                "feed_url": "https://example.org/feed.xml",
                "event_type": "project_update",
                "recommended_action": "buy_now",
            }
        )


def test_ethereum_official_rss_parses_with_canonical_provenance() -> None:
    moment = datetime(2026, 10, 5, 12, tzinfo=UTC)
    source = official_crypto_source_settings()["ethereum-foundation-blog"]
    candidates = EthereumFoundationFeedAdapter.normalize(
        source, fixture("ethereum-feed.xml"), observed_at=moment, fetched_at=moment
    )

    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate.evidence.canonical_url == (
        "https://blog.ethereum.org/2026/10/03/protocol-upgrade"
    )
    assert candidate.evidence.metadata["categories"] == ["Protocol"]
    assert candidate.asset_symbols == ["ETH"]
    assert deterministic_relevance(candidate).event_type == "protocol_upgrade"


def test_bybit_provider_parser_accepts_listings_and_delistings_but_rejects_promotions() -> None:
    moment = datetime(2026, 10, 5, 12, tzinfo=UTC)
    source = official_crypto_source_settings()["bybit-announcements"]
    candidates = BybitAnnouncementAdapter(source_transport(), source).normalize(
        fixture("bybit-announcements.html"), observed_at=moment, fetched_at=moment
    )
    classifications = {
        candidate.evidence.title: deterministic_relevance(candidate) for candidate in candidates
    }

    listing = next(item for item in candidates if item.evidence.title.startswith("New listing"))
    delisting = next(item for item in candidates if item.evidence.title.startswith("Delisting"))
    promotion = next(item for item in candidates if "competition" in item.evidence.title)
    assert listing.asset_symbols == ["BTC"]
    assert delisting.asset_symbols == ["ETH"]
    assert classifications[listing.evidence.title].event_type == "exchange_listing"
    assert classifications[listing.evidence.title].relevant is True
    assert classifications[delisting.evidence.title].event_type == "exchange_delisting"
    assert classifications[delisting.evidence.title].relevant is True
    assert classifications[promotion.evidence.title].relevant is False


def test_solana_rss_accepts_material_network_update_and_rejects_roundup() -> None:
    moment = datetime(2026, 10, 5, 12, tzinfo=UTC)
    source = official_crypto_source_settings()["solana-news"]
    candidates = SolanaNewsFeedAdapter.normalize(
        source, fixture("solana-feed.xml"), observed_at=moment, fetched_at=moment
    )

    material, roundup = candidates
    assert material.asset_symbols == ["SOL"]
    assert deterministic_relevance(material).event_type == "protocol_upgrade"
    assert deterministic_relevance(material).relevant is True
    assert deterministic_relevance(roundup).relevant is False


def test_coinbase_parser_accepts_material_regulation_and_rejects_education() -> None:
    moment = datetime(2026, 10, 5, 12, tzinfo=UTC)
    source = official_crypto_source_settings()["coinbase-blog"]
    candidates = CoinbaseBlogAdapter(source_transport(), source).normalize(
        fixture("coinbase-blog.html"), observed_at=moment, fetched_at=moment
    )

    material, education = candidates
    assert deterministic_relevance(material).event_type == "regulation_crypto"
    assert deterministic_relevance(material).relevant is True
    assert deterministic_relevance(education).relevant is False


def test_official_html_adapters_enforce_provider_hostname() -> None:
    source = official_crypto_source_settings()["bybit-announcements"].model_copy(
        update={
            "base_url": "https://example.org",
            "feed_url": "https://example.org/announcements",
        }
    )
    with pytest.raises(SourceError, match="official"):
        BybitAnnouncementAdapter(source_transport(), source)


async def test_crypto_official_source_fetch_is_bounded_to_fourteen_days() -> None:
    now = datetime.now(UTC)
    recent = (now - timedelta(days=2)).strftime("%a, %d %b %Y %H:%M:%S GMT")
    old = (now - timedelta(days=30)).strftime("%a, %d %b %Y %H:%M:%S GMT")
    payload = f"""<rss><channel>
      <item><title>Protocol upgrade recent</title>
        <link>https://blog.ethereum.org/recent</link><pubDate>{recent}</pubDate></item>
      <item><title>Protocol upgrade old</title>
        <link>https://blog.ethereum.org/old</link><pubDate>{old}</pubDate></item>
    </channel></rss>""".encode()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=payload, request=request)

    transport = SourceTransport(
        NoopGate(),
        "Alpha Radar tests test@example.invalid",
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    try:
        candidates = await EthereumFoundationFeedAdapter(
            transport, official_crypto_source_settings()["ethereum-foundation-blog"]
        ).fetch()
    finally:
        assert transport.client is not None
        await transport.client.aclose()
    assert [candidate.evidence.title for candidate in candidates] == ["Protocol upgrade recent"]


async def test_bybit_listing_maps_canonical_asset_and_preserves_official_url(
    session: AsyncSession,
) -> None:
    await seed_assets(session)
    moment = datetime(2026, 10, 5, 12, tzinfo=UTC)
    source = official_crypto_source_settings()["bybit-announcements"]
    listing = BybitAnnouncementAdapter(source_transport(), source).normalize(
        fixture("bybit-announcements.html"), observed_at=moment, fetched_at=moment
    )[0]

    assert await CryptoEventIngestionService(session).ingest(listing) is True
    event = await session.scalar(select(Event).where(Event.category == "crypto"))
    assert event is not None
    detail = await EventService(EventRepository(session)).detail(event.id)
    assert {asset.symbol for asset in detail.affected_assets} == {"BTC"}
    assert detail.sources[0].canonical_url == (
        "https://announcements.bybit.com/en/article/new-listing-btcusdt-perpetual--abc"
    )
    assert detail.contract_address is None
