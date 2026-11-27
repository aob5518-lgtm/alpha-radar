# Event Contract Simulator V1

The bilingual `/event-contracts` page runs a paper-only simulation for BTCUSDT and
ETHUSDT at 10 and 30 minutes. It uses virtual USDT. There is no real execution.
The Chart signal and the simulator share the frozen Event Signal V1 records.

## Session and worker

Enable `EVENT_SIGNAL_SHADOW_ENABLED` and `EVENT_SIMULATOR_ENABLED` on the existing
API, Web and Celery Worker. Only the API needs `EVENT_SIMULATOR_ADMIN_TOKEN`,
a randomly generated operator secret of at least 32 characters. The shared
installation has a public read-only view. Starting, pausing and opening a new
session require the operator to enter the token in Settings. The browser sends
it as a bearer header and keeps it only in the current page input. Use HTTPS.

`GET /api/v1/event-simulator` returns the current session, four live cards, active
bets, performance and the first page of history. It accepts `session_id`, `before`
and `sessions_before` UUID cursors. `POST` opens a new session with a complete
settings snapshot, and `PATCH` starts or pauses the named current session.
Mutations reject a stale session identity. New sessions archive their predecessor.
Pausing blocks entries, and completing or archiving a session preserves pending
settlements and the original ledger.

Every ten seconds Celery scans committed, undecided `event-signal-v1` rows for the
current session. A candidate must belong to its exact UUID and horizon, be within
the existing 90-second confirmation freshness window, have the exact confirmed
Bybit trigger candle, and be confirmed at or after the session start or last
resume. A PostgreSQL transaction-level advisory lock serializes worker and control
transactions. A partial unique index permits one current session. The session
and signal unique keys enforce one final decision and at most one bet per pair.
A partial unique index also enforces one active bet per canonical instrument,
horizon and session. History and recent decision codes are accessible on the page.
Migration `20261128_0010` adds the three tables. Rolling the application back can
retain the new tables for a later reactivation.

## Settings and risk

| Setting | Default |
| --- | --- |
| Starting virtual balance | 10,000 USDT |
| Markets and horizons | BTCUSDT and ETHUSDT, 10m and 30m |
| Eligibility | Strong directions, evidence ≥85 |
| Stake | 1% of realized bankroll |
| Per-bet cap | 2% of realized bankroll |
| Total payout assumption | 1.80× for both horizons |
| Daily loss budget | 5% of UTC day-opening bankroll |
| Loss cooldown | 60 minutes after 5 consecutive losses |
| Active limit | 4 |

Fixed amount and fixed percentage use Decimal and round down to cents. Both
are capped at 2%. The full stake is reserved while a bet is active. An entry
requires enough available balance and enough daily loss budget to cover the new
stake plus all active stakes. Realized losses reduce this budget. Realized gains
can restore the budget up to its initial cap. The first tick on a new UTC day
uses the then-current realized balance as the new baseline. Pending positions
remain reserved across midnight. A cooldown starts when the loss counter
reaches its limit. Outstanding bets continue to settle during cooldown.
Wins clear the counter. Cooldown prevents new bets independently of the
displayed lifetime losing streak. No progressive stake sizing is implemented.

## Settlement and performance

Both entry and expiry prices use the Binance Index minute-close research proxy
selected by `event-shadow-v1`. The frozen reference, evidence, expiry, payout
and settings are immutable. The simulator waits for the shadow result at the
exact expiry. HIGHER wins strictly above the reference and LOWER wins strictly
below it. Under the existing proxy rule, an equal price is a loss. A shadow
observation that ends with a missing expiry price voids the paper bet and
releases its stake.

- Win gross return is stake × multiplier, rounded to cents half up. Net P&L is gross return less stake.
- Loss gross return is zero. Net P&L is the negative stake.
- Void gross return equals the stake. Net P&L is zero.
- Break-even hit rate is 1 ÷ multiplier, or 55.56% at the default 1.80× assumption.

Settlement records before and after balances in a single ordered ledger. Drawdown
uses the realized peak-to-trough percentage. Profit factor is positive P&L
divided by absolute negative P&L and is undefined without any loss. Win rate
uses only settled wins and losses. Voids do not change the loss streak.
Performance is grouped by market and horizon, score band and direction.
Return contribution uses the session starting bankroll as its denominator.
The equity curve samples the ordered ledger and retains its starting
and latest values.

Direction match rate and simulated P&L are shown separately. The evidence score
is ordinal. The payout multiplier is a scenario input and the actual exchange
settlement convention is unverified. V1's prior 90-day shadow audit measured
45.99% and 45.22% proxy match rates for BTC and ETH 30m respectively, across
all emitted V1 directions. Those are historical shadow observations from a
different eligible sample. Both horizons remain enabled in the new live session.
The new session begins at activation without importing prior signals.

See [Signal V1](EVENT_SIGNAL_V1.md) and [historical audit](EVENT_SIGNAL_V1_AUDIT.md).
