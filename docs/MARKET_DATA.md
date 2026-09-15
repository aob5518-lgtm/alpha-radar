# Market Data Foundation

## Domain flow

```text
Provider adapter
  -> provider-normalized DTO
  -> quality/provenance validation
  -> canonical Asset-linked observation
  -> TimescaleDB
  -> read-only quote/history API
  -> localized Asset Market UI
```

`Asset` represents the durable financial entity. `MarketInstrument` represents a specific
provider-addressable pair or index. BTC remains one canonical Asset while `BTC-USD` on Coinbase and
future provider pairs are separate instruments. Derivatives are instrument types, not new canonical
Assets. The existing `AssetProviderMapping` remains intact because asset identity mapping and
tradable-instrument identity are related but different concepts.

An instrument is unique by `(provider, provider_instrument_id)`. Provider names are lowercase and
base/quote currencies are uppercase. Quote currencies are never silently converted or treated as
equivalent: USD, USDT, USDC, and EUR remain distinct.

## Point-in-time and precision semantics

Quotes preserve `provider_timestamp` when the provider supplies one, `observed_at` when Alpha Radar
received the response, and `ingested_at` when persistence occurred. A missing provider timestamp
stays null. Candles preserve `open_time`, `close_time`, optional `provider_timestamp`, and
`ingested_at`. These meanings must not be collapsed in later features or backtests.

Both quotes and candles are append-oriented time series. `market_quotes` is a Timescale hypertable
partitioned by `observed_at`; `market_candles` is a hypertable partitioned by `open_time`. Quotes are
not overwritten because the observation sequence is useful for provenance and future point-in-time
analysis. Candle identity is `(provider, market_instrument_id, interval, open_time)`, and ingestion
uses an atomic upsert so corrected/in-progress candles update without creating duplicates.

Persisted financial values use PostgreSQL `NUMERIC(38,18)` and Python `Decimal`, never floating
point. The web converts decimal strings to JavaScript numbers only at the final presentation/chart
boundary; canonical persisted and API values remain decimal strings.

## Intervals, quality, and freshness

Supported intervals are centrally versionable domain values: `1m`, `1h`, and `1d`. Their durations,
API query ranges, and Coinbase granularities are defined in one module. API history is bounded by a
maximum of 1,000 rows and an interval-specific maximum time range.

Provider DTO validation rejects non-positive prices, negative sizes/volumes, invalid time ranges,
and inconsistent OHLC bounds. Simple quality flags record timestamp and sequence concerns such as
`future_timestamp`, `old_timestamp`, `out_of_order`, and `duplicate`. This is intentionally a small
foundation rather than a separate data-quality platform.

Quote freshness is computed in the backend from the persisted `observed_at` and a configurable
threshold (`MARKET_DATA_QUOTE_FRESHNESS_SECONDS`, default 90 seconds). API responses expose both
`freshness` and `is_stale`; the frontend does not invent its own threshold.

## Provider abstraction and ingestion

`MarketDataProvider` is a typed async interface for quotes and candles. Adapters translate vendor
payloads into `ProviderQuote` and `ProviderCandle`; repository and API code never see raw vendor JSON.
`MockMarketDataProvider` is deterministic and is the only provider used by CI.

The initial real adapter targets Coinbase Exchange public REST endpoints for limited crypto
development:

- [Get product ticker](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker)
- [Get product candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles)
- [REST rate limits](https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits)
- [Market Data Terms of Use](https://www.coinbase.com/legal/market_data)

The ticker and candle endpoints are publicly accessible without authentication. Coinbase documents
10 public REST requests per second per IP, with bursts up to 15. Candle responses are limited to 300
points, may omit intervals without ticks, and should not be polled frequently. The adapter respects
the 300-candle limit; Alpha Radar's default schedules are approximately 45 seconds for quotes and 60
seconds for 1m candles. External ingestion remains opt-in through
`MARKET_DATA_INGESTION_ENABLED=false` by default.

Celery tasks make provider calls outside the HTTP request path. The API reads PostgreSQL only. The
existing Redis broker and worker are reused; no new queue, service boundary, or streaming system is
introduced.

## Licensing constraint

Technical access to public market-data APIs does not imply commercial display or redistribution
rights. Coinbase's published terms contain material restrictions on third-party display,
redistribution, and derived works. The adapter is suitable only for development/research until the
intended product use has been reviewed and any required written permission or commercial agreement
has been obtained. This repository makes no claim that Alpha Radar currently has those rights.

Before publicly distributing real-time US equity, ETF, or exchange market data, provider and
exchange licensing must be reviewed separately. Securities-data licensing is intentionally outside
Sprint 2.
