from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Protocol
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.events.models import Event, EventSourceReference
from alpha_radar.health import EVENT_SYNC_STATE_KEY
from alpha_radar.sources.errors import SourceError
from alpha_radar.sources.normalization import canonical_url, plain_text
from alpha_radar.sources.repository import SourceRepository
from alpha_radar.sources.schemas import FetchedSourceDocument
from alpha_radar.sources.service import SourceService
from alpha_radar.sources.transport import SourceTransport


class OfficialEventUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    external_key: str | None = None
    event_type: str
    source_slug: str
    evidence: FetchedSourceDocument
    scheduled_date: date | None = None
    scheduled_at: datetime | None = None
    scheduled_timezone: str | None = None
    released: bool = False
    actual_release_at: datetime | None = None
    actual: str | None = Field(default=None, max_length=128)
    previous: str | None = Field(default=None, max_length=128)

    @field_validator("scheduled_at", "actual_release_at")
    @classmethod
    def utc(cls, value: datetime | None) -> datetime | None:
        if value is not None:
            if value.tzinfo is None:
                raise ValueError("Official timestamps require a timezone")
            return value.astimezone(UTC)
        return None


class OfficialEventAdapter(Protocol):
    async def fetch_updates(self) -> list[OfficialEventUpdate]: ...


@dataclass(frozen=True)
class FeedDefinition:
    event_type: str
    source_slug: str
    url: str
    title_pattern: re.Pattern[str] | None = None


class OfficialRssEventAdapter:
    def __init__(self, transport: SourceTransport, feeds: tuple[FeedDefinition, ...]) -> None:
        self.transport = transport
        self.feeds = feeds

    async def fetch_updates(self) -> list[OfficialEventUpdate]:
        updates: list[OfficialEventUpdate] = []
        for feed in self.feeds:
            response, observed_at, fetched_at = await self.transport.get(feed.url)
            updates.extend(self.normalize(feed, response.content, observed_at, fetched_at))
        return updates

    @staticmethod
    def normalize(
        feed: FeedDefinition,
        content: bytes,
        observed_at: datetime,
        fetched_at: datetime,
    ) -> list[OfficialEventUpdate]:
        if b"<!DOCTYPE" in content.upper() or b"<!ENTITY" in content.upper():
            raise SourceError("parser_error", "XML declarations/entities are prohibited")
        try:
            root = ElementTree.fromstring(content)
            channel = root.find("channel")
            if root.tag != "rss" or channel is None:
                raise ValueError("Expected RSS channel")
            result: list[OfficialEventUpdate] = []
            for item in channel.findall("item"):
                title = plain_text(item.findtext("title") or "")
                link = item.findtext("link")
                if not title or not link:
                    continue
                if feed.title_pattern and not feed.title_pattern.search(title):
                    continue
                url = canonical_url(link)
                if not _official_url(feed.source_slug, url):
                    raise ValueError("RSS item has non-official URL")
                date_text = item.findtext("pubDate")
                published = parsedate_to_datetime(date_text).astimezone(UTC) if date_text else None
                summary = plain_text(item.findtext("description") or "")[:2000] or None
                evidence = FetchedSourceDocument(
                    external_id=item.findtext("guid") or url,
                    canonical_url=url,
                    document_type="official_release",
                    title=title,
                    summary=summary,
                    language="en",
                    published_at=published,
                    observed_at=observed_at,
                    fetched_at=fetched_at,
                    metadata={"feed": feed.url, "event_type": feed.event_type},
                )
                actual, previous = extract_release_values(feed.event_type, summary or "")
                result.append(
                    OfficialEventUpdate(
                        event_type=feed.event_type,
                        source_slug=feed.source_slug,
                        evidence=evidence,
                        released=published is not None,
                        actual_release_at=published,
                        actual=actual,
                        previous=previous,
                    )
                )
            return result
        except (ElementTree.ParseError, ValueError, TypeError) as error:
            raise SourceError("parser_error", "Invalid official Event RSS payload") from error


class _TextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


class OfficialCalendarAdapter:
    calendar_urls = {
        "bls-release-calendar": "https://www.bls.gov/schedule/2026/home.htm",
        "bea-release-calendar": "https://www.bea.gov/news/schedule/full",
        "federal-reserve": "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
    }

    def __init__(self, transport: SourceTransport) -> None:
        self.transport = transport

    async def fetch_updates(self) -> list[OfficialEventUpdate]:
        updates: list[OfficialEventUpdate] = []
        for source_slug, url in self.calendar_urls.items():
            response, observed_at, fetched_at = await self.transport.get(url)
            updates.extend(
                self.normalize(source_slug, url, response.content, observed_at, fetched_at)
            )
        return updates

    @staticmethod
    def normalize(
        source_slug: str,
        url: str,
        content: bytes,
        observed_at: datetime,
        fetched_at: datetime,
    ) -> list[OfficialEventUpdate]:
        parser = _TextParser()
        parser.feed(content.decode("utf-8", errors="strict"))
        text = " ".join(" ".join(parser.parts).split())
        external_ids = {
            "bls-release-calendar": "bls-release-calendar-2026",
            "bea-release-calendar": "bea-release-calendar-live",
            "federal-reserve": "fed-release-calendar-2026",
        }
        evidence = FetchedSourceDocument(
            external_id=external_ids[source_slug],
            canonical_url=url,
            document_type="release_calendar",
            title=f"{source_slug} official release calendar",
            language="en",
            observed_at=observed_at,
            fetched_at=fetched_at,
            metadata={"calendar": True},
        )
        if source_slug == "bls-release-calendar":
            return _bls_schedule_updates(text, source_slug, evidence)
        if source_slug == "bea-release-calendar":
            return _bea_schedule_updates(text, source_slug, evidence)
        return _fed_schedule_updates(text, source_slug, evidence)


class EventSyncService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def apply(self, update: OfficialEventUpdate) -> bool:
        event = await self._resolve(update)
        if event is None:
            return False
        source = await SourceRepository(self.session).source(update.source_slug)
        if source is None:
            raise SourceError("invalid_payload", f"Unknown Event source {update.source_slug}")
        document = await SourceService(SourceRepository(self.session)).ingest(
            source, update.evidence
        )
        if update.scheduled_date is not None:
            event.scheduled_date = update.scheduled_date
        if update.scheduled_at is not None:
            event.scheduled_at = update.scheduled_at
        if update.scheduled_timezone is not None:
            event.scheduled_timezone = update.scheduled_timezone
        if update.released:
            if update.actual_release_at is None:
                raise SourceError("invalid_payload", "Release evidence requires official timestamp")
            event.status = "completed"
            event.actual_release_at = update.actual_release_at
            if update.actual is not None:
                event.actual = update.actual
            if update.previous is not None:
                event.previous = update.previous
        existing_link = await self.session.get(EventSourceReference, (event.id, document.id))
        if existing_link is None:
            self.session.add(
                EventSourceReference(
                    event_id=event.id,
                    source_document_id=document.id,
                    evidence_role="release" if update.released else "schedule_revision",
                )
            )
        await self.session.commit()
        return True

    async def _resolve(self, update: OfficialEventUpdate) -> Event | None:
        if update.external_key:
            return await self.session.scalar(
                select(Event).where(Event.external_key == update.external_key)
            )
        match_date = (
            update.actual_release_at.date()
            if update.actual_release_at is not None
            else update.scheduled_date
        )
        if match_date is None:
            return None
        candidates = list(
            await self.session.scalars(
                select(Event).where(
                    Event.event_type == update.event_type,
                    Event.status == "scheduled",
                )
            )
        )
        eligible = [
            event
            for event in candidates
            if event.scheduled_date is not None
            and abs(event.scheduled_date - match_date) <= timedelta(days=14)
        ]

        def distance(event: Event) -> tuple[timedelta, object]:
            scheduled_date = event.scheduled_date
            assert scheduled_date is not None
            return (abs(scheduled_date - match_date), event.id)

        return min(
            eligible,
            key=distance,
            default=None,
        )


async def record_sync_success(client: Redis, updated: int, checked: int) -> None:
    await client.set(  # pyright: ignore[reportUnknownMemberType]
        EVENT_SYNC_STATE_KEY,
        json.dumps(
            {
                "status": "ok",
                "last_success": datetime.now(UTC).isoformat(),
                "updated": updated,
                "checked": checked,
            }
        ),
        ex=172800,
    )


def official_feed_definitions() -> tuple[FeedDefinition, ...]:
    return (
        FeedDefinition("nfp", "bls-release-calendar", "https://www.bls.gov/feed/empsit.rss"),
        FeedDefinition("cpi", "bls-release-calendar", "https://www.bls.gov/feed/cpi.rss"),
        FeedDefinition("ppi", "bls-release-calendar", "https://www.bls.gov/feed/ppi.rss"),
        FeedDefinition(
            "gdp",
            "bea-release-calendar",
            "https://apps.bea.gov/rss/rss.xml",
            re.compile(r"gross domestic product|gdp", re.IGNORECASE),
        ),
        FeedDefinition(
            "fomc",
            "federal-reserve",
            "https://www.federalreserve.gov/feeds/press_monetary.xml",
            re.compile(r"fomc|federal funds|monetary policy", re.IGNORECASE),
        ),
    )


def extract_release_values(event_type: str, summary: str) -> tuple[str | None, str | None]:
    direction = {
        "increased": "+",
        "rose": "+",
        "advanced": "+",
        "decreased": "-",
        "fell": "-",
        "declined": "-",
    }
    patterns = {
        "nfp": re.compile(
            r"payroll employment\s+(increased|rose|decreased|fell|declined)\s+by\s+([\d,]+)",
            re.IGNORECASE,
        ),
        "cpi": re.compile(
            r"consumer price index[^.]{0,80}\s"
            r"(increased|rose|advanced|decreased|fell|declined)\s+"
            r"([\d.]+)\s+percent",
            re.IGNORECASE,
        ),
        "ppi": re.compile(
            r"(?:producer price index|final demand)[^.]{0,80}\s"
            r"(increased|rose|advanced|decreased|fell|declined|moved up)\s+"
            r"([\d.]+)\s+percent",
            re.IGNORECASE,
        ),
        "gdp": re.compile(
            r"gross domestic product[^.]{0,120}\s(increased|decreased)\s+"
            r"at an annual rate of\s+([\d.]+)\s+percent",
            re.IGNORECASE,
        ),
    }
    if event_type == "fomc":
        match = re.search(
            r"target range[^.]{0,100}?([\d.]+)\s+to\s+([\d.]+)\s+percent", summary, re.I
        )
        actual = f"{match.group(1)}–{match.group(2)}%" if match else None
    else:
        match = patterns.get(event_type, re.compile(r"a^")).search(summary)
        if match:
            verb = match.group(1).lower()
            sign = "+" if verb == "moved up" else direction.get(verb, "")
            suffix = "" if event_type == "nfp" else "%"
            actual = f"{sign}{match.group(2)}{suffix}"
        else:
            actual = None
    previous_match = re.search(
        r"(?:revised|revision)[^.]{0,80}?from\s+([+-]?[\d,.]+%?)", summary, re.I
    )
    return actual, previous_match.group(1) if previous_match else None


def _official_url(source_slug: str, url: str) -> bool:
    hosts = {
        "bls-release-calendar": "https://www.bls.gov/",
        "bea-release-calendar": ("https://www.bea.gov/", "https://apps.bea.gov/"),
        "federal-reserve": "https://www.federalreserve.gov/",
    }
    expected = hosts[source_slug]
    return url.startswith(expected)


def _bls_schedule_updates(
    text: str, source_slug: str, evidence: FetchedSourceDocument
) -> list[OfficialEventUpdate]:
    names = {
        "Employment Situation": "nfp",
        "Consumer Price Index": "cpi",
        "Producer Price Index": "ppi",
    }
    return _timed_schedule_updates(text, names, source_slug, evidence)


def _bea_schedule_updates(
    text: str, source_slug: str, evidence: FetchedSourceDocument
) -> list[OfficialEventUpdate]:
    return _timed_schedule_updates(text, {"Gross Domestic Product": "gdp"}, source_slug, evidence)


def _timed_schedule_updates(
    text: str,
    names: dict[str, str],
    source_slug: str,
    evidence: FetchedSourceDocument,
) -> list[OfficialEventUpdate]:
    results: list[OfficialEventUpdate] = []
    date_pattern = (
        r"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+"
        r"([A-Z][a-z]+\s+\d{1,2},\s+20\d{2})\s+"
        r"(?:\()?([01]?\d:\d{2}\s+[AP]M)"
    )
    for name, event_type in names.items():
        pattern = re.compile(re.escape(name) + r".{0,240}?" + date_pattern, re.I)
        for match in pattern.finditer(text):
            local = datetime.strptime(
                f"{match.group(1)} {match.group(2)}", "%B %d, %Y %I:%M %p"
            ).replace(tzinfo=ZoneInfo("America/New_York"))
            results.append(
                OfficialEventUpdate(
                    event_type=event_type,
                    source_slug=source_slug,
                    evidence=evidence,
                    scheduled_date=local.date(),
                    scheduled_at=local.astimezone(UTC),
                    scheduled_timezone="America/New_York",
                )
            )
    return results


def _fed_schedule_updates(
    text: str, source_slug: str, evidence: FetchedSourceDocument
) -> list[OfficialEventUpdate]:
    results: list[OfficialEventUpdate] = []
    pattern = re.compile(
        r"([A-Z][a-z]+)\s+(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?[^\d]{0,40}(20\d{2})",
        re.I,
    )
    for match in pattern.finditer(text):
        day = int(match.group(3) or match.group(2))
        try:
            scheduled_date = datetime.strptime(
                f"{match.group(1)} {day} {match.group(4)}", "%B %d %Y"
            ).date()
        except ValueError:
            continue
        results.append(
            OfficialEventUpdate(
                event_type="fomc",
                source_slug=source_slug,
                evidence=evidence,
                scheduled_date=scheduled_date,
                scheduled_timezone="America/New_York",
            )
        )
    return results
