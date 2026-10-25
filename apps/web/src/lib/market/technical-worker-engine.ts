import { calculateTechnicalContext } from "./technical-context.ts";
import { calculateTradeSetup } from "./trade-setup.ts";
import {
  prepareMarketReplay,
  replayFingerprint,
  type MarketStateReplayState,
} from "./market-state.ts";
import { createTechnicalTimings } from "./technical-diagnostics.ts";
import type {
  TechnicalRequest,
  TechnicalResult,
} from "./technical-worker-protocol.ts";

interface ReplayCache {
  current?: MarketStateReplayState;
  nextOrigin?: MarketStateReplayState;
}
/** Worker-local deterministic state. No network, clocks in algorithms, or persistence. */
export class TechnicalWorkerEngine {
  private cache = new Map<string, ReplayCache>();
  compute(input: TechnicalRequest): TechnicalResult {
    const key = `${input.market_instrument_id}:${input.timeframe}`;
    const prior = this.cache.get(key);
    let previous = prior?.current;
    if (
      prior?.nextOrigin &&
      replayFingerprint(prior.nextOrigin.source) ===
        replayFingerprint(
          input.candles.slice(0, prior.nextOrigin.source.length),
        )
    )
      previous = prior.nextOrigin;
    let replay: MarketStateReplayState | undefined,
      incremental = false;
    let timings = createTechnicalTimings();
    const started = performance.now();
    const snapshot = calculateTechnicalContext(
      input.candles,
      input.confirmedClose,
      input.timeframe,
      input.higherCandles,
      input.market_instrument_id,
      (value) => {
        timings = value;
      },
      {
        previous,
        accept: (state, reused) => {
          replay = state;
          incremental = reused;
        },
      },
    );
    const setup = calculateTradeSetup(
      snapshot,
      input.market_instrument_id,
      input.timeframe,
    );
    this.cache.delete(key);
    this.cache.set(key, { current: replay });
    while (this.cache.size > 16)
      this.cache.delete(this.cache.keys().next().value!);
    return {
      market_instrument_id: input.market_instrument_id,
      timeframe: input.timeframe,
      generation: input.generation,
      revision: input.revision,
      ok: true,
      snapshot,
      setup,
      incremental,
      timings: {
        ...timings,
        worker_compute_ms: performance.now() - started,
        incremental_update_ms: incremental ? performance.now() - started : 0,
      },
    };
  }
  /** Seed changes at the 800-bar boundary are semantic. Prepare the next origin
   * AFTER publishing, so a normal later close advances only one prefix exactly. */
  prewarm(input: TechnicalRequest) {
    const key = `${input.market_instrument_id}:${input.timeframe}`,
      entry = this.cache.get(key);
    if (
      input.candles.length !== 800 ||
      !entry?.current ||
      replayFingerprint(entry.current.source) !==
        replayFingerprint(input.candles)
    )
      return;
    entry.nextOrigin = prepareMarketReplay(
      input.candles.slice(1),
      input.timeframe,
    ).replay;
  }
}
