import assert from "node:assert/strict";
import test from "node:test";
import {
  actionable,
  binanceAppEntry,
  instruction,
  returnable,
} from "../src/lib/event-mobile-handoff.ts";

const now = Date.parse("2026-11-28T08:00:00Z");
const intent = Object.freeze({
  id: "fixture-intent",
  symbol: "BTCUSDT",
  direction: "lower",
  horizon_minutes: 10,
  signal_state: "STRONG_LOWER",
  suggested_stake: "10",
  minimum_payout: "1.80",
  status: "PENDING_REVIEW",
  expires_at: "2026-11-28T08:01:00Z",
  risk_reason: null,
  handoff_started_at: null,
  returned_at: null,
});

test("only an enabled, active STRONG intent can launch", () => {
  assert.equal(actionable(intent, true, now), true);
  for (const state of ["WAIT", "LOWER", "HIGHER"]) {
    assert.equal(
      actionable({ ...intent, signal_state: state }, true, now),
      false,
    );
  }
  assert.equal(actionable(intent, false, now), false);
  assert.equal(actionable(intent, true, now + 60_000), false);
  assert.equal(
    actionable({ ...intent, risk_reason: "stale_data" }, true, now),
    false,
  );
});

test("return keeps the exact persisted intent after expiry", () => {
  const handoff = {
    ...intent,
    status: "EXPIRED",
    handoff_started_at: "2026-11-28T08:00:10Z",
  };
  assert.deepEqual(returnable([intent, handoff]), [handoff]);
  assert.equal(actionable(handoff, true, now), false);
  assert.equal(
    returnable([{ ...handoff, returned_at: "2026-11-28T08:02:00Z" }]).length,
    0,
  );
});

test("clipboard allowlist and official destination exclude credentials", () => {
  const token = "private-test-token";
  assert.equal(
    instruction({ ...intent, token, notes: token }),
    "BTC 10m\nLOWER\n10.00 USDT\nMin payout 1.80x",
  );
  const url = new URL(binanceAppEntry);
  assert.equal(url.origin, "https://www.binance.com");
  assert.equal(url.search + url.hash, "");
  assert.equal(binanceAppEntry.includes(token), false);
});
