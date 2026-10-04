from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Literal, cast, get_args
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, uuid5
from xml.etree import ElementTree

import httpx
import structlog
from pydantic import BaseModel, ConfigDict, Field
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

logger = structlog.get_logger(__name__)

CryptoEventType = Literal[
    "project_update",
    "protocol_upgrade",
    "mainnet_launch",
    "token_launch",
    "token_unlock",
    "exchange_listing",
    "exchange_delisting",
    "security_incident",
    "governance",
    "regulation_crypto",
    "etf_crypto",
    "influential_social",
    "meme_launch",
    "narrative_signal",
]
EventImportance = Literal["critical", "high", "medium", "low"]
RecommendedAction = Literal[
    "watch", "research", "prepare", "wait_for_confirmation", "caution", "avoid"
]
ConfidenceBand = Literal["low", "medium", "high"]


class CryptoEventClassification(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relevant: bool
    event_type: CryptoEventType
    importance: EventImportance
    recommended_action: RecommendedAction
    confidence: ConfidenceBand
    reason: str = Field(min_length=1, max_length=300)


Classifier = Callable[["CryptoEventCandidate"], Awaitable[CryptoEventClassification]]

_LOW_VALUE = re.compile(
    r"\b(weekly recap|ama|meetup|podcast|documentation update|docs update|tutorial|"
    r"minor maintenance release|community event)\b",
    re.IGNORECASE,
)
_RELEVANCE_RULES: tuple[
    tuple[re.Pattern[str], CryptoEventType, EventImportance, RecommendedAction], ...
] = (
    (
        re.compile(r"\b(security incident|exploit|hacked?|breach)\b", re.I),
        "security_incident",
        "high",
        "caution",
    ),
    (re.compile(r"\b(delisting|delisted)\b", re.I), "exchange_delisting", "high", "caution"),
    (
        re.compile(r"\b(listing|listed)\b", re.I),
        "exchange_listing",
        "medium",
        "wait_for_confirmation",
    ),
    (
        re.compile(r"\b(mainnet)( launch| goes live| genesis)?\b", re.I),
        "mainnet_launch",
        "high",
        "prepare",
    ),
    (
        re.compile(r"\b(tge|token generation event|token launch)\b", re.I),
        "token_launch",
        "high",
        "wait_for_confirmation",
    ),
    (re.compile(r"\b(token unlock|vesting unlock)\b", re.I), "token_unlock", "medium", "watch"),
    (re.compile(r"\b(protocol upgrade|hard fork)\b", re.I), "protocol_upgrade", "high", "prepare"),
    (
        re.compile(r"\b(governance proposal|governance vote)\b", re.I),
        "governance",
        "medium",
        "research",
    ),
    (
        re.compile(r"\b(crypto etf|bitcoin etf|ethereum etf|spot etf)\b", re.I),
        "etf_crypto",
        "high",
        "watch",
    ),
    (
        re.compile(r"\b(regulatory action|enforcement action|regulatory approval)\b", re.I),
        "regulation_crypto",
        "high",
        "caution",
    ),
    (
        re.compile(r"\b(confirmed distribution|confirmed airdrop)\b", re.I),
        "project_update",
        "medium",
        "wait_for_confirmation",
    ),
    (re.compile(r"\b(meme coin|memecoin) launch\b", re.I), "meme_launch", "medium", "caution"),
    (
        re.compile(r"\bmajor (integration|partnership|acquisition|product launch)\b", re.I),
        "project_update",
        "medium",
        "research",
    ),
)
_IMPORTANCE_ORDER: tuple[EventImportance, ...] = ("low", "medium", "high", "critical")


def deterministic_relevance(candidate: CryptoEventCandidate) -> CryptoEventClassification:
    """Short, conservative gate: explicit material concepts pass; noise and uncertainty do not."""
    text = f"{candidate.evidence.title}\n{candidate.evidence.summary or ''}"
    if _LOW_VALUE.search(text):
        return _rejected(candidate, "Known low-value announcement pattern")
    for pattern, event_type, importance, action in _RELEVANCE_RULES:
        if pattern.search(text):
            return CryptoEventClassification(
                relevant=True,
                event_type=event_type,
                importance=_cap_importance(importance, candidate.source.importance),
                recommended_action=action,
                confidence="high" if event_type == "security_incident" else "medium",
                reason=f"Matched material {event_type.replace('_', ' ')} concept",
            )
    return _rejected(candidate, "No explicit material Crypto Event concept")


def _rejected(candidate: CryptoEventCandidate, reason: str) -> CryptoEventClassification:
    return CryptoEventClassification(
        relevant=False,
        event_type=candidate.source.event_type,
        importance="low",
        recommended_action="watch",
        confidence="low",
        reason=reason,
    )


def _cap_importance(value: EventImportance, ceiling: EventImportance) -> EventImportance:
    return _IMPORTANCE_ORDER[min(_IMPORTANCE_ORDER.index(value), _IMPORTANCE_ORDER.index(ceiling))]


class OpenAICryptoEventClassifier:
    """Optional information-relevance classifier with strict structured output."""

    def __init__(
        self,
        *,
        model: str,
        api_key: str,
        base_url: str,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.model = model
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.transport = transport

    async def classify(self, candidate: CryptoEventCandidate) -> CryptoEventClassification:
        input_payload = {
            "source_identity": {
                "slug": candidate.source.slug,
                "name": candidate.source.name,
                "source_type": candidate.source.source_type,
            },
            "title": candidate.evidence.title,
            "short_summary": candidate.evidence.summary,
            "known_linked_assets": candidate.source.asset_symbols,
            "configured_event_context": {
                "event_type_hint": candidate.source.event_type,
                "importance_ceiling": candidate.source.importance,
            },
        }
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=20,
            transport=self.transport,
            headers={"Authorization": f"Bearer {self.api_key}"},
        ) as client:
            response = await client.post(
                "/responses",
                json={
                    "model": self.model,
                    "input": [
                        {
                            "role": "system",
                            "content": [
                                {
                                    "type": "input_text",
                                    "text": (
                                        "Classify information relevance for a financial event "
                                        "calendar. Prefer relevant=false when uncertain. Never "
                                        "produce price targets, return predictions, position size, "
                                        "leverage, or BUY/SELL instructions. Return only the "
                                        "strict JSON schema."
                                    ),
                                }
                            ],
                        },
                        {
                            "role": "user",
                            "content": [{"type": "input_text", "text": json.dumps(input_payload)}],
                        },
                    ],
                    "text": {
                        "format": {
                            "type": "json_schema",
                            "name": "crypto_event_relevance",
                            "strict": True,
                            "schema": _CLASSIFICATION_SCHEMA,
                        }
                    },
                },
            )
            response.raise_for_status()
        output_text = _response_output_text(response.json())
        return CryptoEventClassification.model_validate_json(output_text)


_CLASSIFICATION_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "relevant": {"type": "boolean"},
        "event_type": {"type": "string", "enum": list(get_args(CryptoEventType))},
        "importance": {"type": "string", "enum": list(get_args(EventImportance))},
        "recommended_action": {"type": "string", "enum": list(get_args(RecommendedAction))},
        "confidence": {"type": "string", "enum": list(get_args(ConfidenceBand))},
        "reason": {"type": "string"},
    },
    "required": [
        "relevant",
        "event_type",
        "importance",
        "recommended_action",
        "confidence",
        "reason",
    ],
    "additionalProperties": False,
}


def _response_output_text(payload: object) -> str:
    if not isinstance(payload, dict):
        raise ValueError("AI classifier returned an invalid response")
    response = cast(dict[str, object], payload)
    output = response.get("output")
    if not isinstance(output, list):
        raise ValueError("AI classifier returned no structured output")
    for raw_item in cast(list[object], output):
        if not isinstance(raw_item, dict):
            continue
        item = cast(dict[str, object], raw_item)
        raw_content = item.get("content")
        if not isinstance(raw_content, list):
            continue
        for raw_block in cast(list[object], raw_content):
            if isinstance(raw_block, dict):
                content = cast(dict[str, object], raw_block)
                if content.get("type") != "output_text":
                    continue
                text = content.get("text")
                if isinstance(text, str):
                    return text
    raise ValueError("AI classifier returned no structured output")


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
    def __init__(self, session: AsyncSession, classifier: Classifier | None = None) -> None:
        self.session = session
        self.classifier = classifier

    async def ingest(self, candidate: CryptoEventCandidate) -> bool:
        source = await self._ensure_source(candidate.source)
        document = await SourceService(SourceRepository(self.session)).ingest(
            source, candidate.evidence
        )
        classification = deterministic_relevance(candidate)
        classification_source = "deterministic"
        if not classification.relevant:
            return False
        if self.classifier is not None:
            try:
                ai_classification = await self.classifier(candidate)
                if not ai_classification.relevant:
                    return False
                classification = ai_classification.model_copy(
                    update={
                        "importance": _cap_importance(
                            ai_classification.importance, candidate.source.importance
                        )
                    }
                )
                classification_source = "ai_structured"
            except Exception as error:
                await logger.awarning(
                    "crypto_event_ai_classification_failed",
                    source_slug=candidate.source.slug,
                    error_type=type(error).__name__,
                )
                classification_source = "deterministic_fallback"
        if classification.event_type == "influential_social":
            return False
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
            event_type=classification.event_type,
            status="confirmed",
            scheduled_date=evidence_time.date(),
            scheduled_at=evidence_time.astimezone(UTC),
            scheduled_timezone="UTC",
            actual_release_at=None,
            detected_at=candidate.evidence.observed_at,
            importance=classification.importance,
            summary=f"FACT: Official source published: {candidate.evidence.title}",
            signal=(
                "SIGNAL: A configured official source published evidence classified as "
                f"{classification.event_type}."
            ),
            why_it_matters=(
                "ANALYSIS: The announcement may affect attention or expectations, but price "
                "and market structure must confirm any market impact."
            ),
            risk=(
                "RISK: An official announcement does not guarantee adoption, liquidity, or "
                "price appreciation."
            ),
            recommended_action=classification.recommended_action,
            opportunity_signal=_opportunity_signal(classification.recommended_action),
            confidence=classification.confidence,
            contract_address=None,
            impact_analysis={
                "classification_source": classification_source,
                "classification_reason": classification.reason,
                "feed_hints": {
                    "event_type": candidate.source.event_type,
                    "importance_ceiling": candidate.source.importance,
                },
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


def _opportunity_signal(action: RecommendedAction) -> str:
    return {
        "watch": "watch",
        "research": "research",
        "prepare": "prepare",
        "wait_for_confirmation": "wait",
        "caution": "wait",
        "avoid": "avoid",
    }[action]


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
