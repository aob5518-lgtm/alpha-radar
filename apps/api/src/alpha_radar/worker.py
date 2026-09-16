from celery import Celery

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
    imports=("alpha_radar.market_data.tasks", "alpha_radar.sources.tasks"),
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
        "market-data-one-minute-candles": {
            "task": "alpha_radar.market_data.fetch_candles",
            "schedule": 60.0,
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
