import type {
  MarketNextWait,
  MarketPhase,
  MarketState,
  MarketStateDirection,
  MarketStateEvidence,
  MarketStateMarker,
  MarketStateMarkerPhase,
  MarketStateReferenceLevel,
  StructuralLevel,
} from "@alpha-radar/types/core-3";
import type {
  MarketCandle,
  MarketInterval,
} from "@alpha-radar/types/market-data";

import {
  calculateAtrSeries,
  calculateSeededEma,
  calculateTechnicalSnapshot,
  detectConfirmedPivots,
  normalizeClosedCandles,
  type NumericCandle,
  type TechnicalSnapshot,
} from "./technical-levels.ts";

export const MARKET_STATE_VERSION = "market-state-v1" as const;

export const MARKET_STATE_CONSTANTS = {
  calculationWindow: 800,
  atrPeriod: 14,
  baselineWindow: 20,
  shortWindow: 3,
  slowWindow: 8,
  sharpNetMoveAtr: 1.5,
  sharpRangeExpansion: 1.15,
  slowNetMoveAtr: 0.8,
  slowRangeMaximumAtr: 1.15,
  slowProgressMinimum: 0.6,
  stabilizationLookback: 10,
  stabilizationRecentWindow: 3,
  stabilizationPriorMoveAtr: 1.5,
  stabilizationMaximumExtensionAtr: 0.25,
  stabilizationLeaveExtremeAtr: 0.35,
  stabilizationRangeContraction: 0.9,
  reversalBreakBufferAtr: 0.1,
  reversalHoldBufferAtr: 0.2,
  reversalHoldCandles: 2,
  retracementMinimumAtr: 0.35,
  retracementMaximumAtr: 1.5,
  retracementRangeMaximumAtr: 1.2,
  levelTouchBufferAtr: 0.1,
  levelFailureBufferAtr: 0.15,
  levelNearDistanceAtr: 0.75,
  entryMaximumExtensionAtr: 1,
  exhaustionLookback: 12,
  exhaustionMoveAtr: 3,
  exhaustionEmaDistanceAtr: 1.5,
  exhaustionScoreMinimum: 0.65,
  markerReplayWindow: 160,
  markerMaximum: 8,
  minimumStateCandles: 30,
} as const;

const MARKER_PHASES = new Set<MarketStateMarkerPhase>([
  "sharp_drop",
  "sharp_rise",
  "bottoming",
  "topping",
  "reversal_confirmed_up",
  "reversal_confirmed_down",
  "support_confirmed",
  "resistance_confirmed",
  "up_exhaustion",
  "down_exhaustion",
]);

const MARKER_PRIORITY: Record<MarketStateMarkerPhase, number> = {
  reversal_confirmed_up: 5,
  reversal_confirmed_down: 5,
  support_confirmed: 4,
  resistance_confirmed: 4,
  up_exhaustion: 4,
  down_exhaustion: 4,
  bottoming: 3,
  topping: 3,
  sharp_drop: 2,
  sharp_rise: 2,
};

interface PhaseResult {
  phase: MarketPhase;
  confidence: number;
  evidence: MarketStateEvidence[];
  referenceLevel: StructuralLevel | null;
}

interface StabilizationResult {
  bottoming: boolean;
  topping: boolean;
  priorMoveAtr: number;
  leaveLowAtr: number;
  leaveHighAtr: number;
  contraction: number;
}

interface LevelConfirmation {
  confirmed: boolean;
  failed: boolean;
  level: StructuralLevel | null;
}

interface ReversalResult {
  attemptUp: boolean;
  attemptDown: boolean;
  confirmedUp: boolean;
  confirmedDown: boolean;
  brokenUp: number | null;
  brokenDown: number | null;
}

export interface MarketStateAnalysis {
  state: MarketState;
  markers: MarketStateMarker[];
}

export function calculateMarketState(
  candles: MarketCandle[],
  snapshot: TechnicalSnapshot,
): MarketState {
  const closed = normalizeClosedCandles(candles).slice(
    -MARKET_STATE_CONSTANTS.calculationWindow,
  );
  const last = closed.at(-1);
  const direction = normalizeDirection(snapshot.trend.direction);

  if (!last) {
    return {
      algorithm_version: MARKET_STATE_VERSION,
      direction,
      direction_strength: snapshot.trend.strength,
      phase: "slow_decline",
      phase_confidence: 0,
      next_wait: "wait_for_better_location",
      entry_window_candidate: false,
      reference_level: null,
      evidence: [],
      confirmed_at: "",
    };
  }

  const atrSeries = calculateAtrSeries(
    closed,
    MARKET_STATE_CONSTANTS.atrPeriod,
  );
  const atr = Math.max(atrSeries.at(-1) ?? 0, Number.EPSILON);
  const phaseResult = classifyPhase(closed, snapshot, atrSeries, atr);
  const referenceLevel = toReferenceLevel(phaseResult.referenceLevel);
  const entryWindowCandidate = isEntryWindowCandidate(
    direction,
    phaseResult.phase,
    last.close,
    phaseResult.referenceLevel,
    atr,
  );

  return {
    algorithm_version: MARKET_STATE_VERSION,
    direction,
    direction_strength: snapshot.trend.strength,
    phase: phaseResult.phase,
    phase_confidence: phaseResult.confidence,
    next_wait: determineNextWait(
      direction,
      phaseResult.phase,
      last.close,
      snapshot,
      atr,
    ),
    entry_window_candidate: entryWindowCandidate,
    reference_level: referenceLevel,
    evidence: phaseResult.evidence.slice(0, 4),
    confirmed_at: last.closeTime,
  };
}

export function calculateMarketStateMarkers(
  candles: MarketCandle[],
  marketInstrumentId: string,
  timeframe: MarketInterval,
): MarketStateMarker[] {
  const closedSource = candles
    .filter((candle) => candle.is_closed)
    .sort(
      (left, right) => Date.parse(left.open_time) - Date.parse(right.open_time),
    )
    .slice(-MARKET_STATE_CONSTANTS.calculationWindow);
  const start = Math.max(
    MARKET_STATE_CONSTANTS.minimumStateCandles,
    closedSource.length - MARKET_STATE_CONSTANTS.markerReplayWindow,
  );
  const candidates: Array<MarketStateMarker & { sequence: number }> = [];
  let previousPhase: MarketPhase | null = null;

  if (start > 1) {
    const priorPrefix = closedSource.slice(0, start - 1);
    const priorLast = priorPrefix.at(-1);
    if (priorLast) {
      const priorSnapshot = calculateTechnicalSnapshot(
        priorPrefix,
        Number(priorLast.close),
        timeframe,
      );
      previousPhase = calculateMarketState(priorPrefix, priorSnapshot).phase;
    }
  }

  for (let length = start; length <= closedSource.length; length += 1) {
    const prefix = closedSource.slice(0, length);
    const last = prefix.at(-1);
    if (!last) continue;
    const snapshot = calculateTechnicalSnapshot(
      prefix,
      Number(last.close),
      timeframe,
    );
    const state = calculateMarketState(prefix, snapshot);
    const phaseChanged = state.phase !== previousPhase;
    previousPhase = state.phase;
    if (!phaseChanged || !isMarkerPhase(state.phase)) continue;
    candidates.push({
      id: `${marketInstrumentId}:${timeframe}:${state.confirmed_at}:${state.phase}`,
      market_instrument_id: marketInstrumentId,
      timeframe,
      phase: state.phase,
      confidence: state.phase_confidence,
      confirmed_at: state.confirmed_at,
      candle_open_time: last.open_time,
      price: Number(last.close),
      position: markerPosition(state.phase),
      reference_level: state.reference_level,
      evidence: state.evidence,
      sequence: length,
    });
  }

  return candidates
    .sort(
      (left, right) =>
        markerRank(right, closedSource.length) -
          markerRank(left, closedSource.length) ||
        right.sequence - left.sequence,
    )
    .slice(0, MARKET_STATE_CONSTANTS.markerMaximum)
    .sort((left, right) => left.sequence - right.sequence)
    .map((marker) => ({
      id: marker.id,
      market_instrument_id: marker.market_instrument_id,
      timeframe: marker.timeframe,
      phase: marker.phase,
      confidence: marker.confidence,
      confirmed_at: marker.confirmed_at,
      candle_open_time: marker.candle_open_time,
      price: marker.price,
      position: marker.position,
      reference_level: marker.reference_level,
      evidence: marker.evidence,
    }));
}

export function calculateMarketStateAnalysis(
  candles: MarketCandle[],
  snapshot: TechnicalSnapshot,
  marketInstrumentId: string,
  timeframe: MarketInterval,
): MarketStateAnalysis {
  return {
    state: calculateMarketState(candles, snapshot),
    markers: calculateMarketStateMarkers(
      candles,
      marketInstrumentId,
      timeframe,
    ),
  };
}

function classifyPhase(
  candles: NumericCandle[],
  snapshot: TechnicalSnapshot,
  atrSeries: number[],
  atr: number,
): PhaseResult {
  const last = candles.at(-1)!;
  const baselineAtr = Math.max(
    mean(
      atrSeries.slice(
        -(
          MARKET_STATE_CONSTANTS.baselineWindow +
          MARKET_STATE_CONSTANTS.shortWindow
        ),
        -MARKET_STATE_CONSTANTS.shortWindow,
      ),
    ) || atr,
    Number.EPSILON,
  );
  const shortMoveAtr = moveAtr(
    candles,
    MARKET_STATE_CONSTANTS.shortWindow,
    baselineAtr,
  );
  const slowMoveAtr = moveAtr(
    candles,
    MARKET_STATE_CONSTANTS.slowWindow,
    baselineAtr,
  );
  const recentRangeRatio =
    mean(recentTrueRanges(candles, MARKET_STATE_CONSTANTS.shortWindow)) /
    baselineAtr;
  const stabilization = detectStabilization(candles, baselineAtr);
  const reversal = detectReversal(candles, atrSeries, stabilization);
  const support = detectLevelConfirmation(
    candles,
    snapshot.supports[0] ?? null,
    atr,
  );
  const resistance = detectLevelConfirmation(
    candles,
    snapshot.resistances[0] ?? null,
    atr,
  );
  const exhaustion = detectExhaustion(candles, atrSeries);
  const ema20 = calculateSeededEma(
    candles.map((candle) => candle.close),
    20,
  ).at(-1);

  if (support.confirmed && support.level) {
    return levelPhase("support_confirmed", support.level, 84);
  }
  if (resistance.confirmed && resistance.level) {
    return levelPhase("resistance_confirmed", resistance.level, 84);
  }
  if (reversal.confirmedUp) {
    return {
      phase: "reversal_confirmed_up",
      confidence: 82,
      referenceLevel: null,
      evidence: [
        { code: "swing_break", direction: "up", value: reversal.brokenUp ?? 0 },
        { code: "structure_held", direction: "up", candles: 2 },
      ],
    };
  }
  if (reversal.confirmedDown) {
    return {
      phase: "reversal_confirmed_down",
      confidence: 82,
      referenceLevel: null,
      evidence: [
        {
          code: "swing_break",
          direction: "down",
          value: reversal.brokenDown ?? 0,
        },
        { code: "structure_held", direction: "down", candles: 2 },
      ],
    };
  }
  if (reversal.attemptUp) {
    return {
      phase: "reversal_attempt_up",
      confidence: 68,
      referenceLevel: null,
      evidence: [
        { code: "extension_slowed", direction: "down" },
        { code: "swing_break", direction: "up", value: reversal.brokenUp ?? 0 },
      ],
    };
  }
  if (reversal.attemptDown) {
    return {
      phase: "reversal_attempt_down",
      confidence: 68,
      referenceLevel: null,
      evidence: [
        { code: "extension_slowed", direction: "up" },
        {
          code: "swing_break",
          direction: "down",
          value: reversal.brokenDown ?? 0,
        },
      ],
    };
  }
  if (stabilization.bottoming) {
    return {
      phase: "bottoming",
      confidence: 74,
      referenceLevel: null,
      evidence: [
        { code: "extension_slowed", direction: "down" },
        {
          code: "left_extreme",
          direction: "up",
          value: stabilization.leaveLowAtr,
        },
      ],
    };
  }
  if (stabilization.topping) {
    return {
      phase: "topping",
      confidence: 74,
      referenceLevel: null,
      evidence: [
        { code: "extension_slowed", direction: "up" },
        {
          code: "left_extreme",
          direction: "down",
          value: stabilization.leaveHighAtr,
        },
      ],
    };
  }
  if (exhaustion.up) {
    return {
      phase: "up_exhaustion",
      confidence: confidenceFromScore(exhaustion.upScore),
      referenceLevel: snapshot.resistances[0] ?? null,
      evidence: exhaustion.upEvidence,
    };
  }
  if (exhaustion.down) {
    return {
      phase: "down_exhaustion",
      confidence: confidenceFromScore(exhaustion.downScore),
      referenceLevel: snapshot.supports[0] ?? null,
      evidence: exhaustion.downEvidence,
    };
  }
  if (
    shortMoveAtr <= -MARKET_STATE_CONSTANTS.sharpNetMoveAtr &&
    recentRangeRatio >= MARKET_STATE_CONSTANTS.sharpRangeExpansion
  ) {
    return movementPhase("sharp_drop", shortMoveAtr, recentRangeRatio, 82);
  }
  if (
    shortMoveAtr >= MARKET_STATE_CONSTANTS.sharpNetMoveAtr &&
    recentRangeRatio >= MARKET_STATE_CONSTANTS.sharpRangeExpansion
  ) {
    return movementPhase("sharp_rise", shortMoveAtr, recentRangeRatio, 82);
  }

  const recentProgress = directionalProgress(
    candles.slice(-(MARKET_STATE_CONSTANTS.shortWindow + 1)),
  );
  const controlledRetracement =
    Math.abs(shortMoveAtr) >= MARKET_STATE_CONSTANTS.retracementMinimumAtr &&
    Math.abs(shortMoveAtr) <= MARKET_STATE_CONSTANTS.retracementMaximumAtr &&
    recentRangeRatio <= MARKET_STATE_CONSTANTS.retracementRangeMaximumAtr;
  if (
    snapshot.trend.direction === "bullish" &&
    shortMoveAtr < 0 &&
    controlledRetracement &&
    (ema20 === null || ema20 === undefined || last.close >= ema20 - atr)
  ) {
    return {
      phase: "pullback",
      confidence: 70,
      referenceLevel: snapshot.supports[0] ?? null,
      evidence: [
        {
          code: "controlled_retracement",
          direction: "down",
          value: Math.abs(shortMoveAtr),
          candles: MARKET_STATE_CONSTANTS.shortWindow,
        },
      ],
    };
  }
  if (
    snapshot.trend.direction === "bearish" &&
    shortMoveAtr > 0 &&
    controlledRetracement &&
    (ema20 === null || ema20 === undefined || last.close <= ema20 + atr)
  ) {
    return {
      phase: "rebound",
      confidence: 70,
      referenceLevel: snapshot.resistances[0] ?? null,
      evidence: [
        {
          code: "controlled_retracement",
          direction: "up",
          value: Math.abs(shortMoveAtr),
          candles: MARKET_STATE_CONSTANTS.shortWindow,
        },
      ],
    };
  }

  const slowProgress = directionalProgress(
    candles.slice(-(MARKET_STATE_CONSTANTS.slowWindow + 1)),
  );
  const averageSlowRange =
    mean(recentTrueRanges(candles, MARKET_STATE_CONSTANTS.slowWindow)) /
    baselineAtr;
  const slowRise =
    slowMoveAtr >= MARKET_STATE_CONSTANTS.slowNetMoveAtr &&
    slowProgress.up >= MARKET_STATE_CONSTANTS.slowProgressMinimum &&
    averageSlowRange <= MARKET_STATE_CONSTANTS.slowRangeMaximumAtr;
  const slowDecline =
    slowMoveAtr <= -MARKET_STATE_CONSTANTS.slowNetMoveAtr &&
    slowProgress.down >= MARKET_STATE_CONSTANTS.slowProgressMinimum &&
    averageSlowRange <= MARKET_STATE_CONSTANTS.slowRangeMaximumAtr;
  if (slowRise) {
    return slowPhase("slow_rise", slowMoveAtr, slowProgress.up);
  }
  if (slowDecline) {
    return slowPhase("slow_decline", slowMoveAtr, slowProgress.down);
  }

  const fallbackRise =
    slowMoveAtr >= 0 || recentProgress.up > recentProgress.down;
  const rangeReference = nearestLevel(last.close, snapshot);
  return {
    phase: fallbackRise ? "slow_rise" : "slow_decline",
    confidence: 32,
    referenceLevel:
      rangeReference && isNearLevel(last.close, rangeReference, atr)
        ? rangeReference
        : null,
    evidence: [
      {
        code: "range_location",
        direction: fallbackRise ? "up" : "down",
      },
    ],
  };
}

function detectStabilization(
  candles: NumericCandle[],
  atr: number,
): StabilizationResult {
  const lookback = MARKET_STATE_CONSTANTS.stabilizationLookback;
  const recentCount = MARKET_STATE_CONSTANTS.stabilizationRecentWindow;
  const window = candles.slice(-lookback);
  const recent = window.slice(-recentCount);
  const prior = window.slice(0, -recentCount);
  if (prior.length < 3 || recent.length < recentCount) {
    return {
      bottoming: false,
      topping: false,
      priorMoveAtr: 0,
      leaveLowAtr: 0,
      leaveHighAtr: 0,
      contraction: 1,
    };
  }
  const priorMoveAtr =
    ((prior.at(-1)?.close ?? 0) - (prior[0]?.close ?? 0)) / atr;
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const last = recent.at(-1)!;
  const leaveLowAtr = (last.close - Math.min(priorLow, recentLow)) / atr;
  const leaveHighAtr = (Math.max(priorHigh, recentHigh) - last.close) / atr;
  const contraction =
    mean(recent.map((candle) => candle.high - candle.low)) /
    Math.max(
      mean(prior.map((candle) => candle.high - candle.low)),
      Number.EPSILON,
    );
  const lowerWick = mean(
    recent.map((candle) => Math.min(candle.open, candle.close) - candle.low),
  );
  const upperWick = mean(
    recent.map((candle) => candle.high - Math.max(candle.open, candle.close)),
  );
  const bottoming =
    priorMoveAtr <= -MARKET_STATE_CONSTANTS.stabilizationPriorMoveAtr &&
    Math.max(0, priorLow - recentLow) / atr <=
      MARKET_STATE_CONSTANTS.stabilizationMaximumExtensionAtr &&
    leaveLowAtr >= MARKET_STATE_CONSTANTS.stabilizationLeaveExtremeAtr &&
    (contraction <= MARKET_STATE_CONSTANTS.stabilizationRangeContraction ||
      lowerWick / atr >= 0.25);
  const topping =
    priorMoveAtr >= MARKET_STATE_CONSTANTS.stabilizationPriorMoveAtr &&
    Math.max(0, recentHigh - priorHigh) / atr <=
      MARKET_STATE_CONSTANTS.stabilizationMaximumExtensionAtr &&
    leaveHighAtr >= MARKET_STATE_CONSTANTS.stabilizationLeaveExtremeAtr &&
    (contraction <= MARKET_STATE_CONSTANTS.stabilizationRangeContraction ||
      upperWick / atr >= 0.25);
  return {
    bottoming,
    topping,
    priorMoveAtr,
    leaveLowAtr,
    leaveHighAtr,
    contraction,
  };
}

function detectReversal(
  candles: NumericCandle[],
  atrSeries: number[],
  stabilization: StabilizationResult,
): ReversalResult {
  const atr = Math.max(atrSeries.at(-1) ?? 0, Number.EPSILON);
  const pivots = detectConfirmedPivots(candles);
  const currentIndex = candles.length - 1;
  const high = [...pivots]
    .reverse()
    .find((pivot) => pivot.side === "high" && pivot.index <= currentIndex - 2);
  const low = [...pivots]
    .reverse()
    .find((pivot) => pivot.side === "low" && pivot.index <= currentIndex - 2);
  const recent = candles.slice(-5);
  const previous = candles.at(-2);
  const last = candles.at(-1);
  const hadBottoming =
    stabilization.bottoming ||
    [1, 2, 3].some(
      (offset) =>
        detectStabilization(
          candles.slice(0, -offset),
          Math.max(atrSeries.at(-(offset + 1)) ?? atr, Number.EPSILON),
        ).bottoming,
    );
  const hadTopping =
    stabilization.topping ||
    [1, 2, 3].some(
      (offset) =>
        detectStabilization(
          candles.slice(0, -offset),
          Math.max(atrSeries.at(-(offset + 1)) ?? atr, Number.EPSILON),
        ).topping,
    );
  const upBreakIndex = high
    ? recent.findIndex(
        (candle, index) =>
          candle.close >
            high.price + MARKET_STATE_CONSTANTS.reversalBreakBufferAtr * atr &&
          (index === 0 || (recent[index - 1]?.close ?? 0) <= high.price),
      )
    : -1;
  const downBreakIndex = low
    ? recent.findIndex(
        (candle, index) =>
          candle.close <
            low.price - MARKET_STATE_CONSTANTS.reversalBreakBufferAtr * atr &&
          (index === 0 ||
            (recent[index - 1]?.close ?? Number.POSITIVE_INFINITY) >=
              low.price),
      )
    : -1;
  const upHold =
    high !== undefined &&
    upBreakIndex >= 0 &&
    recent.length - upBreakIndex - 1 >=
      MARKET_STATE_CONSTANTS.reversalHoldCandles &&
    recent
      .slice(-MARKET_STATE_CONSTANTS.reversalHoldCandles)
      .every(
        (candle) =>
          candle.close > high.price &&
          candle.low >=
            high.price - MARKET_STATE_CONSTANTS.reversalHoldBufferAtr * atr,
      );
  const downHold =
    low !== undefined &&
    downBreakIndex >= 0 &&
    recent.length - downBreakIndex - 1 >=
      MARKET_STATE_CONSTANTS.reversalHoldCandles &&
    recent
      .slice(-MARKET_STATE_CONSTANTS.reversalHoldCandles)
      .every(
        (candle) =>
          candle.close < low.price &&
          candle.high <=
            low.price + MARKET_STATE_CONSTANTS.reversalHoldBufferAtr * atr,
      );
  const attemptUp =
    Boolean(high && previous && last) &&
    hadBottoming &&
    previous!.close <= high!.price &&
    last!.close >
      high!.price + MARKET_STATE_CONSTANTS.reversalBreakBufferAtr * atr;
  const attemptDown =
    Boolean(low && previous && last) &&
    hadTopping &&
    previous!.close >= low!.price &&
    last!.close <
      low!.price - MARKET_STATE_CONSTANTS.reversalBreakBufferAtr * atr;
  return {
    attemptUp,
    attemptDown,
    confirmedUp: hadBottoming && upHold,
    confirmedDown: hadTopping && downHold,
    brokenUp: high?.price ?? null,
    brokenDown: low?.price ?? null,
  };
}

function detectLevelConfirmation(
  candles: NumericCandle[],
  level: StructuralLevel | null,
  atr: number,
): LevelConfirmation {
  if (!level) return { confirmed: false, failed: false, level: null };
  const recent = candles.slice(-4);
  const last = recent.at(-1);
  if (!last) return { confirmed: false, failed: false, level };
  if (level.kind === "support") {
    const previousBroke =
      (recent.at(-2)?.close ?? Number.POSITIVE_INFINITY) <
      level.zone_low - MARKET_STATE_CONSTANTS.levelFailureBufferAtr * atr;
    const failed =
      recent
        .slice(-2)
        .every(
          (candle) =>
            candle.close <
            level.zone_low - MARKET_STATE_CONSTANTS.levelFailureBufferAtr * atr,
        ) ||
      (previousBroke && last.close < level.zone_high);
    const tested = recent.some(
      (candle) =>
        candle.low <=
          level.zone_high + MARKET_STATE_CONSTANTS.levelTouchBufferAtr * atr &&
        candle.high >= level.zone_low,
    );
    const reclaimed = last.close >= level.zone_high;
    return {
      confirmed: tested && reclaimed && !failed,
      failed,
      level,
    };
  }
  const previousBroke =
    (recent.at(-2)?.close ?? Number.NEGATIVE_INFINITY) >
    level.zone_high + MARKET_STATE_CONSTANTS.levelFailureBufferAtr * atr;
  const failed =
    recent
      .slice(-2)
      .every(
        (candle) =>
          candle.close >
          level.zone_high + MARKET_STATE_CONSTANTS.levelFailureBufferAtr * atr,
      ) ||
    (previousBroke && last.close > level.zone_low);
  const tested = recent.some(
    (candle) =>
      candle.high >=
        level.zone_low - MARKET_STATE_CONSTANTS.levelTouchBufferAtr * atr &&
      candle.low <= level.zone_high,
  );
  const rejected = last.close <= level.zone_low;
  return {
    confirmed: tested && rejected && !failed,
    failed,
    level,
  };
}

function detectExhaustion(candles: NumericCandle[], atrSeries: number[]) {
  const window = candles.slice(-MARKET_STATE_CONSTANTS.exhaustionLookback);
  if (window.length < MARKET_STATE_CONSTANTS.exhaustionLookback) {
    return {
      up: false,
      down: false,
      upScore: 0,
      downScore: 0,
      upEvidence: [] as MarketStateEvidence[],
      downEvidence: [] as MarketStateEvidence[],
    };
  }
  const atr = Math.max(atrSeries.at(-1) ?? 0, Number.EPSILON);
  const move = ((window.at(-1)?.close ?? 0) - (window[0]?.close ?? 0)) / atr;
  const ema20 = calculateSeededEma(
    candles.map((candle) => candle.close),
    20,
  ).at(-1);
  const last = window.at(-1);
  const groups = [window.slice(0, 4), window.slice(4, 8), window.slice(8, 12)];
  const highs = groups.map((group) =>
    Math.max(...group.map((candle) => candle.high)),
  );
  const lows = groups.map((group) =>
    Math.min(...group.map((candle) => candle.low)),
  );
  const upProgressOne = (highs[1] ?? 0) - (highs[0] ?? 0);
  const upProgressTwo = (highs[2] ?? 0) - (highs[1] ?? 0);
  const downProgressOne = (lows[0] ?? 0) - (lows[1] ?? 0);
  const downProgressTwo = (lows[1] ?? 0) - (lows[2] ?? 0);
  const repeatedHighs = upProgressOne > 0 && upProgressTwo > 0;
  const repeatedLows = downProgressOne > 0 && downProgressTwo > 0;
  const upProgressFaded = repeatedHighs && upProgressTwo <= upProgressOne * 0.7;
  const downProgressFaded =
    repeatedLows && downProgressTwo <= downProgressOne * 0.7;
  const recent = window.slice(-3);
  const upperWick =
    mean(
      recent.map((candle) => candle.high - Math.max(candle.open, candle.close)),
    ) / atr;
  const lowerWick =
    mean(
      recent.map((candle) => Math.min(candle.open, candle.close) - candle.low),
    ) / atr;
  const prior = window.slice(0, -1);
  const failedUpBreak =
    Boolean(last) &&
    last!.high > Math.max(...prior.map((candle) => candle.high)) &&
    last!.close <= Math.max(...prior.map((candle) => candle.high));
  const failedDownBreak =
    Boolean(last) &&
    last!.low < Math.min(...prior.map((candle) => candle.low)) &&
    last!.close >= Math.min(...prior.map((candle) => candle.low));
  const emaDistance =
    last && ema20 !== null && ema20 !== undefined
      ? Math.abs(last.close - ema20) / atr
      : 0;
  const upScore =
    (move >= MARKET_STATE_CONSTANTS.exhaustionMoveAtr ? 0.3 : 0) +
    (emaDistance >= MARKET_STATE_CONSTANTS.exhaustionEmaDistanceAtr &&
    last &&
    ema20 !== null &&
    ema20 !== undefined &&
    last.close > ema20
      ? 0.2
      : 0) +
    (repeatedHighs ? 0.15 : 0) +
    (upProgressFaded ? 0.2 : 0) +
    (upperWick >= 0.25 ? 0.1 : 0) +
    (failedUpBreak ? 0.05 : 0);
  const downScore =
    (move <= -MARKET_STATE_CONSTANTS.exhaustionMoveAtr ? 0.3 : 0) +
    (emaDistance >= MARKET_STATE_CONSTANTS.exhaustionEmaDistanceAtr &&
    last &&
    ema20 !== null &&
    ema20 !== undefined &&
    last.close < ema20
      ? 0.2
      : 0) +
    (repeatedLows ? 0.15 : 0) +
    (downProgressFaded ? 0.2 : 0) +
    (lowerWick >= 0.25 ? 0.1 : 0) +
    (failedDownBreak ? 0.05 : 0);
  const upEvidence: MarketStateEvidence[] = [];
  const downEvidence: MarketStateEvidence[] = [];
  if (emaDistance >= MARKET_STATE_CONSTANTS.exhaustionEmaDistanceAtr) {
    upEvidence.push({
      code: "extension_from_ema",
      direction: "up",
      value: emaDistance,
    });
    downEvidence.push({
      code: "extension_from_ema",
      direction: "down",
      value: emaDistance,
    });
  }
  if (upProgressFaded)
    upEvidence.push({ code: "swing_progress_faded", direction: "up" });
  if (downProgressFaded)
    downEvidence.push({ code: "swing_progress_faded", direction: "down" });
  if (upperWick >= 0.25 || failedUpBreak)
    upEvidence.push({
      code: "wick_rejection",
      direction: "down",
      value: upperWick,
    });
  if (lowerWick >= 0.25 || failedDownBreak)
    downEvidence.push({
      code: "wick_rejection",
      direction: "up",
      value: lowerWick,
    });
  return {
    up:
      move >= MARKET_STATE_CONSTANTS.exhaustionMoveAtr &&
      (upProgressFaded ||
        failedUpBreak ||
        (upperWick >= 0.25 && upProgressTwo <= upProgressOne * 1.1)) &&
      upScore >= MARKET_STATE_CONSTANTS.exhaustionScoreMinimum,
    down:
      move <= -MARKET_STATE_CONSTANTS.exhaustionMoveAtr &&
      (downProgressFaded ||
        failedDownBreak ||
        (lowerWick >= 0.25 && downProgressTwo <= downProgressOne * 1.1)) &&
      downScore >= MARKET_STATE_CONSTANTS.exhaustionScoreMinimum,
    upScore,
    downScore,
    upEvidence,
    downEvidence,
  };
}

function determineNextWait(
  direction: MarketStateDirection,
  phase: MarketPhase,
  currentPrice: number,
  snapshot: TechnicalSnapshot,
  atr: number,
): MarketNextWait {
  if (direction === "neutral") {
    if (isNearLevel(currentPrice, snapshot.supports[0], atr))
      return "wait_support";
    if (isNearLevel(currentPrice, snapshot.resistances[0], atr))
      return "wait_resistance";
    return "wait_for_better_location";
  }
  switch (phase) {
    case "sharp_drop":
      return "wait_bottoming";
    case "sharp_rise":
      return "wait_topping";
    case "bottoming":
    case "topping":
    case "reversal_attempt_up":
    case "reversal_attempt_down":
      return "wait_reversal_confirmation";
    case "reversal_confirmed_up":
      return "wait_pullback";
    case "reversal_confirmed_down":
      return "wait_rebound";
    case "pullback":
      return "wait_support";
    case "rebound":
      return "wait_resistance";
    case "up_exhaustion":
      return "wait_pullback";
    case "down_exhaustion":
      return "wait_rebound";
    case "support_confirmed":
    case "resistance_confirmed":
      return "wait_for_better_location";
    case "slow_rise":
      return direction === "bullish" ? "wait_pullback" : "wait_exhaustion";
    case "slow_decline":
      return direction === "bearish" ? "wait_rebound" : "wait_exhaustion";
  }
}

function isEntryWindowCandidate(
  direction: MarketStateDirection,
  phase: MarketPhase,
  currentPrice: number,
  level: StructuralLevel | null,
  atr: number,
): boolean {
  if (!level) return false;
  const directionMatches =
    (direction === "bullish" && phase === "support_confirmed") ||
    (direction === "bearish" && phase === "resistance_confirmed");
  if (!directionMatches) return false;
  const edge = level.kind === "support" ? level.zone_high : level.zone_low;
  return (
    Math.abs(currentPrice - edge) / atr <=
    MARKET_STATE_CONSTANTS.entryMaximumExtensionAtr
  );
}

function levelPhase(
  phase: "support_confirmed" | "resistance_confirmed",
  level: StructuralLevel,
  confidence: number,
): PhaseResult {
  const direction = phase === "support_confirmed" ? "up" : "down";
  return {
    phase,
    confidence,
    referenceLevel: level,
    evidence: [
      { code: "level_tested", level_label: level.label },
      {
        code:
          phase === "support_confirmed" ? "level_reclaimed" : "level_rejected",
        direction,
        level_label: level.label,
      },
    ],
  };
}

function movementPhase(
  phase: "sharp_drop" | "sharp_rise",
  move: number,
  rangeRatio: number,
  confidence: number,
): PhaseResult {
  const direction = phase === "sharp_rise" ? "up" : "down";
  return {
    phase,
    confidence,
    referenceLevel: null,
    evidence: [
      {
        code: "net_move_atr",
        direction,
        value: Math.abs(move),
        candles: MARKET_STATE_CONSTANTS.shortWindow,
      },
      { code: "range_expansion", direction, value: rangeRatio },
    ],
  };
}

function slowPhase(
  phase: "slow_decline" | "slow_rise",
  move: number,
  progress: number,
): PhaseResult {
  const direction = phase === "slow_rise" ? "up" : "down";
  return {
    phase,
    confidence: 64,
    referenceLevel: null,
    evidence: [
      {
        code: "net_move_atr",
        direction,
        value: Math.abs(move),
        candles: MARKET_STATE_CONSTANTS.slowWindow,
      },
      { code: "directional_progress", direction, value: progress },
    ],
  };
}

function directionalProgress(candles: NumericCandle[]): {
  up: number;
  down: number;
} {
  if (candles.length < 2) return { up: 0, down: 0 };
  let up = 0;
  let down = 0;
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index]!;
    const previous = candles[index - 1]!;
    if (current.close > previous.close) up += 1;
    if (current.close < previous.close) down += 1;
  }
  const comparisons = candles.length - 1;
  return { up: up / comparisons, down: down / comparisons };
}

function moveAtr(
  candles: NumericCandle[],
  window: number,
  atr: number,
): number {
  if (candles.length <= window) return 0;
  return (
    ((candles.at(-1)?.close ?? 0) - (candles.at(-(window + 1))?.close ?? 0)) /
    atr
  );
}

function recentTrueRanges(candles: NumericCandle[], window: number): number[] {
  const start = Math.max(0, candles.length - window);
  return candles.slice(start).map((candle, offset) => {
    const index = start + offset;
    const previousClose = candles[index - 1]?.close;
    return previousClose === undefined
      ? candle.high - candle.low
      : Math.max(
          candle.high - candle.low,
          Math.abs(candle.high - previousClose),
          Math.abs(candle.low - previousClose),
        );
  });
}

function nearestLevel(
  currentPrice: number,
  snapshot: TechnicalSnapshot,
): StructuralLevel | null {
  return (
    [...snapshot.supports, ...snapshot.resistances].sort(
      (left, right) =>
        Math.abs(left.representative_price - currentPrice) -
        Math.abs(right.representative_price - currentPrice),
    )[0] ?? null
  );
}

function isNearLevel(
  currentPrice: number,
  level: StructuralLevel | undefined,
  atr: number,
): boolean {
  if (!level) return false;
  const distance =
    currentPrice < level.zone_low
      ? level.zone_low - currentPrice
      : currentPrice > level.zone_high
        ? currentPrice - level.zone_high
        : 0;
  return distance / atr <= MARKET_STATE_CONSTANTS.levelNearDistanceAtr;
}

function toReferenceLevel(
  level: StructuralLevel | null,
): MarketStateReferenceLevel | null {
  return level
    ? {
        level_label: level.label,
        kind: level.kind,
        zone_low: level.zone_low,
        zone_high: level.zone_high,
      }
    : null;
}

function normalizeDirection(
  direction: TechnicalSnapshot["trend"]["direction"],
): MarketStateDirection {
  return direction === "unavailable" ? "neutral" : direction;
}

function isMarkerPhase(phase: MarketPhase): phase is MarketStateMarkerPhase {
  return MARKER_PHASES.has(phase as MarketStateMarkerPhase);
}

function markerPosition(
  phase: MarketStateMarkerPhase,
): MarketStateMarker["position"] {
  return [
    "sharp_drop",
    "topping",
    "reversal_confirmed_down",
    "resistance_confirmed",
    "up_exhaustion",
  ].includes(phase)
    ? "aboveBar"
    : "belowBar";
}

function markerRank(
  marker: MarketStateMarker & { sequence: number },
  candleCount: number,
): number {
  return (
    marker.confidence +
    MARKER_PRIORITY[marker.phase] * 6 +
    (marker.sequence / Math.max(candleCount, 1)) * 10
  );
}

function confidenceFromScore(score: number): number {
  return Math.round(clamp(55 + score * 40, 0, 100));
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
