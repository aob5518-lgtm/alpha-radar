import assert from "node:assert/strict";
import test from "node:test";
import {
  ChartContextStore,
  fetchChartHistory,
} from "../src/lib/market/chart-context-store.ts";
import { ChartHistoryReconciler } from "../src/lib/market/chart-history-reconciler.ts";
import { calculateTechnicalContext } from "../src/lib/market/technical-context.ts";
import { bucketStart } from "../src/lib/market/live-candle.ts";
import {
  btcId,
  ethId,
  fixtureNow,
  fixtureHistory,
  fixtureClosedUpdate,
} from "./helpers/chart-fixtures.mjs";

const quiet = () => {};
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function at(interval, id, now) {
  const history = fixtureHistory(interval, id);
  const shift = bucketStart(now / 1000, interval) * 1000 - fixtureNow;
  return {
    ...history,
    items: history.items.map((c) => ({
      ...c,
      open_time: new Date(Date.parse(c.open_time) + shift).toISOString(),
      close_time: new Date(Date.parse(c.close_time) + shift).toISOString(),
    })),
  };
}
function timers() {
  const pending = new Map();
  const delays = [];
  let id = 0;
  return {
    pending,
    delays,
    schedule(fn, delay) {
      delays.push(delay);
      pending.set(++id, fn);
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
    async fire() {
      const [id, fn] = pending.entries().next().value;
      pending.delete(id);
      fn();
      await new Promise(setImmediate);
    },
  };
}

test("primary is published before a slow higher request; higher failure cannot reject usable primary", async () => {
  const higher = deferred(),
    published = deferred();
  const store = new ChartContextStore(
    async (id, interval) =>
      interval === "1h" ? higher.promise : fixtureHistory(interval, id),
    () => fixtureNow,
    quiet,
  );
  let entry;
  const loading = store.load(btcId, "15m", (value) => {
    entry = value;
    published.resolve();
  });
  await published.promise;
  assert.equal(entry.history.market_instrument_id, btcId);
  assert.equal(store.refreshHealth(btcId, "15m"), "degraded");
  assert.deepEqual(
    entry.snapshot,
    calculateTechnicalContext(
      entry.history.items,
      Number(entry.history.items.at(-1).close),
      "15m",
      undefined,
      btcId,
    ),
  );
  higher.reject(new Error("higher unavailable"));
  assert.equal(await loading, entry);
});

test("cached primary survives REST timeout; uncached failure is hard and cannot borrow another UUID/timeframe", async () => {
  let outage = false,
    now = fixtureNow;
  const store = new ChartContextStore(
    async (id, interval) => {
      if (outage) throw new DOMException("not for logs", "TimeoutError");
      return fixtureHistory(interval, id);
    },
    () => now,
    quiet,
  );
  const cached = await store.load(btcId, "15m");
  now += 900000;
  outage = true;
  const entry = await store.load(btcId, "15m");
  assert.equal(entry, cached);
  assert.equal(store.refreshHealth(btcId, "15m"), "degraded");
  assert.equal(store.cachedContext(btcId, "15m"), cached);
  assert.equal(store.cachedContext(ethId, "15m"), undefined);
  assert.equal(store.cachedContext(btcId, "4h"), undefined);
  await assert.rejects(store.load(ethId, "15m"), /not for logs/);
  await assert.rejects(store.load(btcId, "4h"), /not for logs/);
  assert.equal(store.refreshHealth(ethId, "15m"), "failed");
  assert.equal(store.refreshHealth(btcId, "4h"), "failed");
});

test("expired higher cache is omitted, not frozen or treated as current HTF evidence", async () => {
  let now = fixtureNow,
    higherDown = false;
  const store = new ChartContextStore(
    async (id, interval) => {
      if (higherDown && interval === "1h") throw new Error("higher down");
      return at(interval, id, now);
    },
    () => now,
    quiet,
  );
  const before = (await store.load(btcId, "15m")).snapshot;
  now += 3600000;
  higherDown = true;
  const entry = await store.load(btcId, "15m");
  assert.notEqual(entry.snapshot, before);
  assert.equal(store.refreshHealth(btcId, "15m"), "degraded");
  assert.equal(store.isCurrent(btcId, "15m"), true);
  assert.equal(store.isCurrent(btcId, "1h"), false);
  assert.deepEqual(
    entry.snapshot,
    calculateTechnicalContext(
      entry.history.items,
      Number(entry.history.items.at(-1).close),
      "15m",
      undefined,
      btcId,
    ),
  );
});

test("cache expiry removes HTF evidence before an immediately rendered cached switch", async () => {
  let now = fixtureNow;
  const store = new ChartContextStore(
    async (id, interval) => fixtureHistory(interval, id),
    () => now,
    quiet,
  );
  const before = (await store.load(btcId, "15m")).snapshot;
  now += 3600000;
  const cached = store.cachedContext(btcId, "15m");
  assert.ok(cached);
  assert.notEqual(cached.snapshot, before);
  assert.deepEqual(
    cached.snapshot,
    calculateTechnicalContext(
      cached.history.items,
      Number(cached.history.items.at(-1).close),
      "15m",
      undefined,
      btcId,
    ),
  );
  assert.equal(store.refreshHealth(btcId, "15m"), "degraded");
});

test("current cached higher evidence is retained when primary reconciliation fails", async () => {
  let now = fixtureNow,
    outage = false;
  const store = new ChartContextStore(
    async (id, interval) => {
      if (outage) throw new Error("primary unavailable");
      return fixtureHistory(interval, id);
    },
    () => now,
    quiet,
  );
  await store.load(btcId, "15m");
  now += 900000;
  outage = true;
  const entry = await store.load(btcId, "15m");
  assert.equal(store.isCurrent(btcId, "1h"), true);
  assert.deepEqual(
    entry.snapshot,
    calculateTechnicalContext(
      entry.history.items,
      Number(entry.history.items.at(-1).close),
      "15m",
      store.peek(btcId, "1h").history.items,
      btcId,
    ),
  );
});

test("confirmed stream advances current context and setup during REST outage; partials remain visual only", async () => {
  let now = fixtureNow,
    outage = false;
  const store = new ChartContextStore(
    async (id, interval) => {
      if (outage) throw new Error("offline");
      return fixtureHistory(interval, id);
    },
    () => now,
    quiet,
  );
  const original = await store.load(btcId, "15m");
  const snapshot = original.snapshot,
    setup = original.setup;
  now += 900000;
  outage = true;
  await store.load(btcId, "15m");
  const update = fixtureClosedUpdate(original.history, 150);
  for (const item of [
    { ...update, is_closed: false },
    { type: "price", price: "99999" },
    { type: "trade", price: "1" },
  ]) {
    assert.equal(store.confirm(btcId, "15m", item), false);
    assert.equal(store.context(btcId, "15m").snapshot, snapshot);
    assert.equal(store.context(btcId, "15m").setup, setup);
  }
  assert.equal(store.confirm(btcId, "15m", update), true);
  const current = store.context(btcId, "15m");
  assert.equal(current.snapshot.state.confirmed_at, update.close_time);
  assert.notEqual(current.snapshot, snapshot);
  assert.notEqual(current.setup, setup);
  assert.equal(store.refreshHealth(btcId, "15m"), "healthy");
});

test("retry succeeds degraded → healthy, resets bounded backoff, and manual retry works", async () => {
  let now = fixtureNow,
    outage = false;
  const events = [],
    updates = [],
    clock = timers();
  const store = new ChartContextStore(
    async (id, interval) => {
      if (outage) throw new Error("private-token-not-logged");
      return at(interval, id, now);
    },
    () => now,
    (event) => events.push(event),
  );
  await store.load(btcId, "15m");
  now += 900000;
  outage = true;
  const coordinator = new ChartHistoryReconciler(
    store,
    btcId,
    "15m",
    (entry, health) => updates.push({ entry, health }),
    clock,
  );
  await coordinator.refresh();
  assert.equal(updates.at(-1).health, "degraded");
  for (let i = 0; i < 5; i++) await clock.fire();
  assert.deepEqual(clock.delays, [2000, 5000, 10000, 30000, 30000, 30000]);
  outage = false;
  await clock.fire();
  assert.equal(updates.at(-1).health, "healthy");
  assert.equal(clock.pending.size, 0);
  now += 900000;
  outage = true;
  await coordinator.refresh();
  assert.equal(clock.delays.at(-1), 2000);
  outage = false;
  await coordinator.refresh(true);
  assert.equal(updates.at(-1).health, "healthy");
  assert.equal(clock.pending.size, 0);
  assert.ok(events.some((e) => e.event === "chart_history_refresh_failed"));
  assert.ok(events.some((e) => e.event === "chart_context_degraded"));
  assert.ok(events.some((e) => e.event === "chart_history_refresh_recovered"));
  assert.doesNotMatch(JSON.stringify(events), /private-token/);
  for (const event of events) {
    assert.equal(event.market_instrument_id, btcId);
    assert.ok(["primary", "higher"].includes(event.role));
    assert.equal(typeof event.incremental, "boolean");
    assert.ok(event.elapsed_ms >= 0);
    assert.equal(typeof event.error_type, "string");
  }
  coordinator.dispose();
});

test("initial primary failure automatically retries failed → healthy", async () => {
  let outage = true;
  const clock = timers(),
    updates = [];
  const store = new ChartContextStore(
    async (id, interval) => {
      if (outage && interval === "15m") throw new Error("offline");
      return fixtureHistory(interval, id);
    },
    () => fixtureNow,
    quiet,
  );
  const coordinator = new ChartHistoryReconciler(
    store,
    btcId,
    "15m",
    (entry, health) => updates.push({ entry, health }),
    clock,
  );
  await coordinator.refresh();
  assert.equal(updates.at(-1).health, "failed");
  assert.equal(updates.at(-1).entry, undefined);
  outage = false;
  await clock.fire();
  assert.equal(updates.at(-1).health, "healthy");
  coordinator.dispose();
});

test("disposed identity suppresses old callbacks/retries while shared in-flight history stays deduplicated", async () => {
  const page = deferred(),
    clock = timers();
  let calls = 0,
    oldUpdates = 0;
  const store = new ChartContextStore(
    async (id, interval) => {
      calls++;
      return interval === "15m" ? page.promise : fixtureHistory(interval, id);
    },
    () => fixtureNow,
    quiet,
  );
  const old = new ChartHistoryReconciler(
    store,
    btcId,
    "15m",
    () => oldUpdates++,
    clock,
  );
  const first = old.refresh();
  assert.equal(old.refresh(), first);
  old.dispose();
  const second = store.load(btcId, "15m");
  page.resolve(fixtureHistory());
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  assert.equal(oldUpdates, 0);
  assert.equal(clock.pending.size, 0);
});

test("new stream correction wins a slow REST retry; disposal cancels even a queued timer callback", async () => {
  const page = deferred(),
    clock = timers();
  let now = fixtureNow + 900000;
  const store = new ChartContextStore(
    async (id, interval) =>
      interval === "15m" ? page.promise : fixtureHistory(interval, id),
    () => now,
    quiet,
  );
  store.seed(fixtureHistory());
  store.seed(fixtureHistory("1h"));
  let updates = 0;
  const coordinator = new ChartHistoryReconciler(
    store,
    btcId,
    "15m",
    () => updates++,
    clock,
  );
  const loading = coordinator.refresh();
  const update = {
    ...fixtureClosedUpdate(fixtureHistory()),
    high: "171",
    close: "170",
  };
  store.confirm(btcId, "15m", update);
  coordinator.confirmed();
  assert.equal(
    store.context(btcId, "15m").snapshot.state.confirmed_at,
    update.close_time,
  );
  page.resolve(fixtureHistory());
  await loading;
  assert.equal(store.peek(btcId, "15m").history.items.at(-1).close, "170");
  assert.equal(clock.pending.size, 0);
  now += 900000;
  await coordinator.refresh(); // successful but stale REST must still retry, not claim healthy.
  const queued = clock.pending.values().next().value;
  const before = updates;
  coordinator.dispose();
  queued();
  await new Promise(setImmediate);
  assert.equal(clock.pending.size, 0);
  assert.equal(updates, before);
});

test("typed history timeout propagates a safe error type for client diagnostics", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { error: { code: "history_timeout", message: "private response" } },
      { status: 503 },
    ),
  );
  await assert.rejects(
    fetchChartHistory(btcId, "15m"),
    (error) =>
      error.name === "HistoryTimeout" && !error.message.includes("private"),
  );
});
