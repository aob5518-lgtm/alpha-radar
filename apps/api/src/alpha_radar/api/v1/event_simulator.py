from secrets import compare_digest
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.config import get_settings
from alpha_radar.db.session import get_db_session
from alpha_radar.errors import AppError
from alpha_radar.event_simulator.schemas import (
    ControlSimulation,
    NewSimulation,
    SessionSummary,
    SimulatorState,
)
from alpha_radar.event_simulator.service import control_run, new_run
from alpha_radar.event_simulator.views import state

router = APIRouter(prefix="/event-simulator", tags=["event-paper-simulator"])
bearer = HTTPBearer(auto_error=False)


def enabled() -> None:
    settings = get_settings()
    if not settings.event_simulator_enabled or not settings.event_signal_shadow_enabled:
        raise AppError(status_code=404, code="simulator_disabled", message="Simulator is disabled.")


def operator(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> None:
    enabled()
    secret = get_settings().event_simulator_admin_token.get_secret_value()
    if (
        len(secret) < 32
        or credentials is None
        or not compare_digest(credentials.credentials.encode(), secret.encode())
    ):
        raise AppError(
            status_code=401, code="simulator_admin_required", message="Operator token required."
        )


@router.get("", response_model=SimulatorState, dependencies=[Depends(enabled)])
async def read_simulation(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db_session)],
    session_id: UUID | None = None,
    before: UUID | None = None,
    sessions_before: UUID | None = None,
) -> SimulatorState:
    response.headers["Cache-Control"] = "no-store"
    await db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
    return await state(db, session_id, before, sessions_before)


@router.post("", response_model=SessionSummary, status_code=201, dependencies=[Depends(operator)])
async def create_simulation(
    payload: NewSimulation,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> SessionSummary:
    return SessionSummary.model_validate(
        await new_run(db, payload.settings, payload.current_session_id)
    )


@router.patch("", response_model=SessionSummary, dependencies=[Depends(operator)])
async def change_simulation(
    payload: ControlSimulation,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> SessionSummary:
    return SessionSummary.model_validate(
        await control_run(db, payload.session_id, running=payload.action == "start")
    )
