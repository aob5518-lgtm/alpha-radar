import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import * as context from "../src/lib/market/chart-context-store.ts";
import * as intervals from "../src/lib/market/intervals.ts";
import * as reconciler from "../src/lib/market/chart-history-reconciler.ts";
import {
  btcId,
  fixtureNow,
  fixtureHistory,
  fixtureClosedUpdate,
} from "./helpers/chart-fixtures.mjs";

const compiled = ts.transpileModule(
  readFileSync(
    new URL("../src/components/chart-workspace.tsx", import.meta.url),
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

// Run the actual workspace TSX, effects and handlers with deterministic React hooks.
// Canvas/socket internals retain their separate existing component regression suite.
async function harness(locale = "zh-CN") {
  let now = fixtureNow,
    outage = false,
    cursor = 0,
    pending = [];
  const slots = [],
    timers = new Map(),
    streams = [],
    controllers = [];
  let chartProps,
    timerId = 0;
  const store = new context.ChartContextStore(
    async (id, interval) => {
      if (outage) throw new DOMException("timeout", "TimeoutError");
      return fixtureHistory(interval, id);
    },
    () => now,
    () => {},
  );
  await store.load(btcId, "15m");
  await store.load(btcId, "1h");
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots))
        slots[i] = {
          value: typeof initial === "function" ? initial() : initial,
        };
      return [
        slots[i].value,
        (value) => {
          slots[i].value =
            typeof value === "function" ? value(slots[i].value) : value;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      return (slots[i] ??= { current: initial });
    },
    useEffect(callback, deps) {
      const i = cursor++;
      if (
        !slots[i]?.deps ||
        deps.some((value, j) => !Object.is(value, slots[i].deps[j]))
      )
        pending.push({ i, callback, deps });
    },
  };
  const window = {
    location: new URL(
      `http://localhost/chart?instrument=${btcId}&interval=15m`,
    ),
    history: {
      pushState(_state, _title, url) {
        window.location = new URL(url);
      },
    },
    setTimeout(fn) {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  class Coordinator extends reconciler.ChartHistoryReconciler {
    constructor(...args) {
      super(...args, {
        schedule: (fn) => window.setTimeout(fn),
        cancel: (id) => window.clearTimeout(id),
      });
      controllers.push(this);
    }
  }
  const modules = {
    react: hooks,
    "react/jsx-runtime": jsx,
    "lucide-react": { Activity: () => null, DatabaseZap: () => null },
    "@/components/chart-asset-selector": { ChartAssetSelector: () => null },
    "@/components/structural-market-chart": {
      StructuralMarketChart: (props) => {
        chartProps = props;
        return jsx.jsx("div", {
          "data-chart": props.interval,
          children: "LIVE CANVAS",
        });
      },
    },
    "@/lib/i18n/format": { formatDateTime: String, formatMarketPrice: String },
    "@/lib/market/analyst-context": { analystHref: () => "/analyst" },
    "@/lib/market/chart-context-store": {
      ...context,
      ChartContextStore: class {
        constructor() {
          return store;
        }
      },
    },
    "@/lib/market/intervals": intervals,
    "@/lib/market/market-stream": {
      connectChartStream(_url, callbacks) {
        const stream = { callbacks, stopped: false };
        streams.push(stream);
        return () => {
          stream.stopped = true;
        };
      },
    },
    "@/lib/market/chart-history-reconciler": {
      ChartHistoryReconciler: Coordinator,
    },
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: (name) => {
      assert.ok(name in modules, name);
      return modules[name];
    },
    process: { env: {} },
    URL,
    URLSearchParams,
    performance,
    window,
    document: {
      visibilityState: "visible",
      addEventListener() {},
      removeEventListener() {},
    },
  });
  const messages = JSON.parse(
    readFileSync(
      new URL(`../messages/${locale}.json`, import.meta.url),
      "utf8",
    ),
  );
  const input = {
    instruments: [],
    instrument: {
      id: btcId,
      provider_instrument_id: "BTCUSDT",
      quote_currency: "USDT",
      venue: "Bybit",
    },
    initialInterval: "15m",
    initialHistory: fixtureHistory(),
    initialHigherHistory: fixtureHistory("1h"),
    initialSnapshot: store.context(btcId, "15m").snapshot,
    currentPrice: 113,
    locale,
    messages,
  };
  let tree;
  function render(commit = true) {
    cursor = 0;
    pending = [];
    tree = exports.ChartWorkspace(input);
    if (commit) {
      for (const { i, callback, deps } of pending) {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: callback() };
      }
      return render(false);
    }
    return renderToStaticMarkup(tree);
  }
  function visit(node, predicate) {
    if (!node || typeof node !== "object") return;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = visit(child, predicate);
      if (found) return found;
    }
  }
  return {
    render,
    store,
    controllers,
    streams,
    timers,
    get chart() {
      return chartProps;
    },
    switchTo(interval) {
      visit(
        tree,
        (node) => node.type === "a" && node.props.children === interval,
      ).props.onClick({ button: 0, preventDefault() {} });
    },
    manual() {
      visit(tree, (node) => node.type === "button").props.onClick();
    },
    fail() {
      now += 3600000;
      outage = true;
    },
    async flush() {
      await new Promise(setImmediate);
    },
  };
}

test("actual workspace renders cached switch immediately, retains canvas on failure, and retries without replacing stream lifecycle", async () => {
  const h = await harness();
  assert.match(h.render(), /LIVE CANVAS/);
  await h.flush();
  h.render();
  h.switchTo("1h");
  h.render();
  await h.flush();
  h.render();
  h.switchTo("15m");
  h.render();
  await h.flush();
  h.render();
  h.fail();
  h.switchTo("1h");
  const immediate = h.render();
  assert.match(immediate, /data-chart="1h"/);
  assert.doesNotMatch(immediate, /正在加载/);
  await h.flush();
  assert.match(h.render(), /历史同步暂时延迟，当前图表继续使用最近确认数据。/);
  assert.match(h.render(), /LIVE CANVAS/);
  h.chart.onObservedPrice(120);
  h.render();
  const stream = h.streams.at(-1),
    coordinator = h.controllers.at(-1);
  assert.ok(stream);
  const timer = h.timers.values().next().value;
  timer();
  await h.flush();
  h.render();
  h.manual();
  await h.flush();
  h.render();
  const before = h.chart.marketState;
  h.chart.onConfirmedCandle({
    ...fixtureClosedUpdate(h.chart.history, 160),
    is_closed: false,
  });
  h.render();
  assert.equal(h.chart.marketState, before);
  h.chart.onConfirmedCandle(fixtureClosedUpdate(h.chart.history, 160));
  h.render();
  assert.notEqual(h.chart.marketState, before);
  assert.equal(h.controllers.at(-1), coordinator);
  assert.equal(h.streams.at(-1), stream);
  assert.equal(stream.stopped, false);
  h.controllers.forEach((value) => value.dispose());
});

test("English degraded copy is nonblocking and switching back preserves exact cached identity", async () => {
  const h = await harness("en");
  h.render();
  await h.flush();
  h.render();
  h.switchTo("1h");
  h.render();
  await h.flush();
  h.render();
  h.switchTo("15m");
  h.render();
  await h.flush();
  h.render();
  h.fail();
  h.switchTo("1h");
  h.render();
  await h.flush();
  assert.match(h.render(), /History sync is temporarily delayed/);
  h.switchTo("15m");
  assert.match(h.render(), /data-chart="15m"/);
  assert.equal(h.chart.history.market_instrument_id, btcId);
  assert.equal(h.chart.history.interval, "15m");
  await h.flush();
  assert.match(h.render(), /LIVE CANVAS/);
  h.controllers.forEach((value) => value.dispose());
});
