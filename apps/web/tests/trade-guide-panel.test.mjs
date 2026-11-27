import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as guide from "../src/lib/market/trade-guide.ts";
import * as decision from "../src/lib/market/trade-guide-decision.ts";
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
    ({
      "react/jsx-runtime": jsx,
      "@/lib/market/trade-guide": guide,
      "@/lib/market/trade-guide-decision": decision,
    })[name],
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
    assert.ok(ready.includes(` · ${result.quality_grade}`));
    assert.ok(ready.includes(copy.evidence.volume.neutral));
    assert.ok(ready.includes(copy.evidenceLabel));
    assert.doesNotMatch(
      render({ ...result, tp1_source: "swing-high", tp2_source: "swing-low" }),
      /swing-high|swing-low/,
    );
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

for (const locale of ["en", "zh-CN"])
  for (const direction of ["long", "short"])
    test(`${locale} ${direction}: three decision steps distinguish price, evidence and R:R waits`, () => {
      const copy = JSON.parse(
          readFileSync(
            new URL(`../messages/${locale}.json`, import.meta.url),
            "utf8",
          ),
        ).chart.tradeGuide,
        snapshot = maFixture(direction),
        analysis = calculateMaEntry(snapshot, btcId, "15m");
      const render = (ma) => {
        const value = guide.calculateTradeGuide(
          snapshot,
          ma,
          undefined,
          btcId,
          "15m",
        );
        return renderToStaticMarkup(
          exports.TradeGuidePanel({ guide: value, analysis: ma, copy, locale }),
        );
      };
      const ready = render(analysis);
      assert.ok(ready.includes(copy.decision.label));
      const directionStep = ready.indexOf(`1 · ${copy.decision.direction}`),
        locationStep = ready.indexOf(`2 · ${copy.decision.location}`),
        confirmationStep = ready.indexOf(`3 · ${copy.decision.confirmation}`);
      assert.ok(directionStep >= 0);
      assert.ok(locationStep > directionStep);
      assert.ok(confirmationStep > locationStep);
      assert.ok(ready.includes(copy.decision.directions[direction]));
      assert.match(ready, /15m/);
      assert.match(ready, /data-guide-confirmation="confirmed"/);
      assert.equal((ready.match(/data-trade-guide-state=/g) ?? []).length, 1);

      const pending = render({ ...analysis, price_confirmed: false });
      assert.ok(pending.includes(copy.potentialEntry));
      assert.ok(
        pending.includes(copy.decision.actions[`wait_price_${direction}`]),
      );
      assert.match(pending, /data-guide-confirmation="price_pending"/);

      const evidence = render({
        ...analysis,
        confidence_score: 69,
        quality_tier: "C",
      });
      assert.ok(evidence.includes(copy.decision.actions.wait_evidence));
      assert.ok(evidence.includes(copy.decision.evidencePending));
      assert.ok(!evidence.includes(copy.reasons.confirmation_pending));
      assert.match(evidence, /data-guide-confirmation="price_observed"/);
      assert.ok(
        !evidence.includes(
          copy.actions[
            direction === "long" ? "wait_pullback" : "wait_rejection"
          ],
        ),
      );

      const risk = Math.abs(
          analysis.trigger_price - analysis.invalidation_price,
        ),
        rr = render({
          ...analysis,
          observed_targets: [
            {
              price:
                analysis.trigger_price +
                (direction === "long" ? 1 : -1) * risk * 1.3,
              source: direction === "long" ? "R1" : "S1",
            },
          ],
        });
      assert.ok(rr.includes(copy.decision.actions.wait_rr));
      for (const output of [pending, evidence, rr]) {
        assert.doesNotMatch(output, /TP1|TP2/);
        assert.ok(!output.includes(copy.stop));
        assert.ok(!output.includes(copy.reference));
        assert.ok(output.includes(copy.decision.closedOnly));
        assert.ok(!output.includes("undefined"));
      }
    });

for (const locale of ["en", "zh-CN"])
  test(`${locale}: secondary explanations share one closed disclosure without hiding decisions or READY prices`, () => {
    const chart = JSON.parse(
        readFileSync(
          new URL(`../messages/${locale}.json`, import.meta.url),
          "utf8",
        ),
      ).chart,
      copy = chart.tradeGuide,
      snapshot = maFixture(),
      analysis = calculateMaEntry(snapshot, btcId, "15m"),
      result = guide.calculateTradeGuide(
        snapshot,
        analysis,
        undefined,
        btcId,
        "15m",
      );
    for (const state of ["LONG_READY", "WATCH_LONG", "WAIT", "MISSED"]) {
      const output = renderToStaticMarkup(
        exports.TradeGuidePanel({
          guide: { ...result, state },
          analysis,
          copy,
          locale,
          technicalDetails: jsx.jsx("p", {
            children: chart.tradeSetup.disclaimer,
          }),
        }),
      );
      const disclosure = output.match(/<details\b[^>]*>[\s\S]*?<\/details>/g);
      assert.equal(disclosure?.length, 1);
      assert.doesNotMatch(disclosure[0], /<details[^>]*\bopen\b/);
      for (const text of [
        copy.explanation,
        copy.decision.closedOnly,
        copy.disclaimer,
        copy.technicalDetails,
        chart.tradeSetup.disclaimer,
      ])
        assert.ok(disclosure[0].includes(text), text);
      const visible = output.replace(disclosure[0], "");
      for (const text of [
        copy.states[state],
        copy.decision.label,
        copy.nextAction,
        ...result.reason_codes.map((reason) => copy.reasons[reason]),
      ])
        assert.ok(visible.includes(text), text);
      if (state === "LONG_READY") {
        assert.ok(visible.includes(copy.reference));
        assert.ok(visible.includes(copy.stop));
        assert.ok(visible.includes(copy.rr));
        assert.match(visible, /TP1/);
        assert.match(visible, /TP2/);
      }
    }
  });
