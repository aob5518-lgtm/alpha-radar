import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  researchIdentityMatches,
  researchPresentation,
  shadowIdentityMatches,
  shadowIsCurrent,
} from "../src/lib/market/event-contract-research.ts";
import { GET } from "../src/app/api/v1/event-contracts/[assetId]/route.ts";

const btc = "823a85ed-d36d-58e1-a56d-2e2a3bf1a887";
const eth = "11111111-1111-4111-8111-111111111111";
const at = Date.parse("2026-11-27T10:00:00Z");
const fixture = () => ({
  version: "event-contract-direction-v1",
  asset_id: btc,
  symbol: "BTC",
  market_instrument_id: "index-instrument",
  provider: "binance_index",
  horizon_minutes: 10,
  availability: "ready",
  validation_status: "unvalidated",
  settlement_basis: "next_minute_index_open_proxy",
  settlement_basis_verified: false,
  probability: null,
  expected_value: null,
  last_updated_at: new Date(at).toISOString(),
  valid_until: new Date(at + 60000).toISOString(),
  assessment: {
    version: "event-contract-direction-v1",
    horizon_minutes: 10,
    direction: "up",
    reasons: ["trend_pullback_confirmed"],
    confirmed_at: new Date(at).toISOString(),
    reference_price: "60000",
    zone_low: "59950",
    zone_high: "60010",
    environment_interval: "5m",
    trigger_interval: "1m",
  },
  observations: [],
});

test("shadow observations require exact instrument, asset, horizon and freshness", () => {
  const instrument = "bybit-btc-instrument";
  const payload = {
    version: "event-signal-v1",
    settlement_version: "event-shadow-v1",
    mode: "shadow",
    validation_status: "unvalidated",
    asset_id: btc,
    market_instrument_id: instrument,
    reference_instrument_id: "binance-index",
    symbol: "BTC",
    horizon_minutes: 10,
    signal_source: "bybit",
    reference_source: "binance_index_minute_close_proxy",
    settlement_source: "binance_index_minute_close_proxy",
    settlement_basis_verified: false,
    probability: null,
    expected_value: null,
    generated_at: new Date(at).toISOString(),
    valid_until: new Date(at + 90_000).toISOString(),
    assessment: {
      state: "STRONG_HIGHER",
      direction: "higher",
      score: 87,
      as_of: new Date(at).toISOString(),
    },
    signal: {
      direction: "higher",
      score: 87,
      expires_at: new Date(at + 600_000).toISOString(),
    },
  };
  assert.ok(shadowIdentityMatches(payload, btc, instrument, "BTC", 10));
  assert.ok(shadowIsCurrent(payload, at + 1000));
  assert.equal(shadowIdentityMatches(payload, btc, "other", "BTC", 10), false);
  assert.equal(
    shadowIdentityMatches(payload, eth, instrument, "ETH", 10),
    false,
  );
  assert.equal(
    shadowIdentityMatches(payload, btc, instrument, "BTC", 30),
    false,
  );
  assert.equal(
    shadowIdentityMatches(
      { ...payload, probability: 0.87 },
      btc,
      instrument,
      "BTC",
      10,
    ),
    false,
  );
  assert.equal(shadowIsCurrent(payload, at + 90_000), false);
  assert.equal(shadowIsCurrent(payload, at - 1000), false);
});

test("exact BTC/ETH and 10/30 horizon identities never leak direction", () => {
  const data = fixture();
  assert.equal(researchIdentityMatches(data, btc, "BTC", 10), true);
  for (const [id, symbol, horizon] of [
    [eth, "ETH", 10],
    [btc, "BTC", 30],
    [eth, "BTC", 30],
  ]) {
    assert.equal(researchIdentityMatches(data, id, symbol, horizon), false);
    assert.equal(
      researchPresentation(data, id, symbol, horizon, at).direction,
      "unavailable",
    );
  }
  for (const invalid of [
    { ...data, provider: "bybit" },
    { ...data, probability: 0.8 },
    { ...data, expected_value: 0.2 },
    { ...data, validation_status: "validated" },
    { ...data, settlement_basis_verified: true },
    { ...data, assessment: { ...data.assessment, horizon_minutes: 30 } },
  ])
    assert.equal(researchIdentityMatches(invalid, btc, "BTC", 10), false);
});

test("signal expires locally even when polling stops; stale/future data never looks current", () => {
  const data = fixture();
  assert.equal(researchPresentation(data, btc, "BTC", 10, at).direction, "up");
  assert.equal(
    researchPresentation(data, btc, "BTC", 10, at + 60001).reason,
    "signal_expired",
  );
  assert.equal(
    researchPresentation(data, btc, "BTC", 10, at + 90001).direction,
    "unavailable",
  );
  assert.equal(
    researchPresentation(data, btc, "BTC", 10, at - 1000).direction,
    "unavailable",
  );
  assert.equal(
    researchPresentation(null, btc, "BTC", 10, at).direction,
    "unavailable",
  );
});

const compiled = ts.transpileModule(
  readFileSync(
    new URL("../src/components/event-contract-panel.tsx", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

test("horizon switches retain the open disclosure without remounting its native details", () => {
  const values = [];
  let cursor = 0;
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: (name) =>
      ({
        "react/jsx-runtime": jsx,
        react: {
          useState: (initial) => {
            const slot = cursor++;
            if (!(slot in values)) values[slot] = initial;
            return [values[slot], (next) => (values[slot] = next)];
          },
          useEffect: () => {},
        },
        "@/lib/i18n/format": {},
        "@/lib/market/event-contract-research": {},
      })[name],
  });
  const render = (assetId = btc) => {
    cursor = 0;
    return exports.EventContractPanel({ assetId });
  };
  const initial = render();
  assert.equal(initial.props.expanded, false);
  initial.props.onExpandedChange(true);
  for (const horizon of [30, 10, 30, 10]) {
    render().props.onHorizonChange(horizon);
    const next = render();
    assert.equal(next.props.expanded, true);
    assert.equal(next.props.horizon, horizon);
    assert.equal(next.type, initial.type);
    assert.equal(next.key, initial.key);
  }
  assert.notEqual(render(eth).key, initial.key);
});

for (const locale of ["en", "zh-CN"])
  test(`${locale} compact research UI is folded, honest and detached from the Chart interval`, () => {
    const copy = JSON.parse(
      readFileSync(
        new URL(`../messages/${locale}.json`, import.meta.url),
        "utf8",
      ),
    ).chart.eventContracts;
    const exports = {};
    runInNewContext(compiled, {
      exports,
      require: (name) =>
        ({
          "react/jsx-runtime": jsx,
          react: {
            useState: (value) => [value, () => {}],
            useEffect: () => {},
          },
          "@/lib/i18n/format": {
            formatDateTime: String,
            formatMarketPrice: String,
          },
          "@/lib/market/event-contract-research": {
            researchIdentityMatches,
            researchPresentation,
          },
        })[name],
    });
    const html = renderToStaticMarkup(
      jsx.jsx(exports.EventContractPanel, {
        assetId: btc,
        symbol: "BTC",
        copy,
        locale,
      }),
    );
    assert.ok(html.includes(copy.title));
    assert.ok(html.includes(copy.unvalidated));
    assert.ok(html.includes(copy.disclaimer));
    assert.ok(html.includes(copy.basis));
    assert.ok(html.includes(copy.independent));
    assert.match(html, /<details/);
    assert.doesNotMatch(html, /<details[^>]*\sopen/);
    assert.match(html, /absolute/);
    assert.doesNotMatch(html, /80%|70%|BUY|SELL|止盈|止损/);
    assert.ok(
      html.includes(copy.tenMinutes) && html.includes(copy.thirtyMinutes),
    );
    for (const label of Object.values(copy.reasons))
      assert.ok(label.length > 0);
  });

test("zh-CN research directions and horizons are correct", () => {
  const copy = JSON.parse(
    readFileSync(new URL("../messages/zh-CN.json", import.meta.url), "utf8"),
  ).chart.eventContracts;
  assert.equal(copy.directions.up, "偏涨");
  assert.equal(copy.directions.down, "偏跌");
  assert.equal(copy.directions.wait, "等待");
  assert.equal(copy.tenMinutes, "10分钟");
  assert.equal(copy.thirtyMinutes, "30分钟");
});

test("same-origin research transport validates identity and never calls a provider", async () => {
  const previous = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return Response.json(fixture());
  };
  try {
    for (const [id, horizon] of [
      ["BTC", "10"],
      [btc, "15"],
    ]) {
      const response = await GET(
        new Request(`http://web/api?horizon=${horizon}`),
        { params: Promise.resolve({ assetId: id }) },
      );
      assert.equal(response.status, 422);
    }
    assert.equal(calls.length, 0);
    const response = await GET(new Request("http://web/api?horizon=30"), {
      params: Promise.resolve({ assetId: btc }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(
      calls[0],
      /\/api\/v1\/event-contracts\/[\da-f-]+\?horizon=30$/,
    );
    assert.doesNotMatch(calls[0], /binance|bybit/);
    global.fetch = async () => {
      throw new Error("backend unavailable");
    };
    assert.equal(
      (
        await GET(new Request("http://web/api"), {
          params: Promise.resolve({ assetId: btc }),
        })
      ).status,
      503,
    );
  } finally {
    global.fetch = previous;
  }
});
