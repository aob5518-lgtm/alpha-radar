"""Model registry imported by Alembic."""

from alpha_radar.assets.models import Asset, AssetAlias, AssetProviderMapping
from alpha_radar.market_data.models import MarketCandle, MarketInstrument, MarketQuote
from alpha_radar.sources.models import Source, SourceDocument, SourceDocumentVersion

__all__ = [
    "Asset",
    "AssetAlias",
    "AssetProviderMapping",
    "MarketCandle",
    "MarketInstrument",
    "MarketQuote",
    "Source",
    "SourceDocument",
    "SourceDocumentVersion",
]
