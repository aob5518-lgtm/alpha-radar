import assert from "node:assert/strict";
import test from "node:test";

import {
  executionTime,
  payoutBreakeven,
  validPayout,
} from "../src/lib/event-semi-auto.ts";

test("manual payout must meet the configured floor and supported decimal precision", () => {
  assert.equal(validPayout("1.79", "1.80"), false);
  assert.equal(validPayout("1.80", "1.80"), true);
  assert.equal(validPayout("1.800001", "1.80"), true);
  assert.equal(validPayout("1.8000001", "1.80"), false);
  assert.equal(validPayout("1.8e0", "1.80"), false);
  assert.equal(validPayout("101", "1.80"), false);
});

test("break-even is based on entered payout and invalid input stays empty", () => {
  assert.equal(payoutBreakeven("1.8"), 1 / 1.8);
  assert.equal(payoutBreakeven(""), null);
  assert.equal(payoutBreakeven("Infinity"), null);
  assert.equal(executionTime(""), null);
  assert.equal(
    executionTime("2026-11-28T01:00:01Z"),
    "2026-11-28T01:00:01.000Z",
  );
});
