from collections.abc import Callable, Coroutine
from datetime import UTC, datetime
from secrets import compare_digest
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.config import get_settings
from alpha_radar.db.session import get_db_session
from alpha_radar.errors import AppError, app_error_handler
from alpha_radar.event_semi_auto.repository import Repository
from alpha_radar.event_semi_auto.schemas import (
    BetView,
    Confirm,
    Control,
    IntentAction,
    IntentView,
    Settle,
    State,
)
from alpha_radar.event_semi_auto.service import confirm, control, decide, problem, settle
from alpha_radar.event_semi_auto.views import intent_view, read_state

bearer = HTTPBearer(auto_error=False)


def operator(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> None:
    settings = get_settings()
    if not settings.event_semi_auto_available or not settings.event_signal_shadow_enabled:
        raise problem("semi_auto_unavailable", status=404)
    secret = settings.event_semi_auto_operator_token.get_secret_value()
    if (
        len(secret) < 32
        or not credentials
        or not compare_digest(secret.encode(), credentials.credentials.encode())
    ):
        raise problem("operator_required", status=401)


class PrivateRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[object, object, Response]]:
        handler = super().get_route_handler()

        async def private(request: Request) -> Response:
            try:
                response = await handler(request)
            except RequestValidationError:
                response = await app_error_handler(request, problem("invalid_request", status=422))
            except AppError as error:
                response = await app_error_handler(request, error)
            response.headers["Cache-Control"] = "private, no-store"
            return response

        return private


router = APIRouter(
    prefix="/event-semi-auto",
    tags=["event-semi-auto"],
    dependencies=[Depends(operator)],
    route_class=PrivateRoute,
)
Database = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("", response_model=State)
async def read(
    db: Database,
    response: Response,
    intent_before: UUID | None = None,
    bet_before: UUID | None = None,
) -> State:
    response.headers["Cache-Control"] = "private, no-store"
    await db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
    return await read_state(Repository(db), datetime.now(UTC), intent_before, bet_before)


@router.patch("/settings", status_code=204)
async def update_settings(payload: Control, db: Database) -> None:
    await control(Repository(db), payload)


@router.post("/intents/{intent_id}/decision", response_model=IntentView)
async def decision(intent_id: UUID, payload: IntentAction, db: Database) -> IntentView:
    repo = Repository(db)
    return await intent_view(repo, await decide(repo, intent_id, payload), datetime.now(UTC))


@router.post("/intents/{intent_id}/confirm", response_model=BetView)
async def confirm_record(intent_id: UUID, payload: Confirm, db: Database) -> BetView:
    return BetView.model_validate(await confirm(Repository(db), intent_id, payload))


@router.post("/bets/{bet_id}/settle", response_model=BetView)
async def settle_record(bet_id: UUID, payload: Settle, db: Database) -> BetView:
    return BetView.model_validate(await settle(Repository(db), bet_id, payload))
