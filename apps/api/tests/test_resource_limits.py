from alpha_radar.resource_limits import ConnectionLimiter, LeaseResult


class MemoryLeaseStore:
    def __init__(self) -> None:
        self.clients: dict[str, set[str]] = {}
        self.global_tokens: set[str] = set()
        self.closed = False

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
        del global_key, ttl_ms
        client = self.clients.setdefault(client_key, set())
        if len(client) >= per_client_limit:
            return LeaseResult(False, "per_client_limit")
        if len(self.global_tokens) >= global_limit:
            return LeaseResult(False, "global_limit")
        client.add(token)
        self.global_tokens.add(token)
        return LeaseResult(True)

    async def refresh(self, *, keys: tuple[str, str], token: str, ttl_ms: int) -> None:
        del keys, token, ttl_ms

    async def release(self, *, keys: tuple[str, str], token: str) -> None:
        self.clients.setdefault(keys[0], set()).discard(token)
        self.global_tokens.discard(token)

    async def close(self) -> None:
        self.closed = True


async def test_websocket_connection_limits_and_disconnect_cleanup() -> None:
    store = MemoryLeaseStore()
    limiter = ConnectionLimiter(
        store,
        namespace="test-stream",
        per_client_limit=1,
        global_limit=2,
        ttl_seconds=60,
    )
    first, first_token = await limiter.acquire("198.51.100.1")
    rejected, _ = await limiter.acquire("198.51.100.1")
    second, second_token = await limiter.acquire("198.51.100.2")
    globally_rejected, _ = await limiter.acquire("198.51.100.3")

    assert first.acquired and second.acquired
    assert rejected.reason == "per_client_limit"
    assert globally_rejected.reason == "global_limit"

    await limiter.release("198.51.100.1", first_token)
    replacement, replacement_token = await limiter.acquire("198.51.100.3")
    assert replacement.acquired
    await limiter.release("198.51.100.2", second_token)
    await limiter.release("198.51.100.3", replacement_token)
    assert not store.global_tokens
    await limiter.close()
    assert store.closed
