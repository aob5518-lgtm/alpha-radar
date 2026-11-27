import assert from "node:assert/strict";
import test from "node:test";
import { describeGuideDecision } from "../src/lib/market/trade-guide-decision.ts";
import { calculateTradeGuide } from "../src/lib/market/trade-guide.ts";
import { calculateMaEntry } from "../src/lib/market/ma-confluence-entry.ts";
import { maFixture } from "./helpers/ma-fixtures.mjs";
import { btcId, ethId } from "./helpers/chart-fixtures.mjs";

function fixture(direction = "long", changes = {}) {
  const snapshot = maFixture(direction),
    analysis = {
      ...calculateMaEntry(snapshot, btcId, "15m"),
      ...changes,
    },
    guide = calculateTradeGuide(snapshot, analysis, undefined, btcId, "15m");
  return { snapshot, analysis, guide };
}

for (const direction of ["long", "short"]) {
  test(`${direction}: explain the authoritative READY plan without changing any calculation`, () => {
    const { analysis, guide } = fixture(direction),
      before = structuredClone({ analysis, guide }),
      decision = describeGuideDecision(guide, analysis);
    assert.equal(
      guide.state,
      direction === "long" ? "LONG_READY" : "SHORT_READY",
    );
    assert.equal(decision.direction, direction);
    assert.deepEqual(decision.zone, {
      low: guide.entry_zone_low,
      high: guide.entry_zone_high,
    });
    assert.equal(decision.confirmation, "confirmed");
    assert.equal(decision.waitingAction, null);
    assert.deepEqual({ analysis, guide }, before);
  });

  test(`${direction}: a potential area without closed price confirmation stays WATCH`, () => {
    const { analysis, guide } = fixture(direction, { price_confirmed: false }),
      decision = describeGuideDecision(guide, analysis);
    assert.equal(guide.state, `WATCH_${direction.toUpperCase()}`);
    assert.ok(decision.zone);
    assert.equal(decision.confirmation, "price_pending");
    assert.equal(decision.waitingAction, `wait_price_${direction}`);
  });

  test(`${direction}: confirmed price with insufficient evidence does not request another pullback`, () => {
    const { analysis, guide } = fixture(direction, {
        price_confirmed: true,
        confidence_score: 69,
        quality_tier: "C",
      }),
      decision = describeGuideDecision(guide, analysis);
    assert.equal(guide.state, `WATCH_${direction.toUpperCase()}`);
    assert.equal(decision.confirmation, "price_observed");
    assert.equal(decision.waitingAction, "wait_evidence");
  });

  test(`${direction}: known low reward/risk remains WATCH after price confirmation`, () => {
    const { snapshot, analysis } = fixture(direction),
      sign = direction === "long" ? 1 : -1,
      risk = Math.abs(analysis.trigger_price - analysis.invalidation_price);
    analysis.observed_targets = [
      {
        price: analysis.trigger_price + sign * risk * 1.3,
        source: direction === "long" ? "R1" : "S1",
      },
    ];
    const guide = calculateTradeGuide(
        snapshot,
        analysis,
        undefined,
        btcId,
        "15m",
      ),
      decision = describeGuideDecision(guide, analysis);
    assert.equal(guide.state, `WATCH_${direction.toUpperCase()}`);
    assert.ok(guide.reason_codes.includes("watch_rr"));
    assert.equal(decision.confirmation, "price_observed");
    assert.equal(decision.waitingAction, "wait_rr");
  });
}

test("stale UUID, timeframe, closed timestamps, settings or direction cannot supply confirmation", () => {
  const { analysis, guide } = fixture("long", { price_confirmed: false });
  for (const changes of [
    { market_instrument_id: ethId },
    { timeframe: "1h" },
    { confirmed_at: "2000-01-01T00:00:00Z" },
    { candle_open_time: "2000-01-01T00:00:00Z" },
    { settings: { ...analysis.settings, period: 50 } },
    { settings: { ...analysis.settings, type: "EMA" } },
    { settings: { ...analysis.settings, enabled: false } },
    { setup_direction: "short" },
  ]) {
    const decision = describeGuideDecision(guide, {
      ...analysis,
      price_confirmed: true,
      ...changes,
    });
    assert.equal(decision.confirmation, "unknown", JSON.stringify(changes));
    assert.equal(decision.waitingAction, "wait_confirmation");
  }
  assert.equal(describeGuideDecision(guide).confirmation, "unknown");
});

test("a directional bias is not a valid location; conflict and stale context clear the bias", () => {
  const { analysis, guide } = fixture("long", {
    hard_failures: ["no_retest"],
    setup_type: null,
    entry_zone: null,
  });
  assert.equal(guide.state, "WAIT");
  const decision = describeGuideDecision(guide, analysis);
  assert.equal(decision.direction, "long");
  assert.equal(decision.zone, null);
  assert.equal(decision.confirmation, "blocked");
  assert.equal(
    describeGuideDecision(guide, { ...analysis, market_instrument_id: ethId })
      .direction,
    "none",
  );
  assert.equal(
    describeGuideDecision({ ...guide, reason_codes: ["conflict"] }, analysis)
      .direction,
    "none",
  );
  assert.equal(
    describeGuideDecision(guide, {
      ...analysis,
      hard_failures: ["trend_conflict"],
    }).direction,
    "none",
  );
});

test("WAIT and MISSED never expose retained zones as current entry locations", () => {
  const { guide, analysis } = fixture();
  for (const state of ["WAIT", "MISSED"]) {
    const decision = describeGuideDecision({ ...guide, state }, analysis);
    assert.equal(decision.zone, null);
    assert.equal(
      decision.confirmation,
      state === "MISSED" ? "missed" : "blocked",
    );
    assert.equal(decision.waitingAction, null);
  }
  for (const changes of [
    { entry_zone_low: null },
    { entry_zone_high: null },
    { entry_zone_low: 0 },
    { entry_zone_low: NaN },
    { entry_zone_high: Infinity },
    { entry_zone_low: guide.entry_zone_high + 1 },
  ])
    assert.equal(
      describeGuideDecision({ ...guide, ...changes }, analysis).zone,
      null,
    );
});

test("partial candles cannot change the Guide or its decision explanation", () => {
  const { snapshot, analysis, guide } = fixture(),
    expected = describeGuideDecision(guide, analysis),
    partial = {
      ...snapshot.closedCandles.at(-1),
      openTime: "2099-01-01T00:00:00Z",
      closeTime: "2099-01-01T00:15:00Z",
      open: 1,
      close: 999999,
      high: 999999,
      low: 1,
      volume: 999999,
      isClosed: false,
    },
    updated = {
      ...snapshot,
      closedCandles: [...snapshot.closedCandles, partial],
    },
    nextAnalysis = calculateMaEntry(updated, btcId, "15m"),
    nextGuide = calculateTradeGuide(
      updated,
      nextAnalysis,
      undefined,
      btcId,
      "15m",
    );
  assert.deepEqual(nextGuide, guide);
  assert.deepEqual(describeGuideDecision(nextGuide, nextAnalysis), expected);
});
