from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from alpha_radar.assets.service import AssetService
from alpha_radar.errors import AppError
from alpha_radar.market_data.constants import (
    INTERVAL_DEFINITIONS,
    Freshness,
    MarketInterval,
    QualityFlag,
)
from alpha_radar.market_data.models import MarketInstrument, MarketQuote
from alpha_radar.market_data.providers.base import (
    MarketDataProvider,
    MarketInstrumentRef,
    ProviderCandle,
    ProviderQuote,
)
from alpha_radar.market_data.quality import timestamp_quality_flags
from alpha_radar.market_data.repository import MarketDataRepository
from alpha_radar.market_data.schemas import (
    MarketCandleResponse,
    MarketHistoryResponse,
    MarketQuoteResponse,
)


class MarketDataService:
    def __init__(
        self,
        repository: MarketDataRepository,
        asset_service: AssetService,
        *,
        quote_freshness: timedelta,
        future_tolerance: timedelta,
    ) -> None:
        self.repository = repository
        self.asset_service = asset_service
        self.quote_freshness = quote_freshness
        self.future_tolerance = future_tolerance

    async def get_quote(
        self, identifier: str, *, now: datetime | None = None
    ) -> MarketQuoteResponse:
        asset = await self.asset_service.resolve_asset(identifier)
        quote = await self.repository.latest_quote(asset.id)
        if quote is None:
            raise AppError(
                code="market_quote_not_found",
                message=f"No persisted market quote is available for asset '{identifier}'",
                status_code=404,
            )
        instrument = await self._require_instrument(quote.market_instrument_id)
        reference_time = now or datetime.now(UTC)
        quote_age = self._as_utc(reference_time) - self._as_utc(quote.observed_at)
        is_stale = quote_age > self.quote_freshness
        return MarketQuoteResponse(
            asset_id=asset.id,
            symbol=asset.symbol,
            market_instrument_id=instrument.id,
            provider_instrument_id=instrument.provider_instrument_id,
            price=quote.price,
            bid=quote.bid,
            ask=quote.ask,
            bid_size=quote.bid_size,
            ask_size=quote.ask_size,
            base_currency=quote.base_currency,
            quote_currency=quote.quote_currency,
            provider=quote.provider,
            provider_timestamp=quote.provider_timestamp,
            observed_at=quote.observed_at,
            ingested_at=quote.ingested_at,
            quality_flags=quote.quality_flags,
            freshness=Freshness.STALE if is_stale else Freshness.FRESH,
            is_stale=is_stale,
        )

    async def get_history(
        self,
        identifier: str,
        *,
        interval: MarketInterval,
        start: datetime | None,
        end: datetime | None,
        limit: int,
    ) -> MarketHistoryResponse:
        self._validate_history_range(interval=interval, start=start, end=end)
        asset = await self.asset_service.resolve_asset(identifier)
        instrument = await self.repository.get_instrument_for_history(asset.id, interval)
        if instrument is None:
            instrument = await self.repository.get_preferred_instrument(asset.id)
        if instrument is None:
            raise AppError(
                code="market_instrument_not_found",
                message=f"No active market instrument is available for asset '{identifier}'",
                status_code=404,
            )
        candles = await self.repository.list_candles(
            asset_id=asset.id,
            market_instrument_id=instrument.id,
            interval=interval,
            start=start,
            end=end,
            limit=limit,
        )
        return MarketHistoryResponse(
            asset_id=asset.id,
            symbol=asset.symbol,
            market_instrument_id=instrument.id,
            provider_instrument_id=instrument.provider_instrument_id,
            base_currency=instrument.base_currency,
            quote_currency=instrument.quote_currency,
            provider=instrument.provider,
            interval=interval,
            items=[MarketCandleResponse.model_validate(candle) for candle in candles],
        )

    async def ingest_quote(
        self, instrument: MarketInstrument, provider_quote: ProviderQuote
    ) -> MarketQuote:
        self._validate_provenance(
            instrument,
            provider_quote.provider,
            provider_quote.provider_instrument_id,
        )
        self._validate_currencies(
            instrument, provider_quote.base_currency, provider_quote.quote_currency
        )
        flags = timestamp_quality_flags(
            provider_timestamp=provider_quote.provider_timestamp,
            observed_at=provider_quote.observed_at,
            future_tolerance=self.future_tolerance,
            stale_after=self.quote_freshness,
        )
        previous = await self.repository.latest_quote_for_instrument(instrument.id)
        if (
            previous is not None
            and previous.provider_timestamp is not None
            and provider_quote.provider_timestamp is not None
            and self._as_utc(provider_quote.provider_timestamp)
            < self._as_utc(previous.provider_timestamp)
        ):
            flags.append(QualityFlag.OUT_OF_ORDER.value)

        return await self.repository.add_quote(
            MarketQuote(
                asset_id=instrument.asset_id,
                market_instrument_id=instrument.id,
                provider=provider_quote.provider,
                price=provider_quote.price,
                bid=provider_quote.bid,
                ask=provider_quote.ask,
                bid_size=provider_quote.bid_size,
                ask_size=provider_quote.ask_size,
                base_currency=provider_quote.base_currency,
                quote_currency=provider_quote.quote_currency,
                provider_timestamp=provider_quote.provider_timestamp,
                observed_at=provider_quote.observed_at,
                quality_flags=flags,
                metadata_=provider_quote.metadata,
            )
        )

    async def ingest_candles(
        self, instrument: MarketInstrument, provider_candles: list[ProviderCandle]
    ) -> int:
        ingested = 0
        for candle in provider_candles:
            self._validate_provenance(instrument, candle.provider, candle.provider_instrument_id)
            duplicate = await self.repository.candle_exists(
                provider=candle.provider,
                market_instrument_id=instrument.id,
                interval=candle.interval,
                open_time=candle.open_time,
            )
            flags = [QualityFlag.DUPLICATE.value] if duplicate else []
            flags.extend(
                timestamp_quality_flags(
                    provider_timestamp=candle.provider_timestamp,
                    observed_at=datetime.now(UTC),
                    future_tolerance=self.future_tolerance,
                    stale_after=INTERVAL_DEFINITIONS[candle.interval].max_query_range,
                )
            )
            await self.repository.upsert_candle(
                {
                    "provider": candle.provider,
                    "market_instrument_id": instrument.id,
                    "interval": candle.interval,
                    "open_time": candle.open_time,
                    "asset_id": instrument.asset_id,
                    "close_time": candle.close_time,
                    "open": candle.open,
                    "high": candle.high,
                    "low": candle.low,
                    "close": candle.close,
                    "volume": candle.volume,
                    "quote_volume": candle.quote_volume,
                    "is_closed": candle.is_closed,
                    "provider_timestamp": candle.provider_timestamp,
                    "ingested_at": datetime.now(UTC),
                    "quality_flags": flags,
                    "metadata": candle.metadata,
                }
            )
            ingested += 1
        await self.repository.commit()
        return ingested

    async def fetch_and_ingest_quote(
        self, instrument: MarketInstrument, provider: MarketDataProvider
    ) -> MarketQuote:
        quote = await provider.get_quote(self.instrument_ref(instrument))
        return await self.ingest_quote(instrument, quote)

    async def fetch_and_ingest_candles(
        self,
        instrument: MarketInstrument,
        provider: MarketDataProvider,
        interval: MarketInterval,
        *,
        limit: int,
    ) -> int:
        candles = await provider.get_candles(self.instrument_ref(instrument), interval, limit=limit)
        return await self.ingest_candles(instrument, candles)

    @staticmethod
    def instrument_ref(instrument: MarketInstrument) -> MarketInstrumentRef:
        return MarketInstrumentRef(
            provider_instrument_id=instrument.provider_instrument_id,
            instrument_type=instrument.instrument_type,
            base_currency=instrument.base_currency,
            quote_currency=instrument.quote_currency,
        )

    @staticmethod
    def _validate_provenance(
        instrument: MarketInstrument, provider: str, provider_instrument_id: str
    ) -> None:
        if (
            provider != instrument.provider
            or provider_instrument_id != instrument.provider_instrument_id
        ):
            raise ValueError("Provider observation does not match the market instrument")

    @staticmethod
    def _validate_currencies(
        instrument: MarketInstrument, base_currency: str, quote_currency: str
    ) -> None:
        if base_currency != instrument.base_currency or quote_currency != instrument.quote_currency:
            raise ValueError("Provider quote currencies do not match the market instrument")

    @staticmethod
    def _validate_history_range(
        *, interval: MarketInterval, start: datetime | None, end: datetime | None
    ) -> None:
        if (start is None) != (end is None):
            raise AppError(
                code="incomplete_history_range",
                message="History start and end must be provided together",
                status_code=422,
            )
        if start is not None and end is not None:
            if start >= end:
                raise AppError(
                    code="invalid_history_range",
                    message="History start must be before end",
                    status_code=422,
                )
            if end - start > INTERVAL_DEFINITIONS[interval].max_query_range:
                raise AppError(
                    code="history_range_too_large",
                    message=f"Requested range is too large for interval {interval.value}",
                    status_code=422,
                )

    async def _require_instrument(self, instrument_id: UUID) -> MarketInstrument:
        instrument = await self.repository.get_instrument(instrument_id)
        if instrument is None:
            raise RuntimeError("Persisted quote references a missing market instrument")
        return instrument

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
