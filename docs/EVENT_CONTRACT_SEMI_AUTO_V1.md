# Event Contract Semi-Auto V1

`/event-contracts` offers Shadow, Paper and Semi-Auto. Paper is the default view.
The Semi-Auto worker is a third consumer of frozen Event Signal V1 records.
Signal generation, Shadow settlement and the Paper ledger keep their existing
contracts. PostgreSQL owns the four new tables in migration `20261128_0011`.

## Access and activation

`EVENT_SEMI_AUTO_AVAILABLE=true` exposes the mode and enables the existing Celery
worker's polling task. Provide a server-side `EVENT_SEMI_AUTO_OPERATOR_TOKEN` of
at least 32 characters. The entire ledger, including reads and settings, is
private to one installation operator. The dedicated token is entered in the UI,
held in memory and sent in an authorization header over HTTPS. The production
configuration starts with live intent generation disabled. The operator must
acknowledge the first activation. Settings, the acknowledgement and the kill
switch persist in PostgreSQL. Disable and kill cancel pending intents. Active
real records remain available for reconciliation after either action.

## Intent and placement

Celery checks every ten seconds and consumes only new confirmed Bybit-triggered
signals with exact instrument and horizon identity. Intent snapshots contain the
evidence score, Binance Index reference price and a closed-candle true-range
average calculated at the signal cutoff. Only strong directions with an evidence
score of at least 85 can be actionable. The 10m and 30m approval windows expire
60 and 120 seconds after signal generation. The pre-confirmation drift check
compares the latest fresh Binance Index close with the frozen signal reference,
normalized by the stored Bybit ATR14. A drift above 0.25 ATR requires explicit
acknowledgement. Stale data and the existing macro exclusion window block
actions. Settings changes invalidate the previous revision's pending intents.

The operator reviews the intent and opens the official Binance app entry. All
contract selection and order placement take place manually in the Binance App.
The operator enters the actual payout to approve the intent and checks the
exchange's direction, horizon, premium, open price, open time and expiry.
Below-minimum payout is blocked, including on a direct confirmation request.
The user records the order while the intent is actionable in this original
workflow. The [mobile handoff](EVENT_CONTRACT_MOBILE_HANDOFF_V1.md) accepts
audited historical reports for already-executed orders after a timely handoff.
The optional exchange order reference helps detect accidental duplicates.
Binance login credentials, session tokens and private execution adapters are
outside the ledger.

## Risk and accounting

Defaults are fixed 10 USDT, 25 USDT per bet, 50 USDT daily loss, one open real
bet, three consecutive real losses and a 120-minute cooldown. Each canonical
instrument and horizon permits at most one open real bet. At 1.80× total payout,
the break-even hit rate is 55.56%. Evidence scores are ordinal. Risk uses
manual-ledger net P&L recorded during the UTC day and reserves the full premium
of open real records. The daily limit and exposure apply to the actual premium
at confirmation. The worker and all operator writes serialize under the same
transaction advisory lock. Unique indexes enforce the signal-to-intent,
intent-to-bet, order-reference and open-exposure invariants. Retried confirmations
and settlements with the same terms return the existing record.

After the reported contract expiry, the operator records the exchange's
result. The source is `MANUAL_CONFIRMATION` and confidence is operator-reported.
Actual Binance contract settlement remains unverified programmatically. An open
record has `UNKNOWN` provenance. The enum intentionally distinguishes Binance
officially verified evidence and Binance Index proxy evidence from the operator
report. V1 does not infer actual settlement from either market history or Paper
results. A win returns premium × payout using Decimal arithmetic and half-up cent
rounding. A loss returns zero. A tie or cancellation requires the actual gross
return entered by the operator. Net P&L subtracts the premium from gross return.

The Real section tracks win rate, return on settled premium, cash drawdown,
losing streak, average payout and average premium. No real account balance is
collected. The comparison uses the overlapping observation period of the
current Paper session and the Real ledger. The two sets remain individually
reported. The audit records signal intake, risk decisions, handoff preparation,
manual confirmations, settlement and operational switches.
