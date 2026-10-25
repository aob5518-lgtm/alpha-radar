import assert from "node:assert/strict";
import test from "node:test";
import { TechnicalWorkerClient } from "../src/lib/market/technical-worker-client.ts";
import { TechnicalWorkerEngine } from "../src/lib/market/technical-worker-engine.ts";
import { ChartContextStore } from "../src/lib/market/chart-context-store.ts";
import {
  fixtureHistory,
  fixtureNow,
  btcId,
  ethId,
  fixtureClosedUpdate,
} from "./helpers/chart-fixtures.mjs";

function request(id = btcId, timeframe = "15m") {
  const history = fixtureHistory(timeframe, id);
  return {
    market_instrument_id: id,
    timeframe,
    candles: history.items,
    confirmedClose: Number(history.items.at(-1).close),
    revision: "1:0",
  };
}
function port() {
  const sent = [];
  return {
    sent,
    terminated: false,
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(value) {
      sent.push(structuredClone(value));
    },
    terminate() {
      this.terminated = true;
    },
    deliver(value) {
      this.onmessage?.({ data: value });
    },
  };
}
function result(input) {
  return new TechnicalWorkerEngine().compute(input);
}
for (const [name, id, interval] of [
  ["timeframe", btcId, "1h"],
  ["asset", ethId, "15m"],
]) {
  test(`late worker ${name} results and same-identity old generations are discarded`, () => {
    const worker = port(),
      client = new TechnicalWorkerClient(() => worker),
      applied = [];
    client.select(btcId, "15m");
    client.request(request(), (value) => applied.push(value));
    const old = worker.sent[0];
    client.select(id, interval);
    client.request(request(id, interval), (value) => applied.push(value));
    worker.deliver(result(old));
    assert.equal(applied.length, 0);
    const next = worker.sent.at(-1);
    worker.deliver({ ...result(next), market_instrument_id: "wrong" });
    assert.equal(applied.length, 0);
    worker.deliver({ ...result(next), timeframe: "1w" });
    assert.equal(applied.length, 0);
    worker.deliver(result(next));
    assert.equal(applied.length, 1);
    client.request(request(id, interval), (value) => applied.push(value));
    const obsolete = worker.sent.at(-1);
    client.request({ ...request(id, interval), revision: "2:0" }, (value) =>
      applied.push(value),
    );
    client.request({ ...request(id, interval), revision: "3:0" }, (value) =>
      applied.push(value),
    );
    worker.deliver(result(obsolete));
    assert.equal(applied.length, 1);
    assert.equal(worker.sent.at(-1).revision, "3:0");
    worker.deliver(result(worker.sent.at(-1)));
    assert.equal(applied.length, 2);
    client.dispose();
  });
}
test("worker crashes recreate once, preserve last result, ignore disposed port callbacks, and manual retry rebuilds", () => {
  const ports = [],
    applied = [];
  const client = new TechnicalWorkerClient(() => {
    const p = port();
    ports.push(p);
    return p;
  });
  client.select(btcId, "15m");
  client.request(request(), (r) => applied.push(r));
  ports[0].onerror({});
  assert.equal(ports[0].terminated, true);
  assert.equal(ports.length, 2);
  ports[0].deliver(result(ports[0].sent[0]));
  assert.equal(applied.length, 0);
  ports[1].onerror({});
  assert.equal(applied[0].ok, false);
  assert.equal(ports.length, 2);
  client.retry();
  client.request(request(), (r) => applied.push(r));
  ports[2].deliver(result(ports[2].sent[0]));
  assert.equal(applied[1].ok, true);
  client.dispose();
  ports[2].deliver(result(ports[2].sent[0]));
  assert.equal(applied.length, 2);
});
test("initialization failure never invokes synchronous calculation and reports failure after one restart", () => {
  let attempts = 0,
    failure;
  const client = new TechnicalWorkerClient(() => {
    attempts++;
    throw new Error("unavailable");
  });
  client.select(btcId, "15m");
  client.request(request(), (r) => {
    failure = r;
  });
  assert.equal(attempts, 2);
  assert.equal(failure.ok, false);
  client.dispose();
});
test("worker-backed cache publishes candles without synchronous analysis, rejects stale corrections, preserves snapshots on failure", async () => {
  const pending = [],
    notices = [];
  const computer = {
    select() {},
    request(input, complete) {
      pending.push({
        input: { ...input, generation: pending.length },
        complete,
      });
    },
    retry() {},
    dispose() {},
  };
  const store = new ChartContextStore(
    async (id, interval) => fixtureHistory(interval, id),
    () => fixtureNow,
    () => {},
    computer,
  );
  store.select(btcId, "15m");
  store.subscribe(() => notices.push(true));
  const entry = await store.load(btcId, "15m");
  await new Promise(setImmediate);
  assert.ok(entry.history.items.length);
  assert.equal(entry.snapshot, null);
  assert.equal(entry.analysisPending, true);
  let task = pending.at(-1);
  task.complete(result(task.input));
  assert.ok(entry.snapshot);
  assert.equal(entry.analysisPending, false);
  const before = entry.snapshot;
  store.confirm(btcId, "15m", fixtureClosedUpdate(entry.history, 160));
  store.context(btcId, "15m");
  await new Promise(setImmediate);
  const stale = pending.at(-1);
  store.confirm(btcId, "15m", {
    ...fixtureClosedUpdate(fixtureHistory(), 165),
    close: "165",
    high: "170",
  });
  store.context(btcId, "15m");
  await new Promise(setImmediate);
  stale.complete(result(stale.input));
  assert.equal(entry.snapshot, before);
  task = pending.at(-1);
  task.complete({ ...task.input, ok: false, error_type: "WorkerError" });
  assert.equal(entry.snapshot, before);
  assert.equal(entry.analysisError, true);
  store.retryAnalysis(btcId, "15m");
  await new Promise(setImmediate);
  task = pending.at(-1);
  task.complete(result(task.input));
  assert.notEqual(entry.snapshot, before);
  assert.equal(entry.analysisError, false);
  const generationCount = pending.length;
  assert.equal(
    store.confirm(btcId, "15m", {
      ...fixtureClosedUpdate(entry.history),
      is_closed: false,
    }),
    false,
  );
  store.context(btcId, "15m");
  await new Promise(setImmediate);
  assert.equal(pending.length, generationCount);
  assert.ok(notices.length);
  store.dispose();
});
test("LRU is bounded at 16, protects selected identity, and worker replay cache is bounded", () => {
  const store = new ChartContextStore(async () => {
    throw new Error("not used");
  });
  store.seed(fixtureHistory("15m", btcId, 2));
  store.select(btcId, "15m");
  for (let i = 0; i < 40; i++)
    store.seed(
      fixtureHistory(
        "15m",
        `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        2,
      ),
    );
  assert.ok(store.peek(btcId, "15m"));
  assert.equal(store.entries.size, 16);
  assert.equal(
    store.peek("00000000-0000-4000-8000-000000000000", "15m"),
    undefined,
  );
  const engine = new TechnicalWorkerEngine();
  for (let i = 0; i < 20; i++)
    engine.compute({
      ...request(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
      generation: i,
      candles: [],
    });
  assert.equal(engine.cache.size, 16);
});

test("HTF currency expiry while worker is running replaces the job rather than leaving pending analysis stuck", async () => {
  const tasks = [];
  let now = fixtureNow;
  const computer = {
    select() {},
    request(input, complete) {
      tasks.push({ input: { ...input, generation: tasks.length }, complete });
    },
    retry() {},
    dispose() {},
  };
  const store = new ChartContextStore(
    async (id, interval) => fixtureHistory(interval, id),
    () => now,
    () => {},
    computer,
  );
  store.select(btcId, "15m");
  await store.load(btcId, "15m");
  await new Promise(setImmediate);
  const first = tasks.at(-1);
  assert.ok(first.input.higherCandles);
  now += 3600000;
  first.complete(result(first.input));
  await new Promise(setImmediate);
  const replacement = tasks.at(-1);
  assert.notEqual(replacement, first);
  assert.equal(replacement.input.higherCandles, undefined);
  replacement.complete(result(replacement.input));
  assert.equal(store.peek(btcId, "15m").analysisPending, false);
  store.dispose();
});
