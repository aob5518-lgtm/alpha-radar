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
    CandlestickSeries: "candle",
    HistogramSeries: "volume",
    ColorType: { Solid: "solid" },
    LineStyle: { Dashed: 2, Solid: 0 },
    createSeriesMarkers() {},
    createChart() {
      const series = {
        setData() {},
        update() {},
        createPriceLine() {
          return { applyOptions() {} };
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
        addSeries: () => series,
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
      if (node.props?.ref) node.props.ref.current = { clientWidth: 1200 };
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

test("Chart page keys the client by exact UUID and timeframe", () => {
  const page = readFileSync(
    new URL("../src/app/chart/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /key=\{`\$\{instrument!\.id\}:\$\{interval\}`\}/);
});
