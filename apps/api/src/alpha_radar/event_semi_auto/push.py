import asyncio
import base64
import binascii
import json
import re
from datetime import UTC, datetime
from typing import Literal, cast

import http_ece  # pyright: ignore[reportUnknownVariableType]
import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import Vapid  # pyright: ignore[reportUnknownVariableType]

from alpha_radar.config import get_settings
from alpha_radar.event_semi_auto.alert_models import PushDevice

PushResult = Literal["accepted", "invalid", "retry", "failed", "unknown", "expired"]


def push_destination(endpoint: str) -> httpx.URL:
    url = httpx.URL(endpoint)
    path = url.raw_path
    allowed = (
        url.host == "fcm.googleapis.com"
        and path.startswith(b"/fcm/send/")
        or url.host == "updates.push.services.mozilla.com"
        and path.startswith(b"/wpush/v2/")
        or url.host == "web.push.apple.com"
        and path.startswith(b"/")
    )
    if (
        not endpoint.startswith("https://")
        or any(character.isspace() or character == "\\" for character in endpoint)
        or not allowed
        or url.port not in (None, 443)
        or url.userinfo
        or url.fragment
        or url.query
        or path == b"/"
    ):
        raise ValueError("Unsupported push destination")
    return url


def key_bytes(value: str, length: int) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("Invalid key encoding")
    raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    if len(raw) != length or key_string(raw) != value:
        raise ValueError("Invalid key length or encoding")
    return raw


def key_string(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def validate_keys(public: str, auth: str) -> None:
    ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), key_bytes(public, 65))
    key_bytes(auth, 16)


def public_key() -> str | None:
    settings = get_settings()
    subject = settings.web_push_vapid_subject
    if not (
        settings.event_push_enabled
        and re.fullmatch(r"(mailto:[^@\s]+@[^@\s]+|https://[^\s]+)", subject)
    ):
        return None
    try:
        private = ec.derive_private_key(
            int.from_bytes(key_bytes(settings.web_push_vapid_private_key.get_secret_value(), 32)),
            ec.SECP256R1(),
        )
        key = key_string(
            private.public_key().public_bytes(
                serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
            )
        )
        return key if key == settings.web_push_vapid_public_key else None
    except (ValueError, binascii.Error):
        return None


async def send_push(
    device: PushDevice, payload: dict[str, str], expires_at: datetime, topic: str
) -> PushResult:
    settings = get_settings()
    if not public_key():
        return "failed"
    try:
        url = push_destination(device.endpoint)
        signer = Vapid.from_string(settings.web_push_vapid_private_key.get_secret_value())  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
        authorization: dict[str, str] = signer.sign(  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
            {"aud": f"https://{url.host}", "sub": settings.web_push_vapid_subject}
        )
        encoded = cast(
            bytes,
            http_ece.encrypt(  # pyright: ignore[reportUnknownMemberType]
                json.dumps(payload, ensure_ascii=False).encode(),
                private_key=ec.generate_private_key(ec.SECP256R1()),
                dh=key_bytes(device.p256dh, 65),
                auth_secret=key_bytes(device.auth, 16),
                version="aes128gcm",
            ),
        )
        ttl = int((expires_at - datetime.now(UTC)).total_seconds())
        if ttl < 1:
            return "expired"
        headers = {
            **authorization,
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": str(ttl),
            "Topic": topic,
            "Urgency": "high",
        }
        async with (
            asyncio.timeout(min(ttl, 3)),
            httpx.AsyncClient(follow_redirects=False, trust_env=False, timeout=3) as client,
            client.stream("POST", url, content=encoded, headers=headers) as response,
        ):
            status = response.status_code
    except (httpx.ConnectError, httpx.ConnectTimeout):
        return "retry"
    except (httpx.TransportError, TimeoutError):
        return "unknown"
    except Exception:
        # Provider libraries and HTTP exceptions can embed subscription material.
        return "failed"
    if 200 <= status < 300:
        return "accepted"
    if status in (404, 410):
        return "invalid"
    if status == 429 or status >= 500:
        return "retry"
    return "failed"
