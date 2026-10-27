/** Frozen-input coverage only. No rule search, PnL, provider access, or production writes.
 * node --experimental-strip-types scripts/audit/compare-v11.mjs INPUT.json OUTPUT_DIR
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { calculateTechnicalContext } from "../../apps/web/src/lib/market/technical-context.ts";
import { calculateTradeSetup } from "../../apps/web/src/lib/market/trade-setup.ts";
import {
  calculateMaEntry,
  DEFAULT_MA,
  MA_RULES,
} from "../../apps/web/src/lib/market/ma-confluence-entry.ts";
import { calculateMaEntry as original } from "../../apps/web/tests/fixtures/ma-entry-v1/ma-confluence-entry.ts";
import {
  calculateTradeGuide,
  guideReady,
} from "../../apps/web/src/lib/market/trade-guide.ts";
import {
  higherMarketInterval,
  intervalSeconds,
} from "../../apps/web/src/lib/market/intervals.ts";
import { observers } from "./observe.mjs";
import {
  states,
  stages,
  maBlockers,
  guideBlockers,
  validateSeries,
  higherAt,
} from "./replay.mjs";
const nativePath = "../../apps/web/src/lib/market/ma-confluence-entry.ts";
const frozenPath =
  "../../apps/web/tests/fixtures/ma-entry-v1/ma-confluence-entry.ts";
function targetBlock(path) {
  const s = readFileSync(new URL(path, import.meta.url), "utf8");
  return s.slice(
    s.indexOf("  const ahead = barriers"),
    s.indexOf("  const momentum ="),
  );
}
const zero = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));
export function variants() {
  const old = targetBlock(frozenPath),
    current = targetBlock(nativePath);
  assert.ok(old && current && old !== current);
  return {
    v1: observers({ maPath: frozenPath }),
    episode_only: observers({ changes: [[current, old]] }),
    room_only: observers({ maPath: frozenPath, changes: [[old, current]] }),
    v11: observers(),
  };
}
export function compareSeries(series, higher, start, end, progress = () => {}) {
  validateSeries(series, end);
  validateSeries(higher, end);
  const methods = variants();
  const results = Object.fromEntries(
    Object.keys(methods).map((key) => [
      key,
      {
        counts: zero(states),
        funnel: zero(stages),
        maRaw: zero(maBlockers),
        maFirst: zero(maBlockers),
        guideFirst: zero(guideBlockers),
        maStates: {},
        ready_episodes: 0,
        episodes: [],
        samples: [],
      },
    ]),
  );
  const previousMa = {},
    previousGuide = {},
    previousState = {};
  let scored = 0;
  for (let i = 0; i < series.candles.length; i++) {
    const bar = series.candles[i],
      time = Date.parse(bar.close_time);
    // Burn in longer than the entire episode lifespan; no cold retest is
    // back-searched at the scoring boundary. Indicators still receive full 800.
    if (
      i < 249 ||
      time <
        start -
          (MA_RULES.impulseLookback + MA_RULES.retestLookback) *
            intervalSeconds[series.interval] *
            1000
    )
      continue;
    const candles = series.candles.slice(Math.max(0, i - 799), i + 1),
      htf = higherAt(higher.candles, time, higher.interval);
    const snapshot = calculateTechnicalContext(
      candles,
      Number(bar.close),
      series.interval,
      htf,
      series.id,
    );
    const setup = calculateTradeSetup(snapshot, series.id, series.interval);
    for (const [key, method] of Object.entries(methods)) {
      const observed = method.ma(
          snapshot,
          series.id,
          series.interval,
          DEFAULT_MA,
          previousMa[key],
        ),
        ma = observed.result;
      if (key === "v1")
        assert.deepEqual(ma, original(snapshot, series.id, series.interval));
      if (key === "v11")
        assert.deepEqual(
          ma,
          calculateMaEntry(
            snapshot,
            series.id,
            series.interval,
            DEFAULT_MA,
            previousMa[key],
          ),
        );
      previousMa[key] = ma;
      const guide = calculateTradeGuide(
        snapshot,
        ma,
        setup,
        series.id,
        series.interval,
        previousGuide[key],
      );
      const gp = method.guide(
        snapshot,
        ma,
        setup,
        series.id,
        series.interval,
        previousGuide[key],
      );
      assert.deepEqual(gp.result, guide);
      if (guideReady(guide)) previousGuide[key] = guide;
      else if (
        guide.state === "WAIT" ||
        previousGuide[key]?.ma_settings_key !== guide.ma_settings_key
      )
        previousGuide[key] = undefined;
      if (time < start) {
        previousState[key] = guide.state;
        continue;
      }
      const out = results[key],
        d = observed.trace,
        adverse = ma.reason_codes.filter((r) => maBlockers.includes(r)),
        has = (r) => adverse.includes(r);
      out.counts[guide.state]++;
      out.maStates[ma.state] = (out.maStates[ma.state] ?? 0) + 1;
      for (const r of adverse) out.maRaw[r]++;
      if (adverse[0]) out.maFirst[adverse[0]]++;
      const first = guide.reason_codes.find((r) => guideBlockers.includes(r));
      if (first) out.guideFirst[first]++;
      const passes = [
        ma.setup_direction !== "none",
        !!d && d.direction * d.slope >= MA_RULES.slopeAtr,
        !!d && d.impulse >= 0,
        !!d && d.retests.length > 0,
        !has("repeated_crosses"),
        !has("excess_retests"),
        !!d?.macdAligned,
        !!d?.volumeHealthy,
        !!d?.confirmed,
        !!d && d.target !== null,
        !has("near_obstruction"),
        !has("overextended"),
        ma.confidence_score >= 65,
        ma.confidence_score >= 80,
        gp.trace?.rr >= 1.2,
        gp.trace?.rr >= 1.5,
        guideReady(guide),
      ];
      let pass = true;
      passes.forEach((v, j) => {
        pass &&= v;
        if (pass) out.funnel[stages[j]]++;
      });
      if (guideReady(guide) && previousState[key] !== guide.state) {
        out.ready_episodes++;
        const compact = {
          instrument: series.symbol,
          market_instrument_id: series.id,
          timeframe: series.interval,
          timestamp: guide.confirmed_at,
          direction: guide.direction,
          ma: ma.ma_value,
          ma_version: ma.algorithm_version,
          entry_zone: [guide.entry_zone_low, guide.entry_zone_high],
          reference_entry: guide.reference_entry_price,
          stop: guide.stop_price,
          tp1: guide.tp1_price,
          tp2: guide.tp2_price,
          rr: guide.reward_risk_tp1,
          trend: snapshot.trend.direction,
          market_state: snapshot.state.phase,
          ma_reasons: ma.reason_codes,
          retest_started_at: ma.diagnostics.retest_started_at ?? null,
          retest_age: ma.diagnostics.retest_age_bars ?? null,
          structural_room_atr:
            ma.diagnostics.structural_room_atr ??
            (d.direction * (d.target - d.trigger)) / d.atr,
          room_anchor: ma.diagnostics.room_anchor ?? d.trigger,
        };
        out.episodes.push(compact);
        if (
          key === "v11" &&
          out.samples.filter((s) => s.guide.direction === guide.direction)
            .length < 3
        )
          out.samples.push({
            symbol: series.symbol,
            snapshot,
            setup,
            ma,
            guide,
            candles,
            higher: htf,
          });
      }
      previousState[key] = guide.state;
    }
    if (time >= start) {
      scored++;
      if (scored % 1000 === 0)
        progress({
          symbol: series.symbol,
          interval: series.interval,
          scored,
          counts: results.v11.counts,
        });
    }
  }
  return {
    symbol: series.symbol,
    id: series.id,
    interval: series.interval,
    scored,
    results,
  };
}
if (!isMainThread) {
  const { series, higher, start, end } = workerData;
  parentPort.postMessage({
    result: compareSeries(series, higher, start, end, (value) =>
      parentPort.postMessage({ progress: value }),
    ),
  });
} else if (
  process.argv[1] &&
  new URL(import.meta.url).pathname === process.argv[1]
) {
  const [input, directory] = process.argv.slice(2);
  assert.ok(input && directory);
  execFileSync(
    "git",
    [
      "diff",
      "--exit-code",
      "4ec1617e17a560e244b7c89616f3519e472b173e",
      "--",
      ...[
        "technical-levels",
        "market-state",
        "trade-setup",
        "trade-guide",
        "technical-context",
        "technical-worker-engine",
        "technical-worker-client",
        "chart-context-store",
        "intervals",
      ].map((n) => "apps/web/src/lib/market/" + n + ".ts"),
    ],
    { stdio: "pipe" },
  );
  const originalText = execFileSync(
    "git",
    [
      "show",
      "4ec1617e17a560e244b7c89616f3519e472b173e:apps/web/src/lib/market/ma-confluence-entry.ts",
    ],
    { encoding: "utf8" },
  );
  const frozenText = readFileSync(
    new URL(frozenPath, import.meta.url),
    "utf8",
  ).replaceAll("../../../src/lib/market/", "./");
  assert.equal(
    frozenText,
    originalText,
    "V1 oracle must remain immutable apart from relative imports",
  );
  const bytes = readFileSync(input),
    data = JSON.parse(bytes),
    hash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    hash,
    "ab818b5c304848215f2f82daf4e827b89f4e05f1718c389c6158e0dba4f3d150",
    "Use EXACT frozen audit input, not a later export",
  );
  mkdirSync(directory, { recursive: true });
  const queue = data.series
    .filter((s) => ["15m", "1h", "4h"].includes(s.interval))
    .sort((a, b) => b.candles.length - a.candles.length);
  const summaries = [];
  async function consume() {
    while (queue.length) {
      const series = queue.shift(),
        higher = data.series.find(
          (s) =>
            s.id === series.id &&
            s.interval === higherMarketInterval[series.interval],
        );
      assert.ok(higher);
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), {
          workerData: {
            series,
            higher,
            start: Date.parse(data.requested_start),
            end: Date.parse(data.exported_at),
          },
          execArgv: [
            "--experimental-strip-types",
            "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
          ],
        });
        let done = false;
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (code || !done) reject(new Error(`Replay exit ${code}`));
        });
        worker.on("message", (m) => {
          if (m.progress) console.log(JSON.stringify(m.progress));
          else {
            done = true;
            resolve(m.result);
          }
        });
      });
      writeFileSync(
        join(directory, series.symbol + "-" + series.interval + ".json"),
        JSON.stringify(result, null, 2) + "\n",
      );
      const summary = structuredClone(result);
      for (const r of Object.values(summary.results)) delete r.samples;
      summaries.push(summary);
      console.log(
        JSON.stringify({
          complete: series.symbol + ":" + series.interval,
          counts: result.results.v11.counts,
        }),
      );
    }
  }
  await Promise.all(Array.from({ length: 3 }, consume));
  summaries.sort((a, b) =>
    (a.symbol + a.interval).localeCompare(b.symbol + b.interval),
  );
  const baseline = JSON.parse(
    readFileSync(
      new URL("../../docs/TRADE_GUIDE_SIGNAL_AUDIT.json", import.meta.url),
    ),
  );
  for (const s of summaries) {
    const b = baseline.results.find(
      (r) => r.id === s.id && r.interval === s.interval,
    );
    assert.deepEqual(s.results.v1.counts, b.counts);
    assert.deepEqual(s.results.v1.funnel, b.funnel);
  }
  writeFileSync(
    join(directory, "comparison.json"),
    JSON.stringify(
      {
        format: "ma-entry-v11-coverage",
        input_sha256: hash,
        base_main: "4ec1617e17a560e244b7c89616f3519e472b173e",
        start: data.requested_start,
        end: data.exported_at,
        series: summaries,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Comparison complete; do not tune further if V1.1 READY is zero.",
  );
}
