from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from alpha_radar.api.router import api_router
from alpha_radar.config import get_settings
from alpha_radar.db.session import engine
from alpha_radar.errors import register_error_handlers
from alpha_radar.logging import configure_logging
from alpha_radar.middleware import request_logging_middleware

settings = get_settings()
configure_logging(settings.log_level)
logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await logger.ainfo("application_started", environment=settings.app_env)
    yield
    await engine.dispose()
    await logger.ainfo("application_stopped")


def create_app() -> FastAPI:
    application = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
    application.middleware("http")(request_logging_middleware)
    register_error_handlers(application)
    application.include_router(api_router)
    return application


app = create_app()
