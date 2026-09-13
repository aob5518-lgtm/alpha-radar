from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine

from alpha_radar.config import get_settings
from alpha_radar.db.session import engine
from alpha_radar.health import get_dependency_status, readiness_label

router = APIRouter(prefix="/health", tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class ReadinessChecks(BaseModel):
    database: bool
    redis: bool


class ReadinessResponse(BaseModel):
    status: Literal["ok", "not_ready"]
    checks: ReadinessChecks


def get_engine() -> AsyncEngine:
    return engine


def get_redis_client() -> Redis:
    return Redis.from_url(get_settings().redis_url)  # pyright: ignore[reportUnknownMemberType]


@router.get("", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@router.get("/ready", response_model=ReadinessResponse)
async def readiness(
    response: Response,
    database_engine: Annotated[AsyncEngine, Depends(get_engine)],
    redis_client: Annotated[Redis, Depends(get_redis_client)],
) -> ReadinessResponse:
    try:
        dependency_status = await get_dependency_status(database_engine, redis_client)
    finally:
        await redis_client.aclose()
    if not dependency_status.ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadinessResponse(
        status=readiness_label(dependency_status),
        checks=ReadinessChecks(
            database=dependency_status.database,
            redis=dependency_status.redis,
        ),
    )
