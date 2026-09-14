from fastapi import APIRouter

from alpha_radar.api.v1.assets import router as assets_router
from alpha_radar.api.v1.health import router as health_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health_router)
api_router.include_router(assets_router)
