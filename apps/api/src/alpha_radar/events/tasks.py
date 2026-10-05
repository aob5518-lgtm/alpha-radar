from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Protocol

import structlog
from redis.asyncio import Redis

from alpha_radar.config import get_settings
from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.events.crypto import (
    CryptoEventCandidate,
    CryptoEventIngestionService,
    OfficialCryptoFeedAdapter,
    OfficialCryptoSourceAdapter,
    OpenAICryptoEventClassifier,
    official_crypto_source_adapters,
)
from alpha_radar.events.operations import (
    CryptoSyncRun,
    SocialSyncRun,
    record_crypto_sync_run,
    record_social_sync_run,
)
from alpha_radar.events.social import (
    SocialAccount,
    SocialProvider,
    XSocialProvider,
    configured_social_accounts,
    social_monitoring_enabled,
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

logger = structlog.get_logger(__name__)


class CryptoEventIngestor(Protocol):
    async def ingest(self, candidate: CryptoEventCandidate) -> bool: ...


def official_event_user_agent(contact_identity: str) -> str:
    identity = contact_identity.strip()
    if not _valid_contact_identity(identity):
        raise ValueError("Configure a valid organization/contact identity for Event sync")
    return f"AlphaRadar/0.1 {identity}"


def crypto_event_user_agent(contact_identity: str) -> str:
    identity = contact_identity.strip()
    return f"AlphaRadar/0.1 {identity}" if _valid_contact_identity(identity) else "AlphaRadar/0.1"


def _valid_contact_identity(identity: str) -> bool:
    return "@" in identity and not any(character in identity for character in "\r\n")


async def _sync_official_events() -> int:
    settings = get_settings()
    if not settings.event_sync_enabled:
        return 0
    user_agent = official_event_user_agent(settings.source_contact_identity)
    gate = RedisRequestGate(
        settings.redis_url,
        "official-events",
        min(settings.fed_requests_per_second, 1),
        settings.source_minimum_interval_seconds,
    )
    transport = SourceTransport(
        gate,
        user_agent,
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
    official_enabled = bool(settings.crypto_event_feeds or settings.crypto_event_official_sources)
    social_enabled = social_monitoring_enabled(settings)
    if not official_enabled and not social_enabled:
        return 0
    user_agent = crypto_event_user_agent(settings.source_contact_identity)

    def source_transport(source_slug: str) -> SourceTransport:
        return SourceTransport(
            RedisRequestGate(
                settings.redis_url,
                f"crypto-official-events:{source_slug}",
                min(settings.fed_requests_per_second, 1),
                settings.source_minimum_interval_seconds,
            ),
            user_agent,
            settings.source_http_timeout_seconds,
        )

    def classifier() -> OpenAICryptoEventClassifier | None:
        if settings.ai_provider == "openai" and settings.ai_model and settings.openai_api_key:
            return OpenAICryptoEventClassifier(
                model=settings.ai_model,
                api_key=settings.openai_api_key,
                base_url=settings.openai_base_url,
            )
        return None

    events_ingested = 0
    try:
        if official_enabled:
            async with async_session_factory() as session:
                event_classifier = classifier()
                service = CryptoEventIngestionService(
                    session, event_classifier.classify if event_classifier else None
                )
                adapters: list[OfficialCryptoSourceAdapter] = [
                    OfficialCryptoFeedAdapter(source_transport(feed.slug), feed)
                    for feed in settings.crypto_event_feeds
                ]
                for source_key in dict.fromkeys(settings.crypto_event_official_sources):
                    adapters.extend(
                        official_crypto_source_adapters(
                            source_transport(source_key),
                            [source_key],
                            github_token=settings.github_token,
                        )
                    )
                run = await sync_crypto_source_adapters(adapters, service, session.rollback)
            async with Redis.from_url(settings.redis_url) as client:  # pyright: ignore[reportUnknownMemberType]
                await record_crypto_sync_run(client, run)
            events_ingested += run.events_ingested

        if social_enabled:
            social_transport = SourceTransport(
                RedisRequestGate(
                    settings.redis_url,
                    "crypto-social:x",
                    1,
                    settings.source_minimum_interval_seconds,
                ),
                user_agent,
                settings.source_http_timeout_seconds,
            )
            provider = XSocialProvider(social_transport, settings.x_bearer_token)
            accounts = configured_social_accounts(settings.crypto_social_accounts)
            async with async_session_factory() as session:
                event_classifier = classifier()
                service = CryptoEventIngestionService(
                    session, event_classifier.classify if event_classifier else None
                )
                social_run = await sync_social_accounts(
                    provider,
                    accounts,
                    service,
                    session.rollback,
                    limit=settings.crypto_social_recent_limit,
                )
            async with Redis.from_url(settings.redis_url) as client:  # pyright: ignore[reportUnknownMemberType]
                await record_social_sync_run(client, social_run)
            events_ingested += social_run.events_created
        return events_ingested
    finally:
        await engine.dispose()


async def sync_crypto_source_adapters(
    adapters: list[OfficialCryptoSourceAdapter],
    service: CryptoEventIngestor,
    rollback: Callable[[], Awaitable[None]],
) -> CryptoSyncRun:
    attempted: list[str] = []
    succeeded: list[str] = []
    failed: list[str] = []
    events_ingested = 0
    for adapter in adapters:
        source_slug = adapter.source_slug
        attempted.append(source_slug)
        try:
            candidates = await adapter.fetch()
            for candidate in candidates:
                events_ingested += int(await service.ingest(candidate))
        except Exception as error:
            await rollback()
            failed.append(source_slug)
            await logger.aerror(
                "crypto_event_source_sync_failed",
                source_slug=source_slug,
                error_type=getattr(error, "kind", type(error).__name__),
                timestamp=datetime.now(UTC).isoformat(),
            )
            continue
        succeeded.append(source_slug)
        await logger.ainfo(
            "crypto_event_source_sync_succeeded",
            source_slug=source_slug,
            timestamp=datetime.now(UTC).isoformat(),
        )
    return CryptoSyncRun.from_results(
        attempted=attempted,
        succeeded=succeeded,
        failed=failed,
        events_ingested=events_ingested,
    )


async def sync_social_accounts(
    provider: SocialProvider,
    accounts: list[SocialAccount],
    service: CryptoEventIngestor,
    rollback: Callable[[], Awaitable[None]],
    *,
    limit: int,
) -> SocialSyncRun:
    attempted: list[str] = []
    succeeded: list[str] = []
    failed: list[str] = []
    posts_inspected = 0
    events_created = 0
    for account in accounts:
        attempted.append(account.key)
        try:
            candidates = await provider.fetch_account(account, limit=limit)
            posts_inspected += len(candidates)
            for candidate in candidates:
                events_created += int(await service.ingest(candidate))
        except Exception as error:
            await rollback()
            failed.append(account.key)
            await logger.aerror(
                "crypto_social_account_sync_failed",
                provider=provider.provider_name,
                account_key=account.key,
                error_type=getattr(error, "kind", type(error).__name__),
                timestamp=datetime.now(UTC).isoformat(),
            )
            continue
        succeeded.append(account.key)
        await logger.ainfo(
            "crypto_social_account_sync_succeeded",
            provider=provider.provider_name,
            account_key=account.key,
            timestamp=datetime.now(UTC).isoformat(),
        )
    return SocialSyncRun.from_results(
        attempted=attempted,
        succeeded=succeeded,
        failed=failed,
        posts_inspected=posts_inspected,
        events_created=events_created,
    )


@app.task(  # pyright: ignore[reportUnknownMemberType, reportUntypedFunctionDecorator]
    name="alpha_radar.events.sync_crypto_events"
)
def sync_crypto_events() -> int:
    return asyncio.run(_sync_crypto_events())
