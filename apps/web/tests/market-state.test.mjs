import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { marketPhases } from "@alpha-radar/types/core-3";

import {
  MARKET_STATE_CONSTANTS,
  MARKET_STATE_VERSION,
  calculateMarketState,
  calculateMarketStateMarkers,
} from "../src/lib/market/market-state.ts";
import { calculateTechnicalContext } from "../src/lib/market/technical-context.ts";
import { calculateTechnicalSnapshot } from "../src/lib/market/technical-levels.ts";

function candle(index, close, options = {}) {
  const open = options.open ?? close;
  const halfRange = options.halfRange ?? 0.35;
  const openTime = new Date(Date.UTC(2026, 0, 1) + index * 3_600_000);
  return {
    market_instrument_id: options.instrumentId ?? "instrument-1",
    provider: "test",
    interval: options.interval ?? "1h",
    open_time: openTime.toISOString(),
    close_time: new Date(openTime.getTime() + 3_600_000).toISOString(),
    open: String(open),
    high: String(options.high ?? Math.max(open, close) + halfRange),
    low: String(options.low ?? Math.min(open, close) - halfRange),
    close: String(close),
    volume: options.volume === null ? null : String(options.volume ?? 100),
    quote_volume: null,
    is_closed: options.isClosed ?? true,
    provider_timestamp: null,
    ingested_at: new Date(openTime.getTime() + 3_600_000).toISOString(),
    quality_flags: [],
  };
}

function candlesFromCloses(closes, options = {}) {
  return closes.map((close, index) =>
    candle(index, close, {
      ...options,
      ...(options.forIndex?.(close, index) ?? {}),
    }),
  );
}

function level(kind, low, high, label = kind === "support" ? "S1" : "R1") {
  return {
    id: `${kind}-${label}`,
    label,
    kind,
    representative_price: (low + high) / 2,
    zone_low: low,
    zone_high: high,
    strength: 75,
    strength_band: "strong",
    pivot_count: 3,
    last_tested_at: "2026-01-01T00:00:00Z",
    distance_percent: 0.5,
    timeframe: "1h",
    higher_timeframe_available: false,
    higher_timeframe_confluence: false,
  };
}

function snapshotFor(candles, direction = "neutral", options = {}) {
  const lastPrice = Number(
    candles.filter((item) => item.is_closed).at(-1)?.close ?? 1,
  );
  const base = calculateTechnicalSnapshot(candles, lastPrice, "1h");
  return {
    ...base,
    supports: options.supports ?? [],
    resistances: options.resistances ?? [],
    trend: {
      ...base.trend,
      direction,
      strength: options.strength ?? 67,
    },
  };
}

function stateFor(candles, direction = "neutral", options = {}) {
  return calculateMarketState(
    candles,
    snapshotFor(candles, direction, options),
  );
}

function steady(prefixLength = 30, value = 100) {
  return Array.from(
    { length: prefixLength },
    (_, index) => value + Math.sin(index / 2) * 0.05,
  );
}

test("market-state-v1 classifies gradual pressure without calling it acceleration", () => {
  const decline = candlesFromCloses(
    Array.from({ length: 40 }, (_, index) => 120 - index * 0.12),
  );
  const rise = candlesFromCloses(
    Array.from({ length: 40 }, (_, index) => 100 + index * 0.12),
  );
  assert.equal(stateFor(decline, "bearish").phase, "slow_decline");
  assert.equal(stateFor(rise, "bullish").phase, "slow_rise");
});

test("ATR-normalized short-window acceleration is mutually exclusive", () => {
  const prefix = steady();
  const drop = candlesFromCloses([...prefix, 99, 97.5, 95.5, 93]);
  const rise = candlesFromCloses([...prefix, 101, 102.5, 104.5, 107], {
    volume: null,
  });
  assert.equal(stateFor(drop, "bearish").phase, "sharp_drop");
  assert.equal(stateFor(rise, "bullish").phase, "sharp_rise");
});

test("sharp decline can stabilize into bottoming only after closed-candle confirmation", () => {
  const closes = [
    ...steady(24, 110),
    109,
    107.5,
    105.5,
    103,
    100,
    98,
    97.9,
    98,
    98.7,
  ];
  const source = candlesFromCloses(closes, {
    forIndex: (_close, index) =>
      index >= closes.length - 3 ? { halfRange: 0.18 } : { halfRange: 0.45 },
  });
  assert.equal(stateFor(source.slice(0, -3), "bearish").phase, "sharp_drop");
  assert.equal(stateFor(source, "bearish").phase, "bottoming");
});

test("bottoming break and hold separate reversal attempt from confirmation", () => {
  const base = [
    ...steady(24, 110),
    108,
    105,
    102,
    104,
    105,
    104,
    101,
    98,
    95,
    94.9,
    95,
    95.8,
  ];
  const configured = (closes) =>
    candlesFromCloses(closes, {
      forIndex: (close, index) => {
        if (index === 28) return { high: 106, low: close - 0.4 };
        if (index >= base.length - 3 && index < base.length)
          return { halfRange: 0.18 };
        return { halfRange: 0.4 };
      },
    });
  assert.equal(stateFor(configured(base), "bearish").phase, "bottoming");
  const attempt = configured([...base, 106.8]);
  assert.equal(stateFor(attempt, "bearish").phase, "reversal_attempt_up");
  const confirmed = configured([...base, 106.8, 106.5, 107.2]);
  assert.equal(stateFor(confirmed, "neutral").phase, "reversal_confirmed_up");
  assert.equal(stateFor(confirmed, "bullish").next_wait, "wait_pullback");
});

test("bullish pullback and bearish rebound require controlled multi-candle retracement", () => {
  const bullish = candlesFromCloses([
    ...Array.from({ length: 35 }, (_, index) => 100 + index * 0.15),
    105,
    104.8,
    104.55,
    104.25,
  ]);
  const bearish = candlesFromCloses([
    ...Array.from({ length: 35 }, (_, index) => 110 - index * 0.15),
    105,
    105.2,
    105.45,
    105.75,
  ]);
  assert.equal(stateFor(bullish, "bullish").phase, "pullback");
  assert.equal(stateFor(bearish, "bearish").phase, "rebound");
});

test("existing S1 and R1 zones confirm only after a test and reclaim/rejection", () => {
  const prefix = steady(32, 102);
  const support = level("support", 99.8, 100.2, "S1");
  const resistance = level("resistance", 103.8, 104.2, "R1");
  const supportTest = candlesFromCloses([...prefix, 101, 100.05, 100.4], {
    forIndex: (close, index) =>
      index === prefix.length + 1
        ? { low: 99.9, high: 100.35, open: 100.3 }
        : { halfRange: 0.25 },
  });
  const resistanceTest = candlesFromCloses([...prefix, 103, 104.05, 103.5], {
    forIndex: (close, index) =>
      index === prefix.length + 1
        ? { high: 104.1, low: 103.7, open: 103.8 }
        : { halfRange: 0.25 },
  });
  assert.equal(
    stateFor(supportTest, "bullish", { supports: [support] }).phase,
    "support_confirmed",
  );
  assert.equal(
    stateFor(resistanceTest, "bearish", { resistances: [resistance] }).phase,
    "resistance_confirmed",
  );
});

test("a materially broken support that is not reclaimed cannot confirm", () => {
  const support = level("support", 99.8, 100.2, "S1");
  const source = candlesFromCloses([...steady(32, 102), 100.05, 99.2, 99.3], {
    forIndex: (close, index) =>
      index >= 33 ? { high: close + 0.2, low: close - 0.2 } : {},
  });
  assert.notEqual(
    stateFor(source, "bullish", { supports: [support] }).phase,
    "support_confirmed",
  );
});

test("exhaustion requires extended movement plus weakening continuation evidence", () => {
  const upCloses = [
    ...steady(28, 100),
    101,
    103,
    105,
    107,
    109,
    111,
    113,
    114,
    115,
    115.6,
    116,
    116.2,
  ];
  const downCloses = [
    ...steady(28, 120),
    119,
    117,
    115,
    113,
    111,
    109,
    107,
    106,
    105,
    104.4,
    104,
    103.8,
  ];
  const withWicks = (closes, direction) =>
    candlesFromCloses(closes, {
      forIndex: (close, index) =>
        index >= closes.length - 3
          ? direction === "up"
            ? { high: close + 0.7, low: close - 0.2, open: close - 0.1 }
            : { low: close - 0.7, high: close + 0.2, open: close + 0.1 }
          : { halfRange: 0.35 },
    });
  assert.equal(
    stateFor(withWicks(upCloses, "up"), "bullish").phase,
    "up_exhaustion",
  );
  assert.equal(
    stateFor(withWicks(downCloses, "down"), "bearish").phase,
    "down_exhaustion",
  );
});

test("next_wait is deterministic for neutral location and key workflow states", () => {
  const middle = stateFor(candlesFromCloses(steady(40, 100)), "neutral");
  assert.equal(middle.next_wait, "wait_for_better_location");

  const drop = stateFor(
    candlesFromCloses([...steady(), 99, 97.5, 95.5, 93]),
    "bearish",
  );
  assert.equal(drop.phase, "sharp_drop");
  assert.equal(drop.next_wait, "wait_bottoming");

  const pullback = stateFor(
    candlesFromCloses([
      ...Array.from({ length: 35 }, (_, index) => 100 + index * 0.15),
      105,
      104.8,
      104.55,
      104.25,
    ]),
    "bullish",
  );
  assert.equal(pullback.phase, "pullback");
  assert.equal(pullback.next_wait, "wait_support");
});

test("entry_window_candidate requires matching directional level confirmation", () => {
  const support = level("support", 99.8, 100.2, "S1");
  const source = candlesFromCloses([...steady(32, 102), 101, 100.05, 100.4], {
    forIndex: (close, index) =>
      index === 33
        ? { low: 99.9, high: 100.35, open: 100.3 }
        : { halfRange: 0.25 },
  });
  assert.equal(
    stateFor(source, "bullish", { supports: [support] }).entry_window_candidate,
    true,
  );
  assert.equal(
    stateFor(source, "neutral", { supports: [support] }).entry_window_candidate,
    false,
  );
  assert.equal(stateFor(source, "bullish").entry_window_candidate, false);

  const resistance = level("resistance", 103.8, 104.2, "R1");
  const resistanceSource = candlesFromCloses(
    [...steady(32, 102), 103, 104.05, 103.5],
    {
      forIndex: (close, index) =>
        index === 33
          ? { high: 104.1, low: 103.7, open: 103.8 }
          : { halfRange: 0.25 },
    },
  );
  assert.equal(
    stateFor(resistanceSource, "bearish", { resistances: [resistance] })
      .entry_window_candidate,
    true,
  );
});

test("partial live candles cannot change confirmed state or create markers", () => {
  const closed = candlesFromCloses([...steady(), 99, 97.5, 95.5, 93]);
  const partial = candle(closed.length, 500, {
    open: 93,
    high: 600,
    low: 1,
    isClosed: false,
  });
  const snapshot = snapshotFor(closed, "bearish");
  assert.deepEqual(
    calculateMarketState([...closed, partial], snapshot),
    calculateMarketState(closed, snapshot),
  );
  assert.deepEqual(
    calculateMarketStateMarkers([...closed, partial], "instrument-1", "1h"),
    calculateMarketStateMarkers(closed, "instrument-1", "1h"),
  );
  const confirmedContext = calculateTechnicalContext(
    closed,
    93,
    "1h",
    undefined,
    "instrument-1",
  );
  const liveContext = calculateTechnicalContext(
    [...closed, partial],
    500,
    "1h",
    undefined,
    "instrument-1",
  );
  assert.deepEqual(liveContext.state, confirmedContext.state);
  assert.deepEqual(liveContext.markers, confirmedContext.markers);
});

test("marker replay is deterministic, capped and preserves exact instrument/timeframe", () => {
  const closes = [...steady(40, 100)];
  for (let cycle = 0; cycle < 14; cycle += 1) {
    const base = closes.at(-1);
    const sign = cycle % 2 === 0 ? -1 : 1;
    closes.push(base + sign * 1.5, base + sign * 3.2, base + sign * 5.2);
    closes.push(base + sign * 5.1, base + sign * 5, base + sign * 4.4);
  }
  const source = candlesFromCloses(closes, {
    instrumentId: "exact-instrument",
    interval: "15m",
    halfRange: 0.3,
  });
  const first = calculateMarketStateMarkers(source, "exact-instrument", "15m");
  const repeated = calculateMarketStateMarkers(
    source,
    "exact-instrument",
    "15m",
  );
  assert.deepEqual(first, repeated);
  assert.ok(first.length > 0);
  assert.ok(first.length <= MARKET_STATE_CONSTANTS.markerMaximum);
  assert.ok(
    first.every(
      (marker) =>
        marker.market_instrument_id === "exact-instrument" &&
        marker.timeframe === "15m",
    ),
  );
});

test("market-state contract and zh-CN phase labels have exact parity", async () => {
  const [english, chinese] = await Promise.all([
    readFile(new URL("../messages/en.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
    readFile(new URL("../messages/zh-CN.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
  ]);
  assert.equal(MARKET_STATE_VERSION, "market-state-v1");
  assert.deepEqual(marketPhases, [
    "slow_decline",
    "slow_rise",
    "sharp_drop",
    "sharp_rise",
    "bottoming",
    "topping",
    "reversal_attempt_up",
    "reversal_attempt_down",
    "reversal_confirmed_up",
    "reversal_confirmed_down",
    "pullback",
    "rebound",
    "support_confirmed",
    "resistance_confirmed",
    "up_exhaustion",
    "down_exhaustion",
  ]);
  assert.deepEqual(
    Object.keys(english.chart.marketState),
    Object.keys(chinese.chart.marketState),
  );
  assert.deepEqual(
    Object.keys(english.chart.marketState.phases),
    Object.keys(chinese.chart.marketState.phases),
  );
  assert.deepEqual(chinese.chart.marketState.directions, {
    bullish: "北上",
    neutral: "震荡",
    bearish: "南下",
  });
  assert.equal(chinese.chart.marketState.phases.slow_decline, "阴跌");
  assert.equal(chinese.chart.marketState.phases.sharp_drop, "急跌");
  assert.equal(chinese.chart.marketState.phases.support_confirmed, "支撑确认");
  assert.equal(
    chinese.chart.marketState.phases.reversal_confirmed_up,
    "向上反转确认",
  );
});
