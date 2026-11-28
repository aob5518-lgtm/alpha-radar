import asyncio

from alpha_radar.config import get_settings
from alpha_radar.db.session import async_session_factory, engine
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
    return asyncio.run(run_tick())
