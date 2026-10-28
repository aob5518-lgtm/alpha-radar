import assert from "node:assert/strict";
import test from "node:test";
import { coverage } from "../../../scripts/audit/coverage-v12.mjs";
import { fixtureHistory, btcId } from "./helpers/chart-fixtures.mjs";
const series = (interval) => ({
  symbol: "BTCUSDT",
  id: btcId,
  interval,
  candles: fixtureHistory(interval, btcId, 260).items.map((c) => ({
    ...c,
    provider: "bybit",
  })),
});
test("V1.2 coverage replays causal closed prefixes and never reads changed future candles", () => {
  const primary = series("15m"),
    higher = series("1h");
  const start = Date.parse(primary.candles.at(-4).close_time),
    end = Date.parse(primary.candles.at(-1).close_time);
  const rows = [],
    later = [];
  const first = coverage(
    primary,
    higher,
    start,
    end,
    () => {},
    (r) => rows.push(structuredClone(r)),
  );
  const modified = structuredClone(primary),
    last = modified.candles.at(-1);
  Object.assign(last, {
    open: "99999",
    high: "99999",
    low: "99999",
    close: "99999",
  });
  const second = coverage(
    modified,
    higher,
    start,
    end,
    () => {},
    (r) => later.push(structuredClone(r)),
  );
  assert.equal(first.n, 4);
  assert.equal(second.n, 4);
  assert.deepEqual(later.slice(0, -1), rows.slice(0, -1));
  for (const r of rows) {
    assert.equal(r.guide.market_instrument_id, btcId);
    assert.equal(r.ma.timeframe, "15m");
    if (r.guide.state.endsWith("_READY")) {
      assert.deepEqual(r.guide.hard_failures, []);
      assert.ok(r.guide.evidence_score >= 70 && r.guide.reward_risk_tp1 >= 1.5);
    }
  }
  const partial = structuredClone(primary);
  partial.candles.at(-1).is_closed = false;
  assert.throws(() => coverage(partial, higher, start, end));
});
