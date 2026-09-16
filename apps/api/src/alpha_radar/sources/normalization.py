import hashlib
import json
import re
from html import unescape
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from alpha_radar.sources.schemas import FetchedSourceDocument


def canonical_url(value: str) -> str:
    url = urlsplit(value.strip())
    if (
        url.scheme.lower() not in {"http", "https"}
        or not url.hostname
        or url.username
        or url.password
    ):
        raise ValueError("Expected a public HTTP(S) URL without credentials")
    host = url.hostname.lower()
    port = url.port
    if port and not (
        url.scheme.lower() == "https" and port == 443 or url.scheme.lower() == "http" and port == 80
    ):
        host += f":{port}"
    query = [
        (k, v)
        for k, v in parse_qsl(url.query, keep_blank_values=True)
        if not k.lower().startswith("utm_") and k.lower() not in {"fbclid", "gclid"}
    ]
    return urlunsplit((url.scheme.lower(), host, url.path or "/", urlencode(sorted(query)), ""))


def plain_text(value: str) -> str:
    return " ".join(unescape(re.sub(r"<[^>]*>", " ", value)).split())


def content_hash(document: FetchedSourceDocument) -> str:
    # Retrieval timestamps/URLs are provenance, not revision content. Includes metadata
    # and provider excerpts transiently even when storage policy strips them.
    payload = document.model_dump(
        mode="json", exclude={"observed_at", "fetched_at", "canonical_url", "external_id"}
    )
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()
