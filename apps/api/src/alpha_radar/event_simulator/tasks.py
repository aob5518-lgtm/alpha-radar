import asyncio
from datetime import UTC, datetime

import structlog
from redis.asyncio import Redis

from alpha_radar.config import get_settings
from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.event_simulator.service import process_tick
from alpha_radar.event_simulator.views import LAST_TICK_KEY
from alpha_radar.worker import app

logger = structlog.get_logger(__name__)


async def sync_simulation() -> dict[str, int]:
    settings = get_settings()
    if not settings.event_simulator_enabled or not settings.event_signal_shadow_enabled:
        return {}
    try:
        async with async_session_factory() as session:
            result = await process_tick(session)
        async with Redis.from_url(settings.redis_url, socket_timeout=1) as redis:  # pyright: ignore[reportUnknownMemberType]
            await redis.set(LAST_TICK_KEY, datetime.now(UTC).isoformat(), ex=180)
        if any(result.values()):
            await logger.ainfo("event_paper_simulation_tick", **result)
        return result
    finally:
        await engine.dispose()


@app.task(name="alpha_radar.event_simulator.tick", soft_time_limit=12, time_limit=16)  # pyright: ignore[reportUnknownMemberType, reportUntypedFunctionDecorator]
def simulation_task() -> dict[str, int]:
    return asyncio.run(sync_simulation())
