import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateTradeGuide,
  guideMatchesIdentity,
} from "../src/lib/market/trade-guide.ts";
import { calculateMaEntry } from "../src/lib/market/ma-confluence-entry.ts";
import { calculateTradeSetup } from "../src/lib/market/trade-setup.ts";
import { maFixture } from "./helpers/ma-fixtures.mjs";
import { btcId, ethId } from "./helpers/chart-fixtures.mjs";

// Aggregator boundary fixtures, not market observations or altered engine rules.
function fixture(direction = "long", rr = 3) {
  const snapshot = maFixture(direction),
    ma = calculateMaEntry(snapshot, btcId, "15m");
  const mirror = (value) => (direction === "long" ? value : 300 - value);
  const target = mirror(100 + 10 * rr);
  Object.assign(ma, {
    ma_value: mirror(100),
    ma_zone_low: direction === "long" ? 99 : 199,
    ma_zone_high: direction === "long" ? 101 : 201,
    entry_zone: {
      low: direction === "long" ? 99 : 199,
      high: direction === "long" ? 101 : 201,
    },
    trigger_price: mirror(100),
    invalidation_price: mirror(90),
    first_target: target,
  });
  snapshot.closedCandles.at(-1).close = mirror(100);
  const opposing =
    direction === "long" ? snapshot.resistances : snapshot.supports;
  opposing[0].zone_low = target;
  opposing[0].zone_high = target;
  const run = (previous) =>
    calculateTradeGuide(snapshot, ma, undefined, btcId, "15m", previous);
  return { snapshot, ma, run, mirror };
}
for (const direction of ["long", "short"]) {
  const ready = direction === "long" ? "LONG_READY" : "SHORT_READY",
    watch = direction === "long" ? "WATCH_LONG" : "WATCH_SHORT";
  test(`unchanged MA ${direction} trigger + coherent confirmed context produces READY deterministically`, () => {
    const snapshot = maFixture(direction),
      copy = structuredClone(snapshot),
      ma = calculateMaEntry(snapshot, btcId, "15m");
    const result = calculateTradeGuide(
      snapshot,
      ma,
      calculateTradeSetup(snapshot, btcId, "15m"),
      btcId,
      "15m",
    );
    assert.equal(result.state, ready);
    assert.ok(result.reward_risk_tp1 >= 1.5);
    assert.deepEqual(
      result,
      calculateTradeGuide(
        snapshot,
        ma,
        calculateTradeSetup(snapshot, btcId, "15m"),
        btcId,
        "15m",
      ),
    );
    assert.deepEqual(snapshot, copy);
  });
  for (const [rr, expected] of [
    [1.19, "WAIT"],
    [1.2, watch],
    [1.49, watch],
    [1.5, ready],
    [2, ready],
  ])
    test(`${direction} RR ${rr} → ${expected}`, () => {
      const f = fixture(direction, rr),
        result = f.run();
      assert.equal(result.state, expected, JSON.stringify(result));
      assert.equal(result.favorable_reward_risk, rr >= 2);
    });
  test(`${direction} candidate and unconfirmed observation remain WATCH without an executable plan`, () => {
    const f = fixture(direction);
    f.ma.state = `candidate_${direction}`;
    assert.equal(f.run().state, watch);
    Object.assign(f.ma, {
      state: `observe_${direction}`,
      entry_zone: null,
      trigger_price: null,
      invalidation_price: null,
      first_target: null,
      reason_codes: ["no_retest"],
    });
    const result = f.run();
    assert.equal(result.state, watch);
    assert.equal(result.reference_entry_price, null);
    assert.equal(result.stop_price, null);
    assert.equal(result.reward_risk_tp1, null);
  });
  test(`${direction} nearest real target, second structure and missing TP2 have provenance`, () => {
    const f = fixture(direction),
      levels =
        direction === "long" ? f.snapshot.resistances : f.snapshot.supports;
    const base = structuredClone(levels[0]);
    levels.push({
      ...base,
      label: direction === "long" ? "R2" : "S2",
      zone_low: f.mirror(150),
      zone_high: f.mirror(150),
    });
    f.ma.first_target = f.mirror(120);
    const result = f.run();
    assert.equal(result.tp1_price, f.mirror(120));
    assert.equal(
      result.tp1_source,
      direction === "long" ? "swing-high" : "swing-low",
    );
    assert.equal(result.tp2_price, f.mirror(130));
    assert.equal(result.tp2_source, direction === "long" ? "R1" : "S1");
    f.ma.first_target = f.mirror(130);
    levels.pop();
    assert.equal(f.run().tp2_price, null);
    assert.equal(f.run().tp2_source, null);
  });
  test(`${direction} authoritative buffered stop is unchanged; deeper overlapping structure gets one buffer before RR`, () => {
    const f = fixture(direction);
    assert.equal(f.run().stop_price, f.ma.invalidation_price);
    const levels =
      direction === "long" ? f.snapshot.supports : f.snapshot.resistances;
    Object.assign(levels[0], {
      zone_low: direction === "long" ? 89 : 199,
      zone_high: direction === "long" ? 101 : 211,
    });
    const result = f.run();
    assert.equal(result.stop_price, f.mirror(87.75));
    assert.equal(f.ma.invalidation_price, f.mirror(90));
    assert.ok(
      direction === "long"
        ? result.stop_price < levels[0].zone_low
        : result.stop_price > levels[0].zone_high,
    );
  });
  test(`${direction} current valid trigger beyond the zone becomes MISSED, never READY`, () => {
    const f = fixture(direction);
    f.snapshot.closedCandles.at(-1).close = f.mirror(107);
    const result = f.run();
    assert.equal(result.state, "MISSED");
    assert.equal(result.next_action, `no_chase_${direction}`);
  });
  test(`${direction} prior READY anchors bounded missed detection; no evidence, failed stop, reached target, expired/settings/identity reject`, () => {
    const f = fixture(direction),
      prior = f.run(),
      last = f.snapshot.closedCandles.at(-1);
    f.snapshot.closedCandles.push({
      ...last,
      openTime: last.closeTime,
      closeTime: new Date(Date.parse(last.closeTime) + 900000).toISOString(),
      close: f.mirror(107),
    });
    const next = f.snapshot.closedCandles.at(-1);
    f.snapshot.state.confirmed_at = next.closeTime;
    Object.assign(f.ma, {
      state: `observe_${direction}`,
      entry_zone: null,
      trigger_price: null,
      invalidation_price: null,
      first_target: null,
      reason_codes: ["overextended"],
      confirmed_at: next.closeTime,
      candle_open_time: next.openTime,
    });
    assert.equal(f.run(prior).state, "MISSED");
    assert.equal(f.run().state, "WAIT");
    for (const changed of [
      { ...prior, market_instrument_id: ethId },
      { ...prior, timeframe: "1h" },
      { ...prior, ma_settings_key: "EMA:99:true" },
      { ...prior, candle_open_time: f.snapshot.closedCandles.at(-6).openTime },
    ])
      assert.equal(f.run(changed).state, "WAIT");
    next.close = f.mirror(89);
    assert.equal(f.run(prior).state, "WAIT");
    assert.ok(f.run(prior).reason_codes.includes("invalidated"));
    next.close = f.mirror(131);
    assert.equal(f.run(prior).state, "WAIT");
    assert.ok(f.run(prior).reason_codes.includes("target_reached"));
  });
}
test("invalidated, conflicting, noisy, missing target and invalid risk contexts fail closed", () => {
  for (const [change, reason] of [
    [(f) => (f.ma.state = "invalidated"), "invalidated"],
    [(f) => (f.snapshot.trend.direction = "neutral"), "conflict"],
    [(f) => (f.snapshot.state.direction = "bearish"), "conflict"],
    [(f) => (f.ma.reason_codes = ["repeated_crosses"]), "noise"],
    [
      (f) => {
        f.snapshot.resistances = [];
        f.ma.first_target = null;
      },
      "no_target",
    ],
    [(f) => (f.ma.invalidation_price = 100), "invalid_risk"],
  ]) {
    const f = fixture();
    change(f);
    const result = f.run();
    assert.equal(result.state, "WAIT");
    assert.ok(result.reason_codes.includes(reason), JSON.stringify(result));
  }
});
test("wrong UUID, timeframe, stale confirmation and setup identity cannot be relabeled as current", () => {
  const f = fixture();
  for (const ma of [
    { ...f.ma, market_instrument_id: ethId },
    { ...f.ma, timeframe: "1h" },
    { ...f.ma, confirmed_at: "2020-01-01T00:00:00Z" },
  ])
    assert.equal(
      calculateTradeGuide(f.snapshot, ma, undefined, btcId, "15m").state,
      "WAIT",
    );
  const setup = calculateTradeSetup(f.snapshot, ethId, "15m");
  assert.equal(
    calculateTradeGuide(f.snapshot, f.ma, setup, btcId, "15m").state,
    "WAIT",
  );
  assert.equal(guideMatchesIdentity(f.run(), ethId, "15m"), false);
  assert.equal(guideMatchesIdentity(f.run(), btcId, "1h"), false);
});
test("partial bars cannot create READY or move stop/TP; visual prices are not aggregation inputs", () => {
  const f = fixture(),
    original = f.run();
  f.snapshot.closedCandles.push({
    ...f.snapshot.closedCandles.at(-1),
    isClosed: false,
    close: 999999,
    high: 999999,
  });
  assert.deepEqual(f.run(), original);
  f.ma.state = "candidate_long";
  assert.equal(f.run().state, "WATCH_LONG");
});
