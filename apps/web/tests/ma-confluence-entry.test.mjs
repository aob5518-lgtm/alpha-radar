import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateMaEntry,
  DEFAULT_MA,
  MA_RULES,
  movingAverage,
  macd,
  maMatchesIdentity,
  validMaSettings,
} from "./fixtures/ma-entry-v1/ma-confluence-entry.ts";
import { parseOverlayPreferences } from "../src/lib/market/chart-overlay-preferences.ts";
import { maFixture } from "./helpers/ma-fixtures.mjs";
import { btcId, ethId } from "./helpers/chart-fixtures.mjs";

for (const direction of ["long", "short"])
  test(`clean ${direction} impulse/retest/confirmation with room is a confirmed candidate`, () => {
    const snapshot = maFixture(direction),
      copy = structuredClone(snapshot),
      result = calculateMaEntry(snapshot, btcId, "15m");
    assert.equal(result.state, `trigger_${direction}`, JSON.stringify(result));
    assert.equal(result.quality_tier, "A");
    assert.ok(result.confidence_score >= 80);
    assert.ok(result.reason_codes.includes("price_confirmed"));
    assert.ok(result.entry_zone.low < result.entry_zone.high);
    assert.ok(
      direction === "long"
        ? result.invalidation_price < result.entry_zone.low &&
            result.first_target > result.trigger_price
        : result.invalidation_price > result.entry_zone.high &&
            result.first_target < result.trigger_price,
    );
    assert.deepEqual(snapshot, copy);
    assert.deepEqual(result, calculateMaEntry(snapshot, btcId, "15m"));
  });
for (const [name, change, reason] of [
  [
    "flat chop",
    (s) => {
      s.closedCandles = s.closedCandles.map((c, i) => ({
        ...c,
        open: 110,
        high: 111,
        low: 109,
        close: 110 + (i % 2 ? 0.05 : -0.05),
      }));
    },
    "flat_ma",
  ],
  [
    "repeated crossings",
    (s) => {
      s.closedCandles = s.closedCandles.map((c, i) =>
        i < 308
          ? c
          : {
              ...c,
              close: 113.4 + (i % 2 ? 0.4 : -0.4),
              low: 112,
              high: 115,
              open: 113.4,
            },
      );
    },
    "repeated_crosses",
  ],
  [
    "excess retests",
    (s) => {
      s.closedCandles = s.closedCandles.map((c, i) =>
        i < 308 ? c : { ...c, low: 110 },
      );
    },
    "excess_retests",
  ],
  [
    "no impulse",
    (s) => {
      s.closedCandles = s.closedCandles.map((c, i) => ({
        ...c,
        open: 110 + i * 0.005,
        close: 110 + i * 0.005,
        high: 113,
        low: 108,
      }));
    },
    "no_impulse",
  ],
  [
    "MACD disagreement",
    (s) => {
      for (let i = 311; i <= 316; i++) {
        s.closedCandles[i].close += 8;
        s.closedCandles[i].high += 8;
      }
    },
    "macd_conflict",
  ],
  [
    "weak trigger volume",
    (s) => {
      s.closedCandles.at(-1).volume = 1;
    },
    "weak_volume",
  ],
  [
    "missing volume",
    (s) => {
      s.closedCandles = s.closedCandles.map((c) => ({ ...c, volume: null }));
    },
    "missing_volume",
  ],
  [
    "zero volume",
    (s) => {
      s.closedCandles.at(-1).volume = 0;
    },
    "weak_volume",
  ],
])
  test(`${name} does not promote an entry`, () => {
    const snapshot = maFixture();
    change(snapshot);
    const result = calculateMaEntry(snapshot, btcId, "15m");
    assert.ok(
      !result.state.startsWith("trigger_") &&
        !result.state.startsWith("candidate_"),
    );
    assert.ok(result.reason_codes.includes(reason), JSON.stringify(result));
    assert.equal(result.entry_zone, null);
    assert.equal(result.trigger_price, null);
  });
for (const direction of ["long", "short"])
  test(`${direction} blocked directly into opposing structural zone`, () => {
    const snapshot = maFixture(direction),
      base = calculateMaEntry(snapshot, btcId, "15m"),
      last = snapshot.closedCandles.at(-1);
    if (direction === "long")
      snapshot.resistances[0].zone_low = last.close + 0.1;
    else snapshot.supports[0].zone_high = last.close - 0.1;
    const result = calculateMaEntry(snapshot, btcId, "15m");
    assert.equal(base.state, `trigger_${direction}`);
    assert.ok(result.reason_codes.includes("near_obstruction"));
    assert.equal(result.entry_zone, null);
  });
test("weak close remains observation/candidate, partial cannot promote/repaint, identity is exact", () => {
  const snapshot = maFixture(),
    before = calculateMaEntry(snapshot, btcId, "15m");
  const partial = {
    ...snapshot.closedCandles.at(-1),
    close: 99999,
    high: 99999,
    isClosed: false,
  };
  assert.deepEqual(
    calculateMaEntry(
      { ...snapshot, closedCandles: [...snapshot.closedCandles, partial] },
      btcId,
      "15m",
    ),
    before,
  );
  assert.equal(maMatchesIdentity(before, ethId, "15m"), false);
  assert.equal(maMatchesIdentity(before, btcId, "1h"), false);
  snapshot.closedCandles.at(-1).close = snapshot.closedCandles.at(-1).open;
  assert.ok(
    !calculateMaEntry(snapshot, btcId, "15m").state.startsWith("trigger_"),
  );
});
test("MA/math settings and persistence are bounded/validated; MACD is seeded, not fabricated", () => {
  assert.deepEqual(
    movingAverage(
      Array.from({ length: 10 }, (_, i) => i + 1),
      { ...DEFAULT_MA, period: 10 },
    ).at(-1),
    5.5,
  );
  assert.equal(macd(Array(33).fill(100)).at(-1).histogram, null);
  assert.equal(macd(Array(34).fill(100)).at(-1).histogram, 0);
  assert.equal(validMaSettings({ period: 999, type: "unknown" }).period, 99);
  assert.equal(
    calculateMaEntry(maFixture(), btcId, "15m", {
      ...DEFAULT_MA,
      enabled: false,
    }).state,
    "disabled",
  );
  for (const raw of [null, "invalid", '{"version":2}', "[]"])
    assert.deepEqual(parseOverlayPreferences(raw).visibility, {
      levels: true,
      markers: true,
      ma: true,
      entries: true,
    });
  const pref = parseOverlayPreferences(
    JSON.stringify({
      version: 1,
      visibility: { levels: false, ma: false, entries: "bad" },
      ma: { period: 50, type: "EMA" },
    }),
  );
  assert.equal(pref.visibility.levels, false);
  assert.equal(pref.visibility.ma, false);
  assert.equal(pref.visibility.entries, true);
  assert.equal(pref.ma.period, 50);
  assert.equal(parseOverlayPreferences(JSON.stringify(pref)).ma.type, "EMA");
  assert.equal(MA_RULES.triggerScore, 80);
});

for (const direction of ["long", "short"])
  test(`a closed ${direction} retest failure invalidates rather than moving the failure reference`, () => {
    const s = maFixture(direction),
      before = calculateMaEntry(s, btcId, "15m"),
      last = s.closedCandles.at(-1);
    assert.equal(before.state, `trigger_${direction}`);
    last.close =
      direction === "long"
        ? before.invalidation_price - 1
        : before.invalidation_price + 1;
    last.low = Math.min(last.low, last.close - 0.1);
    last.high = Math.max(last.high, last.close + 0.1);
    const after = calculateMaEntry(s, btcId, "15m");
    assert.equal(after.state, "invalidated");
    assert.equal(after.entry_zone, null);
    assert.equal(after.trigger_price, null);
  });
test("no observed target, insufficient history, opposite slope and chase extension never fabricate actionable references", () => {
  const short = maFixture();
  short.trend.direction = "bearish";
  short.state.direction = "bearish";
  assert.ok(
    calculateMaEntry(short, btcId, "15m").reason_codes.includes(
      "trend_conflict",
    ),
  );
  const noTarget = maFixture();
  noTarget.resistances = [];
  assert.ok(
    calculateMaEntry(noTarget, btcId, "15m").reason_codes.includes("no_target"),
  );
  const thin = maFixture();
  thin.closedCandles = thin.closedCandles.slice(0, 50);
  assert.ok(
    calculateMaEntry(thin, btcId, "15m").reason_codes.includes(
      "insufficient_history",
    ),
  );
  const chase = maFixture();
  chase.closedCandles.at(-1).close += 8;
  chase.closedCandles.at(-1).high += 8;
  const result = calculateMaEntry(chase, btcId, "15m");
  assert.ok(result.reason_codes.includes("overextended"));
  assert.equal(result.entry_zone, null);
});
