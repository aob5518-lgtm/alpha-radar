"""Model registry imported by Alembic."""

from alpha_radar.assets.models import Asset, AssetAlias, AssetProviderMapping
from alpha_radar.events.models import Event, EventAsset, EventSourceReference
from alpha_radar.market_data.models import MarketCandle, MarketInstrument, MarketQuote
from alpha_radar.sources.models import Source, SourceDocument, SourceDocumentVersion

__all__ = [
    "Asset",
    "AssetAlias",
    "AssetProviderMapping",
    "Event",
    "EventAsset",
    "EventSourceReference",
    "MarketCandle",
    "MarketInstrument",
    "MarketQuote",
    "Source",
    "SourceDocument",
    "SourceDocumentVersion",
]
