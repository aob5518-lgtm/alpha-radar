from dataclasses import dataclass
from typing import Literal

from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine


@dataclass(frozen=True)
class DependencyStatus:
    database: bool
    redis: bool

    @property
    def ready(self) -> bool:
        return self.database and self.redis


async def check_database(engine: AsyncEngine) -> bool:
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def check_redis(client: Redis) -> bool:
    try:
        return bool(await client.ping())  # pyright: ignore[reportUnknownMemberType]
    except Exception:
        return False


async def get_dependency_status(engine: AsyncEngine, client: Redis) -> DependencyStatus:
    database = await check_database(engine)
    redis = await check_redis(client)
    return DependencyStatus(database=database, redis=redis)


def readiness_label(status: DependencyStatus) -> Literal["ok", "not_ready"]:
    return "ok" if status.ready else "not_ready"
