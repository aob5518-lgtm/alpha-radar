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

Supported intervals are centrally versionable domain values: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`,
and `1w`. Their durations,
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

The spot adapter targets Coinbase Exchange public REST endpoints for limited crypto
development:

- [Get product ticker](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker)
- [Get product candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles)
- [REST rate limits](https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits)
- [Market Data Terms of Use](https://www.coinbase.com/legal/market_data)

The ticker and candle endpoints are publicly accessible without authentication. Coinbase documents
10 public REST requests per second per IP, with bursts up to 15. Candle responses are limited to 300
points, may omit intervals without ticks, and should not be polled frequently. The adapter pages
sequentially backward with requests of at most 300 source candles and defaults to eight requests per
second (`COINBASE_PUBLIC_REQUESTS_PER_SECOND`). Overlapping rows are deduplicated. The adapter can
return at most 500 closed target candles per call; 4h and 1w require multiple native 1h/day requests.
Four-hour bars use UTC 00/04/08/12/16/20 boundaries. Weekly bars use Monday 00:00 UTC and require
exactly seven consecutive daily source candles; incomplete or gapped buckets are rejected.

Alpha Radar's default quote schedule is approximately 45 seconds. Closed-candle maintenance uses a
bounded three-candle overlap for every supported interval: 1m each minute, 5m each five minutes,
15m each fifteen minutes, 1h hourly, 4h each four hours, 1d daily, and 1w each Monday after the UTC
boundary. Only provider-confirmed closed candles are persisted by these periodic tasks. Upserts make
the overlap idempotent, missing provider buckets are not fabricated, and deep history is never
periodically re-fetched. An operator can enqueue a bounded interval
backfill (valid limit 1–500) when real ingestion is enabled:

```bash
docker compose exec worker celery -A alpha_radar.worker call \
  alpha_radar.market_data.backfill_technical_history \
  --args='["4h", 500]'
```

Repeat explicitly for required intervals; at least 300 closed 4h/1d candles and 200 closed 1w
candles are required by the current acceptance contract, while 500 is preferred and supported.
External ingestion remains opt-in through
`MARKET_DATA_INGESTION_ENABLED=false` by default.

The primary Core 3 Chart market is the bounded set of 12 seeded Bybit V5 USDT linear perpetuals.
Chart, history, streaming, and Analyst handoff use canonical `market_instrument_id`; the linked
Asset UUID remains the identity for Event retrieval. This prevents a Coinbase spot observation from
being selected while the user is viewing a Bybit perpetual.

The Bybit adapter uses the official [V5 Get Kline](https://bybit-exchange.github.io/docs/v5/market/kline)
endpoint with `GET /v5/market/kline?category=linear` and the official
[Kline WebSocket](https://bybit-exchange.github.io/docs/v5/websocket/public/kline) on the public
linear stream. Alpha
Radar maps `1m`, `5m`, `15m`, `1h`, `4h`, `1d`, and `1w` to native `1`, `5`, `15`, `60`, `240`,
`D`, and `W` intervals. It does not re-aggregate native intervals or fill missing bars. WebSocket
subscriptions use `kline.{interval}.{symbol}`. Exchange `confirm=false` candles are visual
LIVE/PARTIAL state only; `confirm=true` identifies a closed candle. Structural Levels and Trend
Regime continue to consume persisted, confirmed candles only.

Production must set `APP_ENV=production`, `MARKET_DATA_PROVIDER=bybit`, and
`MARKET_DATA_INGESTION_ENABLED=true`. Readiness is HTTP 503 until BTCUSDT, ETHUSDT, and SOLUSDT each
have current closed history for all seven intervals. It deliberately does not require every seeded
contract. Coinbase remains available as a backend spot adapter. The mock provider remains the safe
development/CI default and can never produce a market-ready production response.

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
