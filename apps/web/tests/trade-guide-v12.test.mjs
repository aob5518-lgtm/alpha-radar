import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  calculateMaEntry,
  MA_ENTRY_VERSION,
} from "../src/lib/market/ma-confluence-entry.ts";
import {
  calculateTradeGuide,
  GUIDE_RULES,
  TRADE_GUIDE_VERSION,
  retainGuideEvidence,
} from "../src/lib/market/trade-guide.ts";
import {
  scoreEvidence,
  evidenceGrade,
  EVIDENCE_RULES,
} from "../src/lib/market/entry-evidence.ts";
import { calculateTradeSetup } from "../src/lib/market/trade-setup.ts";
import { calculateTechnicalContext } from "../src/lib/market/technical-context.ts";
import { TechnicalWorkerEngine } from "../src/lib/market/technical-worker-engine.ts";
import { maFixture } from "./helpers/ma-fixtures.mjs";
import { fixtureHistory, btcId, ethId } from "./helpers/chart-fixtures.mjs";
import { verifyPresentation } from "../../../scripts/audit/presentation.mjs";

function structural(direction = "long", breakout = false) {
  const s = maFixture(),
    c = s.closedCandles;
  for (let i = 0; i < 318; i++) {
    c[i].high = c[i].close + 0.5;
    c[i].low = c[i].close - 0.5;
  }
  Object.assign(c[317], {
    open: 115.85,
    close: 115.9,
    low: 115.8,
    high: 116.4,
  });
  Object.assign(c[318], { open: 115.9, close: 115.6, low: 115.3, high: 116 });
  Object.assign(c[319], {
    open: 115.7,
    close: 116.2,
    low: 115.4,
    high: 116.3,
    volume: 100,
  });
  Object.assign(s.supports[0], {
    zone_low: 115.3,
    zone_high: 115.7,
    representative_price: 115.5,
  });
  s.state.reference_level = {
    level_label: "S1",
    kind: "support",
    zone_low: 115.3,
    zone_high: 115.7,
  };
  s.state.evidence = [];
  s.state.entry_window_candidate = true;
  if (breakout) {
    s.state.phase = "reversal_confirmed_up";
    s.state.reference_level = null;
    s.state.evidence = [
      { code: "swing_break", direction: "up", value: 115.5 },
      { code: "structure_held", direction: "up", candles: 2 },
    ];
  }
  if (direction === "short") {
    for (const bar of c) {
      const copy = { ...bar };
      Object.assign(bar, {
        open: 300 - copy.open,
        close: 300 - copy.close,
        low: 300 - copy.high,
        high: 300 - copy.low,
      });
    }
    const mirror = (level) => ({
      ...level,
      kind: level.kind === "support" ? "resistance" : "support",
      label: level.kind === "support" ? "R1" : "S1",
      zone_low: 300 - level.zone_high,
      zone_high: 300 - level.zone_low,
      representative_price: 300 - level.representative_price,
    });
    [s.supports, s.resistances] = [
      s.resistances.map(mirror),
      s.supports.map(mirror),
    ];
    s.trend.direction = "bearish";
    s.trend.breakdown.market_structure = -1;
    s.state.direction = "bearish";
    s.state.phase = breakout
      ? "reversal_confirmed_down"
      : "resistance_confirmed";
    if (s.state.reference_level)
      s.state.reference_level = {
        level_label: "R1",
        kind: "resistance",
        zone_low: 184.3,
        zone_high: 184.7,
      };
    for (const e of s.state.evidence)
      if (e.code === "swing_break") {
        e.direction = "down";
        e.value = 184.5;
      }
  }
  return s;
}
function evaluate(s, previous) {
  const ma = calculateMaEntry(s, btcId, "15m"),
    setup = calculateTradeSetup(s, btcId, "15m");
  return {
    ma,
    guide: calculateTradeGuide(s, ma, setup, btcId, "15m", previous),
  };
}
test("versions, fixed safety thresholds, 100-point evidence and ordinal boundaries are explicit", () => {
  assert.equal(MA_ENTRY_VERSION, "ma-confluence-entry-v1.2");
  assert.equal(TRADE_GUIDE_VERSION, "trade-guide-v1.1");
  assert.deepEqual(GUIDE_RULES, {
    minimumRR: 1.2,
    readyRR: 1.5,
    favorableRR: 2,
  });
  assert.equal(
    Object.values(EVIDENCE_RULES.weights).reduce((a, b) => a + b, 0),
    100,
  );
  for (const [score, grade] of [
    [59, "none"],
    [60, "C"],
    [69, "C"],
    [70, "B"],
    [79, "B"],
    [80, "A"],
  ])
    assert.equal(evidenceGrade(score), grade);
  const facts = {
    trend: "strong",
    ma: "confluence",
    state: "confirmed",
    macd: "neutral",
    volume: "normal",
    structure: "structural",
    price: "strong",
  };
  assert.equal(scoreEvidence(facts).score, 86);
  assert.equal(
    scoreEvidence(facts).evidence.find((e) => e.key === "volume").tone,
    "neutral",
  );
});
for (const direction of ["long", "short"]) {
  const ready = direction === "long" ? "LONG_READY" : "SHORT_READY";
  test(`${direction} structural level without MA touch can be READY; neutral MACD and ordinary volume are soft evidence`, () => {
    const s = structural(direction),
      copy = structuredClone(s),
      { ma, guide } = evaluate(s);
    assert.equal(ma.diagnostics.touches, 0);
    assert.equal(
      ma.setup_type,
      direction === "long" ? "support_pullback" : "resistance_rejection",
    );
    assert.equal(
      guide.state,
      ready,
      JSON.stringify({ failures: ma.hard_failures, guide }),
    );
    assert.ok(guide.evidence.find((e) => e.key === "volume").points === 6);
    assert.ok(guide.hard_failures.length === 0);
    assert.ok(guide.evidence_score >= 70);
    assert.deepEqual(s, copy);
    const visual = verifyPresentation({
      snapshot: s,
      ma,
      guide,
      setup: undefined,
      candles: [],
      symbol: "SYNTHETIC",
    });
    assert.equal(visual.primary, true);
    assert.equal(visual.tooltip, true);
  });
  test(`${direction} existing swing-break / held evidence permits breakout-retest, no new structure detector`, () => {
    const { ma, guide } = evaluate(structural(direction, true));
    assert.equal(
      ma.setup_type,
      direction === "long" ? "breakout_retest" : "breakdown_retest",
    );
    assert.ok(
      ["LONG_READY", "SHORT_READY", "WATCH_LONG", "WATCH_SHORT"].includes(
        guide.state,
      ),
      JSON.stringify(guide),
    );
  });
  test(`${direction} poor RR WAIT, 1.2–1.5 WATCH; score C WATCH, score B/A READY`, () => {
    const s = structural(direction),
      ma = evaluate(s).ma,
      sign = direction === "long" ? 1 : -1;
    ma.trigger_price = direction === "long" ? 100 : 200;
    ma.invalidation_price = ma.trigger_price - sign * 10;
    ma.entry_zone =
      direction === "long" ? { low: 99, high: 101 } : { low: 199, high: 201 };
    s.closedCandles.at(-1).close = ma.trigger_price;
    for (const [rr, score, expected] of [
      [1.19, 90, "WAIT"],
      [1.2, 90, `WATCH_${direction.toUpperCase()}`],
      [1.49, 90, `WATCH_${direction.toUpperCase()}`],
      [1.5, 69, `WATCH_${direction.toUpperCase()}`],
      [1.5, 70, ready],
      [1.5, 79, ready],
      [2, 80, ready],
    ]) {
      const target =
        ma.trigger_price +
        sign * rr * Math.abs(ma.trigger_price - ma.invalidation_price);
      const input = {
        ...ma,
        observed_targets: [
          { price: target, source: direction === "long" ? "R1" : "S1" },
        ],
        confidence_score: score,
        quality_tier: evidenceGrade(score),
      };
      const guide = calculateTradeGuide(s, input, undefined, btcId, "15m");
      assert.equal(guide.state, expected, JSON.stringify({ rr, score, guide }));
      if (expected === ready)
        assert.equal(guide.quality_grade, score >= 80 ? "A" : "B");
    }
  });
  test(`${direction} stop buffer applied once; nearest observed TP1, overlap exclusion, target reached and no target fail closed`, () => {
    const s = structural(direction),
      { ma, guide } = evaluate(s),
      sign = direction === "long" ? 1 : -1;
    const prior = s.closedCandles.at(-2),
      boundary =
        direction === "long"
          ? Math.min(ma.entry_zone.low, prior.low)
          : Math.max(ma.entry_zone.high, prior.high);
    assert.equal(guide.stop_price, boundary - sign * 0.25 * ma.atr);
    assert.equal(
      calculateTradeGuide(
        s,
        { ...ma, observed_targets: [] },
        undefined,
        btcId,
        "15m",
      ).state,
      "WAIT",
    );
    const overlap = { price: ma.trigger_price, source: "R1" };
    assert.equal(
      calculateTradeGuide(
        s,
        { ...ma, observed_targets: [overlap] },
        undefined,
        btcId,
        "15m",
      ).state,
      "WAIT",
    );
    const crossed = {
      ...ma,
      observed_targets: [
        { price: ma.trigger_price + sign * 0.01, source: "R1" },
      ],
    };
    assert.equal(
      calculateTradeGuide(s, crossed, undefined, btcId, "15m").state,
      "WAIT",
    );
  });
}
test("neutral Trend with aligned structure/slope is eligible; neutral State no longer universal veto; opposite reversal rejects", () => {
  const s = structural();
  s.trend.direction = "neutral";
  const { ma } = evaluate(s);
  assert.equal(ma.setup_direction, "long");
  assert.ok(!ma.hard_failures.includes("trend_conflict"));
  s.trend.direction = "bullish";
  s.state.direction = "neutral";
  s.state.phase = "pullback";
  assert.notEqual(evaluate(s).guide.state, "WAIT");
  s.state.direction = "bearish";
  s.state.phase = "reversal_confirmed_down";
  assert.equal(evaluate(s).guide.state, "WAIT");
  assert.ok(evaluate(s).ma.hard_failures.includes("trend_conflict"));
});

test("native neutral-MACD READY and native B/C scoring do not depend on overridden engine output", () => {
  const ordinary = evaluate(maFixture());
  assert.equal(ordinary.ma.evidence.find((e) => e.key === "macd").points, 3);
  assert.equal(ordinary.guide.state, "LONG_READY");
  const s = structural();
  s.trend.strength = 40;
  const b = evaluate(s);
  assert.equal(b.guide.quality_grade, "B");
  assert.equal(b.guide.state, "LONG_READY");
  s.closedCandles.at(-1).volume = 0;
  const c = evaluate(s);
  assert.equal(c.guide.quality_grade, "C");
  assert.equal(c.guide.state, "WATCH_LONG");
  assert.deepEqual(c.guide.hard_failures, []);
});

test("a prior plan never bypasses severe momentum/volume gates when its current interaction expires", () => {
  const s = structural(),
    prior = evaluate(s).guide;
  // No zone interaction in the final three candles, and a severe opposing bar.
  for (const c of s.closedCandles.slice(-3))
    Object.assign(c, {
      open: 117,
      close: 116,
      low: 115.9,
      high: 117.1,
      volume: 1000,
    });
  const next = evaluate(s, prior);
  assert.ok(next.ma.hard_failures.includes("opposing_volume"));
  assert.equal(next.guide.state, "WAIT");
});
test("flat range repeated crosses, excess retests, insufficient structure/history and invalidated stop reject", () => {
  const s = structural();
  for (let i = 308; i < 320; i++)
    Object.assign(s.closedCandles[i], {
      open: 113.5,
      low: 111,
      high: 116,
      close: i % 2 ? 113.8 : 113.1,
    });
  const bad = evaluate(s);
  assert.equal(bad.guide.state, "WAIT");
  assert.ok(
    bad.ma.hard_failures.some((f) =>
      ["repeated_crosses", "excess_retests"].includes(f),
    ),
  );
  const thin = structural();
  thin.closedCandles = thin.closedCandles.slice(-60);
  assert.equal(evaluate(thin).guide.state, "WAIT");
  const absent = structural();
  absent.supports = [];
  absent.state.reference_level = null;
  assert.equal(evaluate(absent).guide.state, "WAIT");
  const broken = structural();
  broken.closedCandles.at(-1).close = 100;
  broken.closedCandles.at(-1).low = 99;
  assert.equal(evaluate(broken).guide.state, "WAIT");
  assert.ok(evaluate(broken).ma.hard_failures.includes("level_failed"));
});
test("clearly opposing accelerating MACD and unreclaimed explosive opposing volume are safety vetoes", () => {
  const s = maFixture();
  for (let i = 311; i <= 316; i++) {
    s.closedCandles[i].close += 8;
    s.closedCandles[i].high += 8;
  }
  assert.ok(
    evaluate(s).ma.hard_failures.includes("macd_conflict"),
    JSON.stringify(evaluate(s).ma.diagnostics),
  );
  const v = structural();
  Object.assign(v.closedCandles.at(-1), {
    open: 116.3,
    close: 115.8,
    high: 116.4,
    low: 115.4,
    volume: 1000,
  });
  assert.ok(evaluate(v).ma.hard_failures.includes("opposing_volume"));
  assert.equal(evaluate(v).guide.state, "WAIT");
});

test("excess low-quality MA touches and absent stops remain hard failures even at 100 evidence points", () => {
  const noisy = maFixture();
  for (const c of noisy.closedCandles.slice(-12)) c.low = 110;
  const bad = evaluate(noisy);
  assert.ok(bad.ma.hard_failures.includes("excess_retests"));
  assert.equal(
    calculateTradeGuide(
      noisy,
      { ...bad.ma, confidence_score: 100, quality_tier: "A" },
      undefined,
      btcId,
      "15m",
    ).state,
    "WAIT",
  );
  const s = structural(),
    ma = evaluate(s).ma;
  assert.equal(
    calculateTradeGuide(
      s,
      { ...ma, invalidation_price: null, confidence_score: 100 },
      undefined,
      btcId,
      "15m",
    ).state,
    "WAIT",
  );
});
test("confirmed price action is required; light/missing volume loses points without becoming a veto", () => {
  const s = structural();
  s.closedCandles.at(-1).volume = null;
  assert.ok(!evaluate(s).ma.hard_failures.includes("opposing_volume"));
  const pending = structural();
  pending.closedCandles.at(-1).open = pending.closedCandles.at(-1).close;
  const p = evaluate(pending);
  assert.equal(p.ma.price_confirmed, false);
  assert.equal(p.guide.state, "WATCH_LONG");
});
test("extension is MISSED; prior missed same interaction cannot revive, expired setup is WAIT", () => {
  const s = structural(),
    prior = evaluate(s).guide,
    last = s.closedCandles.at(-1);
  Object.assign(last, {
    close: prior.entry_zone_high + 3,
    high: prior.entry_zone_high + 3.1,
  });
  const missed = evaluate(s, prior).guide;
  assert.equal(missed.state, "MISSED");
  last.close = 116.2;
  assert.equal(evaluate(s, missed).guide.state, "MISSED");
  const transientWait = { ...missed, state: "WAIT" };
  assert.equal(retainGuideEvidence(missed, transientWait), missed);
  assert.equal(
    evaluate(s, retainGuideEvidence(missed, transientWait)).guide.state,
    "MISSED",
  );
  assert.equal(
    retainGuideEvidence(missed, {
      ...transientWait,
      market_instrument_id: ethId,
    }),
    undefined,
  );
  assert.equal(
    retainGuideEvidence(missed, {
      ...transientWait,
      ma_settings_key: "EMA:50:true",
    }),
    undefined,
  );
  const ma = evaluate(s).ma;
  ma.structure_origin = s.closedCandles.at(-8).openTime;
  assert.equal(
    calculateTradeGuide(s, ma, undefined, btcId, "15m").state,
    "WAIT",
  );
});
test("partial/ticker prices cannot move the complete score/grade/plan; mismatched identity/time reject", () => {
  const s = structural(),
    before = evaluate(s);
  s.closedCandles.push({
    ...s.closedCandles.at(-1),
    isClosed: false,
    high: 99999,
    close: 99999,
    volume: 999999,
  });
  assert.deepEqual(evaluate(s), before);
  for (const change of [
    { market_instrument_id: ethId },
    { timeframe: "1h" },
    { confirmed_at: "2000-01-01T00:00:00Z" },
  ])
    assert.equal(
      calculateTradeGuide(
        s,
        { ...before.ma, ...change },
        undefined,
        btcId,
        "15m",
      ).state,
      "WAIT",
    );
});
test("growing and rolling Worker prefixes equal cold replay exactly, including evidence/grades and plans", () => {
  const engine = new TechnicalWorkerEngine(),
    history = fixtureHistory("15m", btcId, 805).items;
  let priorFull,
    priorIncremental,
    incrementalCount = 0;
  for (const end of [798, 799, 800, 801, 802, 803, 804, 805]) {
    const candles = history.slice(Math.max(0, end - 800), end);
    const request = {
      market_instrument_id: btcId,
      timeframe: "15m",
      generation: 1,
      revision: String(end),
      candles,
      confirmedClose: Number(candles.at(-1).close),
    };
    const output = engine.compute(request);
    assert.ok(output.ok);
    if (output.incremental) incrementalCount++;
    const full = calculateTechnicalContext(
      candles,
      request.confirmedClose,
      "15m",
      undefined,
      btcId,
    );
    const a = calculateMaEntry(full, btcId, "15m"),
      b = calculateMaEntry(output.snapshot, btcId, "15m");
    assert.deepEqual(b, a);
    const fullGuide = calculateTradeGuide(
      full,
      a,
      calculateTradeSetup(full, btcId, "15m"),
      btcId,
      "15m",
      priorFull,
    );
    const incGuide = calculateTradeGuide(
      output.snapshot,
      b,
      output.setup,
      btcId,
      "15m",
      priorIncremental,
    );
    assert.deepEqual(incGuide, fullGuide);
    priorFull = fullGuide;
    priorIncremental = incGuide;
    engine.prewarm(request);
  }
  assert.ok(incrementalCount > 0);
});
test("Chinese compact evidence and all six simple primary states remain localized", () => {
  const copy = JSON.parse(
    readFileSync(new URL("../messages/zh-CN.json", import.meta.url)),
  ).chart.tradeGuide;
  for (const label of [
    "可开多",
    "可开空",
    "观察多",
    "观察空",
    "观望",
    "已错过",
  ])
    assert.ok(Object.values(copy.states).includes(label));
  for (const e of evaluate(structural()).ma.evidence)
    for (const tone of ["positive", "neutral", "negative"])
      assert.ok(copy.evidence[e.key][tone]);
});
