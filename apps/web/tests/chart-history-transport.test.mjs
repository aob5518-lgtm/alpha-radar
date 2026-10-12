import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/api/v1/market-instruments/[instrumentId]/history/route.ts";
import { btcId } from "./helpers/chart-fixtures.mjs";

test("same-origin history transport forwards only canonical parameters, never credentials or arbitrary hosts", async (t) => {
  let called;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    called = { url: new URL(url), options };
    return Response.json(
      { market_instrument_id: btcId },
      { headers: { "x-private": "must-not-forward" } },
    );
  });
  const request = new Request(
    `http://localhost/api/v1/market-instruments/${btcId}/history?interval=15m&limit=800&start=2026-10-12T10:00:00Z&url=http://evil.invalid`,
    { headers: { authorization: "fixture-secret" } },
  );
  const response = await GET(request, {
    params: Promise.resolve({ instrumentId: btcId }),
  });
  assert.equal(response.status, 200);
  assert.equal(
    called.url.pathname,
    `/api/v1/market-instruments/${btcId}/history`,
  );
  assert.equal(called.url.searchParams.get("interval"), "15m");
  assert.equal(called.url.searchParams.get("limit"), "800");
  assert.equal(called.url.searchParams.has("url"), false);
  assert.equal(called.options.headers, undefined);
  assert.equal(response.headers.get("x-private"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("history transport preserves canonical API validation/errors and fails closed on network failure", async (t) => {
  const request = new Request(
    `http://localhost/api/v1/market-instruments/${btcId}/history?interval=invalid`,
  );
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: { code: "validation_error" } }, { status: 422 }),
  );
  assert.equal(
    (await GET(request, { params: Promise.resolve({ instrumentId: btcId }) }))
      .status,
    422,
  );
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("private-provider-url-or-secret");
  });
  t.mock.method(console, "warn", () => {});
  const unavailable = await GET(request, {
    params: Promise.resolve({ instrumentId: btcId }),
  });
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /private-provider|secret/);
});

test("non-UUID transport paths are rejected before any upstream request", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({});
  });
  const response = await GET(new Request("http://localhost/history"), {
    params: Promise.resolve({ instrumentId: "../admin" }),
  });
  assert.equal(response.status, 422);
  assert.equal(calls, 0);
});
