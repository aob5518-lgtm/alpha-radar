/** Audit-only lexical probes. Fail closed on source drift; never imported by the app.
 * Probes observe existing local values, do not change branches, rules or returns.
 * Replay compares their complete output with the uninstrumented functions every bar.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as levels from "../../apps/web/src/lib/market/technical-levels.ts";
import * as maModule from "../../apps/web/src/lib/market/ma-confluence-entry.ts";
import * as setup from "../../apps/web/src/lib/market/trade-setup.ts";
import * as intervals from "../../apps/web/src/lib/market/intervals.ts";
import * as retest from "../../apps/web/src/lib/market/ma-retest-episode.ts";
const require = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const ts = require("typescript");
function probe(path, replacements, modules, name) {
  let source = readFileSync(new URL(path, import.meta.url), "utf8");
  for (const [anchor, replacement] of replacements) {
    if (source.split(anchor).length !== 2)
      throw new Error(`Audit probe drift: ${anchor}`);
    source = source.replace(anchor, replacement);
  }
  let trace;
  const exports = {};
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  runInNewContext(output, {
    exports,
    require: (key) => {
      if (!(key in modules)) throw new Error(`Unmapped audit import ${key}`);
      return modules[key];
    },
    __observe: (value) => {
      trace = structuredClone(value);
    },
  });
  return (...args) => {
    trace = undefined;
    const result = exports[name](...args);
    return { result: structuredClone(result), trace };
  };
}
export function observers({
  maPath = "../../apps/web/src/lib/market/ma-confluence-entry.ts",
  changes = [],
} = {}) {
  const modern = readFileSync(
    new URL(maPath, import.meta.url),
    "utf8",
  ).includes("retest_memory");
  return {
    ma: probe(
      maPath,
      [
        ...changes,
        [
          "  result.confidence_score = score;",
          `  __observe({direction,slope,impulse,retests:retests.map(v=>v.i),atr,low,high,trigger,invalidation,target,
        macdAligned,volumeHealthy,confirmed,score,alignedLevel,averageVolume,
        volumeRatio:result.diagnostics.volume_ratio,
        previousBreak:direction*(last.close-(direction===1?previous.high:previous.low))>=0,
        zoneBreak:direction*(last.close-(direction===1?high:low))>=0,
        candleDirection:direction*(last.close-last.open)>0,
        locationPassed:direction===1?closeLocation>=r.closeStrength:closeLocation<=1-r.closeStrength,
        fresh:${modern ? "result.diagnostics.retest_active" : "direction*(previous.close-averages.at(-2))<=r.zoneAtr*(atrSeries.at(-2)??atr)||retests.some(v=>v.i===candles.length-1)"},
        reasons:[...reasons]});
  result.confidence_score = score;`,
        ],
      ],
      {
        "./technical-levels.ts": levels,
        "../../../src/lib/market/technical-levels.ts": levels,
        "./ma-retest-episode.ts": retest,
      },
      "calculateMaEntry",
    ),
    guide: probe(
      "../../apps/web/src/lib/market/trade-guide.ts",
      [
        [
          "    result.favorable_reward_risk =",
          "    __observe({rr:result.reward_risk_tp1});\n    result.favorable_reward_risk =",
        ],
      ],
      {
        "./ma-confluence-entry.ts": maModule,
        "./trade-setup.ts": setup,
        "./intervals.ts": intervals,
      },
      "calculateTradeGuide",
    ),
  };
}
