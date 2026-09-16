from alpha_radar.config import Settings
from alpha_radar.sources.adapters import (
    FedSourceAdapter,
    MockSourceAdapter,
    SECSourceAdapter,
    SourceAdapter,
)
from alpha_radar.sources.errors import SourceError
from alpha_radar.sources.transport import RedisRequestGate, SourceTransport


def create_source_adapter(provider: str, settings: Settings) -> SourceAdapter:
    if provider == "mock":
        return MockSourceAdapter()
    if provider not in {"sec", "fed"}:
        raise SourceError("policy_restricted", "Unsupported source provider")
    if not settings.source_ingestion_enabled or not getattr(settings, f"{provider}_source_enabled"):
        raise SourceError("policy_restricted", "Real source adapter is disabled")
    identity = settings.source_contact_identity.strip()
    if "@" not in identity or any(c in identity for c in "\r\n"):
        raise SourceError("policy_restricted", "Configure a valid organization/contact identity")
    rps = (
        settings.sec_requests_per_second if provider == "sec" else settings.fed_requests_per_second
    )
    gate = RedisRequestGate(
        settings.redis_url, provider, rps, settings.source_minimum_interval_seconds
    )
    transport = SourceTransport(
        gate, f"AlphaRadar/0.1 {identity}", settings.source_http_timeout_seconds
    )
    return (
        SECSourceAdapter(transport, settings.sec_ciks)
        if provider == "sec"
        else FedSourceAdapter(transport)
    )
