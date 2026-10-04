from __future__ import annotations

import asyncio

from redis.asyncio import Redis

from alpha_radar.config import get_settings
from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.events.crypto import (
    CryptoEventIngestionService,
    OfficialCryptoFeedAdapter,
    OpenAICryptoEventClassifier,
)
from alpha_radar.events.sync import (
    EventSyncService,
    OfficialCalendarAdapter,
    OfficialRssEventAdapter,
    official_feed_definitions,
    record_sync_success,
)
from alpha_radar.sources.transport import RedisRequestGate, SourceTransport
from alpha_radar.worker import app


async def _sync_official_events() -> int:
    settings = get_settings()
    if not settings.event_sync_enabled:
        return 0
    identity = settings.source_contact_identity.strip()
    if "@" not in identity or any(character in identity for character in "\r\n"):
        raise ValueError("Configure a valid organization/contact identity for Event sync")
    gate = RedisRequestGate(
        settings.redis_url,
        "official-events",
        min(settings.fed_requests_per_second, 1),
        settings.source_minimum_interval_seconds,
    )
    transport = SourceTransport(
        gate,
        f"AlphaRadar/0.1 {identity}",
        settings.source_http_timeout_seconds,
    )
    release_updates = await OfficialRssEventAdapter(
        transport, official_feed_definitions()
    ).fetch_updates()
    schedule_updates = await OfficialCalendarAdapter(transport).fetch_updates()
    updates = [*schedule_updates, *release_updates]
    updated = 0
    try:
        async with async_session_factory() as session:
            service = EventSyncService(session)
            for update in updates:
                updated += int(await service.apply(update))
        async with Redis.from_url(settings.redis_url) as client:  # pyright: ignore[reportUnknownMemberType]
            await record_sync_success(client, updated, len(updates))
        return updated
    finally:
        await engine.dispose()


@app.task(  # pyright: ignore[reportUnknownMemberType, reportUntypedFunctionDecorator]
    name="alpha_radar.events.sync_official_events"
)
def sync_official_events() -> int:
    return asyncio.run(_sync_official_events())


async def _sync_crypto_events() -> int:
    settings = get_settings()
    if not settings.crypto_event_sync_enabled:
        return 0
    if not settings.crypto_event_feeds:
        return 0
    identity = settings.source_contact_identity.strip()
    if "@" not in identity or any(character in identity for character in "\r\n"):
        raise ValueError("Configure a valid organization/contact identity for Crypto Event sync")
    gate = RedisRequestGate(
        settings.redis_url,
        "crypto-official-events",
        min(settings.fed_requests_per_second, 1),
        settings.source_minimum_interval_seconds,
    )
    transport = SourceTransport(
        gate,
        f"AlphaRadar/0.1 {identity}",
        settings.source_http_timeout_seconds,
    )
    ingested = 0
    try:
        async with async_session_factory() as session:
            classifier = (
                OpenAICryptoEventClassifier(
                    model=settings.ai_model,
                    api_key=settings.openai_api_key,
                    base_url=settings.openai_base_url,
                ).classify
                if settings.ai_provider == "openai"
                and settings.ai_model
                and settings.openai_api_key
                else None
            )
            service = CryptoEventIngestionService(session, classifier)
            for feed in settings.crypto_event_feeds:
                candidates = await OfficialCryptoFeedAdapter(transport, feed).fetch()
                for candidate in candidates:
                    ingested += int(await service.ingest(candidate))
        return ingested
    finally:
        await engine.dispose()


@app.task(  # pyright: ignore[reportUnknownMemberType, reportUntypedFunctionDecorator]
    name="alpha_radar.events.sync_crypto_events"
)
def sync_crypto_events() -> int:
    return asyncio.run(_sync_crypto_events())
