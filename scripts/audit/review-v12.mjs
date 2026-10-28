/** Generate derived review artifacts from a COMPLETED comparison, never raw candle exports.
 * node --experimental-strip-types scripts/audit/review-v12.mjs INPUT COMPARISON OUTPUT_PREFIX
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { calculateTechnicalContext } from "../../apps/web/src/lib/market/technical-context.ts";
import { calculateTradeSetup } from "../../apps/web/src/lib/market/trade-setup.ts";
import { TechnicalWorkerEngine } from "../../apps/web/src/lib/market/technical-worker-engine.ts";
import { calculateMaEntry } from "../../apps/web/src/lib/market/ma-confluence-entry.ts";
import {
  calculateTradeGuide,
  guideReady,
} from "../../apps/web/src/lib/market/trade-guide.ts";
import { higherMarketInterval } from "../../apps/web/src/lib/market/intervals.ts";
import { higherAt } from "./replay.mjs";
import { verifyPresentation } from "./presentation.mjs";
import { verifyV1Integrity } from "./v1-integrity.mjs";
verifyV1Integrity();
const [input, comparisonPath, prefix] = process.argv.slice(2);
assert.ok(input && comparisonPath && prefix, "INPUT COMPARISON OUTPUT_PREFIX");
const bytes = readFileSync(input),
  data = JSON.parse(bytes),
  comparison = JSON.parse(readFileSync(comparisonPath));
assert.equal(
  createHash("sha256").update(bytes).digest("hex"),
  comparison.input_sha256,
);
const modelHash = createHash("sha256")
  .update(
    ["ma-confluence-entry.ts", "entry-evidence.ts", "trade-guide.ts"]
      .map((file) =>
        readFileSync(
          new URL("../../apps/web/src/lib/market/" + file, import.meta.url),
          "utf8",
        ),
      )
      .join("\n"),
  )
  .digest("hex");
assert.equal(modelHash, comparison.model_sha256);
assert.equal(
  comparison.results.reduce((n, r) => n + r.n, 0),
  34020,
);
const allEpisodes = comparison.results.flatMap((r) => r.episodes);
const queues = comparison.results.flatMap((r) =>
  ["long", "short"].map((d) =>
    r.examples.filter(
      (e) => e.direction === d && e.hard_gate_status === "passed",
    ),
  ),
);
const positives = [];
while (positives.length < 20 && queues.some((q) => q.length))
  for (const queue of queues)
    if (queue.length && positives.length < 20) positives.push(queue.shift());
const negatives = comparison.results
  .flatMap((r) =>
    r.examples.filter(
      (e) => e.hard_gate_status === "rejected" && e.state === "WAIT",
    ),
  )
  .slice(0, 12);
const reviews = [];
for (const sample of [...positives, ...negatives]) {
  const series = data.series.find(
    (s) =>
      s.id === sample.market_instrument_id && s.interval === sample.timeframe,
  );
  const index = series.candles.findIndex(
    (c) => c.close_time === sample.timestamp,
  );
  assert.ok(index >= 0);
  const candles = series.candles.slice(Math.max(0, index - 799), index + 1);
  const higher = data.series.find(
    (s) =>
      s.id === series.id &&
      s.interval === higherMarketInterval[series.interval],
  );
  const htf = higherAt(
    higher.candles,
    Date.parse(sample.timestamp),
    higher.interval,
  );
  const snapshot = calculateTechnicalContext(
    candles,
    Number(candles.at(-1).close),
    series.interval,
    htf,
    series.id,
  );
  const setup = calculateTradeSetup(snapshot, series.id, series.interval);
  const ma = calculateMaEntry(snapshot, series.id, series.interval);
  const guide = calculateTradeGuide(
    snapshot,
    ma,
    setup,
    series.id,
    series.interval,
  );
  assert.equal(guide.state, sample.state, "Reconstructed state differs");
  if (guideReady(guide)) {
    assert.deepEqual(
      [
        guide.reference_entry_price,
        guide.stop_price,
        guide.tp1_price,
        guide.tp2_price,
        guide.reward_risk_tp1,
        guide.quality_grade,
        guide.evidence_score,
      ],
      [
        sample.entry,
        sample.stop,
        sample.TP1,
        sample.TP2,
        sample.RR,
        sample.grade,
        sample.score,
      ],
    );
    // Actual historical READY must also survive the accepted rolling Worker path,
    // not just synthetic WAIT-only equivalence fixtures.
    const engine = new TechnicalWorkerEngine();
    const priorCandles = series.candles.slice(index - 800, index);
    assert.equal(priorCandles.length, 800);
    const priorRequest = {
      market_instrument_id: series.id,
      timeframe: series.interval,
      generation: 1,
      revision: "prior",
      candles: priorCandles,
      confirmedClose: Number(priorCandles.at(-1).close),
      higherCandles: higherAt(
        higher.candles,
        Date.parse(priorCandles.at(-1).close_time),
        higher.interval,
      ),
    };
    assert.ok(engine.compute(priorRequest).ok);
    engine.prewarm(priorRequest);
    const current = engine.compute({
      ...priorRequest,
      revision: "current",
      candles,
      higherCandles: htf,
      confirmedClose: Number(candles.at(-1).close),
    });
    assert.ok(current.ok && current.incremental);
    assert.deepEqual(current.snapshot, snapshot);
    const incrementalMa = calculateMaEntry(
      current.snapshot,
      series.id,
      series.interval,
    );
    assert.deepEqual(incrementalMa, ma);
    assert.deepEqual(
      calculateTradeGuide(
        current.snapshot,
        incrementalMa,
        current.setup,
        series.id,
        series.interval,
      ),
      guide,
    );
    reviews.push({
      ...sample,
      rolling_worker_equivalence: true,
      visual: verifyPresentation({
        symbol: sample.instrument,
        guide,
        ma,
        snapshot,
        setup,
        candles,
      }),
    });
  } else {
    assert.ok(guide.hard_failures.length > 0);
    reviews.push({ ...sample, reconstruction_verified: true });
  }
}
const metadata = {
  production_base_sha: comparison.production_base_sha,
  input_sha256: comparison.input_sha256,
  model_sha256: comparison.model_sha256,
  requested_start: comparison.requested_start,
  exported_at: comparison.exported_at,
  reconstruction:
    "Use the private hash-pinned input. Select exact UUID/interval and close timestamp, latest 800 closed bars, and eligible already-closed higher bars; run unchanged technical engines then V1.2 MA/Guide. No future returns.",
  limitation:
    "Current stored candle vintage, not archived historical arrivals/revisions or proof of actual browser delivery. TSX rendering uses mocked chart/socket dependencies; not a production/browser smoke.",
};
writeFileSync(
  prefix + "_EPISODES.json",
  JSON.stringify({ ...metadata, episodes: allEpisodes }, null, 2) + "\n",
);
writeFileSync(
  prefix + "_REVIEW.json",
  JSON.stringify(
    {
      ...metadata,
      positive_count: positives.length,
      rejected_count: negatives.length,
      reviews,
    },
    null,
    2,
  ) + "\n",
);
const summary = {
  ...comparison,
  results: comparison.results.map(({ episodes, examples, ...r }) => ({
    ...r,
    ready_episodes: episodes.length,
    ready_long: episodes.filter((e) => e.direction === "long").length,
    ready_short: episodes.filter((e) => e.direction === "short").length,
  })),
};
writeFileSync(
  prefix + "_SUMMARY.json",
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    episodes: allEpisodes.length,
    positive: positives.length,
    rejected: negatives.length,
    acceptance: comparison.acceptance,
  }),
);
