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

for (const stage of ["headers", "body"]) {
  test(`25s deadline covers ${stage} and returns a typed safe timeout with structured diagnostics`, async (t) => {
    const controller = new AbortController();
    let configuredTimeout, options;
    const logs = [];
    t.mock.method(AbortSignal, "timeout", (milliseconds) => {
      configuredTimeout = milliseconds;
      return controller.signal;
    });
    t.mock.method(console, "warn", (value) => logs.push(JSON.parse(value)));
    const fail = () => {
      controller.abort(new DOMException("secret upstream URL", "TimeoutError"));
      throw new DOMException("private-body-or-token", "AbortError");
    };
    t.mock.method(globalThis, "fetch", async (_url, input) => {
      options = input;
      if (stage === "headers") return fail();
      const response = Response.json({});
      response.arrayBuffer = async () => fail();
      return response;
    });
    const response = await GET(
      new Request(
        `http://localhost/history?interval=1h&role=higher&start=2026-10-12T00:00:00Z`,
      ),
      {
        params: Promise.resolve({ instrumentId: btcId }),
      },
    );
    assert.equal(configuredTimeout, 25000);
    assert.equal(options.signal, controller.signal);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).error.code, "history_timeout");
    assert.equal(logs.length, 1);
    assert.deepEqual(
      { ...logs[0], elapsed_ms: 0 },
      {
        event: "chart_history_refresh_failed",
        market_instrument_id: btcId,
        timeframe: "1h",
        role: "higher",
        incremental: true,
        elapsed_ms: 0,
        error_type: "TimeoutError",
      },
    );
    assert.ok(logs[0].elapsed_ms >= 0);
    assert.doesNotMatch(JSON.stringify(logs), /secret|private|token/);
  });
}
