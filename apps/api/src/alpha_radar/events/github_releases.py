from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta
from typing import cast
from urllib.parse import urlencode, urlsplit

from pydantic import BaseModel, ConfigDict, ValidationError

from alpha_radar.config import CryptoEventFeedSettings, OfficialCryptoSource
from alpha_radar.events.crypto import (
    CryptoEventCandidate,
    CryptoEventClassification,
    OfficialCryptoSourceAdapter,
)
from alpha_radar.sources.errors import SourceError
from alpha_radar.sources.normalization import canonical_url, plain_text
from alpha_radar.sources.schemas import FetchedSourceDocument
from alpha_radar.sources.transport import SourceTransport

GITHUB_API_HOST = "api.github.com"
GITHUB_WEB_HOST = "github.com"


class GitHubRelease(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    tag_name: str
    name: str | None = None
    body: str | None = None
    html_url: str
    draft: bool = False
    prerelease: bool = False
    published_at: datetime | None = None


_MATERIAL_RELEASE = re.compile(
    r"\b(mainnet (?:activation|launch|upgrade)|network (?:activation|upgrade)|"
    r"consensus (?:change|upgrade)|hard fork|mandatory (?:validator|node) upgrade|"
    r"security[- ]critical|critical security|protocol version activation|"
    r"major client release)\b",
    re.I,
)
_UPCOMING_MAINNET = re.compile(
    r"\b(upcoming|scheduled|required for|prepares? for)\b.{0,80}"
    r"\b(mainnet|network (?:activation|upgrade)|hard fork)\b|"
    r"\b(mainnet|network (?:activation|upgrade)|hard fork)\b.{0,80}"
    r"\b(upcoming|scheduled|required)\b",
    re.I | re.S,
)
_LOW_VALUE_RELEASE = re.compile(
    r"\b(test[- ]only|documentation[- ]only|docs? only|internal tooling|developer tooling|"
    r"routine patch|minor patch|chore(?:s)? only)\b",
    re.I,
)
_PRERELEASE = re.compile(r"\b(alpha|beta|release candidate|rc\d*)\b", re.I)


def github_release_classification(
    release: GitHubRelease,
) -> CryptoEventClassification:
    text = f"{release.name or ''}\n{release.tag_name}\n{release.body or ''}"
    mainnet_prerelease = bool(_UPCOMING_MAINNET.search(text))
    if _LOW_VALUE_RELEASE.search(text):
        return _rejected("Routine, documentation-only, test-only, or tooling release")
    if (release.prerelease or _PRERELEASE.search(text)) and not mainnet_prerelease:
        return _rejected("Pre-release is not tied to an explicit upcoming network activation")
    if not _MATERIAL_RELEASE.search(text) and not mainnet_prerelease:
        return _rejected("Release has no explicit material network behavior")
    return CryptoEventClassification(
        relevant=True,
        event_type="protocol_upgrade",
        importance="high",
        recommended_action="prepare",
        confidence="high" if not release.prerelease else "medium",
        reason=(
            "Official release is tied to an upcoming network activation"
            if mainnet_prerelease
            else "Official release explicitly changes material network behavior"
        ),
    )


def _rejected(reason: str) -> CryptoEventClassification:
    return CryptoEventClassification(
        relevant=False,
        event_type="project_update",
        importance="low",
        recommended_action="watch",
        confidence="high",
        reason=reason,
    )


class GitHubReleaseAdapter(OfficialCryptoSourceAdapter):
    """Official GitHub REST Releases adapter for one code-owned public repository."""

    def __init__(
        self,
        transport: SourceTransport,
        source: CryptoEventFeedSettings,
        token: str = "",
    ) -> None:
        self.transport = transport
        self.source = source
        self.token = token.strip()
        owner, repository = _repository(source)
        expected_api = f"https://{GITHUB_API_HOST}/repos/{owner}/{repository}/releases"
        if source.feed_url != expected_api:
            raise SourceError("policy_restricted", "GitHub Releases endpoint is not code-owned")

    @property
    def source_slug(self) -> str:
        return self.source.slug

    async def fetch(self, limit: int | None = None) -> list[CryptoEventCandidate]:
        limit = limit or self.source.recent_item_limit
        if not 1 <= limit <= 50:
            raise SourceError("invalid_payload", "GitHub Release limit must be between 1 and 50")
        query = urlencode({"per_page": limit, "page": 1})
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        response, observed_at, fetched_at = await self.transport.get(
            f"{self.source.feed_url}?{query}",
            allowed_hosts=frozenset({GITHUB_API_HOST}),
            headers=headers,
        )
        return self.normalize(
            self.source,
            response.content,
            observed_at=observed_at,
            fetched_at=fetched_at,
        )

    @staticmethod
    def normalize(
        source: CryptoEventFeedSettings,
        content: bytes,
        *,
        observed_at: datetime,
        fetched_at: datetime,
    ) -> list[CryptoEventCandidate]:
        owner, repository = _repository(source)
        try:
            raw = cast(object, json.loads(content))
            if not isinstance(raw, list):
                raise ValueError("Expected a release list")
            releases = [GitHubRelease.model_validate(item) for item in cast(list[object], raw)]
        except (json.JSONDecodeError, TypeError, ValueError, ValidationError) as error:
            raise SourceError("parser_error", "Invalid GitHub Releases response") from error

        candidates: list[CryptoEventCandidate] = []
        oldest = observed_at - timedelta(days=source.lookback_days)
        for release in releases:
            if release.draft or release.published_at is None:
                continue
            published_at = release.published_at
            if published_at.tzinfo is None:
                raise SourceError("parser_error", "GitHub release timestamp requires timezone")
            published_at = published_at.astimezone(UTC)
            if published_at < oldest or published_at > observed_at + timedelta(days=1):
                continue
            release_url = canonical_url(release.html_url)
            _require_release_url(release_url, owner, repository)
            summary = plain_text(release.body or "")[:2000] or None
            candidates.append(
                CryptoEventCandidate(
                    source=source,
                    asset_symbols=source.asset_symbols,
                    classification_hint=github_release_classification(release),
                    evidence=FetchedSourceDocument(
                        external_id=str(release.id),
                        canonical_url=release_url,
                        document_type="official_github_release",
                        title=plain_text(release.name or release.tag_name),
                        summary=summary,
                        published_at=published_at,
                        observed_at=observed_at,
                        fetched_at=fetched_at,
                        metadata={
                            "repository": f"{owner}/{repository}",
                            "release_id": release.id,
                            "tag": release.tag_name,
                            "prerelease": release.prerelease,
                            "api_url": source.feed_url,
                            "classification_source": "github_release_policy",
                        },
                    ),
                )
            )
        return candidates


def github_release_source_settings() -> dict[OfficialCryptoSource, CryptoEventFeedSettings]:
    """Reviewed repositories. Repository additions require code review and fixture coverage."""
    definitions: tuple[tuple[OfficialCryptoSource, str, str], ...] = (
        ("github-bitcoin-core", "bitcoin/bitcoin", "BTC"),
        ("github-anza-agave", "anza-xyz/agave", "SOL"),
        ("github-sui", "MystenLabs/sui", "SUI"),
        ("github-chainlink", "smartcontractkit/chainlink", "LINK"),
        ("github-avalanchego", "ava-labs/avalanchego", "AVAX"),
        ("github-dogecoin", "dogecoin/dogecoin", "DOGE"),
        ("github-bitcoin-cash-node", "bitcoin-cash-node/bitcoin-cash-node", "BCH"),
    )
    return {
        key: CryptoEventFeedSettings(
            slug=key,
            name=f"{repository} GitHub Releases",
            source_type="protocol",
            base_url=f"https://github.com/{repository}",
            feed_url=f"https://api.github.com/repos/{repository}/releases",
            event_type="protocol_upgrade",
            asset_symbols=[symbol],
            importance="high",
            recommended_action="prepare",
            opportunity_signal="prepare",
            confidence="high",
            license_class="public_official",
        )
        for key, repository, symbol in definitions
    }


def _repository(source: CryptoEventFeedSettings) -> tuple[str, str]:
    parsed = urlsplit(source.base_url)
    parts = [part for part in parsed.path.split("/") if part]
    if parsed.scheme != "https" or parsed.hostname != GITHUB_WEB_HOST or len(parts) != 2:
        raise SourceError("policy_restricted", "GitHub repository URL is not code-owned")
    return parts[0], parts[1]


def _require_release_url(value: str, owner: str, repository: str) -> None:
    parsed = urlsplit(value)
    prefix = f"/{owner}/{repository}/releases/"
    if (
        parsed.scheme != "https"
        or parsed.hostname != GITHUB_WEB_HOST
        or not parsed.path.startswith(prefix)
    ):
        raise SourceError("policy_restricted", "GitHub release URL left its reviewed repository")
