import asyncio

import structlog

from alpha_radar.config import get_settings
from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.event_semi_auto.alert_tasks import TASK
from alpha_radar.event_semi_auto.alerts import alerts_enabled
from alpha_radar.event_semi_auto.push import public_key
from alpha_radar.event_semi_auto.repository import Repository
from alpha_radar.event_semi_auto.service import tick
from alpha_radar.worker import app


async def run_tick() -> dict[str, int]:
    try:
        async with async_session_factory() as db:
            return await tick(Repository(db))
    finally:
        await engine.dispose()


@app.task(name="alpha_radar.event_semi_auto.tick", soft_time_limit=8, time_limit=9)  # pyright: ignore[reportUnknownMemberType, reportUntypedFunctionDecorator]
def tick_task() -> dict[str, int]:
    settings = get_settings()
    if not settings.event_semi_auto_available or not settings.event_signal_shadow_enabled:
        return {"opened": 0, "blocked": 0}
    result = asyncio.run(run_tick())
    if result["opened"] and alerts_enabled() and public_key():
        try:
            app.send_task(TASK, expires=8, retry=False)  # pyright: ignore[reportUnknownMemberType]
        except Exception as error:
            structlog.get_logger().warning(
                "event_alert_enqueue_failed", error_type=type(error).__name__
            )
    return result
