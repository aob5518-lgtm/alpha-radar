import assert from "node:assert/strict";
import test from "node:test";
import { TechnicalWorkerClient } from "../src/lib/market/technical-worker-client.ts";
import { TechnicalWorkerEngine } from "../src/lib/market/technical-worker-engine.ts";
import { calculateMaEntry } from "../src/lib/market/ma-confluence-entry.ts";
import { calculateTradeGuide } from "../src/lib/market/trade-guide.ts";
import { fixtureHistory, btcId, ethId } from "./helpers/chart-fixtures.mjs";

for (const [id, interval] of [
  [ethId, "15m"],
  [btcId, "1h"],
])
  test(`late Worker cannot install old Guide on ${id}/${interval}`, () => {
    const sent = [],
      applied = [];
    const port = {
      postMessage: (value) => sent.push(value),
      terminate() {},
      onmessage: null,
      onerror: null,
      onmessageerror: null,
    };
    const client = new TechnicalWorkerClient(() => port),
      engine = new TechnicalWorkerEngine();
    const request = (id, timeframe, revision = "1") => {
      const candles = fixtureHistory(timeframe, id).items;
      return {
        market_instrument_id: id,
        timeframe,
        revision,
        candles,
        confirmedClose: Number(candles.at(-1).close),
      };
    };
    const accept = (r) => {
      assert.ok(r.ok);
      const ma = calculateMaEntry(
        r.snapshot,
        r.market_instrument_id,
        r.timeframe,
      );
      applied.push(
        calculateTradeGuide(
          r.snapshot,
          ma,
          r.setup,
          r.market_instrument_id,
          r.timeframe,
        ),
      );
    };
    try {
      client.select(btcId, "15m");
      client.request(request(btcId, "15m"), accept);
      client.select(id, interval);
      client.request(request(id, interval), accept);
      port.onmessage({ data: engine.compute(sent[0]) });
      assert.equal(applied.length, 0);
      port.onmessage({ data: engine.compute(sent.at(-1)) });
      assert.equal(applied.length, 1);
      assert.equal(applied[0].market_instrument_id, id);
      assert.equal(applied[0].timeframe, interval);
      client.request(request(id, interval, "2"), accept);
      const older = sent.at(-1);
      client.request(request(id, interval, "3"), accept);
      port.onmessage({ data: engine.compute(older) });
      assert.equal(applied.length, 1);
      port.onmessage({ data: engine.compute(sent.at(-1)) });
      assert.equal(applied.length, 2);
    } finally {
      client.dispose();
    }
  });
