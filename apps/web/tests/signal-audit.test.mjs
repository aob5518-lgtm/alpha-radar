import assert from "node:assert/strict";
import test from "node:test";
import { observers } from "../../../scripts/audit/observe.mjs";
import { verifyV1Integrity } from "../../../scripts/audit/v1-integrity.mjs";
test(
  "immutable production V1 audit fixtures retain their exact source checksums",
  verifyV1Integrity,
);
import {
  replay,
  validateSeries,
  higherAt,
} from "../../../scripts/audit/replay.mjs";
import { maFixture } from "./helpers/ma-fixtures.mjs";
import { fixtureHistory, btcId } from "./helpers/chart-fixtures.mjs";
import { calculateMaEntry } from "./fixtures/ma-entry-v1/ma-confluence-entry.ts";
import { calculateTradeGuide } from "./fixtures/ma-entry-v1/trade-guide.ts";
import { verifyPresentation } from "../../../scripts/audit/presentation.mjs";
for (const direction of ["long", "short"])
  test(`audit probes preserve exact ${direction} production outputs and observe raw gates`, () => {
    const probe = observers(),
      snapshot = maFixture(direction);
    const ma = calculateMaEntry(snapshot, btcId, "15m");
    const observed = probe.ma(snapshot, btcId, "15m");
    assert.deepEqual(observed.result, ma);
    assert.equal(observed.trace.confirmed, true);
    assert.equal(observed.trace.volumeHealthy, true);
    const guide = calculateTradeGuide(snapshot, ma, undefined, btcId, "15m");
    const g = probe.guide(snapshot, ma, undefined, btcId, "15m");
    assert.deepEqual(g.result, guide);
    assert.equal(g.trace.rr, guide.reward_risk_tp1);
    const rendered = verifyPresentation({
      symbol: "SYNTHETIC TEST ONLY",
      snapshot,
      ma,
      guide,
      candles: [],
      setup: undefined,
    });
    assert.equal(rendered.primary, true);
    assert.equal(rendered.tooltip, true);
  });
function input(n = 255) {
  const s = fixtureHistory("15m", btcId, n);
  return {
    symbol: "BTCUSDT",
    id: btcId,
    interval: "15m",
    candles: s.items.map((c) => ({ ...c, provider: "bybit" })),
  };
}
test("RR diagnostics distinguish a cleared poor-RR output from an unevaluated masked gate", () => {
  const snapshot = maFixture(),
    ma = calculateMaEntry(snapshot, btcId, "15m"),
    probe = observers();
  snapshot.resistances = [];
  ma.first_target =
    Math.max(ma.trigger_price, snapshot.closedCandles.at(-1).close) + 0.1;
  const poor = probe.guide(snapshot, ma, undefined, btcId, "15m");
  assert.equal(poor.result.state, "WAIT");
  assert.deepEqual(poor.result.reason_codes, ["poor_rr"]);
  assert.equal(poor.result.reward_risk_tp1, null);
  assert.ok(poor.trace.rr > 0 && poor.trace.rr < 1.2);
  const masked = probe.guide(
    snapshot,
    { ...ma, reason_codes: ["flat_ma"] },
    undefined,
    btcId,
    "15m",
  );
  assert.equal(masked.trace, undefined);
  assert.deepEqual(masked.result.reason_codes, ["noise"]);
});
test("audit rejects partial, duplicate, wrong identity and invalid OHLC rather than filling", () => {
  for (const mutate of [
    (s) => (s.candles[0].is_closed = false),
    (s) => (s.candles[0].market_instrument_id = "other"),
    (s) => s.candles.splice(1, 0, s.candles[0]),
    (s) => (s.candles[0].low = "999999"),
  ]) {
    const s = input();
    mutate(s);
    assert.throws(() => validateSeries(s, Infinity));
  }
  const s = input();
  s.candles.splice(10, 1);
  assert.equal(validateSeries(s, Infinity)[0].missing, 1);
});
test("higher context cannot contain future bars and stale higher history is omitted", () => {
  const c = fixtureHistory("1h", btcId, 260).items,
    time = Date.parse(c.at(-2).close_time);
  const selected = higherAt(c, time, "1h");
  assert.ok(selected.every((v) => Date.parse(v.close_time) <= time));
  assert.equal(selected.at(-1).open_time, c.at(-2).open_time);
  assert.equal(higherAt(c, time + 10 * 3600000, "1h"), undefined);
});
test("replay is deterministic and truncating future history preserves every audited result", () => {
  const s = input(),
    start = Date.parse(s.candles.at(-4).close_time),
    end = Date.parse(s.candles.at(-1).close_time);
  const originalRows = [];
  const first = replay(s, undefined, start, end, {
      onBar: (row) => originalRows.push(structuredClone(row)),
    }),
    second = replay(s, undefined, start, end);
  assert.deepEqual(first, second);
  assert.equal(
    Object.values(first.counts).reduce((a, b) => a + b, 0),
    4,
  );
  const truncated = { ...s, candles: s.candles.slice(0, -1) };
  const before = replay(truncated, undefined, start, end);
  assert.equal(before.n, 3);
  const other = {
    ...s,
    candles: [
      ...truncated.candles,
      {
        ...s.candles.at(-1),
        open: "999999",
        high: "999999",
        low: "999999",
        close: "999999",
      },
    ],
  };
  // Even when the future bar is INCLUDED in the dataset, earlier snapshots,
  // pivots, lifecycle markers, MA and Guide must remain byte-for-byte equal.
  const changedRows = [];
  replay(other, undefined, start, end, {
    onBar: (row) => changedRows.push(structuredClone(row)),
  });
  assert.deepEqual(changedRows.slice(0, -1), originalRows.slice(0, -1));
});
