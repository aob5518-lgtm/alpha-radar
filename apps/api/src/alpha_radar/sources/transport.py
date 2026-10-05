import asyncio
from collections.abc import Awaitable, Mapping
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Protocol, cast
from urllib.parse import urlsplit

import httpx
from redis.asyncio import Redis

from alpha_radar.sources.errors import SourceError


class RequestGate(Protocol):
    async def acquire(self) -> None: ...
    async def defer(self, seconds: float) -> None: ...


class RedisRequestGate:
    # Redis server time + one atomic script: shared across all worker processes.
    script = """
    local t = redis.call('TIME')
    local now = tonumber(t[1])*1000 + tonumber(t[2])/1000
    local next = tonumber(redis.call('GET', KEYS[1]) or '0')
    if next > now then return math.ceil(next-now) end
    redis.call('PSETEX', KEYS[1], math.ceil(ARGV[1]), now+ARGV[1])
    return 0
    """

    def __init__(self, redis_url: str, provider: str, rps: float, minimum_interval: float) -> None:
        if rps <= 0 or minimum_interval < 0:
            raise ValueError("Invalid request policy")
        self.redis_url = redis_url
        self.key = f"alpha-radar:source-request:{provider}"
        self.interval_ms = max(1000 / rps, minimum_interval * 1000)

    async def acquire(self) -> None:
        async with Redis.from_url(self.redis_url) as client:  # pyright: ignore[reportUnknownMemberType]
            while True:
                result = cast(
                    Awaitable[int], client.eval(self.script, 1, self.key, str(self.interval_ms))
                )  # pyright: ignore[reportUnknownMemberType]
                delay = float(await result)
                if delay <= 0:
                    return
                if delay > 30000:
                    raise SourceError("rate_limited", "Provider cooldown is active", delay / 1000)
                await asyncio.sleep(delay / 1000)

    async def defer(self, seconds: float) -> None:
        script = """
        local t = redis.call('TIME')
        local now = tonumber(t[1])*1000 + tonumber(t[2])/1000
        local next = math.max(tonumber(redis.call('GET', KEYS[1]) or '0'), now+ARGV[1])
        redis.call('PSETEX', KEYS[1], math.ceil(next-now), next)
        return 1
        """
        async with Redis.from_url(self.redis_url) as client:  # pyright: ignore[reportUnknownMemberType]
            result = cast(Awaitable[int], client.eval(script, 1, self.key, str(seconds * 1000)))  # pyright: ignore[reportUnknownMemberType]
            await result


def retry_delay(value: str | None, fallback: float = 300) -> float:
    if not value:
        return fallback
    try:
        seconds = float(value)
    except ValueError:
        try:
            seconds = (parsedate_to_datetime(value) - datetime.now(UTC)).total_seconds()
        except (ValueError, TypeError):
            return fallback
    return max(fallback, seconds)


class SourceTransport:
    def __init__(
        self,
        gate: RequestGate,
        user_agent: str,
        timeout: float = 15,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not user_agent.strip():
            raise SourceError("policy_restricted", "A declared contact User-Agent is required")
        self.gate = gate
        self.user_agent = user_agent
        self.timeout = timeout
        self.client = client

    async def get(
        self,
        url: str,
        *,
        allowed_hosts: frozenset[str] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> tuple[httpx.Response, datetime, datetime]:
        target = urlsplit(url)
        explicitly_allowed = (
            allowed_hosts is not None
            and target.scheme == "https"
            and target.hostname is not None
            and target.hostname.lower() in allowed_hosts
            and target.port in {None, 443}
            and target.username is None
            and target.password is None
        )
        if not explicitly_allowed and not (
            url.startswith("https://data.sec.gov/submissions/CIK")
            or url == "https://www.federalreserve.gov/feeds/press_all.xml"
            or url
            in {
                "https://www.bls.gov/feed/empsit.rss",
                "https://www.bls.gov/feed/cpi.rss",
                "https://www.bls.gov/feed/ppi.rss",
                "https://apps.bea.gov/rss/rss.xml",
                "https://www.federalreserve.gov/feeds/press_monetary.xml",
                "https://www.bls.gov/schedule/2026/home.htm",
                "https://www.bea.gov/news/schedule/full",
                "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
            }
        ):
            raise SourceError("policy_restricted", "Provider URL is not allowlisted")
        await self.gate.acquire()
        observed = datetime.now(UTC)
        request_headers = {"User-Agent": self.user_agent, **dict(headers or {})}
        request_headers["User-Agent"] = self.user_agent
        try:
            if self.client:
                response = await self.client.get(
                    url, headers=request_headers, follow_redirects=False
                )
            else:
                async with httpx.AsyncClient(
                    timeout=self.timeout, follow_redirects=False
                ) as client:
                    response = await client.get(url, headers=request_headers)
        except httpx.HTTPError as error:
            await self.gate.defer(60)
            raise SourceError("temporary_source_error", "Provider network failure", 60) from error
        if response.status_code in {403, 429} or response.status_code >= 500:
            delay = retry_delay(
                response.headers.get("Retry-After"), 900 if response.status_code == 403 else 300
            )
            await self.gate.defer(delay)
            kind = (
                "policy_restricted"
                if response.status_code == 403
                else "rate_limited"
                if response.status_code == 429
                else "temporary_source_error"
            )
            raise SourceError(kind, f"Provider returned HTTP {response.status_code}", delay)
        if response.status_code == 404:
            raise SourceError("document_not_found", "Provider document not found")
        if response.status_code != 200:
            raise SourceError("invalid_payload", f"Unexpected provider HTTP {response.status_code}")
        response_host = response.url.host.lower()
        if allowed_hosts is not None and response_host not in allowed_hosts:
            raise SourceError("policy_restricted", "Provider response left its allowlisted host")
        if len(response.content) > 5_000_000:
            raise SourceError("invalid_payload", "Provider response exceeds size bound")
        return response, observed, datetime.now(UTC)
