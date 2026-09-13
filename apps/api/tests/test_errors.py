from fastapi import APIRouter
from fastapi.testclient import TestClient

from alpha_radar.errors import AppError
from alpha_radar.main import create_app


def test_app_error_uses_standard_envelope() -> None:
    application = create_app()
    router = APIRouter()

    async def failure() -> None:
        raise AppError("example_error", "Example failure", 409, {"field": "value"})

    router.add_api_route("/failure", failure, methods=["GET"])
    application.include_router(router)

    with TestClient(application) as client:
        response = client.get("/failure")

    assert response.status_code == 409
    assert response.json() == {
        "error": {
            "code": "example_error",
            "message": "Example failure",
            "details": {"field": "value"},
        }
    }
