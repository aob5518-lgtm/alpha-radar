from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass
from datetime import UTC, date, datetime
from uuid import NAMESPACE_URL, uuid5
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.models import Asset
from alpha_radar.db.session import async_session_factory
from alpha_radar.events.models import Event, EventAsset, EventSourceReference
from alpha_radar.sources.models import Source, SourceDocument, SourceDocumentVersion

DETECTED_AT = datetime(2026, 10, 2, tzinfo=UTC)


@dataclass(frozen=True)
class SourceSeed:
    key: str
    source_type: str
    slug: str
    name: str
    provider: str
    base_url: str
    schedule_url: str
    title: str


SOURCES = (
    SourceSeed(
        "bls",
        "government",
        "bls-release-calendar",
        "U.S. Bureau of Labor Statistics Release Calendar",
        "bls",
        "https://www.bls.gov",
        "https://www.bls.gov/schedule/2026/home.htm",
        "2026 BLS Release Calendar",
    ),
    SourceSeed(
        "bea",
        "government",
        "bea-release-calendar",
        "U.S. Bureau of Economic Analysis Release Calendar",
        "bea",
        "https://www.bea.gov",
        "https://www.bea.gov/news/schedule/2026",
        "2026 BEA Release Calendar",
    ),
    SourceSeed(
        "fed",
        "central_bank",
        "federal-reserve",
        "Federal Reserve",
        "fed",
        "https://www.federalreserve.gov",
        "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        "FOMC Meeting Calendar 2026",
    ),
)


@dataclass(frozen=True)
class ScheduledEvent:
    key: str
    title: str
    event_type: str
    local_time: datetime | None
    importance: str
    source_key: str = "bls"
    announced_date: date | None = None

    @property
    def scheduled_date(self) -> date:
        value = self.local_time.date() if self.local_time else self.announced_date
        if value is None:
            raise ValueError("Scheduled event requires a date")
        return value


def eastern(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, 8, 30, tzinfo=ZoneInfo("America/New_York"))


SCHEDULE = (
    ScheduledEvent(
        "bls:employment:2026-09",
        "Employment Situation — September 2026",
        "nfp",
        eastern(2026, 10, 2),
        "critical",
    ),
    ScheduledEvent(
        "bls:cpi:2026-09",
        "Consumer Price Index — September 2026",
        "cpi",
        eastern(2026, 10, 14),
        "critical",
    ),
    ScheduledEvent(
        "bls:ppi:2026-09",
        "Producer Price Index — September 2026",
        "ppi",
        eastern(2026, 10, 15),
        "high",
    ),
    ScheduledEvent(
        "bls:employment:2026-10",
        "Employment Situation — October 2026",
        "nfp",
        eastern(2026, 11, 6),
        "critical",
    ),
    ScheduledEvent(
        "bls:cpi:2026-10",
        "Consumer Price Index — October 2026",
        "cpi",
        eastern(2026, 11, 10),
        "critical",
    ),
    ScheduledEvent(
        "bls:ppi:2026-10",
        "Producer Price Index — October 2026",
        "ppi",
        eastern(2026, 11, 13),
        "high",
    ),
    ScheduledEvent(
        "bls:employment:2026-11",
        "Employment Situation — November 2026",
        "nfp",
        eastern(2026, 12, 4),
        "critical",
    ),
    ScheduledEvent(
        "bls:cpi:2026-11",
        "Consumer Price Index — November 2026",
        "cpi",
        eastern(2026, 12, 10),
        "critical",
    ),
    ScheduledEvent(
        "bls:ppi:2026-11",
        "Producer Price Index — November 2026",
        "ppi",
        eastern(2026, 12, 15),
        "high",
    ),
    ScheduledEvent(
        "bea:gdp:2026-q3:advance",
        "GDP — Q3 2026 Advance Estimate",
        "gdp",
        eastern(2026, 10, 29),
        "critical",
        "bea",
    ),
    ScheduledEvent(
        "bea:gdp:2026-q3:second",
        "GDP — Q3 2026 Second Estimate",
        "gdp",
        eastern(2026, 11, 25),
        "high",
        "bea",
    ),
    ScheduledEvent(
        "bea:gdp:2026-q3:third",
        "GDP — Q3 2026 Third Estimate",
        "gdp",
        eastern(2026, 12, 23),
        "high",
        "bea",
    ),
    ScheduledEvent(
        "fed:fomc:2026-10",
        "FOMC meeting conclusion — October 2026",
        "fomc",
        None,
        "critical",
        "fed",
        date(2026, 10, 28),
    ),
    ScheduledEvent(
        "fed:fomc:2026-12",
        "FOMC meeting conclusion — December 2026",
        "fomc",
        None,
        "critical",
        "fed",
        date(2026, 12, 9),
    ),
)


async def seed_events(session: AsyncSession) -> tuple[int, int, int]:
    documents = {seed.key: await ensure_source_document(session, seed) for seed in SOURCES}
    assets = {
        asset.symbol: asset.id
        for asset in await session.scalars(
            select(Asset).where(Asset.symbol.in_(["BTC", "SPY", "QQQ"]))
        )
    }
    existing = set(await session.scalars(select(Event.external_key)))
    existing_links = set(
        (await session.execute(select(EventAsset.event_id, EventAsset.asset_id))).tuples()
    )
    existing_sources = set(
        (
            await session.execute(
                select(EventSourceReference.event_id, EventSourceReference.source_document_id)
            )
        ).tuples()
    )
    created = asset_links = source_links = 0
    for item in SCHEDULE:
        event_id = uuid5(NAMESPACE_URL, f"alpha-radar:event:{item.key}")
        document = documents[item.source_key]
        if item.key not in existing:
            source_name = next(seed.name for seed in SOURCES if seed.key == item.source_key)
            event = Event(
                id=event_id,
                external_key=item.key,
                title=item.title,
                event_type=item.event_type,
                status="scheduled",
                scheduled_date=item.scheduled_date,
                scheduled_at=item.local_time.astimezone(UTC) if item.local_time else None,
                scheduled_timezone="America/New_York",
                detected_at=DETECTED_AT,
                importance=item.importance,
                summary=(
                    f"FACT: The official {source_name} lists this scheduled release or meeting."
                ),
                why_it_matters=(
                    "ANALYSIS: This macro-policy event can materially change rate expectations "
                    "and risk-asset pricing."
                ),
                impact_analysis={
                    "fact": f"Scheduled by {source_name}",
                    "analysis": "Potential macro volatility catalyst",
                },
                bull_case=(
                    "SCENARIO: A benign surprise may support risk appetite; no outcome is assumed."
                ),
                bear_case=(
                    "SCENARIO: An adverse surprise may pressure risk assets; no outcome is assumed."
                ),
                watch_next=[
                    "Official release or policy statement",
                    "Market reaction after publication",
                ],
            )
            session.add(event)
            existing.add(item.key)
            created += 1
        for asset_id in assets.values():
            if (event_id, asset_id) not in existing_links:
                session.add(EventAsset(event_id=event_id, asset_id=asset_id))
                existing_links.add((event_id, asset_id))
                asset_links += 1
        if (event_id, document.id) not in existing_sources:
            session.add(EventSourceReference(event_id=event_id, source_document_id=document.id))
            existing_sources.add((event_id, document.id))
            source_links += 1
    await session.commit()
    return created, asset_links, source_links


async def ensure_source_document(session: AsyncSession, seed: SourceSeed) -> SourceDocument:
    source = await session.scalar(select(Source).where(Source.slug == seed.slug))
    if source is None:
        source = Source(
            id=uuid5(NAMESPACE_URL, f"alpha-radar:source:{seed.slug}"),
            slug=seed.slug,
            name=seed.name,
            source_type=seed.source_type,
            source_tier="primary",
            provider=seed.provider,
            base_url=seed.base_url,
            language="en",
            license_class="metadata_only",
            metadata_={"agency": seed.name},
        )
        session.add(source)
        await session.flush()
    document = await session.scalar(
        select(SourceDocument).where(
            SourceDocument.source_id == source.id,
            SourceDocument.canonical_url == seed.schedule_url,
        )
    )
    digest = hashlib.sha256(seed.schedule_url.encode()).hexdigest()
    if document is None:
        document = SourceDocument(
            id=uuid5(NAMESPACE_URL, f"alpha-radar:document:{seed.key}:2026-calendar"),
            source_id=source.id,
            external_id=f"{seed.key}-release-calendar-2026",
            canonical_url=seed.schedule_url,
            document_type="release_calendar",
            title=seed.title,
            language="en",
            first_observed_at=DETECTED_AT,
            last_observed_at=DETECTED_AT,
            first_fetched_at=DETECTED_AT,
            last_fetched_at=DETECTED_AT,
            ingested_at=DETECTED_AT,
            current_content_hash=digest,
            metadata_={"official_timezone": "America/New_York", "retrieval": "verified_schedule"},
        )
        session.add(document)
        await session.flush()
        session.add(
            SourceDocumentVersion(
                id=uuid5(
                    NAMESPACE_URL,
                    f"alpha-radar:document-version:{seed.key}:2026-calendar:1",
                ),
                source_document_id=document.id,
                version_number=1,
                content_hash=digest,
                title=document.title,
                observed_at=DETECTED_AT,
                fetched_at=DETECTED_AT,
                ingested_at=DETECTED_AT,
                is_current=True,
                metadata_={"canonical_url": seed.schedule_url},
            )
        )
    return document


async def main() -> None:
    async with async_session_factory() as session:
        print(await seed_events(session))


if __name__ == "__main__":
    asyncio.run(main())
