import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as engine from "../src/lib/market/ma-confluence-entry.ts";
import * as preferences from "../src/lib/market/chart-overlay-preferences.ts";
import * as tradeGuide from "../src/lib/market/trade-guide.ts";
import { maFixture } from "./helpers/ma-fixtures.mjs";
import { btcId, ethId } from "./helpers/chart-fixtures.mjs";

const compiled = ts.transpileModule(
  readFileSync(
    new URL("../src/components/ma-chart-layer.tsx", import.meta.url),
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
function harness(storage = new Map(), failStorage = false) {
  const slots = [];
  let cursor = 0,
    pending = [],
    tree,
    calls = 0,
    chart,
    guideCalls = 0;
  const hooks = {
    useRef(value) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: value };
      return slots[i];
    },
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
    useEffect(callback, deps) {
      const i = cursor++;
      if (
        !slots[i]?.deps ||
        deps.some((d, j) => !Object.is(d, slots[i].deps[j]))
      )
        pending.push({ i, callback, deps });
    },
    useMemo(calculate, deps) {
      const i = cursor++;
      if (
        !slots[i]?.deps ||
        deps.some((d, j) => !Object.is(d, slots[i].deps[j]))
      )
        slots[i] = { deps, value: calculate() };
      return slots[i].value;
    },
  };
  const modules = {
    react: hooks,
    "react/jsx-runtime": jsx,
    "@/components/structural-market-chart": {
      StructuralMarketChart: (props) => {
        chart = props;
        return jsx.jsx("div", { children: "CANVAS" });
      },
    },
    "@/lib/market/ma-confluence-entry": {
      ...engine,
      calculateMaEntry(...args) {
        calls++;
        return engine.calculateMaEntry(...args);
      },
    },
    "@/lib/market/chart-overlay-preferences": preferences,
    "@/lib/market/trade-guide": {
      ...tradeGuide,
      calculateTradeGuide(...args) {
        guideCalls++;
        return tradeGuide.calculateTradeGuide(...args);
      },
    },
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: (name) => modules[name],
    localStorage: {
      getItem(key) {
        if (failStorage) throw new Error("denied");
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (failStorage) throw new Error("denied");
        storage.set(key, value);
      },
    },
  });
  const snapshot = maFixture();
  const input = {
    snapshot,
    instrumentId: btcId,
    interval: "15m",
    locale: "zh-CN",
    chartMessages: JSON.parse(
      readFileSync(new URL("../messages/zh-CN.json", import.meta.url), "utf8"),
    ).chart,
  };
  function render(props = input, commit = true) {
    cursor = 0;
    pending = [];
    tree = exports.MaChartLayer(props);
    if (commit) {
      for (const { i, callback, deps } of pending) {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: callback() };
      }
      return render(props, false);
    }
    return renderToStaticMarkup(tree);
  }
  function find(node, predicate) {
    if (!node || typeof node !== "object") return;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const hit = find(child, predicate);
      if (hit) return hit;
    }
  }
  return {
    render,
    input,
    storage,
    get chart() {
      return chart;
    },
    get calls() {
      return calls;
    },
    get guideCalls() {
      return guideCalls;
    },
    toggle(index) {
      const inputs = [];
      const walk = (node) => {
        if (!node || typeof node !== "object") return;
        if (node.type === "input" && node.props.type === "checkbox")
          inputs.push(node);
        for (const child of [node.props?.children].flat(Infinity)) walk(child);
      };
      walk(tree);
      inputs[index].props.onChange();
    },
    period(value) {
      find(
        tree,
        (n) => n.type === "input" && n.props.type === "number",
      ).props.onBlur({
        target: { value: String(value) },
        currentTarget: { value: String(value) },
      });
    },
  };
}
test("real overlay controls persist independently and do not recompute cached context or MA on visibility changes", () => {
  const h = harness();
  h.render();
  h.render();
  const count = h.calls,
    analysis = h.chart.maAnalysis,
    guideCount = h.guideCalls,
    guide = h.chart.tradeGuide;
  for (let i = 0; i < 4; i++) {
    h.toggle(i);
    h.render();
  }
  assert.equal(h.calls, count);
  assert.equal(h.chart.maAnalysis, analysis);
  assert.equal(h.guideCalls, guideCount);
  assert.equal(h.chart.tradeGuide, guide);
  assert.deepEqual(
    { ...h.chart.overlays },
    { levels: false, markers: false, ma: false, entries: false },
  );
  const remount = harness(h.storage);
  remount.render();
  remount.render();
  assert.equal(remount.chart.overlays.ma, false);
  assert.equal(remount.chart.overlays.levels, false);
  h.period(50);
  h.render();
  assert.equal(h.calls, count + 1);
  assert.equal(h.chart.maAnalysis.settings.period, 50);
  h.render({ ...h.input, instrumentId: ethId, interval: "1h" });
  assert.equal(h.chart.maAnalysis.market_instrument_id, ethId);
  assert.equal(h.chart.maAnalysis.timeframe, "1h");
});
test("denied local storage still renders usable bilingual controls and aligned reason/state labels", () => {
  const h = harness(new Map(), true);
  assert.match(h.render(), /CANVAS/);
  h.render();
  h.toggle(0);
  h.render();
  assert.equal(h.chart.overlays.levels, false);
  for (const locale of ["en", "zh-CN"]) {
    const copy = JSON.parse(
      readFileSync(
        new URL(`../messages/${locale}.json`, import.meta.url),
        "utf8",
      ),
    ).chart.maEntry;
    for (const reason of engine.maReasons) assert.ok(copy.reasons[reason]);
    assert.ok(copy.disclaimer);
    assert.equal(Object.keys(copy.states).length, 9);
  }
});

test("pending Worker context leaves canvas and controls usable; accepted context calculates once without visibility replay", () => {
  const h = harness();
  const pending = { ...h.input, snapshot: undefined };
  assert.match(h.render(pending), /CANVAS/);
  assert.equal(h.calls, 0);
  assert.equal(h.chart.maAnalysis, undefined);
  assert.doesNotMatch(h.render(pending), /data-ma-state/);
  h.toggle(2);
  h.render(pending);
  assert.equal(h.calls, 0);
  h.render(h.input);
  assert.equal(h.calls, 1);
  assert.ok(h.chart.maAnalysis);
  h.toggle(2);
  h.render(h.input);
  assert.equal(h.calls, 1);
  // A new identity can have candles before its first accepted Worker result.
  h.render({ ...pending, instrumentId: ethId, interval: "1h" });
  assert.equal(h.chart.maAnalysis, undefined);
  assert.equal(h.calls, 1);
});

test("committed READY evidence supports bounded MISSED, while visual price updates do not recalculate a Guide", () => {
  const h = harness();
  h.render();
  assert.equal(h.chart.tradeGuide.state, "LONG_READY");
  const prior = h.chart.tradeGuide,
    snapshot = structuredClone(h.input.snapshot),
    last = snapshot.closedCandles.at(-1);
  const close = prior.entry_zone_high + 3;
  snapshot.closedCandles.push({
    ...last,
    openTime: last.closeTime,
    closeTime: new Date(Date.parse(last.closeTime) + 900000).toISOString(),
    open: close - 0.2,
    high: close + 0.2,
    low: close - 0.5,
    close,
    volume: 120,
  });
  snapshot.state.confirmed_at = snapshot.closedCandles.at(-1).closeTime;
  const next = { ...h.input, snapshot };
  h.render(next);
  assert.equal(
    h.chart.tradeGuide.state,
    "MISSED",
    JSON.stringify({
      ma: h.chart.maAnalysis.reason_codes,
      guide: h.chart.tradeGuide,
    }),
  );
  const guide = h.chart.tradeGuide,
    calls = h.guideCalls,
    maCalls = h.calls;
  h.render({ ...next, currentPrice: 999999 });
  assert.equal(h.guideCalls, calls);
  assert.equal(h.calls, maCalls);
  assert.equal(h.chart.tradeGuide, guide);
  assert.equal(guide.stop_price, prior.stop_price);
  assert.equal(guide.tp1_price, prior.tp1_price);
});
