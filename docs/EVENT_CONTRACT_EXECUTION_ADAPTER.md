# Event Contract Live Execution Architecture V1

Event Signal V1 and Paper are frozen. The existing worker consumes a stored signal and
creates at most one intent per signal for the installation's active policy. PostgreSQL
stores its frozen instrument, direction, score, generated time, reference price/source,
strategy version, premium, payout floor, risk settings, adapter and deadline. The
deadline is the earlier of the signal expiry and 60s for 10m or 120s for 30m.

## Adapter and execution gates

`LIVE_EXECUTION_ENABLED=false` keeps dispatch off by default. Operator activation and
the runtime kill switch are independent. `LIVE_EXECUTION_ADAPTER` applies only to new
intents and defaults to `MOBILE_HANDOFF`. `MANUAL` starts an operator-managed record.
`MOBILE_HANDOFF` prepares the existing official app entry after a successful API
response. The operator places either order. `RESEARCH_DISABLED` always fails closed.
There is no fallback, broker session, provider write, or worker dispatch in V1.

The authenticated decision API checks the deadline, settings revision, exposure,
daily loss and cooldown, macro window, current reference freshness and adapter health.
It stores absolute, percent and ATR-normalized reference drift. Drift above the existing
threshold requires an explicit acknowledgement. The operator must enter the current
exchange-displayed payout. A missing or below-minimum payout returns `BLOCKED_PAYOUT`.
The operator checks it again before placing the order because the quote can change
outside Alpha Radar.

## State and reconciliation

`CREATED` transitions to `RISK_APPROVED` or `CANCELLED`.
`READY_FOR_EXECUTION` precedes the durable `EXECUTING` claim. A successful mobile
preparation enters `HANDOFF_STARTED`. Manual preparation stays in `EXECUTING` until
the operator supplies evidence. A confirmed order enters `EXECUTED` and appends one
Real Bet. Settlement enters `SETTLED`. Definitive adapter failures enter `FAILED`.
Unstarted intents expire to `EXPIRED`. In-flight expiry or an uncertain adapter outcome
enters `RECONCILIATION_REQUIRED`. A single in-flight or unresolved intent blocks new
starts. The operator checks actual order history and either supplies the order reference
or confirms no order exists, which closes the intent as `CANCELLED`.

Each dispatch claim is committed under the existing PostgreSQL transaction advisory
lock before the adapter runs. A timeout or interrupted attempt cannot be dispatched
again. The UUID follows preparation, execution and reconciliation. Existing unique
constraints cover one intent per signal, one Real Bet per intent and one Real Bet per
external reference. Repeated confirmations with identical terms return the same record.
Kill/disable blocks new starts while preserving recovery and settlement. Historical
mobile handoffs from before migration remain reportable. Actual terms of an
already-placed order are audit evidence, including below-policy payout and mismatch.

## Future adapter contract

Implement `availability`, `health`, `prepare`, `execute`, `reconcile` and `cancel`.
Preparation receives a typed frozen request containing the execution/intent/signal UUIDs,
market UUID, market label, horizon, direction, premium, checked payout, reference price
and deadline. A reviewed provider adapter must independently obtain a fresh executable
quote, carry the execution UUID as a provider idempotency key, bound round-trip latency
to the remaining deadline, and distinguish definitive rejection from an uncertain
outcome. It must reconcile by read-only lookup before any retry can be considered.
Provider-auth secrets belong on the server behind the adapter boundary. Never capture
private requests, raw provider responses, passwords, device identifiers, authorization
headers, cookies or session tokens in PostgreSQL or logs.

The result carries the execution/intent UUID, provenance, status, actual premium,
payout, opening price and timestamp, external reference and a safe error code.
V1 records operator-reported provenance. The private API reports adapter availability,
health, last dispatch success/failure, latest dispatch latency and observed error rate.
Per-intent timings measure signal to intent and intent to dispatch. Real Bet timings
measure actual open and remain separate from Paper. An adapter timeout uses a fixed
sanitized error and cannot create a synthetic order.
