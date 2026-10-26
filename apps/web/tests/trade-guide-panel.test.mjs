import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as guide from "../src/lib/market/trade-guide.ts";
import { maFixture } from "./helpers/ma-fixtures.mjs";
import { calculateMaEntry } from "../src/lib/market/ma-confluence-entry.ts";
import { btcId } from "./helpers/chart-fixtures.mjs";
const compiled = ts.transpileModule(
  readFileSync(
    new URL("../src/components/trade-guide-panel.tsx", import.meta.url),
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
const exports = {};
runInNewContext(compiled, {
  exports,
  require: (name) =>
    ({ "react/jsx-runtime": jsx, "@/lib/market/trade-guide": guide })[name],
});
for (const locale of ["en", "zh-CN"])
  test(`${locale} primary UI has exactly one state; WATCH/WAIT/MISSED do not expose a confirmed executable plan`, () => {
    const copy = JSON.parse(
      readFileSync(
        new URL(`../messages/${locale}.json`, import.meta.url),
        "utf8",
      ),
    ).chart.tradeGuide;
    const snapshot = maFixture(),
      ma = calculateMaEntry(snapshot, btcId, "15m"),
      result = guide.calculateTradeGuide(snapshot, ma, undefined, btcId, "15m");
    const render = (value) =>
      renderToStaticMarkup(
        exports.TradeGuidePanel({ guide: value, copy, locale }),
      );
    const ready = render(result);
    assert.match(ready, /TP1/);
    assert.match(ready, /TP2/);
    assert.ok(ready.includes(copy.stop));
    assert.ok(ready.includes(copy.states.LONG_READY));
    assert.ok(!ready.includes(copy.states.SHORT_READY));
    for (const state of ["WATCH_LONG", "WATCH_SHORT", "WAIT", "MISSED"]) {
      const output = render({
        ...result,
        state,
        next_action:
          state === "MISSED"
            ? "no_chase_long"
            : state === "WATCH_LONG"
              ? "wait_pullback"
              : state === "WATCH_SHORT"
                ? "wait_rejection"
                : "wait",
      });
      assert.ok(output.includes(copy.states[state]));
      assert.ok(!output.includes(copy.stop));
      assert.doesNotMatch(output, /TP1|TP2/);
      assert.ok(!output.includes(copy.states.LONG_READY));
    }
    assert.equal(Object.keys(copy.states).length, 6);
    for (const reason of result.reason_codes) assert.ok(copy.reasons[reason]);
  });
