# Signal-coverage audit (offline, not a trading strategy)

No production imports these tools. No thresholds are modified. No provider calls,
PnL, fees/return fitting, or deployment. Default enabled SMA99 only. Requires the
existing Node 22.18+ / pnpm workspace dependencies; no new package is added.

1. Execute `export-signal-history.sql` with `psql -X -qAt -v ON_ERROR_STOP=1`
   through an authorized production read-only connection. Save stdout in a private
   local file. It exports a repeatable-read snapshot with 90 scoring days plus 800
   bars of warm-up for primary and eligible higher periods. Never print credentials.
2. From repository root:

   ```sh
   node --experimental-strip-types scripts/audit/run.mjs INPUT.json /tmp/signal-audit 3
   node --experimental-strip-types scripts/audit/report.mjs /tmp/signal-audit docs/TRADE_GUIDE_SIGNAL_AUDIT.md INPUT.json
   ```

   Workers are local CPU threads, not agents or production services. Output is
   per-series JSON with exact historical READY examples and a `summary.json`;
   `report.mjs` runs the real TSX presentation harness against those examples.
   The input hash and frozen cutoff make the run reproducible. Preserve that
   input privately: a later DB export is a different vintage, not the same run.
   Do not commit raw provider candle histories or copied production configuration.
3. Review the generated conclusion with the actual results before committing the
   report; the generator deliberately does not make investment/model judgments.
   Commit summary counts (without raw snapshots) alongside the report if useful.
4. Run normal web/backend/Compose CI. The small `signal-audit.test.mjs` suite is
   automatically included by `pnpm web:test`; CI never contacts production.

`observe.mjs` adds audit-only lexical observers to the existing MA/Guide source in
an isolated VM. They capture computed gates before capped-score/early return or
cleared WAIT output hides diagnostics. Anchors must occur exactly once, and **every
replayed candle** compares complete original/probed output. Probe drift fails closed.
No alternate MA/Guide algorithm is used to classify actual historical bars.

`presentation.mjs` reuses the existing component test harness before its first
test registration, checks its boundary/stub anchors, and replaces only the mocked
Guide panel with the actual TSX. Chart-library and sockets remain external mocks;
the Chart's production identity, marker, primary and tooltip logic execute unchanged.

The replay uses close timestamps, not final-history pivots. Current stored backfills
cannot reconstruct historical arrival/revision or browser-session history; disclose
that limitation. All counters are coverage diagnostics, not causal PnL or proof of
calibration. Single-rule acceptance tests never change production thresholds.
