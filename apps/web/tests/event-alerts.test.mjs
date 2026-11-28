import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { activeAlerts, intentHref } from "../src/lib/event-alerts.ts";

const id = "22c9d286-dca4-4a87-bfb4-b5a8a5534893";
const other = "22c9d286-dca4-4a87-bfb4-b5a8a5534894";
const expiry = new Date("2026-11-29T00:01:00Z").toISOString();

test("active alerts are bounded to their expiry and retain exact intent identities", () => {
  const now = Date.parse(expiry) - 1000;
  const btc = {
    intent_id: id,
    actionable: true,
    expires_at: expiry,
    symbol: "BTCUSDT",
    horizon_minutes: 10,
  };
  const eth = {
    ...btc,
    intent_id: other,
    symbol: "ETHUSDT",
    horizon_minutes: 30,
  };
  const blocked = { ...eth, actionable: false };
  assert.deepEqual(activeAlerts([eth, btc, blocked], now), [btc, eth]);
  assert.deepEqual(activeAlerts([btc], now + 1000), []);
  assert.equal(intentHref(id), "/event-contracts?intent=" + id);
  assert.equal(intentHref("//outside.test/?token=secret"), "/event-contracts");
});

test("Service Worker serializes no credentials and guards push expiry and click routes", async () => {
  const code = await readFile(
    new URL("../public/event-alert-sw.js", import.meta.url),
    "utf8",
  );
  const handlers = new Map();
  const claims = new Set();
  const shown = [];
  const opened = [];
  const context = {
    Date,
    URL,
    claimAlert: (key) => {
      const fresh = !claims.has(key);
      claims.add(key);
      return Promise.resolve(fresh);
    },
    self: {
      location: { origin: "https://radar.example" },
      addEventListener: (kind, callback) => handlers.set(kind, callback),
      registration: {
        showNotification: async (title, options) =>
          shown.push({ title, options }),
      },
      clients: {
        matchAll: async () => [],
        openWindow: async (url) => opened.push(url),
      },
    },
  };
  vm.runInNewContext(code.replace(/^import .*;\n/, ""), context);
  function dispatch(kind, args) {
    let completion;
    handlers.get(kind)({
      ...args,
      waitUntil: (value) => {
        completion = value;
      },
    });
    return completion;
  }
  const payload = {
    intent: id,
    body: "New signal",
    expires: new Date(Date.now() + 60_000).toISOString(),
  };
  await dispatch("push", { data: { json: () => payload } });
  await dispatch("push", { data: { json: () => payload } });
  await dispatch("push", {
    data: {
      json: () => ({
        ...payload,
        expires: new Date(Date.now() - 1000).toISOString(),
      }),
    },
  });
  assert.equal(shown.length, 2);
  assert.equal(shown[0].options.tag, id);
  assert.equal(shown[0].options.silent, false);
  assert.equal(shown[1].options.silent, true);
  await dispatch("notificationclick", {
    notification: { close() {}, data: shown[0].options.data },
  });
  await dispatch("notificationclick", {
    notification: { close() {}, data: { intent: "//outside.test" } },
  });
  assert.deepEqual(opened, [
    "https://radar.example/event-contracts?intent=" + id,
    "https://radar.example/event-contracts",
  ]);
});
