"""Read-only bilingual Source Intelligence SSR verification."""

import os
from html.parser import HTMLParser
from urllib.request import Request, urlopen


class Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.parts: list[str] = []
        self.hidden = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.hidden = True
        identity = dict(attrs).get("id")
        if identity:
            self.ids.append(identity)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"}:
            self.hidden = False

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)

    @property
    def text(self) -> str:
        return " ".join(" ".join(self.parts).split())


def fetch(locale: str) -> Page:
    base = os.environ.get("WEB_URL", "http://localhost:3000").rstrip("/")
    request = Request(
        base + "/radar/sources?source=mock-source",
        headers={"Cookie": f"alpha_radar_locale={locale}"},
    )
    with urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"Source UI returned HTTP {response.status}")
        page = Page()
        page.feed(response.read().decode())
        return page


english = fetch("en")
chinese = fetch("zh-CN")
for page in (english, chinese):
    if len(page.ids) != len(set(page.ids)):
        raise RuntimeError("Source UI contains duplicate HTML IDs")
    if "Sample source document revision 2" not in page.text:
        raise RuntimeError("Current persisted source revision is not rendered")

if (
    "Source Document" not in english.text
    or "Not yet analyzed into Event" not in english.text
):
    raise RuntimeError("English source/Event boundary is missing")
if "来源文档" not in chinese.text or "尚未分析为事件" not in chinese.text:
    raise RuntimeError("Chinese source/Event boundary is missing")

print("Bilingual persisted Source Intelligence SSR verification passed.")
