from alpha_radar.config import Settings
from alpha_radar.market_data.providers import (
    CoinbaseMarketDataProvider,
    MarketDataProvider,
    MockMarketDataProvider,
)


def create_market_data_provider(settings: Settings) -> MarketDataProvider:
    if settings.market_data_provider == "coinbase":
        return CoinbaseMarketDataProvider(
            base_url=settings.coinbase_exchange_api_url,
            timeout_seconds=settings.market_data_http_timeout_seconds,
        )
    return MockMarketDataProvider()
