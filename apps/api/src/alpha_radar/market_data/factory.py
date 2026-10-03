from alpha_radar.config import Settings
from alpha_radar.market_data.providers import (
    BybitMarketDataProvider,
    CoinbaseMarketDataProvider,
    MarketDataProvider,
    MockMarketDataProvider,
)


def create_market_data_provider(settings: Settings) -> MarketDataProvider:
    if settings.market_data_provider == "bybit":
        return BybitMarketDataProvider(
            base_url=settings.bybit_api_url,
            websocket_url=settings.bybit_websocket_url,
            timeout_seconds=settings.market_data_http_timeout_seconds,
            requests_per_second=settings.bybit_public_requests_per_second,
        )
    if settings.market_data_provider == "coinbase":
        return CoinbaseMarketDataProvider(
            base_url=settings.coinbase_exchange_api_url,
            websocket_url=settings.coinbase_websocket_url,
            timeout_seconds=settings.market_data_http_timeout_seconds,
            requests_per_second=settings.coinbase_public_requests_per_second,
        )
    return MockMarketDataProvider()
