import type { MarketInterval } from "@alpha-radar/types/market-data";
import type { NumericCandle } from "./technical-levels.ts";
import { intervalSeconds } from "./intervals.ts";

export interface RetestEpisode {
  started_at: string;
  started_open: string;
  direction: number;
  touches: Array<{ time: string; extreme: number }>;
  consumed: boolean;
}
export interface RetestMemory {
  id: string;
  interval: MarketInterval;
  settings: string;
  last_open: string;
  direction: number;
  before_direction: number | null;
  cold_start: boolean;
  before: RetestEpisode | null;
  after: RetestEpisode | null;
  source: Array<{ time: string; value: string }>;
}
export interface RetestInput {
  id: string;
  interval: MarketInterval;
  settings: string;
  candles: NumericCandle[];
  direction: number;
  low: number;
  high: number;
  atr: number;
  impulse: number;
  touching: boolean;
  previousTouching: boolean;
  conflicting: boolean;
  chop: boolean;
  extended: boolean;
  maximumAge: number;
  invalidationAtr: number;
}
const copy = (e: RetestEpisode | null): RetestEpisode | null =>
  e ? { ...e, touches: e.touches.map((t) => ({ ...t })) } : null;
const signature = (c: NumericCandle) =>
  [
    c.openTime,
    c.closeTime,
    c.open,
    c.high,
    c.low,
    c.close,
    c.volume,
    c.isClosed,
  ].join(":");

/** Advance ONE accepted confirmed context. No clock, browser state, engine replay,
 * back-search for arbitrary touches, or mutable global cursor. Cold starts can
 * observe a new current touch, but cannot invent an earlier accepted episode. */
export function advanceRetest(input: RetestInput, previous?: RetestMemory) {
  if (!input.candles.length || input.candles.some((c) => !c.isClosed))
    throw new Error("Retest requires confirmed candles");
  const { candles, direction } = input,
    last = candles.at(-1)!,
    prior = candles.at(-2);
  const source = candles.map((c) => ({
    time: c.openTime,
    value: signature(c),
  }));
  const current = new Map(source.map((c) => [c.time, c.value]));
  const same =
    previous?.id === input.id &&
    previous.interval === input.interval &&
    previous.settings === input.settings;
  const sameBar = same && previous.last_open === last.openTime;
  const adjacent =
    same &&
    previous.last_open === prior?.openTime &&
    Date.parse(last.openTime) - Date.parse(prior.openTime) ===
      intervalSeconds[input.interval] * 1000;
  const unchanged =
    same &&
    previous.source.every(
      (c) =>
        (sameBar && c.time === last.openTime) ||
        !current.has(c.time) ||
        current.get(c.time) === c.value,
    );
  const accepted = !!(unchanged && (sameBar || adjacent));
  const before = accepted
    ? copy(sameBar ? previous!.before : previous!.after)
    : null;
  const memory: RetestMemory = {
    id: input.id,
    interval: input.interval,
    settings: input.settings,
    last_open: last.openTime,
    direction,
    before_direction: accepted
      ? sameBar
        ? previous!.before_direction
        : previous!.direction
      : null,
    cold_start: accepted && sameBar ? previous!.cold_start : !accepted,
    before: copy(before),
    after: null,
    source,
  };
  let episode = copy(before),
    failed = false;
  let age = episode
    ? candles.findIndex((c) => c.openTime === episode!.started_open)
    : -1;
  age = age < 0 ? -1 : candles.length - 1 - age;
  if (
    episode &&
    (age < 0 ||
      age > input.maximumAge ||
      Date.parse(last.openTime) - Date.parse(episode.started_open) >
        input.maximumAge * intervalSeconds[input.interval] * 1000)
  )
    episode = null;
  const stop = (e: RetestEpisode | null) => {
    const values = e?.touches.map((t) => t.extreme) ?? [];
    return direction === 1
      ? Math.min(input.low, ...values) - input.invalidationAtr * input.atr
      : Math.max(input.high, ...values) + input.invalidationAtr * input.atr;
  };
  // Failure is tested BEFORE admitting the current candle's new extreme/retest.
  if (
    episode &&
    direction !== 0 &&
    episode.direction === direction &&
    direction * (last.close - stop(episode)) <= 0
  )
    failed = true;
  const cancelled =
    failed ||
    !direction ||
    input.conflicting ||
    input.chop ||
    input.extended ||
    (memory.before_direction !== null &&
      memory.before_direction !== direction) ||
    !!(episode && episode.direction !== direction);
  if (cancelled)
    return {
      memory,
      episode: null,
      active: false,
      age: null,
      extreme: null,
      failed,
    };
  // Contiguous touches do not refresh the clock; a departed/re-entered range is
  // a separate interaction, still subject to unchanged touch/chop limits.
  const initialSameBar = sameBar && memory.cold_start;
  if (
    input.touching &&
    input.impulse >= 0 &&
    (!accepted || initialSameBar || !input.previousTouching)
  ) {
    episode = {
      started_at: last.closeTime,
      started_open: last.openTime,
      direction,
      touches: [],
      consumed: false,
    };
    age = 0;
  }
  if (episode && input.touching && !episode.consumed)
    episode.touches.push({
      time: last.openTime,
      extreme: direction === 1 ? last.low : last.high,
    });
  if (
    episode &&
    direction *
      (last.close -
        stop(
          before && episode.started_open === before.started_open
            ? before
            : null,
        )) <=
      0
  )
    return {
      memory,
      episode: null,
      active: false,
      age: null,
      extreme: null,
      failed: true,
    };
  memory.after = episode;
  return {
    memory,
    episode,
    active:
      !!episode && !episode.consumed && age >= 0 && age <= input.maximumAge,
    age: episode ? age : null,
    extreme: episode
      ? direction === 1
        ? Math.min(...episode.touches.map((t) => t.extreme))
        : Math.max(...episode.touches.map((t) => t.extreme))
      : null,
    failed,
  };
}
