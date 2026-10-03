from __future__ import annotations

from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Protocol, cast
from uuid import uuid4

from redis.asyncio import Redis


@dataclass(frozen=True)
class LeaseResult:
    acquired: bool
    reason: str | None = None


class LeaseStore(Protocol):
    async def acquire(
        self,
        *,
        client_key: str,
        global_key: str,
        token: str,
        per_client_limit: int,
        global_limit: int,
        ttl_ms: int,
    ) -> LeaseResult: ...

    async def refresh(self, *, keys: tuple[str, str], token: str, ttl_ms: int) -> None: ...

    async def release(self, *, keys: tuple[str, str], token: str) -> None: ...

    async def close(self) -> None: ...


class RedisLeaseStore:
    acquire_script = """
    local t = redis.call('TIME')
    local now = tonumber(t[1])*1000 + tonumber(t[2])/1000
    redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
    redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
    if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 1 end
    if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then return 2 end
    local expires = now + tonumber(ARGV[4])
    redis.call('ZADD', KEYS[1], expires, ARGV[1])
    redis.call('ZADD', KEYS[2], expires, ARGV[1])
    redis.call('PEXPIRE', KEYS[1], ARGV[4])
    redis.call('PEXPIRE', KEYS[2], ARGV[4])
    return 0
    """
    refresh_script = """
    local t = redis.call('TIME')
    local expires = tonumber(t[1])*1000 + tonumber(t[2])/1000 + tonumber(ARGV[2])
    for i, key in ipairs(KEYS) do
      if redis.call('ZSCORE', key, ARGV[1]) then
        redis.call('ZADD', key, expires, ARGV[1])
        redis.call('PEXPIRE', key, ARGV[2])
      end
    end
    return 1
    """
    release_script = (
        "return redis.call('ZREM', KEYS[1], ARGV[1]) + redis.call('ZREM', KEYS[2], ARGV[1])"
    )

    def __init__(self, client: Redis) -> None:
        self.client = client

    async def acquire(
        self,
        *,
        client_key: str,
        global_key: str,
        token: str,
        per_client_limit: int,
        global_limit: int,
        ttl_ms: int,
    ) -> LeaseResult:
        result = int(
            await cast(
                Awaitable[int],
                self.client.eval(
                    self.acquire_script,
                    2,
                    client_key,
                    global_key,
                    token,
                    str(per_client_limit),
                    str(global_limit),
                    str(ttl_ms),
                ),
            )
        )
        reason = "per_client_limit" if result == 1 else "global_limit" if result == 2 else None
        return LeaseResult(result == 0, reason)

    async def refresh(self, *, keys: tuple[str, str], token: str, ttl_ms: int) -> None:
        await cast(
            Awaitable[int], self.client.eval(self.refresh_script, 2, *keys, token, str(ttl_ms))
        )

    async def release(self, *, keys: tuple[str, str], token: str) -> None:
        await cast(Awaitable[int], self.client.eval(self.release_script, 2, *keys, token))

    async def close(self) -> None:
        await self.client.aclose()


class ConnectionLimiter:
    def __init__(
        self,
        store: LeaseStore,
        *,
        namespace: str,
        per_client_limit: int,
        global_limit: int,
        ttl_seconds: int,
    ) -> None:
        self.store = store
        self.namespace = namespace
        self.per_client_limit = per_client_limit
        self.global_limit = global_limit
        self.ttl_ms = ttl_seconds * 1000

    @classmethod
    def redis(
        cls,
        redis_url: str,
        *,
        namespace: str,
        per_client_limit: int,
        global_limit: int,
        ttl_seconds: int,
    ) -> ConnectionLimiter:
        client = Redis.from_url(redis_url)  # pyright: ignore[reportUnknownMemberType]
        return cls(
            RedisLeaseStore(client),
            namespace=namespace,
            per_client_limit=per_client_limit,
            global_limit=global_limit,
            ttl_seconds=ttl_seconds,
        )

    def keys(self, client_id: str) -> tuple[str, str]:
        return (
            f"alpha-radar:{self.namespace}:client:{client_id}",
            f"alpha-radar:{self.namespace}:global",
        )

    async def acquire(self, client_id: str) -> tuple[LeaseResult, str]:
        token = str(uuid4())
        client_key, global_key = self.keys(client_id)
        result = await self.store.acquire(
            client_key=client_key,
            global_key=global_key,
            token=token,
            per_client_limit=self.per_client_limit,
            global_limit=self.global_limit,
            ttl_ms=self.ttl_ms,
        )
        return result, token

    async def refresh(self, client_id: str, token: str) -> None:
        await self.store.refresh(keys=self.keys(client_id), token=token, ttl_ms=self.ttl_ms)

    async def release(self, client_id: str, token: str) -> None:
        await self.store.release(keys=self.keys(client_id), token=token)

    async def close(self) -> None:
        await self.store.close()
