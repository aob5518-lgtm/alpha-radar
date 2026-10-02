# Structural Level Engine V1

Version: `structural-levels-v1`

Trend version: `trend-regime-v1`

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
at least one neighbor. Swing lows use the inverse rule. Pivot quality is the pivot's excursion beyond
the strongest neighboring extreme, normalized by local 14-period ATR and capped to `[0,1]`.
Rejection strength measures the relevant wick relative to ATR. Volume confirmation compares pivot
volume with its trailing 20-candle mean; absent volume contributes zero rather than fabricated data.

## ATR clustering

Pivots are sorted by price. A candidate joins an existing zone when its distance from the zone's
quality-weighted center is no greater than `0.6 × max(candidate ATR, zone mean ATR)`. Otherwise it
starts a new zone. The zone exposes its minimum/maximum pivot price and quality-weighted
representative price. Clustering prevents nearby prices such as 70,850, 70,930 and 71,020 from
appearing as redundant independent lines when volatility makes them one structure.

## Strength score

The initial transparent 0–100 score is:

```text
25% touch count (capped at four)
20% mean rejection strength
15% mean volume confirmation
15% recency
15% mean pivot quality
10% higher-timeframe confluence
```

Bands are weak `<45`, moderate `45–69`, and strong `>=70`. Missing higher-timeframe input contributes
zero. Score components and thresholds are versioned constants, not learned weights and not AI.

## Support/resistance and Top 3 selection

With current price `P`, zones above `P` are resistance candidates and zones below `P` are support
candidates. Selection ranks a combination of structural strength and useful proximity; distance
cannot replace strength. Because clustering happens first, one zone cannot occupy multiple slots.
The best three candidates are then displayed by proximity as R1→R3 above price and S1→S3 below
price. Each level exposes zone range, representative price, score/band, touches, last test,
percentage distance, timeframe and higher-timeframe confluence.

## Trend Regime V1

Trend requires at least 200 closed candles. It combines:

- confirmed higher-high/higher-low versus lower-high/lower-low structure (25%);
- EMA 20/50/200 ordering (25%);
- five-candle EMA slopes (15%);
- price location relative to all three EMAs (15%);
- 14-period ADX directional strength (10%);
- optional higher-timeframe alignment (10%).

Directional score `>=0.20` is BULLISH, `<=-0.20` is BEARISH, otherwise NEUTRAL. Strength is a bounded
0–100 combination of absolute directional agreement and ADX. It describes regime, not the next
candle and not guaranteed future performance. The response exposes the full factor breakdown.

## Timeframes and provider behavior

Every timeframe recalculates candles, zones and trend independently. Coinbase natively supplies
1m/5m/15m/1h/1d granularities. The adapter deterministically aggregates complete 1h groups into 4h
and complete 1d groups into 1w; incomplete groups are discarded, never emitted as closed synthetic
bars. Provider request limits can yield fewer than 500 candles, which the UI reports honestly.

## Testing and future backtesting

Offline tests cover right-side confirmation, open-candle exclusion, replay/no-look-ahead, ATR
clustering, nearby merging, side classification, Top 3 bounds, repeated determinism, timeframe
identity, insufficient history, flat/rising/volatile markets and provider aggregation.

Future work should run versioned walk-forward evaluation over survivorship-aware histories. It must
record level creation time, first touch, rejection/break distance, maximum favorable/adverse move,
market regime, fees/slippage assumptions and provider data gaps. Parameter changes require a new
algorithm version; historical results must never be overwritten.
