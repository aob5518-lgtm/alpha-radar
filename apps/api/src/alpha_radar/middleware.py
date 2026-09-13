from collections.abc import Awaitable, Callable
from time import perf_counter
from uuid import uuid4

import structlog
from fastapi import Request, Response
from structlog.contextvars import bind_contextvars, clear_contextvars

logger = structlog.get_logger(__name__)


async def request_logging_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    clear_contextvars()
    request_id = request.headers.get("x-request-id", str(uuid4()))
    bind_contextvars(request_id=request_id)
    started = perf_counter()
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    await logger.ainfo(
        "request_complete",
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
        duration_ms=round((perf_counter() - started) * 1000, 2),
    )
    return response
