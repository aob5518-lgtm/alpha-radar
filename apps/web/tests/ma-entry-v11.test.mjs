import assert from "node:assert/strict";
import test from "node:test";
import { advanceRetest } from "../src/lib/market/ma-retest-episode.ts";
import {
  calculateMaEntry,
  MA_RULES,
  DEFAULT_MA,
} from "../src/lib/market/ma-confluence-entry.ts";
import { maFixture } from "./helpers/ma-fixtures.mjs";
import { btcId, ethId, fixtureHistory } from "./helpers/chart-fixtures.mjs";
import { calculateTechnicalContext } from "../src/lib/market/technical-context.ts";
import { TechnicalWorkerEngine } from "../src/lib/market/technical-worker-engine.ts";
import { MA_RULES as frozenRules } from "./fixtures/ma-entry-v1/ma-confluence-entry.ts";
import { GUIDE_RULES } from "../src/lib/market/trade-guide.ts";
test("all numeric MA and Guide gates remain frozen", () => {
  assert.deepEqual(MA_RULES, frozenRules);
  assert.deepEqual(GUIDE_RULES, {
    minimumRR: 1.2,
    readyRR: 1.5,
    favorableRR: 2,
  });
});
function step(i, changes = {}) {
  const candles = Array.from({ length: i + 2 }, (_, j) => ({
    openTime: new Date(j * 900000).toISOString(),
    closeTime: new Date((j + 1) * 900000).toISOString(),
    open: 100,
    high: j === 1 ? 100.1 : 100.6,
    low: j === 1 ? 99.9 : 100.3,
    close: j === 1 ? 100.05 : 100.5,
    volume: 100,
    isClosed: true,
  }));
  return {
    id: btcId,
    interval: "15m",
    settings: "SMA:99:true",
    candles,
    direction: 1,
    low: 99.8,
    high: 100.2,
    atr: 1,
    impulse: 0,
    touching: i === 0,
    previousTouching: i === 1,
    conflicting: false,
    chop: false,
    extended: false,
    maximumAge: 3,
    invalidationAtr: 0.25,
    ...changes,
  };
}
for (const age of [1, 2, 3])
  test(`episode supports confirmation ${age} closed bars after touch, then expires`, () => {
    let state = advanceRetest(step(0));
    const start = state.episode.started_at;
    for (let i = 1; i <= age; i++) state = advanceRetest(step(i), state.memory);
    assert.equal(state.active, true);
    assert.equal(state.age, age);
    assert.equal(state.episode.started_at, start);
    assert.equal(state.extreme, 99.9);
  });
test("continuous touches cannot renew expiry, separate departure and retest starts a new episode", () => {
  let state = advanceRetest(step(0));
  for (let i = 1; i <= 4; i++)
    state = advanceRetest(
      step(i, { touching: true, previousTouching: true }),
      state.memory,
    );
  assert.equal(state.active, false);
  state = advanceRetest(step(5), state.memory);
  state = advanceRetest(
    step(6, { touching: true, previousTouching: false }),
    state.memory,
  );
  assert.equal(state.active, true);
  assert.equal(state.age, 0);
  assert.equal(state.episode.started_at, step(6).candles.at(-1).closeTime);
});
for (const [name, change] of [
  ["trend flip", { direction: -1 }],
  ["material state conflict", { conflicting: true }],
  ["chop", { chop: true }],
  ["extension", { extended: true }],
  ["expiry", {}],
])
  test(`episode cancelled by ${name}, cannot resurrect without new touch`, () => {
    const initial = advanceRetest(step(0));
    const next = advanceRetest(
      step(name === "expiry" ? 4 : 1, change),
      initial.memory,
    );
    assert.equal(next.active, false);
    if (name === "trend flip")
      assert.equal(
        next.failed,
        false,
        "Never evaluate a long stop using short-side math",
      );
    assert.equal(
      advanceRetest(step(name === "expiry" ? 5 : 2), next.memory).active,
      false,
    );
  });
test("stop failure excludes failure candle extreme, partials never update memory", () => {
  const initial = advanceRetest(step(0)),
    input = step(1);
  input.candles.at(-1).close = 99;
  input.candles.at(-1).low = 90;
  const old = structuredClone(initial.memory),
    failed = advanceRetest(input, initial.memory);
  assert.equal(failed.failed, true);
  assert.equal(failed.active, false);
  assert.deepEqual(initial.memory, old);
  const partial = step(1);
  partial.candles.at(-1).isClosed = false;
  assert.throws(() => advanceRetest(partial, initial.memory));
  assert.deepEqual(initial.memory, old);
});
test("same confirmed revision is idempotent; HTF replacement rewinds before-current checkpoint", () => {
  const first = advanceRetest(step(0)),
    input = step(1);
  const once = advanceRetest(input, first.memory),
    again = advanceRetest(input, once.memory);
  assert.deepEqual(again, once);
  const conflict = advanceRetest(step(1, { direction: -1 }), once.memory);
  assert.deepEqual(advanceRetest(input, conflict.memory), once);
  assert.equal(
    advanceRetest(step(1, { id: ethId }), first.memory).active,
    false,
  );
  const corrected = step(1);
  corrected.candles[0].close = 99;
  assert.equal(advanceRetest(corrected, first.memory).active, false);
});
for (const direction of ["long", "short"])
  for (const age of [1, 2, 3, 4])
    test(`real ${direction} MA confirmation ${age} bars later respects the episode bound`, () => {
      const s = maFixture(direction),
        sign = direction === "long" ? 1 : -1;
      s.closedCandles.pop();
      s.state.confirmed_at = s.closedCandles.at(-1).closeTime;
      let analysis = calculateMaEntry(s, btcId, "15m");
      for (let i = 1; i <= age; i++) {
        const p = s.closedCandles.at(-1),
          close =
            i === age
              ? sign === 1
                ? p.high + 0.4
                : p.low - 0.4
              : p.close + sign * 0.01;
        s.closedCandles.push({
          ...p,
          openTime: p.closeTime,
          closeTime: new Date(Date.parse(p.closeTime) + 900000).toISOString(),
          open: p.close + sign * 0.02,
          high:
            sign === 1 ? Math.max(p.high + 0.1, close + 0.02) : p.close - 0.01,
          low:
            sign === 1 ? p.close + 0.01 : Math.min(p.low - 0.1, close - 0.02),
          close,
          volume: 120,
        });
        s.state.confirmed_at = s.closedCandles.at(-1).closeTime;
        analysis = calculateMaEntry(s, btcId, "15m", DEFAULT_MA, analysis);
      }
      if (age === 4) {
        assert.ok(!analysis.state.startsWith("trigger_"));
        assert.equal(analysis.diagnostics.retest_active, false);
        assert.ok(analysis.reason_codes.includes("no_retest"));
        return;
      }
      assert.equal(
        analysis.state,
        `trigger_${direction}`,
        JSON.stringify({
          state: analysis.state,
          reasons: analysis.reason_codes,
          diag: analysis.diagnostics,
        }),
      );
      assert.equal(analysis.diagnostics.retest_age_bars, age);
      assert.deepEqual(
        calculateMaEntry(s, btcId, "15m", DEFAULT_MA, analysis),
        analysis,
      );
    });
test("native partial candle cannot age or consume an accepted episode or change entry/stop/target", () => {
  const s = maFixture(),
    first = calculateMaEntry(s, btcId, "15m");
  const partial = {
    ...s.closedCandles.at(-1),
    openTime: s.closedCandles.at(-1).closeTime,
    isClosed: false,
    close: 99999,
    high: 99999,
  };
  assert.deepEqual(
    calculateMaEntry(
      { ...s, closedCandles: [...s.closedCandles, partial] },
      btcId,
      "15m",
      DEFAULT_MA,
      first,
    ),
    first,
  );
});
test("room is entry-based; inside-zone obstacles are not TP1; nearest real forward obstacle is retained", () => {
  const s = maFixture(),
    base = calculateMaEntry(s, btcId, "15m");
  const atr = (base.ma_zone_high - base.ma_zone_low) / 0.4,
    entry = base.trigger_price;
  s.resistances = [
    {
      ...s.resistances[0],
      zone_low: entry + 0.95 * atr,
      zone_high: entry + 4 * atr,
    },
  ];
  const result = calculateMaEntry(s, btcId, "15m");
  assert.ok(!result.reason_codes.includes("near_obstruction"));
  assert.equal(result.diagnostics.room_anchor, entry);
  assert.ok(result.diagnostics.structural_room_atr >= 0.9);
  assert.ok(
    (result.first_target - s.closedCandles.at(-1).close) / atr <
      MA_RULES.roomAtr,
  );
  assert.ok(result.first_target > entry);
  const overlap = {
    ...s.resistances[0],
    zone_low: base.ma_zone_low,
    zone_high: entry + 0.1,
  };
  s.resistances.unshift(overlap);
  const next = calculateMaEntry(s, btcId, "15m");
  assert.equal(next.first_target, result.first_target);
  s.resistances.unshift({
    ...overlap,
    zone_low: entry + 0.1,
    zone_high: entry + 0.2,
  });
  assert.ok(
    calculateMaEntry(s, btcId, "15m").reason_codes.includes("near_obstruction"),
  );
});
test("full context fold and incremental Worker sequence deep-equal across rolling histories", () => {
  const source = fixtureHistory("15m", btcId, 905).items,
    worker = new TechnicalWorkerEngine();
  let full, incremental;
  for (let i = 790; i < source.length; i++) {
    const candles = source.slice(Math.max(0, i - 799), i + 1),
      close = Number(candles.at(-1).close);
    const snapshot = calculateTechnicalContext(
      candles,
      close,
      "15m",
      undefined,
      btcId,
    );
    const request = {
      market_instrument_id: btcId,
      timeframe: "15m",
      generation: i,
      revision: String(i),
      candles,
      confirmedClose: close,
    };
    const computed = worker.compute(request);
    if (i > 790)
      assert.equal(
        computed.incremental,
        true,
        "Exercise growing and rolling-800 prewarmed appends",
      );
    full = calculateMaEntry(snapshot, btcId, "15m", DEFAULT_MA, full);
    incremental = calculateMaEntry(
      computed.snapshot,
      btcId,
      "15m",
      DEFAULT_MA,
      incremental,
    );
    assert.deepEqual(incremental, full);
    worker.prewarm(request);
  }
});
