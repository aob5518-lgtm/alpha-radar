# Event Contract Direction Research V1

User-authorized Chart extension, based on main `2b70666cf21436e3dd398c87af871648c9f8f818`.
Version: `event-contract-direction-v1`. BTC and ETH only; independent 10-minute and
30-minute horizons. **Unvalidated research**, never an order, calibrated probability,
expected return, actual exchange win/loss record or substitute for settlement rules.

## Product and data boundary

A compact, default-closed disclosure shares the existing Chart timeframe toolbar.
Its expanded content overlays rather than displaces candles. English and Simplified
Chinese include source, freshness, reason and explicit unvalidated/proxy labeling.
The forecast horizon is independent of the Chart timeframe. SOL and other instruments
do not show this BTC/ETH-only control. Asset/horizon changes discard outstanding
requests and old state; expiry is enforced locally even during polling interruption.

The existing Bybit Chart, Structural Levels V1.1, Trend V1.1, Market State, MA Entry
and Trade Guide algorithms, thresholds, workers, caches and streams remain unchanged.
This independently versioned Python research strategy uses MA pullbacks and observed
confirmed swing barriers, **not a second implementation of authoritative Chart S1/R1**.
Existing Chart technical context describes Bybit perpetuals and cannot serve as a
Binance-index prediction or settlement label.

The public official endpoint is
`https://fapi.binance.com/fapi/v1/indexPriceKlines?pair=BTCUSDT&interval=1m` (ETHUSDT
also supported). This is USD-M **index** history, not mark price, trade price, spot
Klines or Bybit data. UTC minute starts/exclusive ends, exact Decimal OHLC and source
metadata persist in the existing Timescale `market_candles` table. Volume is null:
the provider's zero/ignore fields are not trade volume. Only complete closed candles
are persisted. Duplicate identities upsert; gaps are never filled synthetically.

Two separate canonical Asset-linked `MarketInstrument` records use provider
`binance_index` and type `index`. Research indices are excluded from generic Asset
preferred-history selection; explicit instrument APIs remain available. Existing
Bybit selections and seed counts are preserved. The research worker idempotently
seeds indices after canonical assets exist, independently of normal market seeding.

**Settlement equivalence is unverified.** The Binance Event Contract opening and
settlement index must be independently matched to this series before actual product
accuracy/profitability can be claimed. Arbitrary-second exchange entry/expiry and
the documented next-second opening behavior cannot be reconstructed from minute
OHLC. No exchange credentials, execution API or account data are requested.

## Frozen candidate hypothesis

All constants live in `event_contracts/strategy.py:Rules`, frozen before the initial
audit. These are hypotheses, not tuned winning thresholds. Each assessment uses at
most 1,200 closed 1m candles; missing/duplicate/nonconsecutive minutes cause
unavailable. The model prepares complete UTC-aligned 5m/15m groups, then exactly 60
bars per feature timeframe, with SMA-seeded EMA20/50 and Wilder ATR14.

| Horizon | Environment | Confirmation |
| --- | --- | --- |
| 10 minutes | 5m | 1m |
| 30 minutes | 15m | 5m |

Up: environment close above EMA20 above EMA50, five-bar EMA20 slope at least 0.15
environment ATR. Down is the exact mirror. No aligned environment means WAIT.
Trigger interaction zone is EMA20 ±0.20 trigger ATR. A touch must exist within the
last three closed bars, with no more than four touch bars in the last twelve.
Three MA-side crossings in twelve bars mean WAIT. A last-three range above 2.5 ATR
or close more than 1 ATR from the MA means WAIT. Confirmation requires a directional
body, close beyond the appropriate zone edge **and previous high/low**, and in the
directional outer 35% of the candle range. A forward confirmed swing (three closed
bars to each side) within 0.75 ATR blocks the candidate. No price target is generated.

Important scheduled persisted Macro Events overlapping publication through expiry
block signals; an important date-only Macro record blocks the UTC day conservatively.
This does not assert complete historical calendar coverage or live Macro polling.
Macro ingestion/settings and Event records are never modified by this module.

Only data received within 90 seconds of the last confirmed minute is current.
Candidates expire within 60 seconds of publication and within 90 seconds of the
confirmed minute. A continuous MA interaction has one episode key; database unique
constraints prevent duplicate episodes. One pending paper observation per asset and
horizon suppresses overlapping candidates. All other outcomes are WAIT/unavailable
with typed reasons, never fabricated signals to populate an empty panel.

## Persistence and time semantics

Migration `20261127_0008` adds `event_contract_decisions` only. Existing data and
migration history remain intact. An instrument/horizon/version/confirmed-time unique
constraint makes decision insertion idempotent. An additional nullable episode
unique constraint prevents repeated directional episodes. UTC `timestamptz`, UUID
Asset/instrument foreign keys and Decimal financial columns are used throughout.

The append-only decision contains generation time, input-confirmation cutoff,
valid-until, strategy version, feature values, episode and input SHA-256. Later
observations update only the separate observation columns; correction/recalculation
never rewrites previously recorded signal evidence.

Paper entry is explicitly **the next full minute after publication**. Its price is
that index minute's observed open; expiry is exactly 10/30 minutes after that assumed
entry. The expiry-minute open is read only once the provider confirms that minute.
This is a delayed minute-open **proxy**, never an actual order fill/settlement.
Missing either exact minute remains pending for one hour, then becomes `missing`.
No nearest-neighbor price, carry-forward, fabricated candle or synthetic refund.
Ties are a distinct proxy observation. The API exposes at most twenty recent
directional observations; the panel shows the latest five. No win percentage is
promoted to a predictive probability.

## Operations, API and audit

`EVENT_CONTRACTS_ENABLED=false` by default. When enabled, existing Celery Beat runs
the existing worker once a minute. A token-owned Redis lease prevents overlap;
each asset has its own database session/commit and structured failure log. Requests
are bounded to the reviewed official host/pairs. There is no user-supplied URL,
third-party proxy, fallback provider, new service or dependency. Provider errors
cannot modify the Chart. Stale data automatically withholds direction.

Read-only `GET /api/v1/event-contracts/{asset_uuid}?horizon=10|30` reads PostgreSQL
only. Invalid UUID/horizon is rejected; unsupported assets return 404. Disabled,
warming-up, stale and unavailable responses remain explicit. `probability` and
`expected_value` are always null; `settlement_basis_verified` always false.
Redis operational output is `alpha-radar:event-contracts:status`, with last run,
succeeded/failed symbols and healthy/degraded/failed state. This opt-in research
feed is not a critical dependency of baseline Chart readiness.

```sh
python -m alpha_radar.event_contracts.cli backfill --days 180
python -m alpha_radar.event_contracts.cli sync
python -m alpha_radar.event_contracts.cli audit --days 180 --output /tmp/event-contract-audit.json
# Optional explicit hypothetical payout, NOT a live venue quote:
python -m alpha_radar.event_contracts.cli audit --days 180 --payout 0.8 --output /tmp/event-contract-audit-payout.json
```

Backfill is bounded to 365 days and 530 pages per pair, paced and idempotent. It is
manual, separate from API requests and normal Bybit retention/backfill. Historical
audit is read-only with respect to decisions: it never creates historical records
that could be mistaken for live signals. It uses identical bounded rules, causal
complete higher-period groups, one-minute publication/entry delay, distinct episodes
and nonoverlapping horizons. The chronological 60/20/20 development/validation/holdout
split purges outcomes crossing boundaries. Rules are not fitted to any split.

Report each asset/horizon separately: coverage, rejection counts, immutable input
hash, distinct observations, ties/missing results, observed match fraction,
descriptive Wilson interval and consecutive failures. Optional hypothetical payout
adds net units and drawdown; it never assumes a real historical/live payout. Simple
always-up and previous-5m-direction baselines use the same selected timestamps.

These intervals do not correct serial/cross-asset dependence. Current-vintage market
history/calendar cannot reproduce historical revisions or prove full Event coverage.
Minute inputs do not test 2/5/10-second execution latency. No fitted/calibrated
model, positive expectancy, statistical significance or production trading approval
is claimed. Real calibration requires verified settlement labels, payout history,
adequate independent out-of-sample observations and realtime shadow evidence.

## Verification and rollback

Unit tests cover symmetric candidates, no-look-ahead/partial exclusion, UTC complete
groups, stale/gapped data, Macro gates, payout math, provider validation, identity,
immutable/idempotent decisions, proxy outcomes/missing prices and asset isolation.
Frontend tests cover exact asset/horizon, stale/expired/future rejection, typed
transport, bilingual copy, default folding and unchanged Chart resilience.
Compose integration additionally runs `event_contracts.integration_verify` against
real PostgreSQL with deterministic fixtures; it refuses production execution.

Production release uses merged main, validated backup and retained previous images.
The additive table/indices may remain on application rollback; never downgrade a
production database merely to revert this optional panel. Disable the flag and use
the previous release/images if research data or baseline readiness fail.
