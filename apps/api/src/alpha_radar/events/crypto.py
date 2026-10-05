from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Literal, Protocol, cast, get_args
from urllib.parse import urljoin, urlsplit
from uuid import NAMESPACE_URL, uuid5
from xml.etree import ElementTree

import httpx
import structlog
from pydantic import BaseModel, ConfigDict, Field, JsonValue
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.models import Asset
from alpha_radar.config import CryptoEventFeedSettings, OfficialCryptoSource
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
    if candidate.classification_hint is not None:
        hint = candidate.classification_hint
        if not hint.relevant:
            return hint
        return hint.model_copy(
            update={"importance": _cap_importance(hint.importance, candidate.source.importance)}
        )
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
    asset_symbols: list[str] = Field(default_factory=list, max_length=20)
    classification_hint: CryptoEventClassification | None = None
    channel: Literal["official", "social"] = "official"


class OfficialCryptoSourceAdapter(Protocol):
    @property
    def source_slug(self) -> str: ...

    async def fetch(self, limit: int | None = None) -> list[CryptoEventCandidate]: ...


class OfficialCryptoFeedAdapter:
    """Strict official RSS/Atom adapter; social sources are intentionally unsupported."""

    def __init__(self, transport: SourceTransport, feed: CryptoEventFeedSettings) -> None:
        self.transport = transport
        self.feed = feed
        _require_official_url(feed.base_url, feed.feed_url)

    @property
    def source_slug(self) -> str:
        return self.feed.slug

    async def fetch(self, limit: int | None = None) -> list[CryptoEventCandidate]:
        limit = limit or self.feed.recent_item_limit
        if not 1 <= limit <= 100:
            raise SourceError("invalid_payload", "Limit must be between 1 and 100")
        allowed_host = _hostname(self.feed.base_url)
        response, observed_at, fetched_at = await self.transport.get(
            self.feed.feed_url, allowed_hosts=frozenset({allowed_host})
        )
        _require_response_host(response, frozenset({allowed_host}))
        candidates = self.normalize(
            self.feed,
            response.content,
            observed_at=observed_at,
            fetched_at=fetched_at,
        )
        return _bounded_recent(candidates, observed_at, self.feed.lookback_days, limit)

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
                categories: list[JsonValue] = [
                    plain_text(child.text or "")
                    for child in entry
                    if _local_name(child.tag) == "category" and plain_text(child.text or "")
                ]
                result.append(
                    CryptoEventCandidate(
                        source=feed,
                        asset_symbols=feed.asset_symbols,
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
                                "categories": categories,
                            },
                        ),
                    )
                )
            return result
        except (ElementTree.ParseError, TypeError, ValueError) as error:
            raise SourceError("parser_error", "Invalid official Crypto Event feed") from error


class EthereumFoundationFeedAdapter(OfficialCryptoFeedAdapter):
    @staticmethod
    def normalize(
        feed: CryptoEventFeedSettings,
        content: bytes,
        *,
        observed_at: datetime,
        fetched_at: datetime,
    ) -> list[CryptoEventCandidate]:
        return [
            _apply_ethereum_policy(item)
            for item in OfficialCryptoFeedAdapter.normalize(
                feed, content, observed_at=observed_at, fetched_at=fetched_at
            )
        ]


class SolanaNewsFeedAdapter(OfficialCryptoFeedAdapter):
    @staticmethod
    def normalize(
        feed: CryptoEventFeedSettings,
        content: bytes,
        *,
        observed_at: datetime,
        fetched_at: datetime,
    ) -> list[CryptoEventCandidate]:
        return [
            _apply_solana_policy(item)
            for item in OfficialCryptoFeedAdapter.normalize(
                feed, content, observed_at=observed_at, fetched_at=fetched_at
            )
        ]


class _AnnouncementLinkParser(HTMLParser):
    """Extract only provider-specific announcement links; this is not a generic scraper."""

    def __init__(self, path_prefix: str) -> None:
        super().__init__(convert_charrefs=True)
        self.path_prefix = path_prefix
        self.items: list[dict[str, str]] = []
        self._current: dict[str, str] | None = None
        self._anchor_depth = 0
        self._heading_depth = 0
        self._text: list[str] = []
        self._heading: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key: value or "" for key, value in attrs}
        if tag == "a" and self._current is None:
            href = attributes.get("href", "")
            if urlsplit(href).path.startswith(self.path_prefix):
                self._current = {
                    "href": href,
                    "title": attributes.get("data-title", "") or attributes.get("aria-label", ""),
                    "published": attributes.get("data-published-at", ""),
                    "category": attributes.get("data-category", ""),
                    "summary": attributes.get("data-summary", ""),
                }
                self._anchor_depth = 1
                self._text = []
                self._heading = []
                return
        if self._current is None:
            return
        if tag == "a":
            self._anchor_depth += 1
        if tag in {"h1", "h2", "h3", "h4"}:
            self._heading_depth += 1
        if tag == "time" and attributes.get("datetime"):
            self._current["published"] = attributes["datetime"]

    def handle_data(self, data: str) -> None:
        if self._current is None:
            return
        value = plain_text(data)
        if not value:
            return
        self._text.append(value)
        if self._heading_depth:
            self._heading.append(value)

    def handle_endtag(self, tag: str) -> None:
        if self._current is None:
            return
        if tag in {"h1", "h2", "h3", "h4"} and self._heading_depth:
            self._heading_depth -= 1
        if tag != "a":
            return
        self._anchor_depth -= 1
        if self._anchor_depth:
            return
        raw_text = " ".join(self._text)
        self._current["title"] = plain_text(
            self._current["title"] or " ".join(self._heading) or _title_before_date(raw_text)
        )
        if not self._current["published"]:
            self._current["published"] = _date_text(raw_text) or ""
        if self._current["title"]:
            self.items.append(self._current)
        self._current = None
        self._text = []
        self._heading = []


class OfficialCryptoHtmlAdapter:
    official_host: str
    article_path_prefix: str

    def __init__(self, transport: SourceTransport, source: CryptoEventFeedSettings) -> None:
        self.transport = transport
        self.source = source
        if _hostname(source.base_url) != self.official_host:
            raise SourceError("policy_restricted", "HTML adapter source host is not official")
        _require_official_url(source.base_url, source.feed_url)

    @property
    def source_slug(self) -> str:
        return self.source.slug

    async def fetch(self, limit: int | None = None) -> list[CryptoEventCandidate]:
        limit = limit or self.source.recent_item_limit
        response, observed_at, fetched_at = await self.transport.get(
            self.source.feed_url, allowed_hosts=frozenset({self.official_host})
        )
        _require_response_host(response, frozenset({self.official_host}))
        candidates = self.normalize(
            response.content,
            observed_at=observed_at,
            fetched_at=fetched_at,
        )
        return _bounded_recent(candidates, observed_at, self.source.lookback_days, limit)

    def normalize(
        self,
        content: bytes,
        *,
        observed_at: datetime,
        fetched_at: datetime,
    ) -> list[CryptoEventCandidate]:
        try:
            markup = content.decode("utf-8")
        except UnicodeDecodeError as error:
            raise SourceError("parser_error", "Official announcement page is not UTF-8") from error
        parser = _AnnouncementLinkParser(self.article_path_prefix)
        parser.feed(markup)
        if not parser.items:
            raise SourceError("parser_error", "Official announcement page contained no articles")
        candidates: list[CryptoEventCandidate] = []
        for item in parser.items:
            url = canonical_url(urljoin(self.source.base_url, item["href"]))
            _require_official_url(self.source.base_url, url)
            published_at, published_date = _html_publication_time(item["published"])
            hint = self.classify_item(item["title"], item["summary"], item["category"])
            symbols = _extract_asset_symbols(f"{item['title']} {item['summary']}")
            candidates.append(
                CryptoEventCandidate(
                    source=self.source,
                    asset_symbols=symbols,
                    classification_hint=hint,
                    evidence=FetchedSourceDocument(
                        external_id=url,
                        canonical_url=url,
                        document_type="official_crypto_announcement",
                        title=item["title"],
                        summary=plain_text(item["summary"])[:2000] or None,
                        published_at=published_at,
                        observed_at=observed_at,
                        fetched_at=fetched_at,
                        metadata={
                            "index_url": self.source.feed_url,
                            "provider_category": item["category"],
                            "published_date": published_date,
                            "classification_source": "provider_specific_html_adapter",
                        },
                    ),
                )
            )
        return candidates

    def classify_item(
        self, title: str, summary: str, category: str
    ) -> CryptoEventClassification | None:
        raise NotImplementedError


_BYBIT_PROMOTION = re.compile(
    r"\b(win|giveaway|competition|contest|campaign|cashback|rebate|referral|affiliate|"
    r"puzzle|reward pool|share of|fee discount|trading challenge)\b",
    re.I,
)
_BYBIT_NON_CRYPTO = re.compile(r"\b(stock|tradfi|forex|cfd)\b", re.I)


class BybitAnnouncementAdapter(OfficialCryptoHtmlAdapter):
    official_host = "announcements.bybit.com"
    article_path_prefix = "/en/article/"

    def classify_item(
        self, title: str, summary: str, category: str
    ) -> CryptoEventClassification | None:
        text = f"{title} {summary} {category}"
        if _BYBIT_PROMOTION.search(text) or _BYBIT_NON_CRYPTO.search(text):
            return _rejection_hint("Promotional or non-crypto Bybit announcement")
        if re.search(r"\b(delist|delisting|removal of)\b", text, re.I):
            return _hint("exchange_delisting", "high", "caution", "Official Bybit delisting")
        if re.search(r"\b(new listing|will list|listing of)\b", text, re.I):
            return _hint(
                "exchange_listing", "medium", "wait_for_confirmation", "Official Bybit listing"
            )
        if re.search(r"\b(network upgrade|hard fork|mainnet upgrade)\b", text, re.I):
            return _hint("protocol_upgrade", "high", "prepare", "Supported network upgrade")
        if re.search(r"\bmajor maintenance\b", text, re.I):
            return _hint("project_update", "medium", "watch", "Major exchange maintenance")
        if re.search(r"\bbybit alpha\b.*\b(launch|listing|live)\b", text, re.I):
            return _hint(
                "token_launch", "medium", "wait_for_confirmation", "Bybit Alpha project launch"
            )
        return None


_COINBASE_NOISE = re.compile(
    r"\b(how to|learn|beginner|consumer protection|company culture|design system|career|"
    r"interview|minor engineering|tutorial|weekly|recap|rewards?|fees?|sweepstakes)\b",
    re.I,
)


class CoinbaseBlogAdapter(OfficialCryptoHtmlAdapter):
    official_host = "www.coinbase.com"
    article_path_prefix = "/blog/"

    def classify_item(
        self, title: str, summary: str, category: str
    ) -> CryptoEventClassification | None:
        text = f"{title} {summary} {category}"
        if _COINBASE_NOISE.search(text):
            return _rejection_hint("Low-value Coinbase education, culture, or marketing content")
        if re.search(r"\b(regulat|cftc|sec |approval|licen[cs]e|court|enforcement)\b", text, re.I):
            return _hint(
                "regulation_crypto", "high", "watch", "Material official regulatory development"
            )
        if re.search(
            r"\b(clearing|matching engine|market structure|institutional|bank|custody|"
            r"stablecoin infrastructure|derivatives platform|payment infrastructure)\b",
            text,
            re.I,
        ) and re.search(
            r"\b(launch|approval|partner|integration|expand|upgrade|bring)\w*\b", text, re.I
        ):
            return _hint(
                "project_update", "medium", "research", "Material infrastructure or partnership"
            )
        return None


def official_crypto_source_settings() -> dict[OfficialCryptoSource, CryptoEventFeedSettings]:
    """Small reviewed source registry. Adding a source requires code review and fixture coverage."""
    definitions: dict[OfficialCryptoSource, CryptoEventFeedSettings] = {
        "ethereum-foundation-blog": CryptoEventFeedSettings(
            slug="ethereum-foundation-blog",
            name="Ethereum Foundation Blog",
            source_type="protocol",
            base_url="https://blog.ethereum.org",
            feed_url="https://blog.ethereum.org/en/feed.xml",
            event_type="project_update",
            asset_symbols=["ETH"],
            importance="high",
        ),
        "bybit-announcements": CryptoEventFeedSettings(
            slug="bybit-announcements",
            name="Bybit Official Announcements",
            source_type="exchange",
            base_url="https://announcements.bybit.com",
            feed_url="https://announcements.bybit.com/en/",
            event_type="project_update",
            importance="high",
        ),
        "solana-news": CryptoEventFeedSettings(
            slug="solana-news",
            name="Solana Official News",
            source_type="protocol",
            base_url="https://solana.com",
            feed_url="https://solana.com/news/rss.xml",
            event_type="project_update",
            asset_symbols=["SOL"],
            importance="high",
        ),
        "coinbase-blog": CryptoEventFeedSettings(
            slug="coinbase-blog",
            name="Coinbase Official Blog",
            source_type="exchange",
            base_url="https://www.coinbase.com",
            feed_url="https://www.coinbase.com/blog/landing",
            event_type="project_update",
            importance="high",
        ),
    }
    from alpha_radar.events.github_releases import github_release_source_settings

    definitions.update(github_release_source_settings())
    return definitions


def official_crypto_source_adapters(
    transport: SourceTransport,
    sources: list[OfficialCryptoSource],
    *,
    github_token: str = "",
) -> list[OfficialCryptoSourceAdapter]:
    from alpha_radar.events.github_releases import GitHubReleaseAdapter

    definitions = official_crypto_source_settings()
    adapters: dict[
        OfficialCryptoSource, type[OfficialCryptoFeedAdapter | OfficialCryptoHtmlAdapter]
    ] = {
        "ethereum-foundation-blog": EthereumFoundationFeedAdapter,
        "bybit-announcements": BybitAnnouncementAdapter,
        "solana-news": SolanaNewsFeedAdapter,
        "coinbase-blog": CoinbaseBlogAdapter,
    }
    result: list[OfficialCryptoSourceAdapter] = []
    for key in dict.fromkeys(sources):
        definition = definitions[key]
        if key.startswith("github-"):
            result.append(GitHubReleaseAdapter(transport, definition, github_token))
        else:
            result.append(adapters[key](transport, definition))
    return result


def _apply_ethereum_policy(candidate: CryptoEventCandidate) -> CryptoEventCandidate:
    text = f"{candidate.evidence.title} {candidate.evidence.summary or ''}"
    hint = None
    if re.search(r"\b(security incident|vulnerability|exploit|breach)\b", text, re.I):
        hint = _hint("security_incident", "high", "caution", "Ethereum security announcement")
    elif re.search(
        r"\b(protocol upgrade|hard fork|mainnet|testnet|validator|client release)\b", text, re.I
    ):
        hint = _hint("protocol_upgrade", "high", "prepare", "Ethereum protocol development")
    elif re.search(r"\b(governance proposal|governance vote|eip governance)\b", text, re.I):
        hint = _hint("governance", "medium", "research", "Ethereum governance announcement")
    return candidate.model_copy(update={"asset_symbols": ["ETH"], "classification_hint": hint})


def _apply_solana_policy(candidate: CryptoEventCandidate) -> CryptoEventCandidate:
    text = f"{candidate.evidence.title} {candidate.evidence.summary or ''}"
    hint = None
    if re.search(r"\b(roundup|guide|summer school|community event|podcast|recap)\b", text, re.I):
        hint = _rejection_hint("Low-value Solana ecosystem or community article")
    elif re.search(
        r"\b(protocol upgrade|mainnet|validator|network upgrade|client release|"
        r"technical release|slot time)\b",
        text,
        re.I,
    ):
        hint = _hint("protocol_upgrade", "high", "prepare", "Material Solana network update")
    elif re.search(
        r"\b(institutional|bank|payment infrastructure|tokenized funds?|"
        r"stablecoin infrastructure)\b",
        text,
        re.I,
    ) and re.search(r"\b(launch|live|integrat|connect|partner|bring)\w*\b", text, re.I):
        hint = _hint(
            "project_update", "medium", "research", "Material Solana infrastructure integration"
        )
    return candidate.model_copy(update={"asset_symbols": ["SOL"], "classification_hint": hint})


def _hint(
    event_type: CryptoEventType,
    importance: EventImportance,
    action: RecommendedAction,
    reason: str,
) -> CryptoEventClassification:
    return CryptoEventClassification(
        relevant=True,
        event_type=event_type,
        importance=importance,
        recommended_action=action,
        confidence="high",
        reason=reason,
    )


def _rejection_hint(reason: str) -> CryptoEventClassification:
    return CryptoEventClassification(
        relevant=False,
        event_type="project_update",
        importance="low",
        recommended_action="watch",
        confidence="high",
        reason=reason,
    )


_MONTH_DATE = re.compile(
    r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|"
    r"Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b",
    re.I,
)


def _date_text(value: str) -> str | None:
    match = _MONTH_DATE.search(value)
    return match.group(0) if match else None


def _title_before_date(value: str) -> str:
    match = _MONTH_DATE.search(value)
    return value[: match.start()].strip() if match else value.strip()


def _html_publication_time(value: str) -> tuple[datetime | None, str | None]:
    value = value.strip()
    if not value:
        return None, None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            return parsed.astimezone(UTC), parsed.date().isoformat()
        return None, parsed.date().isoformat()
    except ValueError:
        pass
    for pattern in ("%b %d, %Y", "%B %d, %Y"):
        try:
            return None, datetime.strptime(value, pattern).date().isoformat()
        except ValueError:
            continue
    raise SourceError("parser_error", "Official announcement has an invalid publication date")


_TRACKED_CRYPTO_ASSETS = {
    "BTC": ("bitcoin",),
    "ETH": ("ethereum", "ether"),
    "SOL": ("solana",),
    "BNB": ("bnb", "bnb chain"),
    "XRP": ("xrp", "xrp ledger"),
    "DOGE": ("dogecoin", "doge"),
    "ADA": ("cardano",),
    "SUI": ("sui",),
    "LINK": ("chainlink",),
    "AVAX": ("avalanche",),
    "LTC": ("litecoin",),
    "BCH": ("bitcoin cash",),
}


def _extract_asset_symbols(value: str) -> list[str]:
    lowered = value.lower()
    symbols: list[str] = []
    for symbol, names in _TRACKED_CRYPTO_ASSETS.items():
        symbol_match = re.search(rf"\b{symbol}(?:USDT|USDC|USD)?\b", value, re.I)
        name_match = any(re.search(rf"\b{re.escape(name)}\b", lowered) for name in names)
        if symbol_match or name_match:
            symbols.append(symbol)
    return symbols


def _bounded_recent(
    candidates: list[CryptoEventCandidate], observed_at: datetime, lookback_days: int, limit: int
) -> list[CryptoEventCandidate]:
    oldest = (observed_at - timedelta(days=lookback_days)).date()
    newest = (observed_at + timedelta(days=1)).date()
    recent: list[CryptoEventCandidate] = []
    for candidate in candidates:
        published = candidate.evidence.published_at
        raw_date = candidate.evidence.metadata.get("published_date")
        if published is not None:
            published_date = published.date()
        elif isinstance(raw_date, str):
            try:
                published_date = datetime.fromisoformat(raw_date).date()
            except ValueError:
                continue
        else:
            continue
        if oldest <= published_date <= newest:
            recent.append(candidate)
        if len(recent) == limit:
            break
    return recent


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
        if classification.event_type == "influential_social" and candidate.channel != "social":
            return False
        identity = candidate.evidence.external_id or candidate.evidence.canonical_url
        digest = hashlib.sha256(identity.encode()).hexdigest()[:32]
        external_key = f"crypto:{candidate.source.slug}:{digest}"
        existing = await self.session.scalar(
            select(Event).where(Event.external_key == external_key)
        )
        if existing is not None:
            return False
        evidence_time = candidate.evidence.published_at
        raw_published_date = candidate.evidence.metadata.get("published_date")
        if evidence_time is not None:
            scheduled_date = evidence_time.date()
        elif isinstance(raw_published_date, str):
            scheduled_date = datetime.fromisoformat(raw_published_date).date()
        else:
            scheduled_date = candidate.evidence.observed_at.date()
        is_social = candidate.channel == "social"
        account = candidate.evidence.metadata.get("account_username")
        mentioned = candidate.asset_symbols or candidate.source.asset_symbols
        mentioned_symbols = ", ".join(mentioned)
        event = Event(
            id=uuid5(NAMESPACE_URL, f"alpha-radar:event:{external_key}"),
            external_key=external_key,
            title=candidate.evidence.title,
            category="crypto",
            event_type=classification.event_type,
            status="confirmed",
            scheduled_date=scheduled_date,
            scheduled_at=evidence_time.astimezone(UTC) if evidence_time else None,
            scheduled_timezone="UTC" if evidence_time else None,
            actual_release_at=None,
            detected_at=candidate.evidence.observed_at,
            importance=classification.importance,
            summary=(
                f"FACT: Monitored X account @{account} explicitly mentioned {mentioned_symbols}."
                if is_social and isinstance(account, str) and mentioned_symbols
                else f"FACT: Official source published: {candidate.evidence.title}"
            ),
            signal=(
                "SIGNAL: High-impact social attention may increase in the short term."
                if is_social
                else "SIGNAL: A configured official source published evidence classified as "
                f"{classification.event_type}."
            ),
            why_it_matters=(
                "ANALYSIS: Price and volume must confirm whether social attention becomes a "
                "market move."
                if is_social
                else "ANALYSIS: The announcement may affect attention or expectations, but "
                "price and market structure must confirm any market impact."
            ),
            risk=(
                "RISK: A single social post is not sufficient evidence of sustained price "
                "direction."
                if is_social
                else "RISK: An official announcement does not guarantee adoption, liquidity, "
                "or price appreciation."
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
                select(Asset).where(
                    Asset.symbol.in_(candidate.asset_symbols or candidate.source.asset_symbols)
                )
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
                evidence_role="signal" if is_social else "fact",
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
        is_social = feed.source_type == "social"
        source = Source(
            id=uuid5(NAMESPACE_URL, f"alpha-radar:source:{feed.slug}"),
            slug=feed.slug,
            name=feed.name,
            source_type=feed.source_type,
            source_tier="social" if is_social else "primary",
            provider="x_api" if is_social else "crypto_official_source",
            base_url=feed.base_url,
            language="en",
            license_class=feed.license_class,
            metadata_={"index_url": feed.feed_url, "event_type": feed.event_type},
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


def _hostname(value: str) -> str:
    hostname = urlsplit(value).hostname
    if not hostname:
        raise SourceError("policy_restricted", "Crypto Event source has no official host")
    return hostname.lower()


def _require_response_host(response: httpx.Response, allowed_hosts: frozenset[str]) -> None:
    response_host = response.url.host.lower()
    if response_host not in allowed_hosts:
        raise SourceError("policy_restricted", "Crypto Event response left its official host")


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
