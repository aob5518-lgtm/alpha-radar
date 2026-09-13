from typing import Any

import structlog
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = structlog.get_logger(__name__)


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Any | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


class AppError(Exception):
    def __init__(
        self, code: str, message: str, status_code: int, details: Any | None = None
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details


def _response(error: ErrorDetail, status_code: int) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=ErrorResponse(error=error).model_dump())


async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
    error = ErrorDetail(code=exc.code, message=exc.message, details=exc.details)
    return _response(error, exc.status_code)


async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    return _response(
        ErrorDetail(
            code="validation_error", message="Request validation failed", details=exc.errors()
        ),
        status.HTTP_422_UNPROCESSABLE_ENTITY,
    )


async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
    await logger.aexception("unhandled_exception", method=request.method, path=request.url.path)
    return _response(
        ErrorDetail(code="internal_error", message="An unexpected error occurred"),
        status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unexpected_error_handler)
