"""Read-only production readiness report; exits non-zero when required modes are unsafe."""

import json
import os
from urllib.error import HTTPError
from urllib.request import urlopen


def get_json(url: str) -> tuple[int, dict[str, object]]:
    try:
        with urlopen(url, timeout=15) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def main() -> None:
    api_url = os.environ.get("API_URL", "http://localhost:8000").rstrip("/")
    web_url = os.environ.get("WEB_URL", "http://localhost:3000").rstrip("/")
    ready_status, ready = get_json(f"{api_url}/api/v1/health/ready")
    ai_status, ai = get_json(f"{web_url}/api/analyst")
    operations = ready.get("operations", {})
    report = {
        "readiness_http_status": ready_status,
        "market_provider": operations.get("market", {}).get("provider"),
        "market_ingestion_enabled": operations.get("market", {}).get(
            "ingestion_enabled"
        ),
        "market_history_latest": operations.get("market", {}).get("history_latest"),
        "market_history_current": operations.get("market", {}).get("history_current"),
        "event_sync": operations.get("event_sync"),
        "ai_configured": ai.get("ai_configured") if ai_status == 200 else False,
        "ai_rate_limiter": ai.get("rate_limiter")
        if ai_status == 200
        else "unavailable",
        "ai_rate_limiter_status": (
            ai.get("rate_limiter_status") if ai_status == 200 else "unavailable"
        ),
        "streaming_enabled": operations.get("streaming_enabled"),
    }
    print(json.dumps(report, indent=2, sort_keys=True))
    if ready_status != 200 or ready.get("status") != "ok":
        raise SystemExit("Production readiness failed")
    if not report["ai_rate_limiter"] == "redis":
        raise SystemExit("AI Redis rate limiter is unavailable")
    if report["ai_rate_limiter_status"] != "ready":
        raise SystemExit("AI Redis rate limiter is not ready")


if __name__ == "__main__":
    main()
