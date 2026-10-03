"""Read-only bilingual Core 3 SSR and legacy-route verification."""

import json
import os
from html.parser import HTMLParser
from urllib.parse import urlparse
from urllib.request import Request, urlopen


class Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []
        self.parts: list[str] = []
        self.hidden = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.hidden = True
        values = dict(attrs)
        if tag == "a" and (href := values.get("href")):
            self.links.append(href)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"}:
            self.hidden = False

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)

    @property
    def text(self) -> str:
        return " ".join(" ".join(self.parts).split())


def fetch(path: str, locale: str = "en") -> tuple[Page, str]:
    base = os.environ.get("WEB_URL", "http://localhost:3000").rstrip("/")
    request = Request(base + path, headers={"Cookie": f"alpha_radar_locale={locale}"})
    with urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"{path}: HTTP {response.status}")
        page = Page()
        page.feed(response.read().decode("utf-8"))
        return page, urlparse(response.geturl()).path


def bitcoin_instrument_id() -> str:
    base = os.environ.get("API_URL", "http://localhost:8000").rstrip("/")
    with urlopen(
        f"{base}/api/v1/market-instruments?provider=bybit&instrument_type=perpetual",
        timeout=30,
    ) as response:
        payload = json.load(response)
    return next(
        item["id"]
        for item in payload["items"]
        if item["provider_instrument_id"] == "BTCUSDT"
    )


def require(page: Page, *values: str) -> None:
    for value in values:
        if value not in page.text:
            raise RuntimeError(f"Missing rendered Core 3 contract: {value}")


def verify_locale(locale: str, instrument_id: str) -> None:
    expected = (
        {
            "events": "Market-moving events",
            "chart_contract": ("BTCUSDT Perpetual", "Current price", "Timeframe"),
            "analyst": "AI Analyst",
            "event_columns": (
                "Importance",
                "Actual",
                "Forecast",
                "Previous",
                "Affected assets",
            ),
            "closed": "closed candles only",
            "disabled": "AI integration is not enabled",
        }
        if locale == "en"
        else {
            "events": "影响市场的事件",
            "chart_contract": ("BTCUSDT 永续", "当前价格", "周期"),
            "analyst": "AI 分析师",
            "event_columns": (
                "重要性",
                "实际值",
                "预测值",
                "前值",
                "受影响资产",
            ),
            "closed": "仅使用收盘 K 线",
            "disabled": "AI 集成尚未启用",
        }
    )
    events, _ = fetch("/events", locale)
    require(events, expected["events"], *expected["event_columns"])
    chart, _ = fetch(f"/chart?instrument={instrument_id}&interval=1h", locale)
    require(
        chart,
        *expected["chart_contract"],
        expected["closed"],
        "Bybit",
        "USDT",
    )
    analyst, _ = fetch(
        f"/analyst?instrument={instrument_id}&interval=1h&from=chart", locale
    )
    require(analyst, expected["analyst"], expected["disabled"], "BTCUSDT", "1h")
    for page in (events, chart, analyst):
        if "Demo Data" in page.text or "演示数据" in page.text:
            raise RuntimeError("Core 3 rendered archived demo intelligence")


def verify_redirects() -> None:
    destinations = {
        "/": "/events",
        "/radar": "/events",
        "/discover": "/events",
        "/discover/themes": "/events",
        "/strategy": "/analyst",
        "/strategy/cycle": "/analyst",
        "/watchlist": "/events",
        "/alerts": "/events",
        "/assets": "/chart",
    }
    for source, expected in destinations.items():
        _, final_path = fetch(source)
        if final_path != expected:
            raise RuntimeError(
                f"{source} redirected to {final_path}, expected {expected}"
            )
    _, source_path = fetch("/radar/sources?source=mock-source")
    if source_path != "/radar/sources":
        raise RuntimeError("Internal Source audit route was unexpectedly redirected")


if __name__ == "__main__":
    instrument_id = bitcoin_instrument_id()
    verify_locale("en", instrument_id)
    verify_locale("zh-CN", instrument_id)
    verify_redirects()
    print(
        "Core 3 bilingual SSR, persisted Chart, Analyst handoff and legacy redirects passed."
    )
