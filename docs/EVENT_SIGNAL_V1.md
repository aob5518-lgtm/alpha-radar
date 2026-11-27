# Event Signal V1 — Shadow Mode

BTCUSDT and ETHUSDT have separate 10m and 30m assessments in the Chart's
existing folded bilingual disclosure. The Python worker computes
`event-signal-v1` and records observations resolved by `event-shadow-v1`.
Persistence uses the additive `20261127_0009` migration. The existing public
research endpoint remains available for legacy records.

| Horizon | Trigger | Context | Bollinger z | VWAP distance (ATR) | Impulse (ATR) | Minimum rejection features | Wick / close fraction | Range edge tolerance (ATR) | Volume climax |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| 10m | Bybit 1m | Bybit 5m | 1.8 | 1.2 | 1.4 | 1 | .32 / .55 | .70 | 1.7× |
| 30m | Bybit 5m | Bybit 15m | 2.0 | 1.4 | 1.6 | 2 | .35 / .60 | .55 | 1.9× |

The worker uses 80 contiguous, confirmed native bars for each interval and
an exact instrument UUID. No 3m aggregate is used. The context close at the
trigger's latest available context boundary must be present. The trigger
can be at most 90 seconds old. A current persisted Bybit quote, confirmed
trigger volume and the exact Binance index minute close are required.
Critical and high macro rows block 30 minutes on either side of a detected
scheduled or known actual release. Date-only rows block the UTC date plus
the same padding. Published real events remain eligible for the post-release
window.

| Group | Cap | Evidence points |
| --- | ---: | --- |
| Extreme | 25 | 10 for recent RSI threshold, 6 for Bollinger, 5 for VWAP, 4 for impulse |
| Exhaustion | 20 | 10 each for divergence and deceleration, 8 for volume follow-through failure |
| Rejection | 20 | 8 body, 5 wick, 5 band re-entry, 7 failed break |
| Structure | 15 | 9 prior context range proximity, 6 failed local break |
| Volume | 10 | 6 climax, 4 reduced follow-through |
| Regime | 10 | 10 ranging or weak, 7 strong, 2 on continuation conflict |

Wilder RSI14 at 70/30 on one of the last four trigger closes establishes a
possible extreme. An extreme requires at least one additional extension
measurement. The preceding 20 trigger candles give the population-standard-
deviation Bollinger basis, typical-price volume-weighted VWAP and mean
pre-extreme true range over 14 bars for ATR normalization. Impulse measures
the excursion relative to the close three bars before the extreme RSI bar.

Divergence requires a fresh price extreme and a three-point RSI deterioration.
Deceleration requires a four-point RSI deterioration plus a retracement of
.25 pre-extreme ATR. A volume climax followed by at most 75% of that volume
and a reversal-side close adds exhaustion evidence. A reverse body and close
in the specified rejection portion of the candle are mandatory. Wick, band
re-entry and failure to hold a break of the preceding local range supply
corroboration. Structure uses extrema of earlier closed context bars.
The Chart's authoritative levels are computed in its browser worker and are
not an input to backend replay.

Context EMA20/EMA50 spread and the four-bar EMA20 change, normalized by
context ATR, define strong trend at .75/.35 ATR with aligned signs. A
spread above .25 ATR outside strong trend is weak trend. A failed break
with rejection tags reversal. When the strong trend has aligned higher
highs/higher lows or mirrored lower highs/lower lows, lack of exhaustion
or rejection blocks the countertrend direction. A trigger close accelerating
more than .35 trigger ATR in the original direction blocks emission.

Scores below 65 wait. Scores 65–74 retain an observation direction while
waiting. A score of 75–84 can emit a regular direction once all gates pass.
A score of at least 85 with exhaustion and without trend conflict can emit
a strong direction. The evidence score is ordinal.

A setup is anchored to the latest prior RSI normalization (45–55) or opposite
RSI extreme in the last 40 trigger bars. Unanchored or duplicate episodes
wait. PostgreSQL unique keys scope one record to exact instrument/horizon/
version/confirmation cutoff and one to direction/episode. Opposite directions
and independent normalized episodes are eligible. The original reference,
timestamp, score, evidence and version are frozen on insert.

The reference is the confirmed public Binance USD-M index minute close
at the trigger cutoff. Expiry is that boundary plus exactly 10 or 30 minutes.
The worker stores the actual later generation timestamp separately. It
resolves at the exact index close at expiry and marks an absent quote missing
after one hour. Above reference wins HIGHER, below wins LOWER, and equality
counts as a loss under the explicit research rule. Market and settlement
sources and both instrument UUIDs remain in the record. Exchange equivalence
and exchange tie handling remain unverified, and probability/EV are null.

Set `EVENT_SIGNAL_SHADOW_ENABLED=true` for the API, web and existing worker.
Beat schedules a bounded database read every 20 seconds. Existing public
index collection continues and resolves pending legacy observations.
Redis stores short-lived display snapshots and source status under
`alpha-radar:event-signal-v1:status`. The API serves
`GET /api/v1/event-contracts/{asset_id}/shadow?horizon=10|30`. Durable
observations and statistics use PostgreSQL. The Chart reads the same-origin
API and rejects stale and mismatched results. Set the flag false to return to
the previous research panel while retaining both tables.

See [90-day replay and live analytics](EVENT_SIGNAL_V1_AUDIT.md).
