# Signal-coverage audit (offline, not a trading strategy)

No production imports these tools. No thresholds are modified. No provider calls,
PnL, fees/return fitting, or deployment. Default enabled SMA99 only. Requires the
existing Node 22.18+ / pnpm workspace dependencies; no new package is added.

The original V1 audit now imports the immutable `tests/fixtures/ma-entry-v1` oracle,
not the upgraded live MA module. Protected technical engines/Guide still must match
the original source. The original report/data hash remains a V1 result, not V1.1.

For the V1.1 comparison, run `compare-v11.mjs INPUT.json OUTPUT_DIR`. It requires
the exact original input SHA-256, compares V1, episode-only, room-only and combined
on one shared causal technical context per bar, and validates V1 counts/funnels
against the committed original report. It does not search parameter values or use PnL.
The two audit-only ablations swap only the guarded original/current target block;
they are never runtime feature flags or deployed alternative strategies. Full V1.1
MA/Guide outputs are compared with their observational probes on every bar.
Only compact derived READY episode records belong in Git; full private sample
contexts/candles stay in the local output directory for actual TSX verification.
Then `report-v11.mjs OUTPUT_DIR INPUT.json` generates the comparison report,
every compact READY episode and up to 20 representative examples. At each actual
V1.1 episode start it independently verifies the four modes on that same candle
(with bounded prior warm-up), so attribution is not guessed from aggregate counts.

1. Execute `export-signal-history.sql` with `psql -X -qAt -v ON_ERROR_STOP=1`
   through an authorized production read-only connection. Save stdout in a private
   local file. It exports a repeatable-read snapshot with 90 scoring days plus 800
   bars of warm-up for primary and eligible higher periods. Never print credentials.
2. From repository root:

   ```sh
   node --experimental-strip-types scripts/audit/run.mjs INPUT.json /tmp/signal-audit 3
   node --experimental-strip-types scripts/audit/report.mjs /tmp/signal-audit docs/TRADE_GUIDE_SIGNAL_AUDIT.md INPUT.json docs/TRADE_GUIDE_SIGNAL_AUDIT.json
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
