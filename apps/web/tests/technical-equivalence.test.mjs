import assert from "node:assert/strict";
import test from "node:test";
import { calculateTechnicalContext as oracle } from "./fixtures/production-v1/technical-context.ts";
import { calculateTechnicalContext } from "../src/lib/market/technical-context.ts";
import { calculateTradeSetup } from "../src/lib/market/trade-setup.ts";
import { TechnicalWorkerEngine } from "../src/lib/market/technical-worker-engine.ts";
import { calculateMarketStateAnalysis as oracleAnalysis } from "./fixtures/production-v1/market-state.ts";
import {
  calculateReplayAnalysis,
  prepareMarketReplay,
} from "../src/lib/market/market-state.ts";
import { calculateTechnicalSnapshot } from "../src/lib/market/technical-levels.ts";
import { fixtureHistory, btcId, ethId } from "./helpers/chart-fixtures.mjs";

export function sample(interval, id, shape, count = 320) {
  const h = fixtureHistory(interval, id, count);
  h.items = h.items.map((c, i) => {
    const center =
      shape === "up"
        ? 100 + i * 0.3 + Math.sin(i / 5) * 2
        : shape === "down"
          ? 400 - i * 0.3 + Math.sin(i / 5) * 2
          : shape === "drop"
            ? 200 +
              Math.sin(i / 5) * 2 -
              (i > count - 5 ? (i - count + 5) * 6 : 0)
            : shape === "rise"
              ? 200 +
                Math.sin(i / 5) * 2 +
                (i > count - 5 ? (i - count + 5) * 6 : 0)
              : 200 + Math.sin(i / 5) * 8;
    return {
      ...c,
      open: String(center - 0.2),
      high: String(center + 1),
      low: String(center - 1),
      close: String(center),
    };
  });
  return h;
}
for (const id of [btcId, ethId])
  for (const interval of ["15m", "1h"])
    for (const shape of ["up", "down", "range", "drop", "rise"]) {
      test(`production deep equivalence ${id} ${interval} ${shape}`, () => {
        const h = sample(interval, id, shape),
          higher = sample(interval === "15m" ? "1h" : "4h", id, "range");
        const price = Number(h.items.at(-1).close);
        const before = oracle(h.items, price, interval, higher.items, id);
        const after = calculateTechnicalContext(
          h.items,
          price,
          interval,
          higher.items,
          id,
        );
        assert.deepEqual(after, before);
        assert.deepEqual(
          calculateTradeSetup(after, id, interval),
          calculateTradeSetup(before, id, interval),
        );
      });
    }
test("incremental append, final-only HTF evidence, corrections, version reset and rolling-800 checkpoints remain oracle-equivalent", () => {
  const h = sample("15m", btcId, "range", 820),
    engine = new TechnicalWorkerEngine();
  for (const length of [
    300, 301, 302, 303, 304, 305, 799, 800, 801, 802, 803,
  ]) {
    const candles = h.items.slice(Math.max(0, length - 800), length);
    const request = {
      market_instrument_id: btcId,
      timeframe: "15m",
      candles,
      confirmedClose: Number(candles.at(-1).close),
      generation: length,
      revision: String(length),
    };
    const result = engine.compute(request);
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.snapshot,
      oracle(candles, request.confirmedClose, "15m", undefined, btcId),
    );
    assert.deepEqual(
      result.setup,
      calculateTradeSetup(result.snapshot, btcId, "15m"),
    );
    if ([301, 302, 303, 304, 305, 800, 801, 802, 803].includes(length))
      assert.equal(
        result.incremental,
        true,
        `append ${length} must not full replay`,
      );
    engine.prewarm(request);
  }
  const candles = h.items
    .slice(3, 803)
    .map((c, i) => (i === 500 ? { ...c, volume: "200" } : c));
  const result = engine.compute({
    market_instrument_id: btcId,
    timeframe: "15m",
    candles,
    confirmedClose: Number(candles.at(-1).close),
    generation: 999,
    revision: "corrected",
  });
  assert.equal(result.incremental, false);
  assert.deepEqual(
    result.snapshot,
    oracle(candles, Number(candles.at(-1).close), "15m", undefined, btcId),
  );
});

for (const id of [btcId, ethId])
  for (const timeframe of ["15m", "1h"]) {
    test(`many-candle incremental equivalence with changing HTF, nullable volume and partial exclusion: ${id} ${timeframe}`, () => {
      const source = sample(timeframe, id, "range", 290).items.map((c, i) => ({
        ...c,
        volume: i % 3 ? null : c.volume,
      }));
      const engine = new TechnicalWorkerEngine();
      for (let length = 250; length <= 280; length++) {
        const candles = source.slice(0, length),
          higherCandles =
            length % 2
              ? sample(timeframe === "15m" ? "1h" : "4h", id, "up").items
              : undefined;
        const confirmedClose = Number(candles.at(-1).close);
        const input = {
          market_instrument_id: id,
          timeframe,
          candles,
          higherCandles,
          confirmedClose,
          generation: length,
          revision: String(length),
        };
        const actual = engine.compute(input);
        assert.deepEqual(
          actual.snapshot,
          oracle(candles, confirmedClose, timeframe, higherCandles, id),
        );
        assert.deepEqual(
          actual.setup,
          calculateTradeSetup(actual.snapshot, id, timeframe),
        );
        assert.equal(actual.incremental, length > 250);
      }
    });
  }
for (const kind of ["support", "resistance"])
  test(`${kind} confirmation state/marker/Trade Setup matches frozen oracle`, () => {
    const closes = [
      ...Array.from({ length: 32 }, (_, i) => 102 + Math.sin(i / 2) * 0.05),
      ...(kind === "support" ? [101, 100.05, 100.4] : [103, 104.05, 103.5]),
    ];
    const candles = fixtureHistory("15m", btcId, closes.length).items.map(
      (c, i) => ({
        ...c,
        open: String(closes[i]),
        close: String(closes[i]),
        high: String(closes[i] + 0.25),
        low: String(closes[i] - 0.25),
      }),
    );
    const low = kind === "support" ? 99.8 : 103.8,
      high = low + 0.4;
    const zone = {
      id: "test-zone",
      kind,
      label: kind === "support" ? "S1" : "R1",
      zone_low: low,
      zone_high: high,
      representative_price: (low + high) / 2,
      strength: 75,
      strength_band: "strong",
      pivot_count: 3,
      last_tested_at: candles.at(-1).close_time,
      distance_percent: 0.5,
      timeframe: "15m",
      higher_timeframe_available: false,
      higher_timeframe_confluence: false,
    };
    const base = calculateTechnicalSnapshot(
      candles,
      Number(candles.at(-1).close),
      "15m",
    );
    const snapshot = {
      ...base,
      supports: kind === "support" ? [zone] : [],
      resistances: kind === "resistance" ? [zone] : [],
      trend: {
        ...base.trend,
        direction: kind === "support" ? "bullish" : "bearish",
        strength: 67,
      },
    };
    const expected = oracleAnalysis(candles, snapshot, btcId, "15m");
    const actual = calculateReplayAnalysis(
      candles,
      snapshot,
      btcId,
      "15m",
    ).analysis;
    assert.equal(actual.state.phase, `${kind}_confirmed`);
    assert.deepEqual(actual, expected);
    assert.deepEqual(
      calculateTradeSetup({ ...snapshot, ...actual }, btcId, "15m"),
      calculateTradeSetup({ ...snapshot, ...expected }, btcId, "15m"),
    );
  });
test("version-invalid or missing replay and nonmatching origin force deterministic rebuild", () => {
  const candles = fixtureHistory().items,
    old = prepareMarketReplay(candles, "15m").replay;
  assert.equal(
    prepareMarketReplay(candles, "15m", { ...old, version: "old-version" })
      .incremental,
    false,
  );
  assert.equal(
    prepareMarketReplay(candles.slice(1), "15m", old).incremental,
    false,
  );
});

test("empty/short/seed-boundary histories, unsorted input and partial candles preserve full production output", () => {
  for (const length of [0, 1, 28, 29, 249, 250, 800]) {
    const candles = fixtureHistory("15m", btcId, Math.max(1, length))
      .items.slice(0, length)
      .map((c, i) => (i % 5 === 0 ? { ...c, volume: null } : c));
    const price = Number(candles.at(-1)?.close ?? 100);
    assert.deepEqual(
      calculateTechnicalContext(candles, price, "15m", undefined, btcId),
      oracle(candles, price, "15m", undefined, btcId),
    );
    if (length > 0) {
      const partial = {
        ...candles.at(-1),
        is_closed: false,
        open_time: "2030-01-01T00:00:00Z",
        close_time: "2030-01-01T00:15:00Z",
        close: "999999",
        high: "999999",
      };
      assert.deepEqual(
        calculateTechnicalContext(
          [...candles].reverse().concat(partial),
          price,
          "15m",
          undefined,
          btcId,
        ),
        oracle(candles, price, "15m", undefined, btcId),
      );
    }
  }
});
