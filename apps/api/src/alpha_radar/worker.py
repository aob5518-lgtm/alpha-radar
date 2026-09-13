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
    accept_content=["json"],
    task_serializer="json",
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
)
