import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

import * as historyHelpers from "../src/lib/market/chart-history.ts";
import * as liveHelpers from "../src/lib/market/live-candle.ts";
import * as displayHelpers from "../src/lib/market/market-state-display.ts";
import * as contextStore from "../src/lib/market/chart-context-store.ts";
import * as tradeSetup from "../src/lib/market/trade-setup.ts";
import * as marketStream from "../src/lib/market/market-stream.ts";
import * as maEntry from "../src/lib/market/ma-confluence-entry.ts";
import * as tradeGuide from "../src/lib/market/trade-guide.ts";
import { maFixture } from "./helpers/ma-fixtures.mjs";
import {
  btcId,
  fixtureNow,
  fixtureHistory,
  fixtureClosedUpdate,
} from "./helpers/chart-fixtures.mjs";

const chartMessages = JSON.parse(
  readFileSync(new URL("../messages/en.json", import.meta.url), "utf8"),
).chart;
const btc = "b211ed53-f2ed-5135-b52e-00217b04afc6";
const eth = "a01580d8-52c9-5721-9214-d3b91654de2d";
const source = readFileSync(
  new URL("../src/components/structural-market-chart.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

function marker(id, interval, zone = 82000) {
  return {
    id: `${id}:${interval}:test-confirmation`,
    market_instrument_id: id,
    timeframe: interval,
    phase: "support_confirmed",
    confidence: 84,
    confirmed_at: "2026-10-10T10:00:00Z",
    candle_open_time: "2026-10-10T09:00:00Z",
    price: zone + 100,
    position: "belowBar",
    reference_level: {
      kind: "support",
      level_label: "S1",
      zone_low: zone,
      zone_high: zone + 100,
    },
    evidence: [{ code: "level_reclaimed", direction: "up", level_label: "S1" }],
  };
}

function props(id = btc, interval = "15m", currentPrice = 83000) {
  return {
    instrumentId: id,
    interval,
    currentPrice,
    instrumentLabel: id === btc ? "BTCUSDT Perpetual" : "ETHUSDT Perpetual",
    history: { items: [], has_more: false, next_end: null },
    levels: [],
    marketState: {
      direction: "neutral",
      direction_strength: 10,
      phase: "slow_rise",
      phase_confidence: 32,
      next_wait: "wait_for_better_location",
      entry_window_candidate: false,
      reference_level: null,
      evidence: [{ code: "range_location" }],
    },
    marketStateMarkers: [marker(id, interval, id === btc ? 82000 : 2400)],
    providerLabel: "Bybit",
    quoteCurrency: "USDT",
    analystHref: "/analyst",
    liveLabel: "Live",
    delayedLabel: "Delayed",
    partialLabel: "Partial",
    closedLabel: "Closed",
    openAnalystLabel: "Analyst",
    returnLatestLabel: "Return to latest",
    locale: "en",
    chartMessages,
  };
}

// Execute the actual TSX with deterministic hook/effect and external chart/socket mocks.
// This intentionally preserves the component instance across prop changes, exercising
// correctness independently of the additional page key. No test-only production exports.
function harness() {
  const slots = [];
  const sockets = [];
  const charts = [];
  let cursor = 0;
  let pending = [];
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: initial };
      return [
        slots[index].value,
        (value) => {
          slots[index].value =
            typeof value === "function" ? value(slots[index].value) : value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (
        !slots[index]?.deps ||
        deps.some((value, i) => !Object.is(value, slots[index].deps[i]))
      )
        pending.push({ index, callback, deps });
    },
  };
  const chartLibrary = {
    LineSeries: "line",
    CandlestickSeries: "candle",
    HistogramSeries: "volume",
    ColorType: { Solid: "solid" },
    LineStyle: { Dashed: 2, Solid: 0 },
    createSeriesMarkers(series, markers) {
      series.markers = markers;
      return {
        setMarkers: (next) => {
          series.markers = next;
        },
      };
    },
    createChart() {
      const priceLines = [];
      let maData = [];
      const series = {
        setData() {},
        update() {},
        createPriceLine(options) {
          const line = { ...options, applyOptions() {} };
          priceLines.push(line);
          return line;
        },
        removePriceLine(line) {
          const i = priceLines.indexOf(line);
          if (i >= 0) priceLines.splice(i, 1);
        },
        priceScale() {
          return { applyOptions() {} };
        },
      };
      const scale = {
        setVisibleLogicalRange() {},
        subscribeVisibleLogicalRangeChange() {},
        unsubscribeVisibleLogicalRangeChange() {},
      };
      const chart = {
        series,
        priceLines,
        get maData() {
          return maData;
        },
        addSeries: (kind) =>
          kind === "line"
            ? {
                ...series,
                setData(value) {
                  maData = value;
                },
              }
            : series,
        timeScale: () => scale,
        applyOptions() {},
        remove() {},
        subscribeCrosshairMove(handler) {
          this.hover = handler;
        },
        unsubscribeCrosshairMove() {
          this.hover = null;
        },
        subscribeClick(handler) {
          this.click = handler;
        },
        unsubscribeClick() {
          this.click = null;
        },
      };
      charts.push(chart);
      return chart;
    },
  };
  class Socket {
    constructor(url) {
      this.url = url;
      sockets.push(this);
    }
    close() {
      this.onclose?.();
    }
    send(update) {
      this.onmessage({ data: JSON.stringify(update) });
    }
  }
  const modules = {
    react: hooks,
    "react/jsx-runtime": jsxRuntime,
    "next/link": ({ children, ...rest }) =>
      jsxRuntime.jsx("a", { ...rest, children }),
    "lucide-react": { ArrowRight: () => null },
    "lightweight-charts": chartLibrary,
    "@/lib/market/chart-history": historyHelpers,
    "@/lib/market/live-candle": liveHelpers,
    "@/lib/market/market-state-display": displayHelpers,
    "@/lib/market/chart-context-store": contextStore,
    "@/lib/market/trade-setup": tradeSetup,
    "@/lib/market/market-stream": marketStream,
    "@/lib/market/ma-confluence-entry": maEntry,
    "@/lib/market/trade-guide": tradeGuide,
    "@/components/trade-guide-panel": {
      TradeGuidePanel: ({ guide }) =>
        jsxRuntime.jsx("div", {
          "data-guide-test": guide.market_instrument_id + ":" + guide.timeframe,
          children: `${guide.state} stop=${guide.stop_price} tp1=${guide.tp1_price}`,
        }),
    },
    "@/lib/market/market-state-presentation": {
      formatMarketStateWait: (state) => state.next_wait,
      formatMarketStateEvidence: (evidence) => evidence.code,
      marketStateMarkerLabel: (phase) => phase,
    },
  };
  const exports = {};
  runInNewContext(compiled, {
    process: { env: { NEXT_PUBLIC_API_URL: "http://localhost:8000" } },
    exports,
    require: (name) => {
      assert.ok(name in modules, `Unmocked import: ${name}`);
      return modules[name];
    },
    URL,
    WebSocket: Socket,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    window: { setInterval: () => 1, clearInterval() {} },
  });
  function render(input, commit = true) {
    cursor = 0;
    pending = [];
    const tree = exports.StructuralMarketChart(input);
    function attach(node) {
      if (!node || typeof node !== "object") return;
      if (node.props?.ref)
        node.props.ref.current = {
          clientWidth: 1200,
          clientHeight: 540,
          offsetTop: 260,
        };
      for (const child of [node.props?.children].flat(Infinity)) attach(child);
    }
    attach(tree);
    if (commit) {
      for (const { index, callback, deps } of pending) {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: callback() };
      }
      return render(input, false);
    }
    return renderToStaticMarkup(tree);
  }
  return { render, sockets, charts };
}

test("four overlay visibilities update existing chart without recomputation/socket recreation and reject stale MA identity", () => {
  const h = harness(),
    analysis = maEntry.calculateMaEntry(maFixture(), btcId, "15m"),
    input = {
      ...props(),
      maAnalysis: analysis,
      levels: [{ label: "S1", kind: "support", representative_price: 100 }],
      overlays: { levels: true, markers: true, ma: true, entries: true },
    };
  h.render(input);
  const chart = h.charts[0],
    socket = h.sockets[0];
  assert.ok(chart.maData.length);
  assert.ok(chart.priceLines.some((line) => line.title === "S1"));
  assert.ok(chart.series.markers.some((m) => m.id.startsWith("ma:")));
  h.render({
    ...input,
    overlays: { levels: false, markers: true, ma: false, entries: false },
  });
  assert.equal(chart.maData.length, 0);
  assert.ok(!chart.priceLines.some((line) => line.title === "S1"));
  assert.equal(chart.series.markers.length, 1);
  h.render({
    ...input,
    overlays: { levels: true, markers: false, ma: true, entries: true },
  });
  assert.ok(chart.maData.length);
  assert.equal(chart.series.markers.length, 1);
  assert.ok(chart.series.markers[0].id.startsWith("ma:"));
  h.render({
    ...input,
    maAnalysis: { ...analysis, market_instrument_id: eth },
  });
  assert.equal(chart.maData.length, 0);
  assert.equal(
    chart.series.markers.some((m) => m.id.startsWith("ma:")),
    false,
  );
  h.render({ ...input, maAnalysis: { ...analysis, timeframe: "1h" } });
  assert.equal(chart.maData.length, 0);
  assert.equal(h.charts.length, 1);
  assert.equal(h.sockets.length, 1);
  assert.equal(h.sockets[0], socket);
  assert.equal(input.maAnalysis, analysis);
});

for (const [name, from, to] of [
  ["BTC → ETH", props(btc), props(eth, "15m", 2500)],
  ["ETH → BTC", props(eth, "15m", 2500), props(btc)],
  ["15m → 1h", props(btc, "15m"), props(btc, "1h")],
  ["1h → 15m", props(btc, "1h"), props(btc, "15m")],
]) {
  test(`${name} clears opened tooltip, pin, price and stream status`, () => {
    const h = harness();
    h.render(from);
    h.charts.at(-1).click({
      hoveredObjectId: from.marketStateMarkers[0].id,
      point: { x: 40, y: 40 },
    });
    h.sockets.at(-1).send({
      type: "trade",
      price: "99999",
      provider_timestamp: "2026-10-10T10:01:00Z",
    });
    assert.match(h.render(from), /level_reclaimed/);
    assert.match(h.render(from), /99,999/);
    assert.match(h.render(from), /Live.*Partial/);
    // Guard must reject stale detail during render, even before effects execute.
    assert.doesNotMatch(h.render(to, false), /level_reclaimed/);
    const next = h.render(to);
    assert.doesNotMatch(next, /level_reclaimed|99,999|Live/);
    assert.match(next, new RegExp(to.currentPrice.toLocaleString("en")));
    assert.match(next, /Delayed/);
    // A new stream resumes normally and first click opens (no leaked pin).
    h.sockets.at(-1).send({
      type: "trade",
      price: "1234",
      provider_timestamp: "2026-10-10T10:01:00Z",
    });
    assert.match(h.render(to), /Live.*Partial/);
    h.charts.at(-1).click({
      hoveredObjectId: to.marketStateMarkers[0].id,
      point: { x: 40, y: 40 },
    });
    assert.match(h.render(to), /level_reclaimed/);
  });
}

for (const [name, stale] of [
  ["instrument UUID", marker(eth, "15m")],
  ["timeframe", marker(btc, "1h")],
]) {
  test(`tooltip rejects stale ${name} without mutating marker identity`, () => {
    const h = harness(),
      input = { ...props(), marketStateMarkers: [stale] };
    const before = JSON.stringify(stale);
    h.render(input);
    h.charts
      .at(-1)
      .hover({ hoveredObjectId: stale.id, point: { x: 40, y: 40 } });
    assert.doesNotMatch(h.render(input), /level_reclaimed/);
    assert.equal(JSON.stringify(stale), before);
  });
}

test("same-identity server price updates do not overwrite the live price or clear detail", () => {
  const h = harness(),
    input = props();
  h.render(input);
  h.sockets.at(-1).send({ type: "price", price: "83123" });
  h.charts.at(-1).click({
    hoveredObjectId: input.marketStateMarkers[0].id,
    point: { x: 40, y: 40 },
  });
  const next = h.render({ ...input, currentPrice: 83200 });
  assert.match(next, /83,123/);
  assert.doesNotMatch(next, /83,200/);
  assert.match(next, /level_reclaimed/);
});

test("actual Chart closed callback refreshes state/markers/overlays without a chart or socket rebuild", async () => {
  const store = new contextStore.ChartContextStore(
    async (id, interval) => fixtureHistory(interval, id),
    () => fixtureNow,
  );
  const entry = await store.load(btcId, "15m");
  const input = {
    ...props(),
    history: entry.history,
    marketState: entry.snapshot.state,
    marketStateMarkers: entry.snapshot.markers,
    levels: [...entry.snapshot.supports, ...entry.snapshot.resistances],
    tradeSetup: entry.setup,
  };
  let confirmations = 0;
  input.onConfirmedCandle = (value) => {
    confirmations++;
    store.confirm(btcId, "15m", value);
    store.context(btcId, "15m");
  };
  const h = harness();
  h.render(input);
  const socket = h.sockets[0],
    chart = h.charts[0];
  const oldTime = input.marketState.confirmed_at;
  socket.send({ ...fixtureClosedUpdate(input.history), is_closed: false });
  socket.send({ type: "price", price: "111" });
  socket.send({
    type: "trade",
    price: "112",
    provider_timestamp: input.history.items.at(-1).close_time,
  });
  assert.equal(confirmations, 0);
  assert.equal(
    store.context(btcId, "15m").snapshot.state.confirmed_at,
    oldTime,
  );
  const closed = fixtureClosedUpdate(input.history);
  socket.send(closed);
  assert.equal(confirmations, 1);
  const next = store.context(btcId, "15m");
  const rendered = h.render({
    ...input,
    history: next.history,
    levels: [...next.snapshot.supports, ...next.snapshot.resistances],
    marketState: next.snapshot.state,
    marketStateMarkers: next.snapshot.markers,
    tradeSetup: next.setup,
  });
  assert.match(
    rendered,
    new RegExp(`data-confirmed-at="${closed.close_time}"`),
  );
  assert.equal(h.sockets.length, 1);
  assert.equal(h.charts.length, 1);
  assert.equal(h.sockets[0], socket);
  assert.equal(h.charts[0], chart);
  assert.deepEqual(
    chart.series.markers.map((x) => x.id),
    next.snapshot.markers.map((x) => x.id),
  );
});

for (const [name, stale] of [
  ["UUID", { market_instrument_id: eth, timeframe: "15m" }],
  ["timeframe", { market_instrument_id: btc, timeframe: "1h" }],
]) {
  test(`Chart never renders a stale ${name} Trade Setup reference price`, () => {
    const h = harness();
    const input = {
      ...props(),
      tradeSetup: {
        ...stale,
        direction: "long",
        status: "candidate",
        preferred_entry_price: 99999,
        reference_level: null,
      },
    };
    assert.doesNotMatch(
      h.render(input),
      /99,999|Reference entry price|Directional bias/,
    );
  });
}

test("late disposed-stream callbacks cannot overwrite new-identity price or status", () => {
  const h = harness();
  h.render(props());
  const old = h.sockets.at(-1);
  const input = props(eth, "1h", 2500);
  h.render(input);
  h.sockets.at(-1).send({
    type: "trade",
    price: "2501",
    provider_timestamp: "2026-10-10T10:01:00Z",
  });
  old.send({
    type: "trade",
    price: "99999",
    provider_timestamp: "2026-10-10T10:02:00Z",
  });
  old.onclose();
  old.onerror();
  const rendered = h.render(input);
  assert.match(rendered, /2,501/);
  assert.match(rendered, /Live.*Partial/);
  assert.doesNotMatch(rendered, /99,999/);
});

test("current-identity hover, hover-out, pin and unpin behavior remains intact", () => {
  const h = harness(),
    input = props();
  h.render(input);
  const chart = h.charts.at(-1);
  const event = {
    hoveredObjectId: input.marketStateMarkers[0].id,
    point: { x: 40, y: 40 },
  };
  chart.hover(event);
  assert.match(h.render(input), /level_reclaimed/);
  chart.hover({});
  assert.doesNotMatch(h.render(input), /level_reclaimed/);
  chart.click(event);
  chart.hover({});
  assert.match(h.render(input), /level_reclaimed/);
  chart.click(event);
  assert.doesNotMatch(h.render(input), /level_reclaimed/);
});

test("MA series accepts its first delayed Worker context without rebuilding canvas or socket", () => {
  const h = harness(),
    input = props();
  h.render(input);
  const chart = h.charts[0],
    socket = h.sockets[0];
  assert.equal(chart.maData.length, 0);
  const analysis = maEntry.calculateMaEntry(maFixture(), btc, "15m");
  h.render({ ...input, maAnalysis: analysis });
  assert.ok(chart.maData.length > 0);
  assert.equal(h.charts.length, 1);
  assert.equal(h.sockets.length, 1);
  assert.equal(h.sockets[0], socket);
  h.render({ ...input, maAnalysis: { ...analysis, timeframe: "1h" } });
  assert.equal(chart.maData.length, 0);
});

test("Chart workspace keys the client by exact UUID and timeframe", () => {
  const page = readFileSync(
    new URL("../src/components/chart-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /key=\{`\$\{instrument\.id\}:\$\{interval\}`\}/);
});

function withGuide(input) {
  const snapshot = maFixture();
  // Fixture levels must carry the selected period, like a real accepted Worker result.
  for (const level of [...snapshot.supports, ...snapshot.resistances])
    level.timeframe = input.interval;
  const ma = maEntry.calculateMaEntry(
    snapshot,
    input.instrumentId,
    input.interval,
  );
  return {
    ...input,
    guideMode: true,
    marketState: { ...input.marketState, ...snapshot.state },
    maAnalysis: ma,
    tradeGuide: tradeGuide.calculateTradeGuide(
      snapshot,
      ma,
      undefined,
      input.instrumentId,
      input.interval,
    ),
  };
}
test("one primary Guide marker replaces redundant MA signal; click opens plan; toggles retain chart/socket and hide independent overlays", () => {
  const h = harness(),
    input = withGuide(props());
  h.render(input);
  const chart = h.charts[0],
    socket = h.sockets[0];
  const markers = chart.series.markers,
    primary = markers.find((m) => m.id.startsWith("guide:"));
  assert.ok(primary);
  assert.equal(
    markers.some((m) => m.id.startsWith("ma:")),
    false,
  );
  chart.click({ hoveredObjectId: primary.id, point: { x: 50, y: 100 } });
  assert.match(h.render(input), /top:372px/);
  assert.equal((h.render(input).match(/data-guide-test=/g) ?? []).length, 2);
  // A correction or setting change can replace the plan at the same confirmed
  // timestamp. The render guard must reject old evidence before effects run.
  for (const nextGuide of [
    { ...input.tradeGuide, stop_price: input.tradeGuide.stop_price - 1 },
    { ...input.tradeGuide, state: "WAIT", direction: "none" },
  ]) {
    assert.equal(
      (
        h
          .render({ ...input, tradeGuide: nextGuide }, false)
          .match(/data-guide-test=/g) ?? []
      ).length,
      1,
    );
  }
  socket.send({ type: "price", price: "99999" });
  socket.send({
    type: "trade",
    price: "99998",
    provider_timestamp: input.tradeGuide.confirmed_at,
  });
  h.render(input);
  assert.deepEqual(chart.series.markers, markers);
  assert.equal(input.tradeGuide.state, "LONG_READY");
  const hidden = {
    ...input,
    overlays: { levels: false, markers: false, ma: true, entries: false },
  };
  assert.equal((h.render(hidden).match(/data-guide-test=/g) ?? []).length, 1);
  assert.equal(chart.series.markers.length, 0);
  assert.ok(chart.maData.length > 0);
  h.render({ ...hidden, overlays: { ...hidden.overlays, entries: true } });
  assert.equal(chart.series.markers.length, 1);
  assert.ok(chart.series.markers[0].id.startsWith("guide:"));
  assert.equal(h.charts.length, 1);
  assert.equal(h.sockets.length, 1);
});
for (const [fromId, fromInterval, toId, toInterval] of [
  [btc, "15m", eth, "15m"],
  [eth, "15m", btc, "15m"],
  [btc, "15m", btc, "1h"],
  [btc, "1h", btc, "15m"],
])
  test(`Guide tooltip and primary plan reject old identity ${fromId}/${fromInterval} → ${toId}/${toInterval}`, () => {
    const h = harness(),
      input = withGuide(props(fromId, fromInterval));
    h.render(input);
    const marker = h.charts[0].series.markers.find((m) =>
      m.id.startsWith("guide:"),
    );
    assert.ok(marker);
    h.charts[0].click({ hoveredObjectId: marker.id, point: { x: 50, y: 100 } });
    assert.equal((h.render(input).match(/data-guide-test=/g) ?? []).length, 2);
    const stale = { ...input, ...props(toId, toInterval), guideMode: true };
    const html = h.render(stale);
    assert.doesNotMatch(html, /data-guide-test=/);
    assert.equal(
      h.charts.at(-1).series.markers.some((m) => m.id.startsWith("guide:")),
      false,
    );
  });
