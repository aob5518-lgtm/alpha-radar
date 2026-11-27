# Event Signal V1 — Shadow Mode audit

## Dataset and method

The frozen rules were replayed from 2026-08-29 15:55 to 2026-11-27 15:55 UTC.
The replay used native public Bybit linear BTCUSDT and ETHUSDT candles and the
persisted public Binance USD-M index for reference and expiry. Each Bybit pair
provided 129,600 1m, 25,920 5m and 8,640 15m bars in the reporting window, plus
warmup. Each index provided 129,601 minute closes including the opening boundary.
There were zero missing bars, internal gaps or missing Bybit volumes across
the window. Dataset SHA-256 hashes and individual frozen assessments are in
the archived JSON at `/opt/alpha-radar/shared/event-signal-v1/audit.json`.

The first eligible close after the start is evaluated. Decisions whose expiry
would extend beyond the end are excluded. Rule evaluation sees at most 80
confirmed native bars per interval. Higher-period bars must have closed by the
trigger cutoff. Expiry prices are read after the assessment is frozen. All
grouped statistics come from distinct emitted episodes. Consecutive loss counts
are chronological within the reported group. Pending and missing results are
excluded from the denominator and interrupt the streak. The one equal-price
outcome in ETH 30m is counted as a proxy loss.

The baseline uses Wilder 14 RSI on the same trigger interval and 80-bar seed
window. RSI ≥70 first enters a LOWER episode; RSI ≤30 first enters a HIGHER
episode. Another signal requires exiting that threshold or switching sides.
It shares the data and macro gates and the exact same reference/expiry proxy.
The strategies select different timestamps. This comparison measures each
strategy's observed sample and does not isolate causation by signal filter.

## Results

| Market | V1 signals | V1 wins/losses | V1 match | V1 max loss streak | RSI signals | RSI wins/losses | RSI match | RSI max loss streak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| BTC 10m | 1267 | 717/550 | 56.59% | 7 | 3289 | 1659/1630 | 50.44% | 17 |
| BTC 30m | 137 | 63/74 | 45.99% | 6 | 594 | 341/253 | 57.41% | 9 |
| ETH 10m | 1170 | 664/506 | 56.75% | 10 | 3121 | 1644/1477 | 52.68% | 10 |
| ETH 30m | 115 | 52/63 | 45.22% | 6 | 588 | 334/254 | 56.80% | 8 |

The combined rule had a higher proxy match rate than the RSI baseline on both
10m samples and a lower rate on both 30m samples. BTC 10m had a shorter
maximum loss streak than baseline; ETH 10m was equal. Both 30m samples were
more selective and weaker on match rate. Higher evidence bands did not
consistently correspond to higher observed hit rates.

| Market | WAIT | HIGHER | STRONG_HIGHER | LOWER | STRONG_LOWER | Mean / median evidence score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| BTC 10m | 128323 | 441 | 200 | 447 | 179 | 81.53 / 80 |
| BTC 30m | 25777 | 47 | 29 | 36 | 25 | 84.33 / 83 |
| ETH 10m | 128420 | 408 | 184 | 414 | 164 | 81.50 / 80 |
| ETH 30m | 25799 | 32 | 28 | 31 | 24 | 84.84 / 86 |

| Market | Direction and wins/losses |
| --- | --- |
| BTC 10m | higher 369/272 · lower 348/278 |
| BTC 30m | higher 33/43 · lower 30/31 |
| ETH 10m | higher 335/257 · lower 329/249 |
| ETH 30m | higher 25/35 · lower 27/28 |

| Market | Score bucket and wins/losses |
| --- | --- |
| BTC 10m | 75–79 352/240 · 80–84 149/122 · 85–89 136/132 · 90+ 80/56 |
| BTC 30m | 75–79 11/20 · 80–84 16/24 · 85–89 25/15 · 90+ 11/15 |
| ETH 10m | 75–79 311/251 · 80–84 138/92 · 85–89 145/100 · 90+ 70/63 |
| ETH 30m | 75–79 11/12 · 80–84 18/14 · 85–89 16/22 · 90+ 7/15 |

| Market | Regime and wins/losses |
| --- | --- |
| BTC 10m | ranging 70/70 · reversal 348/264 · strong_trend 41/21 · weak_trend 258/195 |
| BTC 30m | ranging 2/3 · reversal 53/62 · strong_trend 4/2 · weak_trend 4/7 |
| ETH 10m | ranging 71/50 · reversal 321/242 · strong_trend 30/23 · weak_trend 242/191 |
| ETH 30m | ranging 1/2 · reversal 46/53 · strong_trend 1/1 · weak_trend 4/7 |

## Limitations

These are exchange-index proxy observations. Minute closes cannot verify the
actual Event Contract opening price, expiry convention, tie rule or eligible
payout. The replay assumes availability at the close and cannot reconstruct
live quote freshness, ingestion latency or revised historical venue data.
The live worker requires a current canonical Bybit quote before recording.

Nine available macro rows overlapped the overall archive range, but none
were eligible at the affected historical decision times using the available
point-in-time version timestamps. The persisted calendar lacks earlier
versions and cannot reproduce historical macro coverage. Live macro gating
consumes known high/critical events. The two separate horizons and adjacent
signals can overlap. The rates are descriptive and do not establish an
out-of-sample edge or probability calibration. The 30m samples are small.
No payout data was available, so EV was omitted.

## Reproduction and live statistics

```sh
python -m alpha_radar.event_contracts.shadow_archive /tmp/bybit-v1 \
  --days 90 --end 2026-11-27T15:55:00+00:00
python -m alpha_radar.event_contracts.shadow_audit replay --days 90 \
  --directory /tmp/bybit-v1 --end 2026-11-27T15:55:00+00:00 \
  --output /tmp/event-signal-audit.json
python -m alpha_radar.event_contracts.shadow_audit live --days 30
```

The replay produces counts by state, rejection reason, instrument, horizon,
direction, score band and regime, plus per-signal evidence. Live analytics
use the same grouping over stored observations. The operating window is 30
days of shadow observation, with each market/horizon reviewed separately.

See [Event Signal implementation](EVENT_SIGNAL_V1.md).
