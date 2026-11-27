"""Verify the bilingual paper deployment and its read-only public contract."""

import json
import os
from decimal import Decimal
from urllib.error import HTTPError
from urllib.request import Request, urlopen

base = os.environ.get("WEB_URL", "http://localhost:3000").rstrip("/")
for locale, headline, badge in (
    ("en", "Event Contracts · Automated Paper Betting", "PAPER MODE"),
    ("zh-CN", "事件合约 · 模拟自动下注", "模拟模式"),
):
    page = Request(base + "/event-contracts", headers={"Cookie": f"alpha_radar_locale={locale}"})
    with urlopen(page, timeout=20) as response:
        source = response.read().decode()
        assert headline in source and badge in source and "Binance Index" in source
        assert 'href="/event-contracts"' in source
        assert all(f'href="{route}"' in source for route in ("/events", "/chart", "/analyst"))

path = base + "/api/v1/event-simulator"
with urlopen(path, timeout=15) as response:
    state = json.load(response)
    assert response.status == 200 and "no-store" in response.headers["Cache-Control"]
assert {(signal["symbol"], signal["horizon_minutes"]) for signal in state["signals"]} == {
    ("BTCUSDT", 10), ("BTCUSDT", 30), ("ETHUSDT", 10), ("ETHUSDT", 30),
}
assert Decimal(state["defaults"]["starting_bankroll"]) == 10000
assert Decimal(state["defaults"]["payout_10m"]) == Decimal("1.80")
assert state["defaults"]["allow_regular_signals"] is False
for method in ("POST", "PATCH"):
    request = Request(path, method=method, data=b"{}", headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=10):
            raise AssertionError("Unauthenticated change was allowed")
    except HTTPError as exc:
        assert exc.code == 401, exc.code
print("Bilingual simulator route, protected controls, and four live card identities verified.")
