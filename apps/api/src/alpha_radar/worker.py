from celery import Celery
from celery.schedules import crontab

from alpha_radar.config import get_settings
from alpha_radar.logging import configure_logging

settings = get_settings()
configure_logging(settings.log_level)

app = Celery(
    "alpha_radar",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)
app.conf.update(  # pyright: ignore[reportUnknownMemberType]
    imports=(
        "alpha_radar.events.tasks",
        "alpha_radar.market_data.tasks",
        "alpha_radar.sources.tasks",
    ),
    accept_content=["json"],
    task_serializer="json",
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    beat_schedule={
        "market-data-quotes-every-45-seconds": {
            "task": "alpha_radar.market_data.fetch_quotes",
            "schedule": 45.0,
        },
        "market-data-candles-1m": {
            "task": "alpha_radar.market_data.fetch_candles",
            "schedule": crontab(minute="*"),
            "args": ["1m", 3],
        },
        "market-data-candles-5m": {
            "task": "alpha_radar.market_data.fetch_candles",
            "schedule": crontab(minute="*/5"),
            "args": ["5m", 3],
        },
        "market-data-candles-15m": {
            "task": "alpha_radar.market_data.fetch_candles",
            "schedule": crontab(minute="*/15"),
            "args": ["15m", 3],
        },
        "market-data-candles-1h": {
            "task": "alpha_radar.market_data.fetch_candles",
            "schedule": crontab(minute=2),
            "args": ["1h", 3],
        },
        "market-data-candles-4h": {
            "task": "alpha_radar.market_data.fetch_candles",
            "schedule": crontab(minute=3, hour="*/4"),
            "args": ["4h", 3],
        },
        "market-data-candles-1d": {
            "task": "alpha_radar.market_data.fetch_candles",
            "schedule": crontab(minute=5, hour=0),
            "args": ["1d", 3],
        },
        "market-data-candles-1w": {
            "task": "alpha_radar.market_data.fetch_candles",
            "schedule": crontab(minute=10, hour=0, day_of_week=1),
            "args": ["1w", 3],
        },
    },
)

if settings.source_ingestion_enabled:
    for slug, enabled in (
        ("sec", settings.sec_source_enabled),
        ("federal-reserve", settings.fed_source_enabled),
    ):
        if enabled:
            app.conf.beat_schedule[f"source-{slug}"] = {  # pyright: ignore[reportUnknownMemberType]
                "task": "alpha_radar.sources.ingest_source_recent",
                "schedule": float(settings.source_poll_interval_seconds),
                "args": [slug],
            }

if settings.event_sync_enabled:
    app.conf.beat_schedule["official-event-sync"] = {  # pyright: ignore[reportUnknownMemberType]
        "task": "alpha_radar.events.sync_official_events",
        "schedule": float(settings.event_sync_interval_seconds),
    }

if settings.crypto_event_sync_enabled and (
    settings.crypto_event_feeds or settings.crypto_event_official_sources
):
    app.conf.beat_schedule["crypto-event-sync"] = {  # pyright: ignore[reportUnknownMemberType]
        "task": "alpha_radar.events.sync_crypto_events",
        "schedule": float(settings.crypto_event_poll_interval_seconds),
    }
