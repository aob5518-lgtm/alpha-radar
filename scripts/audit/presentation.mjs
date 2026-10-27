/** Reuse the project's actual TSX Chart harness, with its external canvas/socket
 * mocks only. Restore the REAL Guide panel (the original harness stubs it).
 * The literal test boundary is checked so harness drift fails rather than skips.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as guideModule from "../../apps/web/src/lib/market/trade-guide.ts";
const testUrl = new URL(
  "../../apps/web/tests/chart-marker-identity.test.mjs",
  import.meta.url,
);
const require = createRequire(testUrl),
  ts = require("typescript");
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const panelExports = {};
runInNewContext(
  compile(
    readFileSync(
      new URL(
        "../../apps/web/src/components/trade-guide-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
  {
    exports: panelExports,
    require: (name) =>
      name === "@/lib/market/trade-guide" ? guideModule : require(name),
  },
);
const source = readFileSync(testUrl, "utf8"),
  boundary = '\ntest("four overlay visibilities';
assert.equal(
  source.split(boundary).length,
  2,
  "Chart test harness boundary drift",
);
let prefix = source.slice(0, source.indexOf(boundary));
const stubStart = '    "@/components/trade-guide-panel": {',
  stubEnd = '    "@/lib/market/market-state-presentation":';
assert.equal(prefix.split(stubStart).length, 2);
assert.equal(prefix.split(stubEnd).length, 2);
prefix =
  prefix.slice(0, prefix.indexOf(stubStart)) +
  '    "@/components/trade-guide-panel": __realPanel,\n' +
  prefix.slice(prefix.indexOf(stubEnd));
const exported = {};
runInNewContext(
  compile(
    prefix.replaceAll("import.meta.url", JSON.stringify(testUrl.href)) +
      "\nexport {harness,props};",
  ),
  { exports: exported, require, __realPanel: panelExports, URL },
);
export function verifyPresentation(sample) {
  const { guide, ma, snapshot } = sample,
    id = guide.market_instrument_id,
    interval = guide.timeframe;
  assert.ok(guideModule.guideReady(guide));
  const chartMessages = JSON.parse(
    readFileSync(
      new URL("../../apps/web/messages/zh-CN.json", import.meta.url),
      "utf8",
    ),
  ).chart;
  const input = {
    ...exported.props(id, interval, snapshot.closedCandles.at(-1).close),
    locale: "zh-CN",
    chartMessages,
    history: { items: sample.candles, has_more: false, next_end: null },
    instrumentLabel: sample.symbol,
    marketState: snapshot.state,
    marketStateMarkers: snapshot.markers,
    levels: [...snapshot.supports, ...snapshot.resistances],
    maAnalysis: ma,
    tradeSetup: sample.setup,
    tradeGuide: guide,
    guideMode: true,
    overlays: { levels: true, markers: true, ma: true, entries: true },
  };
  const h = exported.harness(),
    html = h.render(input),
    chart = h.charts.at(-1);
  const label = guide.state === "LONG_READY" ? "可开多" : "可开空";
  assert.ok(html.includes(label));
  assert.equal((html.match(/data-trade-guide-state=/g) ?? []).length, 1);
  const marker = chart.series.markers.find((m) => m.id.startsWith("guide:"));
  assert.ok(marker, "Historical READY not displayed as Guide marker");
  assert.equal(marker.text, guide.direction === "long" ? "多" : "空");
  chart.click({ hoveredObjectId: marker.id, point: { x: 50, y: 50 } });
  const tooltip = h.render(input);
  assert.equal((tooltip.match(/data-trade-guide-state=/g) ?? []).length, 2);
  assert.ok(tooltip.includes(label));
  // Same mounted component, before effects: stale tooltip AND primary rejected.
  assert.doesNotMatch(
    h.render({ ...input, instrumentId: "different-uuid" }, false),
    /data-trade-guide-state=/,
  );
  return {
    symbol: sample.symbol,
    id,
    interval,
    confirmed_at: guide.confirmed_at,
    state: guide.state,
    label,
    marker: marker.text,
    stop: guide.stop_price,
    tp1: guide.tp1_price,
    rr: guide.reward_risk_tp1,
    primary: true,
    tooltip: true,
    identity_guard: true,
  };
}
