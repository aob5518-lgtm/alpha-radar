import assert from "node:assert/strict";
import { calculateTechnicalContext } from "../../apps/web/src/lib/market/technical-context.ts";
import { calculateTradeSetup } from "../../apps/web/src/lib/market/trade-setup.ts";
import {
  calculateMaEntry,
  MA_RULES,
  movingAverage,
} from "../../apps/web/src/lib/market/ma-confluence-entry.ts";
import {
  calculateTradeGuide,
  guideReady,
} from "../../apps/web/src/lib/market/trade-guide.ts";
import { calculateAtrSeries } from "../../apps/web/src/lib/market/technical-levels.ts";
import {
  higherMarketInterval,
  intervalSeconds,
} from "../../apps/web/src/lib/market/intervals.ts";
import { observers } from "./observe.mjs";

export const states = [
  "LONG_READY",
  "SHORT_READY",
  "WATCH_LONG",
  "WATCH_SHORT",
  "WAIT",
  "MISSED",
];
export const maBlockers = [
  "flat_ma",
  "trend_conflict",
  "repeated_crosses",
  "excess_retests",
  "no_impulse",
  "no_retest",
  "near_obstruction",
  "no_target",
  "weak_confirmation",
  "weak_volume",
  "missing_volume",
  "macd_conflict",
  "macd_unready",
  "overextended",
  "level_failed",
];
export const guideBlockers = [
  "conflict",
  "noise",
  "invalidated",
  "no_target",
  "invalid_risk",
  "poor_rr",
  "watch_rr",
  "confirmation_pending",
  "extended",
  "target_reached",
  "context_mismatch",
  "identity_mismatch",
  "unavailable",
];
export const stages = [
  "direction available",
  "MA slope aligned",
  "impulse exists",
  "recent retest exists",
  "chop filter passed",
  "retest-count filter passed",
  "MACD passed",
  "volume passed",
  "price confirmation passed",
  "real target exists",
  "structural room passed",
  "not overextended",
  "candidate score >=65",
  "trigger score >=80",
  "R:R >=1.2",
  "R:R >=1.5",
  "final READY",
];
const zeros = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));
export function distribution(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  const q = (p) => (a.length ? a[Math.floor((a.length - 1) * p)] : null);
  return {
    n: a.length,
    min: q(0),
    p25: q(0.25),
    median: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
    max: q(1),
  };
}
export function validateSeries(series, end) {
  const duration = intervalSeconds[series.interval] * 1000,
    gaps = [];
  let previous;
  for (const c of series.candles) {
    assert.equal(c.is_closed, true);
    assert.equal(c.provider, "bybit");
    assert.equal(c.market_instrument_id, series.id);
    assert.equal(c.interval, series.interval);
    const open = Date.parse(c.open_time),
      close = Date.parse(c.close_time);
    assert.ok(Number.isFinite(open) && close > open && close <= end);
    // Bybit persists inclusive millisecond close time; the stream projects next boundary.
    assert.ok(
      Math.abs(close - open - duration) <= 1,
      `Unexpected candle duration ${c.open_time}`,
    );
    assert.equal(open % duration, 0);
    for (const key of ["open", "high", "low", "close"])
      assert.ok(Number.isFinite(Number(c[key])) && Number(c[key]) > 0);
    assert.ok(
      Number(c.low) <= Math.min(Number(c.open), Number(c.close)) &&
        Number(c.high) >= Math.max(Number(c.open), Number(c.close)),
    );
    assert.ok(
      c.volume === null ||
        (Number.isFinite(Number(c.volume)) && Number(c.volume) >= 0),
    );
    if (previous !== undefined) {
      assert.ok(open > previous, "Duplicate/unordered candle");
      if (open - previous !== duration)
        gaps.push({
          after: new Date(previous).toISOString(),
          before: c.open_time,
          missing: (open - previous) / duration - 1,
        });
    }
    previous = open;
  }
  return gaps;
}
export function higherAt(candles, time, interval) {
  const closed = candles
    .filter((c) => Date.parse(c.close_time) <= time)
    .slice(-800);
  // Same as ChartContextStore.isCurrent: omit stale higher-period evidence.
  const boundary =
    Math.floor(time / (intervalSeconds[interval] * 1000)) *
    intervalSeconds[interval] *
    1000;
  return closed.length && Date.parse(closed.at(-1).close_time) >= boundary
    ? closed
    : undefined;
}
function hypothetical(ma, d, remove, addWeight) {
  const score = d.score + addWeight;
  return {
    ...ma,
    confidence_score: score,
    reason_codes: ma.reason_codes.filter((r) => r !== remove),
    state:
      (d.confirmed || remove === "weak_confirmation") && d.fresh && score >= 80
        ? d.direction === 1
          ? "trigger_long"
          : "trigger_short"
        : d.direction === 1
          ? "candidate_long"
          : "candidate_short",
    entry_zone: { low: d.low, high: d.high },
    trigger_price: d.trigger,
    invalidation_price: d.invalidation,
    first_target: d.target,
  };
}
export function replay(
  series,
  higher,
  start,
  end,
  { progress = () => {}, sampleLimit = 3, onBar } = {},
) {
  validateSeries(series, end);
  if (higher) validateSeries(higher, end);
  const probe = observers(),
    counts = zeros(states),
    maRaw = zeros(maBlockers),
    maFirst = zeros(maBlockers),
    guideRaw = zeros(guideBlockers),
    guideFirst = zeros(guideBlockers);
  const funnel = zeros(stages),
    episodes = zeros(stages),
    readyTimes = [],
    samples = [],
    maStates = {};
  const retest = { 4: 0, 5: 0, 6: 0 },
    volumeRatios = [],
    rr = zeros(["<1.0", "1.0–1.2", "1.2–1.5", "1.5–2.0", ">=2.0"]);
  const only = {
      volume: 0,
      macd: 0,
      previous_break: 0,
      close_location: 0,
      no_retest: 0,
    },
    counterReady = { volume: 0, macd: 0, previous_break: 0, close_location: 0 };
  let previousGuide,
    previousDirection = "none",
    episodeReached = new Set(),
    previousReady = "",
    firstTime,
    lastTime,
    n = 0,
    htfMissing = 0,
    rrMissing = 0,
    maTriggers = 0,
    rrLost = 0,
    rrDowngraded = 0;
  for (let i = 0; i < series.candles.length; i++) {
    const bar = series.candles[i],
      time = Date.parse(bar.close_time);
    // Include a full 800-bar primary warm-up in the exported input. Earlier bars are not scored.
    if (time < start - 3 * intervalSeconds[series.interval] * 1000 || i < 249)
      continue;
    const candles = series.candles.slice(Math.max(0, i - 799), i + 1),
      htf = higherAt(
        higher?.candles ?? [],
        time,
        higherMarketInterval[series.interval],
      );
    if (!htf) htfMissing++;
    const snapshot = calculateTechnicalContext(
      candles,
      Number(bar.close),
      series.interval,
      htf,
      series.id,
    );
    const setup = calculateTradeSetup(snapshot, series.id, series.interval),
      ma = calculateMaEntry(snapshot, series.id, series.interval);
    const observed = probe.ma(snapshot, series.id, series.interval);
    assert.deepEqual(observed.result, ma, "Audit probe changed MA output");
    const guide = calculateTradeGuide(
      snapshot,
      ma,
      setup,
      series.id,
      series.interval,
      previousGuide,
    );
    const gp = probe.guide(
      snapshot,
      ma,
      setup,
      series.id,
      series.interval,
      previousGuide,
    );
    assert.deepEqual(gp.result, guide, "Audit probe changed Guide output");
    if (guideReady(guide)) previousGuide = guide;
    else if (
      guide.state === "WAIT" ||
      previousGuide?.ma_settings_key !== guide.ma_settings_key
    )
      previousGuide = undefined;
    if (time < start) continue;
    onBar?.({ time, guide, ma, snapshot });
    const d = observed.trace,
      reasons = ma.reason_codes.filter((r) => maBlockers.includes(r));
    for (const r of reasons) maRaw[r]++;
    if (reasons[0]) maFirst[reasons[0]]++;
    const gr = guide.reason_codes.filter((r) => guideBlockers.includes(r));
    for (const r of gr) guideRaw[r]++;
    if (gr[0]) guideFirst[gr[0]]++;
    maStates[ma.state] = (maStates[ma.state] ?? 0) + 1;
    counts[guide.state]++;
    n++;
    firstTime ??= bar.close_time;
    lastTime = bar.close_time;
    const ready = guideReady(guide);
    if (ready && previousReady !== guide.state) readyTimes.push(n);
    previousReady = ready ? guide.state : "";
    if (ma.setup_direction !== previousDirection) {
      episodeReached = new Set();
      previousDirection = ma.setup_direction;
    }
    const has = (r) => reasons.includes(r);
    const passed = [
      ma.setup_direction !== "none",
      !!d && d.direction * d.slope >= MA_RULES.slopeAtr,
      !!d && d.impulse >= 0,
      !!d && d.retests.length > 0,
      !has("repeated_crosses"),
      !has("excess_retests"),
      !!d?.macdAligned,
      !!d?.volumeHealthy,
      !!d?.confirmed,
      !!d && d.target !== null,
      !has("near_obstruction"),
      !has("overextended"),
      ma.confidence_score >= 65,
      ma.confidence_score >= 80,
      gp.trace?.rr >= 1.2,
      gp.trace?.rr >= 1.5,
      ready,
    ];
    let cumulative = true;
    passed.forEach((pass, j) => {
      cumulative &&= pass;
      if (cumulative) {
        funnel[stages[j]]++;
        if (!episodeReached.has(j)) {
          episodes[stages[j]]++;
          episodeReached.add(j);
        }
      }
    });
    if (has("weak_volume") && d && d.volumeRatio !== null)
      volumeRatios.push(d.volumeRatio);
    if (d) {
      const alone = (reason) => reasons.length === 1 && has(reason);
      const trial = (reason, weight) =>
        calculateTradeGuide(
          snapshot,
          hypothetical(ma, d, reason, weight),
          setup,
          series.id,
          series.interval,
        );
      for (const [reason, key, weight] of [
        ["weak_volume", "volume", 10],
        ["macd_conflict", "macd", 10],
      ]) {
        if (alone(reason) && d.confirmed && d.fresh && d.score + weight >= 80) {
          only[key]++;
          if (guideReady(trial(reason, weight))) counterReady[key]++;
        }
      }
      if (alone("weak_confirmation") && d.fresh && d.score + 15 >= 80) {
        if (
          !d.previousBreak &&
          d.zoneBreak &&
          d.candleDirection &&
          d.locationPassed
        ) {
          only.previous_break++;
          if (guideReady(trial("weak_confirmation", 15)))
            counterReady.previous_break++;
        }
        if (
          d.previousBreak &&
          d.zoneBreak &&
          d.candleDirection &&
          !d.locationPassed
        ) {
          only.close_location++;
          if (guideReady(trial("weak_confirmation", 15)))
            counterReady.close_location++;
        }
      }
      if (alone("no_retest")) {
        only.no_retest++;
        const c = snapshot.closedCandles,
          av = movingAverage(
            c.map((v) => v.close),
            ma.settings,
          ),
          atr = calculateAtrSeries(c);
        for (const lookback of [4, 5, 6])
          if (
            c.some(
              (v, j) =>
                j > d.impulse &&
                j >= c.length - lookback &&
                av[j] !== null &&
                v.low <= av[j] + MA_RULES.zoneAtr * atr[j] &&
                v.high >= av[j] - MA_RULES.zoneAtr * atr[j],
            )
          )
            retest[lookback]++;
      }
    }
    if (ma.state.startsWith("trigger_")) {
      maTriggers++;
      const value = gp.trace?.rr;
      if (value === undefined) rrMissing++;
      else {
        rr[
          value < 1
            ? "<1.0"
            : value < 1.2
              ? "1.0–1.2"
              : value < 1.5
                ? "1.2–1.5"
                : value < 2
                  ? "1.5–2.0"
                  : ">=2.0"
        ]++;
        if (guide.reason_codes.includes("poor_rr")) rrLost++;
        if (guide.reason_codes.includes("watch_rr")) rrDowngraded++;
      }
    }
    if (
      ready &&
      samples.filter((v) => v.guide.state === guide.state).length < sampleLimit
    )
      samples.push({
        symbol: series.symbol,
        snapshot,
        setup,
        ma,
        guide,
        candles,
        higher: htf,
      });
    if (n % 1000 === 0)
      progress({
        symbol: series.symbol,
        interval: series.interval,
        processed: n,
        counts,
      });
  }
  const days = firstTime
    ? (Date.parse(lastTime) -
        Date.parse(firstTime) +
        intervalSeconds[series.interval] * 1000) /
      86400000
    : 0;
  const gaps = validateSeries(series, end),
    startIndex = series.candles.findIndex(
      (c) => Date.parse(c.close_time) >= start,
    );
  return {
    symbol: series.symbol,
    id: series.id,
    interval: series.interval,
    firstTime,
    lastTime,
    n,
    days,
    counts,
    maStates,
    funnel,
    episodes,
    maRaw,
    maFirst,
    guideRaw,
    guideFirst,
    ready_episodes: readyTimes.length,
    ready_bars: counts.LONG_READY + counts.SHORT_READY,
    signals_per_day: days ? readyTimes.length / days : 0,
    signals_per_week: days ? (readyTimes.length / days) * 7 : 0,
    median_candles_between_ready: distribution(
      readyTimes.slice(1).map((v, j) => v - readyTimes[j]),
    ).median,
    retest,
    only,
    counterReady,
    volume: distribution(volumeRatios),
    rr,
    maTriggers,
    rrMissing,
    rrLost,
    rrDowngraded,
    htfMissing,
    gaps,
    stored_candles: series.candles.length,
    warmup_bars: startIndex < 0 ? series.candles.length : startIndex,
    late_ingested_candles: series.candles.filter(
      (c) =>
        Date.parse(c.ingested_at) >
        Date.parse(c.close_time) + intervalSeconds[series.interval] * 1000,
    ).length,
    samples,
  };
}
