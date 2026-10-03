# Structural Level Engine V1.1

Version: `structural-levels-v1.1`

Trend version: `trend-regime-v1.1`

## Input and no-look-ahead rules

The engine accepts normalized OHLCV candles but immediately excludes every candle where
`is_closed != true`. Candles are ordered by `open_time`. A pivot with left width `L` and right width
`R` is not confirmed until all `R` later closed candles exist. The default is `L=3`, `R=3`.
Consequently:

- the current open candle cannot create, strengthen or move a confirmed level;
- historical replay at time `t` receives only candles closed by `t`;
- future candles cannot alter a pivot that was already confirmed;
- repeating a calculation with identical inputs produces identical output.

## Pivot detection

A swing high is at least as high as all candles in its confirmation window and strictly higher than
at least one neighbor. Swing lows use the inverse rule. Equal-price plateaus resolve deterministically
to the final candle in the contiguous plateau. Pivot quality is the pivot's excursion beyond the
strongest neighboring extreme, normalized by local 14-period ATR and capped to `[0,1]`. Rejection
strength measures the relevant wick relative to ATR. Volume confirmation compares pivot volume with
its trailing 20-candle mean. Absent volume is marked unavailable and omitted from the weighted
denominator rather than treated as zero evidence.

## ATR clustering

Pivots are sorted by price. A candidate joins an existing zone when its distance from the zone's
quality-weighted center is no greater than `0.6 × max(candidate ATR, zone mean ATR)`. Otherwise it
starts a new zone. The zone exposes its minimum/maximum pivot price and quality-weighted
representative price.

## Strength score

The transparent 0–100 score is:

```text
25% confirmed pivot count (capped at four)
20% mean rejection strength
15% mean volume confirmation
15% recency
15% mean pivot quality
10% higher-timeframe confluence
```

Bands are weak `<45`, moderate `45–69`, and strong `>=70`. Volume and higher-timeframe components are
included only when those inputs are available; weights are renormalized across available evidence.
An available higher timeframe with no confluence is zero confluence, while an unavailable higher
timeframe is not evidence. These are deterministic versioned weights, not learned weights or AI.

## Support/resistance and Top 3 selection

With current price `P`, zones above `P` are resistance candidates and zones below `P` are support
candidates. Selection ranks structural strength and useful proximity. Clustering happens before the
best three candidates are displayed as R1→R3 and S1→S3. Each level exposes zone range,
representative price, score/band, confirmed pivot count, last test, percentage distance, timeframe
and higher-timeframe availability/confluence. `pivot_count` is not a retest count; true
post-formation retest semantics are deferred.

## Trend Regime V1.1

Trend requires at least 250 closed candles: 200 observations seed EMA 200 with an SMA, followed by at
least 50 warm-up observations. EMA 20 and EMA 50 use the same SMA-seeded recurrence. It combines:

- confirmed higher-high/higher-low versus lower-high/lower-low structure (25%);
- EMA 20/50/200 ordering (25%);
- five-candle EMA slopes (15%);
- price location relative to all three EMAs (15%);
- standard 14-period Wilder-smoothed ADX directional strength (10%);
- optional higher-timeframe alignment (10%).

Directional score `>=0.20` is BULLISH, `<=-0.20` is BEARISH, otherwise NEUTRAL. Strength is a bounded
0–100 combination of absolute directional agreement and ADX. Higher-timeframe alignment is omitted
and the score renormalized when that trend cannot be calculated. It describes regime, not the next
candle and not guaranteed future performance.

## Timeframes and provider behavior

Every timeframe recalculates candles, zones and trend independently. Live hierarchy is
`1m→5m→15m→1h→4h→1d→1w`; weekly has no higher timeframe. The higher-period snapshot supplies real
level confluence and trend direction only when its persisted history is available. Bybit natively
supplies every supported timeframe for the primary USDT perpetual Chart, so those bars are not
aggregated. The retained Coinbase spot adapter natively
supplies 1m/5m/15m/1h/1d granularities. The adapter aggregates complete 1h groups into UTC-aligned
4h bars and complete 1d groups into Monday 00:00 UTC-aligned 1w bars. Aggregation requires every
expected source timestamp; incomplete or gapped groups are discarded.

The Coinbase provider pages backward in chunks of at most 300 source candles, is paced below its public
limit, deduplicates overlaps, and returns at most 500 target candles. A manual, unscheduled worker
backfill task persists deeper histories; normal request handlers remain database-only.

## Testing and future backtesting

Offline tests cover right-side confirmation, plateau policy, open-candle exclusion,
replay/no-look-ahead, clustering, Top 3 bounds, determinism, timeframe identity, insufficient
history, SMA-seeded EMA, Wilder ADX intermediates, missing-evidence renormalization, paginated history
depth, weekly UTC boundaries and provider aggregation.

Future work should run versioned walk-forward evaluation over survivorship-aware histories. It must
record level creation time, first touch, rejection/break distance, maximum favorable/adverse move,
market regime, fees/slippage assumptions and provider data gaps. Parameter changes require a new
algorithm version; historical results must never be overwritten.
