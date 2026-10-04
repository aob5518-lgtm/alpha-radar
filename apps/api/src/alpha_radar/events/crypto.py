from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, uuid5
from xml.etree import ElementTree

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.models import Asset
from alpha_radar.config import CryptoEventFeedSettings
from alpha_radar.events.models import Event, EventAsset, EventSourceReference
from alpha_radar.sources.errors import SourceError
from alpha_radar.sources.models import Source
from alpha_radar.sources.normalization import canonical_url, plain_text
from alpha_radar.sources.repository import SourceRepository
from alpha_radar.sources.schemas import FetchedSourceDocument
from alpha_radar.sources.service import SourceService
from alpha_radar.sources.transport import SourceTransport


class CryptoEventCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: CryptoEventFeedSettings
    evidence: FetchedSourceDocument


class OfficialCryptoFeedAdapter:
    """Strict official RSS/Atom adapter; social sources are intentionally unsupported."""

    def __init__(self, transport: SourceTransport, feed: CryptoEventFeedSettings) -> None:
        self.transport = transport
        self.feed = feed
        _require_official_url(feed.base_url, feed.feed_url)

    async def fetch(self, limit: int = 50) -> list[CryptoEventCandidate]:
        if not 1 <= limit <= 100:
            raise SourceError("invalid_payload", "Limit must be between 1 and 100")
        response, observed_at, fetched_at = await self.transport.get(self.feed.feed_url)
        return self.normalize(
            self.feed,
            response.content,
            observed_at=observed_at,
            fetched_at=fetched_at,
        )[:limit]

    @staticmethod
    def normalize(
        feed: CryptoEventFeedSettings,
        content: bytes,
        *,
        observed_at: datetime,
        fetched_at: datetime,
    ) -> list[CryptoEventCandidate]:
        if b"<!DOCTYPE" in content.upper() or b"<!ENTITY" in content.upper():
            raise SourceError("parser_error", "XML declarations/entities are prohibited")
        try:
            root = ElementTree.fromstring(content)
            entries = root.findall("./channel/item") if _local_name(root.tag) == "rss" else []
            if not entries and _local_name(root.tag) == "feed":
                entries = [node for node in root if _local_name(node.tag) == "entry"]
            if not entries:
                raise ValueError("Expected RSS items or Atom entries")
            result: list[CryptoEventCandidate] = []
            for entry in entries:
                title = plain_text(_child_text(entry, "title") or "")
                link = _entry_link(entry)
                if not title or not link:
                    continue
                url = canonical_url(link)
                _require_official_url(feed.base_url, url)
                published = _entry_time(entry)
                identifier = _child_text(entry, "guid") or _child_text(entry, "id") or url
                summary = (
                    plain_text(
                        _child_text(entry, "description") or _child_text(entry, "summary") or ""
                    )[:2000]
                    or None
                )
                result.append(
                    CryptoEventCandidate(
                        source=feed,
                        evidence=FetchedSourceDocument(
                            external_id=identifier,
                            canonical_url=url,
                            document_type="official_crypto_announcement",
                            title=title,
                            summary=summary,
                            published_at=published,
                            observed_at=observed_at,
                            fetched_at=fetched_at,
                            metadata={
                                "feed": feed.feed_url,
                                "event_type": feed.event_type,
                                "classification_source": "configured_official_feed",
                            },
                        ),
                    )
                )
            return result
        except (ElementTree.ParseError, TypeError, ValueError) as error:
            raise SourceError("parser_error", "Invalid official Crypto Event feed") from error


class CryptoEventIngestionService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def ingest(self, candidate: CryptoEventCandidate) -> bool:
        source = await self._ensure_source(candidate.source)
        document = await SourceService(SourceRepository(self.session)).ingest(
            source, candidate.evidence
        )
        identity = candidate.evidence.external_id or candidate.evidence.canonical_url
        digest = hashlib.sha256(identity.encode()).hexdigest()[:32]
        external_key = f"crypto:{candidate.source.slug}:{digest}"
        existing = await self.session.scalar(
            select(Event).where(Event.external_key == external_key)
        )
        if existing is not None:
            return False
        evidence_time = candidate.evidence.published_at or candidate.evidence.observed_at
        event = Event(
            id=uuid5(NAMESPACE_URL, f"alpha-radar:event:{external_key}"),
            external_key=external_key,
            title=candidate.evidence.title,
            category="crypto",
            event_type=candidate.source.event_type,
            status="confirmed",
            scheduled_date=evidence_time.date(),
            scheduled_at=evidence_time.astimezone(UTC),
            scheduled_timezone="UTC",
            actual_release_at=None,
            detected_at=candidate.evidence.observed_at,
            importance=candidate.source.importance,
            summary=f"FACT: Official source published: {candidate.evidence.title}",
            signal=(
                "SIGNAL: A configured official source published evidence classified as "
                f"{candidate.source.event_type}."
            ),
            why_it_matters=(
                "ANALYSIS: The announcement may affect attention or expectations, but price "
                "and market structure must confirm any market impact."
            ),
            risk=(
                "RISK: An official announcement does not guarantee adoption, liquidity, or "
                "price appreciation."
            ),
            recommended_action=candidate.source.recommended_action,
            opportunity_signal=candidate.source.opportunity_signal,
            confidence=candidate.source.confidence,
            contract_address=None,
            impact_analysis={
                "classification_source": "configured_official_feed",
                "source_document_id": str(document.id),
            },
            bull_case=None,
            bear_case=None,
            watch_next=[
                "Confirm details in the linked official announcement",
                "Observe price, volume, and existing technical levels",
            ],
        )
        self.session.add(event)
        await self.session.flush()
        assets = list(
            await self.session.scalars(
                select(Asset).where(Asset.symbol.in_(candidate.source.asset_symbols))
            )
        )
        for asset in assets:
            self.session.add(
                EventAsset(event_id=event.id, asset_id=asset.id, relationship="crypto_event")
            )
        self.session.add(
            EventSourceReference(
                event_id=event.id,
                source_document_id=document.id,
                evidence_role="fact",
            )
        )
        await self.session.commit()
        return True

    async def _ensure_source(self, feed: CryptoEventFeedSettings) -> Source:
        source = await SourceRepository(self.session).source(feed.slug)
        if source is not None:
            if source.base_url.rstrip("/") != feed.base_url:
                raise SourceError("invalid_payload", "Configured source base URL changed")
            return source
        source = Source(
            id=uuid5(NAMESPACE_URL, f"alpha-radar:source:{feed.slug}"),
            slug=feed.slug,
            name=feed.name,
            source_type=feed.source_type,
            source_tier="primary",
            provider="crypto_official_feed",
            base_url=feed.base_url,
            language="en",
            license_class="metadata_only",
            metadata_={"feed_url": feed.feed_url, "event_type": feed.event_type},
        )
        self.session.add(source)
        await self.session.flush()
        return source


def _require_official_url(base_url: str, value: str) -> None:
    base, target = urlsplit(base_url), urlsplit(value)
    if (
        base.scheme != "https"
        or target.scheme != "https"
        or not base.hostname
        or target.hostname != base.hostname
    ):
        raise SourceError("policy_restricted", "Crypto Event URL is outside its official host")


def _local_name(value: str) -> str:
    return value.rsplit("}", 1)[-1]


def _child_text(entry: ElementTree.Element, name: str) -> str | None:
    for child in entry:
        if _local_name(child.tag) == name:
            return child.text
    return None


def _entry_link(entry: ElementTree.Element) -> str | None:
    for child in entry:
        if _local_name(child.tag) == "link":
            return child.attrib.get("href") or child.text
    return None


def _entry_time(entry: ElementTree.Element) -> datetime | None:
    value = (
        _child_text(entry, "pubDate")
        or _child_text(entry, "published")
        or _child_text(entry, "updated")
    )
    if not value:
        return None
    try:
        parsed = (
            parsedate_to_datetime(value)
            if "," in value
            else datetime.fromisoformat(value.replace("Z", "+00:00"))
        )
    except (TypeError, ValueError) as error:
        raise ValueError("Invalid feed timestamp") from error
    if parsed.tzinfo is None:
        raise ValueError("Feed timestamp requires timezone")
    return parsed.astimezone(UTC)
