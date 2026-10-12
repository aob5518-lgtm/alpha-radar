import assert from "node:assert/strict";
import test from "node:test";

import {
  ChartContextStore,
  fetchChartHistory,
  chartIdentityKey,
  mergeConfirmedHistory,
  projectConfirmedStreamCandle,
} from "../src/lib/market/chart-context-store.ts";
import { calculateTechnicalContext } from "../src/lib/market/technical-context.ts";
import { MARKET_STATE_CONSTANTS } from "../src/lib/market/market-state.ts";
import {
  btcId,
  ethId,
  fixtureNow,
  fixtureHistory,
  fixtureClosedUpdate,
} from "./helpers/chart-fixtures.mjs";

test("incremental history transport includes the canonical required end bound", async (t) => {
  let query;
  t.mock.method(globalThis, "fetch", async (url) => {
    query = new URL(url, "http://localhost").searchParams;
    return Response.json(fixtureHistory("1h", btcId));
  });
  const start = "2026-10-12T11:00:00Z";
  await fetchChartHistory(btcId, "1h", start);
  assert.equal(query.get("start"), start);
  assert.ok(Date.parse(query.get("end")) > Date.parse(start));
  await fetchChartHistory(btcId, "1h");
  assert.equal(query.has("start"), false);
  assert.equal(query.has("end"), false);
});

function storeFixture() {
  const calls = [];
  const store = new ChartContextStore(
    async (id, interval, start) => {
      calls.push({ id, interval, start });
      return fixtureHistory(interval, id);
    },
    () => fixtureNow,
  );
  return { store, calls };
}

test("first 15m visit fetches canonical history and the exact higher context", async () => {
  const { store, calls } = storeFixture();
  const entry = await store.load(btcId, "15m");
  assert.deepEqual(calls.map((x) => x.interval).sort(), ["15m", "1h"]);
  assert.ok(calls.every((x) => x.id === btcId && x.start === undefined));
  assert.equal(entry.history.market_instrument_id, btcId);
});

test("15m → 1h → 15m reuses current cached history AND technical replay", async () => {
  const { store, calls } = storeFixture();
  const first = await store.load(btcId, "15m");
  const snapshot = first.snapshot;
  await store.load(btcId, "1h");
  const again = await store.load(btcId, "15m");
  assert.equal(again.snapshot, snapshot);
  assert.equal(calls.filter((x) => x.interval === "1h").length, 1); // Initially required as higher context.
  assert.equal(calls.filter((x) => x.interval === "15m").length, 1);
  assert.equal(calls.filter((x) => x.interval === "4h").length, 1);
});

test("cache enforces UUID + interval and never supplies BTC history to ETH", async () => {
  const { store, calls } = storeFixture();
  await store.load(btcId, "15m");
  assert.equal(store.context(ethId, "15m"), undefined);
  const eth = await store.load(ethId, "15m");
  assert.equal(eth.history.market_instrument_id, ethId);
  assert.equal(eth.setup.market_instrument_id, ethId);
  assert.notEqual(
    chartIdentityKey(btcId, "15m"),
    chartIdentityKey(ethId, "15m"),
  );
  assert.notEqual(
    chartIdentityKey(btcId, "15m"),
    chartIdentityKey(btcId, "1h"),
  );
  assert.equal(calls.filter((x) => x.id === ethId).length, 2);
});

test("history-only higher cache is not a fast-path context; fully computed current context is", async () => {
  const { store } = storeFixture();
  await store.load(btcId, "15m");
  assert.equal(store.cachedContext(btcId, "1h"), undefined);
  assert.equal(store.peek(btcId, "1h").snapshot, null);
  const entry = await store.load(btcId, "1h");
  assert.equal(store.cachedContext(btcId, "1h"), entry);
});

test("new confirmed candle refreshes levels, trend, state, markers and setup without navigation or fetch", async () => {
  const { store, calls } = storeFixture();
  const entry = await store.load(btcId, "15m");
  const before = entry.snapshot;
  const beforeSetup = entry.setup;
  const fetches = calls.length;
  const update = fixtureClosedUpdate(entry.history);
  assert.equal(store.confirm(btcId, "15m", update), true);
  const next = store.context(btcId, "15m");
  assert.notDeepEqual(next.snapshot.supports, before.supports);
  assert.notDeepEqual(next.snapshot.trend, before.trend);
  assert.notDeepEqual(next.snapshot.state, before.state);
  assert.notEqual(next.snapshot.markers, before.markers); // Replayed, but selection need not change on every close.
  assert.notDeepEqual(next.setup, beforeSetup);
  const expected = calculateTechnicalContext(
    next.history.items,
    Number(update.close),
    "15m",
    store.peek(btcId, "1h").history.items,
    btcId,
  );
  assert.deepEqual(next.snapshot, expected);
  assert.equal(next.snapshot.state.confirmed_at, update.close_time);
  assert.equal(calls.length, fetches);
  assert.equal(store.confirm(btcId, "15m", update), false);
  assert.equal(store.context(btcId, "15m").snapshot, next.snapshot);
});

test("a newly confirmed meaningful transition updates marker selection automatically", async () => {
  const history = fixtureHistory();
  history.items = history.items.map((c) => ({
    ...c,
    open: "100",
    high: "100.35",
    low: "99.65",
    close: "100",
  }));
  const store = new ChartContextStore(
    async (id, interval) =>
      interval === "15m" ? history : fixtureHistory(interval, id),
    () => fixtureNow,
  );
  const before = (await store.load(btcId, "15m")).snapshot;
  assert.equal(before.markers.length, 0);
  const update = {
    ...fixtureClosedUpdate(history, 103),
    high: "103.3",
    low: "99.65",
  };
  assert.equal(store.confirm(btcId, "15m", update), true);
  const next = store.context(btcId, "15m").snapshot;
  assert.ok(
    next.markers.some(
      (marker) =>
        marker.confirmed_at === update.close_time &&
        marker.phase === "sharp_rise",
    ),
  );
});

test("partial, ticker and trade cannot change technical context or preferred entry", async () => {
  const { store } = storeFixture();
  const entry = await store.load(btcId, "15m");
  const snapshot = entry.snapshot,
    setup = entry.setup;
  for (const update of [
    { ...fixtureClosedUpdate(entry.history), is_closed: false },
    { type: "price", price: "999999" },
    { type: "trade", price: "0.1" },
  ]) {
    assert.equal(store.confirm(btcId, "15m", update), false);
    const next = store.context(btcId, "15m");
    assert.equal(next.snapshot, snapshot);
    assert.equal(next.setup, setup);
  }
});

test("higher confirmed close refreshes dependent current context, partial higher close does not", async () => {
  const { store } = storeFixture();
  const before = (await store.load(btcId, "15m")).snapshot;
  const update = fixtureClosedUpdate(store.peek(btcId, "1h").history, 180);
  assert.equal(
    store.confirm(btcId, "1h", { ...update, is_closed: false }),
    false,
  );
  assert.equal(store.context(btcId, "15m").snapshot, before);
  assert.equal(store.confirm(btcId, "1h", update), true);
  const entry = store.context(btcId, "15m");
  assert.notEqual(entry.snapshot, before);
  const expected = calculateTechnicalContext(
    entry.history.items,
    Number(entry.history.items.at(-1).close),
    "15m",
    store.peek(btcId, "1h").history.items,
    btcId,
  );
  assert.deepEqual(entry.snapshot, expected);
});

test("confirmed merge orders, replaces exact timestamp, rejects other identities and caps to 800", () => {
  const history = fixtureHistory("15m", btcId, 810);
  const newer = { ...history.items.at(-1), close: "200", high: "201" };
  const other = { ...newer, market_instrument_id: ethId };
  const result = mergeConfirmedHistory(
    history.items.reverse(),
    [newer, other],
    btcId,
    "15m",
  );
  assert.equal(result.length, MARKET_STATE_CONSTANTS.calculationWindow);
  assert.equal(result.at(-1).close, "200");
  assert.equal(new Set(result.map((c) => c.open_time)).size, 800);
  assert.ok(
    result.every((c, i) => !i || c.open_time > result[i - 1].open_time),
  );
});

test("bounded cache eviction advances older-history cursor rather than skipping trimmed bars", () => {
  const history = fixtureHistory("15m", btcId, 800);
  const store = new ChartContextStore(
    async () => history,
    () => fixtureNow,
  );
  store.seed({ ...history, has_more: false });
  assert.equal(store.confirm(btcId, "15m", fixtureClosedUpdate(history)), true);
  const current = store.peek(btcId, "15m").history;
  assert.equal(current.items.length, 800);
  assert.equal(current.next_end, current.items[0].open_time);
  assert.equal(current.has_more, true);
});

test("stream projection rejects wrong provider contract/timeframe and never invents ingestion timestamps", () => {
  const history = fixtureHistory();
  const update = fixtureClosedUpdate(history);
  assert.equal(
    projectConfirmedStreamCandle(
      { ...update, provider_instrument_id: "ETHUSDT" },
      history,
    ),
    null,
  );
  assert.equal(
    projectConfirmedStreamCandle({ ...update, interval: "1h" }, history),
    null,
  );
  assert.equal(
    projectConfirmedStreamCandle({ ...update, close_time: "invalid" }, history),
    null,
  );
  assert.equal(projectConfirmedStreamCandle(update, history).ingested_at, "");
  assert.equal(
    projectConfirmedStreamCandle(update, history).market_instrument_id,
    btcId,
  );
});

test("stale histories refresh incrementally and concurrent loads deduplicate requests", async () => {
  let now = fixtureNow;
  const calls = [];
  const store = new ChartContextStore(
    async (id, interval, start) => {
      calls.push({ id, interval, start });
      return fixtureHistory(interval, id);
    },
    () => now,
  );
  await Promise.all([store.load(btcId, "15m"), store.load(btcId, "15m")]);
  assert.equal(calls.length, 2);
  now += 900000;
  await store.load(btcId, "15m");
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).start, fixtureHistory().items.at(-1).open_time);
});

test("bad API identity rejects rather than installing an unrelated context", async () => {
  const store = new ChartContextStore(async () => fixtureHistory("15m", ethId));
  await assert.rejects(store.load(btcId, "15m"), /identity/);
  assert.equal(store.peek(btcId, "15m"), undefined);
});

test("first higher-period REST response cannot discard a close received during its fetch", async () => {
  let resolveHigher;
  const lower = fixtureHistory(),
    higher = fixtureHistory("1h");
  const store = new ChartContextStore(
    async (id, interval) =>
      interval === "1h"
        ? new Promise((resolve) => {
            resolveHigher = resolve;
          })
        : lower,
    () => fixtureNow,
  );
  store.seed(lower);
  const pending = store.load(btcId, "15m");
  const closed = fixtureClosedUpdate(higher, 180);
  assert.equal(store.confirm(btcId, "1h", closed), true);
  resolveHigher(higher);
  await pending;
  assert.equal(store.peek(btcId, "1h").history.items.at(-1).close, "180");
  assert.equal(store.peek(btcId, "1h").history.items.length, 321);
});

test("a slow stale REST response cannot overwrite a newer streamed correction", async () => {
  let resolvePage;
  const history = fixtureHistory();
  const store = new ChartContextStore(
    async (id, interval) =>
      interval === "15m"
        ? new Promise((resolve) => {
            resolvePage = resolve;
          })
        : fixtureHistory(interval, id),
    () => fixtureNow + 900000,
  );
  store.seed(history);
  store.seed(fixtureHistory("1h"));
  const pending = store.load(btcId, "15m");
  const update = {
    ...history.items.at(-1),
    type: "candle",
    provider_instrument_id: "BTCUSDT",
    close: "120",
    high: "121",
  };
  assert.equal(store.confirm(btcId, "15m", update), true);
  resolvePage(history);
  await pending;
  assert.equal(store.peek(btcId, "15m").history.items.at(-1).close, "120");
});

test("diagnostics change no technical outputs and expose each bounded calculation stage", () => {
  const history = fixtureHistory();
  const price = Number(history.items.at(-1).close);
  let timing;
  const measured = calculateTechnicalContext(
    history.items,
    price,
    "15m",
    undefined,
    btcId,
    (value) => {
      timing = value;
    },
  );
  assert.deepEqual(
    measured,
    calculateTechnicalContext(history.items, price, "15m", undefined, btcId),
  );
  for (const key of [
    "history_fetch_ms",
    "structural_levels_ms",
    "trend_regime_ms",
    "market_state_ms",
    "marker_replay_ms",
    "total_technical_context_ms",
  ])
    assert.ok(timing[key] >= 0);
});
