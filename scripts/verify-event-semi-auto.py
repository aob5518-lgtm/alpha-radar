"""Read-only smoke test of the private production route and disabled defaults."""

import json
import os
from decimal import Decimal
from urllib.error import HTTPError
from urllib.request import Request, urlopen

base = os.environ.get("WEB_URL", "http://127.0.0.1:3000").rstrip("/")
path = base + "/api/v1/event-semi-auto"
token = os.environ["EVENT_SEMI_AUTO_OPERATOR_TOKEN"]

for method, target in (("GET", path), ("PATCH", path + "/settings")):
    request = Request(target, method=method, headers={"Content-Type": "application/json"},
                      data=b"{}" if method == "PATCH" else None)
    try:
        with urlopen(request, timeout=20):
            raise AssertionError("Operator authorization was bypassed.")
    except HTTPError as exc:
        assert exc.code == 401, exc.code
        assert "no-store" in exc.headers["Cache-Control"]

request = Request(path, headers={"Authorization": "Bearer " + token})
with urlopen(request, timeout=20) as response:
    state = json.load(response)
    assert "no-store" in response.headers["Cache-Control"]
assert state["enabled"] is False and state["acknowledged"] is False
assert state["live_execution_enabled"] is False
health = {adapter["adapter"]: adapter for adapter in state["execution_adapters"]}
assert set(health) == {"MANUAL", "MOBILE_HANDOFF", "RESEARCH_DISABLED"}
assert health["MANUAL"]["healthy"] and health["MOBILE_HANDOFF"]["healthy"]
assert not health["RESEARCH_DISABLED"]["available"]
assert not state["intents"] and not state["active"] and not state["history"]
assert state["real"]["bets"] == 0
settings = state["settings"]
assert settings["markets"] == ["BTCUSDT", "ETHUSDT"] and settings["horizons"] == [10, 30]
assert settings["minimum_score"] == 85 and Decimal(settings["max_drift_atr"]) == Decimal(".25")
assert Decimal(settings["minimum_payout_10m"]) == Decimal("1.80")
assert Decimal(settings["minimum_payout_30m"]) == Decimal("1.80")
assert Decimal(settings["fixed_stake"]) == 10 and Decimal(settings["max_stake"]) == 25
assert Decimal(settings["max_daily_loss"]) == 50
assert settings["max_active_real_bets"] == 1 and settings["max_consecutive_losses"] == 3
assert settings["cooldown_minutes"] == 120
assert len(state["signals"]) == 4

for locale, modes, paper_title in (
    ("en", ("Shadow", "Paper", "Semi-Auto"), "Event Contracts · Automated Paper Betting"),
    ("zh-CN", ("影子观察", "模拟下注", "半自动"), "事件合约 · 模拟自动下注"),
):
    with urlopen(Request(base + "/event-contracts", headers={
        "Cookie": f"alpha_radar_locale={locale}",
    }), timeout=20) as response:
        body = response.read().decode()
        assert paper_title in body and all(mode in body for mode in modes)
print("Bilingual Paper default, private ledger, four cards and disabled Semi-Auto defaults verified.")
