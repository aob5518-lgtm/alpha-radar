from fastapi import APIRouter

from alpha_radar.api.v1.assets import router as assets_router
from alpha_radar.api.v1.event_alerts import router as event_alerts_router
from alpha_radar.api.v1.event_contracts import router as event_contracts_router
from alpha_radar.api.v1.event_semi_auto import router as event_semi_auto_router
from alpha_radar.api.v1.event_simulator import router as event_simulator_router
from alpha_radar.api.v1.events import router as events_router
from alpha_radar.api.v1.health import router as health_router
from alpha_radar.api.v1.mac_executor import router as mac_executor_router
from alpha_radar.api.v1.market_data import instruments_router
from alpha_radar.api.v1.market_data import router as market_data_router
from alpha_radar.api.v1.sources import router as sources_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health_router)
api_router.include_router(assets_router)
api_router.include_router(event_contracts_router)
api_router.include_router(event_simulator_router)
api_router.include_router(event_semi_auto_router)
api_router.include_router(event_alerts_router)
api_router.include_router(mac_executor_router)
api_router.include_router(events_router)
api_router.include_router(market_data_router)
api_router.include_router(instruments_router)
api_router.include_router(sources_router)
