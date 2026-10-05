from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.seed import seed_assets
from alpha_radar.config import Settings
from alpha_radar.events.crypto import CryptoEventIngestionService, deterministic_relevance
from alpha_radar.events.github_releases import (
    GitHubReleaseAdapter,
    github_release_source_settings,
)
from alpha_radar.events.models import Event
from alpha_radar.events.repository import EventRepository
from alpha_radar.events.service import EventService
from alpha_radar.events.social import (
    XPost,
    XSocialProvider,
    XUser,
    classify_social_post,
    configured_social_accounts,
    social_account_settings,
    social_monitoring_enabled,
)
from alpha_radar.sources.errors import SourceError
from alpha_radar.sources.models import SourceDocumentVersion
from alpha_radar.sources.transport import SourceTransport

FIXTURES = Path(__file__).parent / "fixtures" / "crypto"
MOMENT = datetime(2026, 10, 5, 12, tzinfo=UTC)


class NoopGate:
    async def acquire(self) -> None:
        return None

    async def defer(self, seconds: float) -> None:
        del seconds
        return None


def fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_github_release_normalization_accepts_material_and_rejects_routine_release() -> None:
    source = github_release_source_settings()["github-bitcoin-core"]
    candidates = GitHubReleaseAdapter.normalize(
        source,
        fixture("github-releases.json"),
        observed_at=MOMENT,
        fetched_at=MOMENT,
    )

    assert len(candidates) == 2
    material, routine = candidates
    assert material.asset_symbols == ["BTC"]
    assert material.evidence.metadata == {
        "repository": "bitcoin/bitcoin",
        "release_id": 1001,
        "tag": "v30.0",
        "prerelease": False,
        "api_url": "https://api.github.com/repos/bitcoin/bitcoin/releases",
        "classification_source": "github_release_policy",
    }
    assert material.evidence.canonical_url == (
        "https://github.com/bitcoin/bitcoin/releases/tag/v30.0"
    )
    assert material.evidence.published_at == datetime(2026, 10, 3, 10, tzinfo=UTC)
    assert deterministic_relevance(material).relevant is True
    assert deterministic_relevance(material).event_type == "protocol_upgrade"
    assert deterministic_relevance(routine).relevant is False


async def test_github_release_persists_bounded_excerpt_under_public_official_policy(
    session: AsyncSession,
) -> None:
    await seed_assets(session)
    candidate = GitHubReleaseAdapter.normalize(
        github_release_source_settings()["github-bitcoin-core"],
        fixture("github-releases.json"),
        observed_at=MOMENT,
        fetched_at=MOMENT,
    )[0]

    assert await CryptoEventIngestionService(session).ingest(candidate) is True
    version = await session.scalar(
        select(SourceDocumentVersion).where(SourceDocumentVersion.title == "Bitcoin Core v30.0")
    )
    assert version is not None
    assert (
        version.summary == "Major client release tied to network behavior and a consensus change."
    )
    assert version.metadata_["repository"] == "bitcoin/bitcoin"
    assert version.metadata_["release_id"] == 1001


@pytest.mark.parametrize(
    ("source_key", "fixture_name", "symbol"),
    [
        ("github-sui", "github-sui-release.json", "SUI"),
        ("github-avalanchego", "github-avalanche-release.json", "AVAX"),
    ],
)
def test_github_mainnet_release_policies(source_key: str, fixture_name: str, symbol: str) -> None:
    source = github_release_source_settings()[source_key]  # type: ignore[index]
    candidate = GitHubReleaseAdapter.normalize(
        source,
        fixture(fixture_name),
        observed_at=MOMENT,
        fetched_at=MOMENT,
    )[0]

    classification = deterministic_relevance(candidate)
    assert candidate.asset_symbols == [symbol]
    assert classification.relevant is True
    assert classification.importance == "high"
    assert classification.event_type == "protocol_upgrade"


def test_github_repository_allowlist_is_code_owned() -> None:
    settings = Settings.model_validate(
        {
            "crypto_event_official_sources": [
                "github-bitcoin-core",
                "github-anza-agave",
                "github-sui",
                "github-chainlink",
                "github-avalanchego",
                "github-dogecoin",
                "github-bitcoin-cash-node",
            ]
        }
    )
    assert len(settings.crypto_event_official_sources) == 7
    with pytest.raises(ValidationError):
        Settings.model_validate({"crypto_event_official_sources": ["github-unreviewed/repository"]})


async def test_github_public_fetch_works_without_token_and_optional_token_is_server_header() -> (
    None
):
    source = github_release_source_settings()["github-bitcoin-core"]
    authorization_headers: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        authorization_headers.append(request.headers.get("Authorization"))
        return httpx.Response(200, content=fixture("github-releases.json"), request=request)

    transport = SourceTransport(
        NoopGate(),
        "AlphaRadar/0.1",
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    try:
        assert await GitHubReleaseAdapter(transport, source).fetch()
        assert await GitHubReleaseAdapter(transport, source, "server-token").fetch()
    finally:
        await transport.client.aclose()  # type: ignore[union-attr]
    assert authorization_headers == [None, "Bearer server-token"]


def test_social_is_effectively_disabled_without_credentials() -> None:
    assert not social_monitoring_enabled(Settings())
    assert not social_monitoring_enabled(
        Settings(
            crypto_event_sync_enabled=True,
            crypto_social_provider="x",
            crypto_social_accounts=["elon-musk"],
        )
    )
    assert social_monitoring_enabled(
        Settings(
            crypto_event_sync_enabled=True,
            crypto_social_provider="x",
            x_bearer_token="server-only",
            crypto_social_accounts=["elon-musk"],
        )
    )


def test_social_account_allowlist_and_tiers_are_explicit() -> None:
    definitions = social_account_settings()
    assert definitions["elon-musk"].tier == "tier_1"
    assert definitions["solana"].tier == "tier_2"
    assert not [account for account in definitions.values() if account.tier == "tier_3"]
    assert [account.key for account in configured_social_accounts(["elon-musk", "solana"])] == [
        "elon-musk",
        "solana",
    ]
    with pytest.raises(ValidationError):
        Settings.model_validate({"crypto_social_accounts": ["unreviewed-kol"]})


def test_explicit_doge_social_mention_is_signal_and_generic_post_is_rejected() -> None:
    account = social_account_settings()["elon-musk"]
    doge = XPost(
        id="12345",
        text="Dogecoin / DOGE deserves attention.",
        author_id="44196397",
        created_at=MOMENT,
    )
    generic = doge.model_copy(update={"id": "12346", "text": "Beautiful day for a rocket launch."})

    accepted = classify_social_post(account, doge, ["DOGE"])
    rejected = classify_social_post(account, generic, [])
    assert accepted.relevant is True
    assert accepted.event_type == "influential_social"
    assert accepted.recommended_action == "wait_for_confirmation"
    assert rejected.relevant is False


async def test_social_post_persists_as_signal_without_contract_address(
    session: AsyncSession,
) -> None:
    await seed_assets(session)
    account = social_account_settings()["elon-musk"]
    user = XUser(id="44196397", username="elonmusk", name="Elon Musk")
    candidates = XSocialProvider.normalize(
        account,
        user,
        {
            "data": [
                {
                    "id": "12345",
                    "text": "DOGE and Dogecoin deserve attention.",
                    "author_id": "44196397",
                    "created_at": "2026-10-05T11:00:00Z",
                }
            ]
        },
        observed_at=MOMENT,
        fetched_at=MOMENT,
    )
    assert await CryptoEventIngestionService(session).ingest(candidates[0]) is True
    event = await session.scalar(select(Event).where(Event.event_type == "influential_social"))
    assert event is not None
    detail = await EventService(EventRepository(session)).detail(event.id)
    assert detail.summary == "FACT: Monitored X account @elonmusk explicitly mentioned DOGE."
    assert detail.signal == "SIGNAL: High-impact social attention may increase in the short term."
    assert detail.sources[0].source_type == "social"
    assert detail.sources[0].source_tier == "social"
    assert detail.sources[0].evidence_role == "signal"
    assert detail.contract_address is None
    assert {asset.symbol for asset in detail.affected_assets} == {"DOGE"}


async def test_x_adapter_rejects_unreviewed_account_without_network_access() -> None:
    reviewed = social_account_settings()["elon-musk"]
    unreviewed = reviewed.model_copy(update={"username": "another_user"})
    provider = XSocialProvider(SourceTransport(NoopGate(), "AlphaRadar/0.1"), "server-only")
    with pytest.raises(SourceError, match="reviewed allowlist"):
        await provider.fetch_account(unreviewed, limit=5)
