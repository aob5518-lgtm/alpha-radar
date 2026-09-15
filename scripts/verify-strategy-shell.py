"""Read-only SSR verification against the Compose web app; no third-party dependencies."""

import os
from html.parser import HTMLParser
from urllib.request import Request, urlopen


class Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.links: list[str] = []
        self.parts: list[str] = []
        self.hidden = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.hidden = True
        values = dict(attrs)
        if identity := values.get("id"):
            self.ids.append(identity)
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


def fetch(path: str, locale: str) -> Page:
    base = os.environ.get("WEB_URL", "http://localhost:3000").rstrip("/")
    request = Request(base + path, headers={"Cookie": f"alpha_radar_locale={locale}"})
    with urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"{path}: HTTP {response.status}")
        page = Page()
        page.feed(response.read().decode("utf-8"))
    if len(page.ids) != len(set(page.ids)):
        raise RuntimeError(f"{path}: duplicate HTML IDs")
    return page


def require(page: Page, *values: str) -> None:
    for value in values:
        if value not in page.text:
            raise RuntimeError(f"Missing rendered strategy contract: {value}")


def verify(locale: str) -> None:
    demo = "Demo Data" if locale == "en" else "演示数据"
    distinctions = (
        ("FACT", "ANALYSIS", "SCENARIO", "MODEL OUTPUT", "COUNTERPOINT", "INVALIDATION")
        if locale == "en"
        else ("事实", "分析", "情景", "模型输出", "反方观点", "失效条件")
    )
    for path in (
        "/discover/themes",
        "/discover/opportunities",
        "/strategy",
        "/strategy/cycle",
        "/discover?project=demo-project-lantern",
    ):
        require(fetch(path, locale), demo, *distinctions)

    theme = fetch("/discover/themes?theme=demo-theme-stablecoins", locale)
    if theme.ids.count("demo-theme-stablecoins") != 1 or "demo-theme-rwa" in theme.ids:
        raise RuntimeError("Theme detail query did not select exactly one record")
    if "/discover/opportunities?theme=demo-theme-stablecoins" not in theme.links:
        raise RuntimeError("Missing Theme -> Opportunity link")

    opportunity = fetch(
        "/discover/opportunities?opportunity=demo-opportunity-custody", locale
    )
    if (
        "/strategy?playbook=demo-playbook-demo-opportunity-custody#playbooks"
        not in opportunity.links
    ):
        raise RuntimeError("Missing Opportunity -> Playbook link")

    playbook = fetch(
        "/strategy?playbook=demo-playbook-demo-opportunity-custody", locale
    )
    if "demo-playbook-demo-opportunity-settlement" in playbook.ids:
        raise RuntimeError("Playbook selection did not exclude the other playbook")
    require(
        playbook,
        *(
            ("Bull Case", "Base Case", "Bear Case", "Not observed / not measured")
            if locale == "en"
            else ("乐观情景", "基准情景", "悲观情景", "尚未观测 / 未测量")
        ),
    )
    require(
        fetch("/discover/opportunities?opportunity=unknown", locale),
        "No demo records match" if locale == "en" else "没有符合条件的演示记录",
    )
    catalyst = fetch("/strategy?catalyst=demo-catalyst-review", locale)
    require(catalyst, "2:00 PM" if locale == "en" else "14:00")
    asset = fetch("/assets/bitcoin", locale)
    require(
        asset,
        "mock",
        "USD",
        demo,
        "Persisted platform observations" if locale == "en" else "平台已持久化",
        "Related Demo Strategy Context" if locale == "en" else "相关演示策略背景",
    )


if __name__ == "__main__":
    for supported_locale in ("en", "zh-CN"):
        verify(supported_locale)
    print(
        "Strategy SSR routes, demo contracts, locale parity, deep links, UTC dates and persisted Asset Market verification passed."
    )
