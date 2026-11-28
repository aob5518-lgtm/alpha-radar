from datetime import UTC, datetime
from hashlib import sha256
from secrets import compare_digest
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import text

from alpha_radar.api.v1.event_semi_auto import Database, PrivateRoute, bearer
from alpha_radar.config import get_settings
from alpha_radar.event_semi_auto.mac_observe import Observation, observe
from alpha_radar.event_semi_auto.repository import Repository
from alpha_radar.event_semi_auto.service import problem


def device(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> None:
    settings = get_settings()
    fingerprint = settings.mac_executor_device_token_sha256.get_secret_value()
    if (
        not settings.mac_executor_observe_enabled
        or not settings.event_semi_auto_available
        or not settings.event_signal_shadow_enabled
        or len(fingerprint) != 64
    ):
        raise problem("mac_observation_unavailable", status=404)
    token = credentials.credentials if credentials else ""
    if (
        len(token) != 64
        or any(char not in "0123456789abcdef" for char in token)
        or not compare_digest(fingerprint, sha256(token.encode()).hexdigest())
    ):
        raise problem("mac_device_required", status=401)


router = APIRouter(
    prefix="/event-semi-auto/mac-executor",
    tags=["mac-executor"],
    dependencies=[Depends(device)],
    route_class=PrivateRoute,
)


@router.get("/observation", response_model=Observation)
async def read_observation(db: Database) -> Observation:
    await db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
    return await observe(Repository(db), datetime.now(UTC))
