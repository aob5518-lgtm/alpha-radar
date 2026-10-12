import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateTradeSetup,
  tradeSetupMatchesIdentity,
} from "../src/lib/market/trade-setup.ts";
import { calculateTechnicalContext } from "../src/lib/market/technical-context.ts";
import {
  btcId,
  ethId,
  fixtureHistory,
  fixtureClosedUpdate,
} from "./helpers/chart-fixtures.mjs";

function setupContext(direction = "bullish", phase = "support_confirmed") {
  const history = fixtureHistory();
  const price = Number(history.items.at(-1).close);
  const snapshot = calculateTechnicalContext(
    history.items,
    price,
    "15m",
    undefined,
    btcId,
  );
  const support = {
    id: "fixture-support",
    kind: "support",
    label: "S1",
    zone_low: price - 2,
    zone_high: price - 0.2,
    timeframe: "15m",
  };
  const resistance = {
    id: "fixture-resistance",
    kind: "resistance",
    label: "R1",
    zone_low: price + 0.2,
    zone_high: price + 2,
    timeframe: "15m",
  };
  const ref =
    phase.includes("resistance") ||
    phase.includes("down") ||
    phase === "rebound"
      ? resistance
      : support;
  return {
    ...snapshot,
    supports: [support],
    resistances: [resistance],
    trend: { ...snapshot.trend, direction },
    state: {
      ...snapshot.state,
      direction,
      phase,
      entry_window_candidate: true,
      reference_level: {
        level_label: ref.label,
        kind: ref.kind,
        zone_low: ref.zone_low,
        zone_high: ref.zone_high,
      },
    },
  };
}

for (const [trend, phase, bias, kind] of [
  ["bullish", "support_confirmed", "long", "support"],
  ["bearish", "resistance_confirmed", "short", "resistance"],
]) {
  test(`${trend} + ${phase} derives ${bias} candidate from authoritative ${kind} zone`, () => {
    const snapshot = setupContext(trend, phase);
    const result = calculateTradeSetup(snapshot, btcId, "15m");
    const level =
      kind === "support" ? snapshot.supports[0] : snapshot.resistances[0];
    assert.equal(result.direction, bias);
    assert.equal(result.status, "candidate");
    assert.equal(result.entry_zone_low, level.zone_low);
    assert.equal(result.entry_zone_high, level.zone_high);
    assert.equal(
      result.preferred_entry_price,
      ((level.zone_low + level.zone_high) / 2 +
        (bias === "long" ? level.zone_high : level.zone_low)) /
        2,
    );
    assert.ok(
      result.preferred_entry_price >= level.zone_low &&
        result.preferred_entry_price <= level.zone_high,
    );
    assert.notEqual(
      result.preferred_entry_price,
      snapshot.closedCandles.at(-1).close,
    );
    assert.deepEqual(result, calculateTradeSetup(snapshot, btcId, "15m"));
    assert.equal(result.algorithm_version, "trade-setup-v1");
    assert.equal(result.confirmed_at, snapshot.state.confirmed_at);
  });
}

for (const [trend, phase] of [
  ["neutral", "support_confirmed"],
  ["bullish", "pullback"],
  ["bearish", "rebound"],
  ["bullish", "reversal_attempt_up"],
  ["bearish", "reversal_attempt_down"],
  ["bullish", "reversal_confirmed_up"],
  ["bearish", "reversal_confirmed_down"],
  ["bullish", "sharp_rise"],
  ["bearish", "sharp_drop"],
]) {
  test(`${trend} + ${phase} is wait, not an entry from proximity or a first reversal`, () => {
    const result = calculateTradeSetup(
      setupContext(trend, phase),
      btcId,
      "15m",
    );
    assert.equal(result.direction, "wait");
    assert.equal(result.status, "waiting");
    assert.equal(result.preferred_entry_price, null);
    assert.equal(result.entry_zone_low, null);
  });
}

test("neutral range-middle has no invented price or watch zone", () => {
  const snapshot = setupContext("neutral");
  snapshot.state.reference_level = null;
  const result = calculateTradeSetup(snapshot, btcId, "15m");
  assert.equal(result.reference_level, null);
  assert.equal(result.entry_zone_low, null);
  assert.equal(result.preferred_entry_price, null);
});

test("neutral near a confirmed current level exposes a watch zone only", () => {
  const snapshot = setupContext("neutral");
  const result = calculateTradeSetup(snapshot, btcId, "15m");
  assert.equal(result.direction, "wait");
  assert.ok(result.reference_level);
  assert.equal(result.preferred_entry_price, null);
});

test("existing entry-window flag is necessary even with a matching directional confirmation", () => {
  const snapshot = setupContext();
  snapshot.state.entry_window_candidate = false;
  assert.equal(calculateTradeSetup(snapshot, btcId, "15m").status, "waiting");
});

for (const [trend, phase, extendedClose, brokenClose] of [
  ["bullish", "support_confirmed", 200, 90],
  ["bearish", "resistance_confirmed", 50, 140],
]) {
  test(`${trend} extension returns to waiting without chasing price`, () => {
    const snapshot = setupContext(trend, phase);
    const original = calculateTradeSetup(snapshot, btcId, "15m");
    snapshot.closedCandles = snapshot.closedCandles.map((c, i) =>
      i === snapshot.closedCandles.length - 1
        ? {
            ...c,
            close: extendedClose,
            high: Math.max(c.high, extendedClose + 0.1),
            low: Math.min(c.low, extendedClose - 0.1),
          }
        : c,
    );
    const result = calculateTradeSetup(snapshot, btcId, "15m");
    assert.equal(result.status, "waiting");
    assert.equal(result.reason, "extended");
    assert.equal(result.preferred_entry_price, original.preferred_entry_price);
  });
  test(`${trend} broken level removes candidate, zone and reference price`, () => {
    const snapshot = setupContext(trend, phase);
    snapshot.closedCandles = snapshot.closedCandles.map((c, i) =>
      i === snapshot.closedCandles.length - 1
        ? {
            ...c,
            close: brokenClose,
            high: Math.max(c.high, brokenClose + 0.1),
            low: Math.min(c.low, brokenClose - 0.1),
          }
        : c,
    );
    const result = calculateTradeSetup(snapshot, btcId, "15m");
    assert.equal(result.direction, "wait");
    assert.equal(result.reason, "invalidated");
    assert.equal(result.preferred_entry_price, null);
    assert.equal(result.reference_level, null);
  });
}

test("an obsolete reference cannot select a new unrelated S1 by rank", () => {
  const snapshot = setupContext();
  snapshot.supports = [
    { ...snapshot.supports[0], zone_low: 50, zone_high: 51 },
  ];
  const result = calculateTradeSetup(snapshot, btcId, "15m");
  assert.equal(result.reason, "invalidated");
  assert.equal(result.preferred_entry_price, null);
});

test("partial candle cannot alter setup direction/status/zone/price", () => {
  const history = fixtureHistory();
  const close = Number(history.items.at(-1).close);
  const before = calculateTechnicalContext(
    history.items,
    close,
    "15m",
    undefined,
    btcId,
  );
  const partial = { ...fixtureClosedUpdate(history, 9999), is_closed: false };
  const after = calculateTechnicalContext(
    [...history.items, partial],
    close,
    "15m",
    undefined,
    btcId,
  );
  assert.deepEqual(
    calculateTradeSetup(after, btcId, "15m"),
    calculateTradeSetup(before, btcId, "15m"),
  );
});

test("exact instrument UUID and timeframe guard rejects stale setup", () => {
  const result = calculateTradeSetup(setupContext(), btcId, "15m");
  assert.equal(tradeSetupMatchesIdentity(result, btcId, "15m"), true);
  assert.equal(tradeSetupMatchesIdentity(result, ethId, "15m"), false);
  assert.equal(tradeSetupMatchesIdentity(result, btcId, "1h"), false);
});
