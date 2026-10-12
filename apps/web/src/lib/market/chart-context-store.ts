import type { TradeSetupCandidateV1 } from "@alpha-radar/types/core-3";
import type {
  MarketCandle,
  MarketHistory,
  MarketInterval,
} from "@alpha-radar/types/market-data";

import { higherMarketInterval } from "./intervals.ts";
import { bucketStart } from "./live-candle.ts";
import { MARKET_STATE_CONSTANTS } from "./market-state.ts";
import {
  calculateTechnicalContext,
  type TechnicalContextSnapshot,
} from "./technical-context.ts";
import { logTechnicalDiagnostics } from "./technical-diagnostics.ts";
import { calculateTradeSetup } from "./trade-setup.ts";

export const chartIdentityKey = (
  instrumentId: string,
  interval: MarketInterval,
) => `${instrumentId}:${interval}`;

export interface ChartContextEntry {
  history: MarketHistory;
  snapshot: TechnicalContextSnapshot | null;
  setup: TradeSetupCandidateV1 | null;
  revision: number;
  calculatedRevision: string;
}

export type HistoryLoader = (
  instrumentId: string,
  interval: MarketInterval,
  start?: string,
) => Promise<MarketHistory>;

export interface StreamCandle {
  type: "candle";
  provider: string;
  provider_instrument_id: string;
  interval: MarketInterval;
  open_time: string;
  close_time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
  quote_volume?: string | null;
  is_closed: boolean;
  provider_timestamp?: string | null;
}

export function projectConfirmedStreamCandle(
  value: StreamCandle,
  history: MarketHistory,
): MarketCandle | null {
  if (
    value.type !== "candle" ||
    value.is_closed !== true ||
    value.interval !== history.interval ||
    value.provider !== history.provider ||
    value.provider_instrument_id !== history.provider_instrument_id ||
    !Number.isFinite(Date.parse(value.open_time)) ||
    !Number.isFinite(Date.parse(value.close_time)) ||
    Date.parse(value.close_time) <= Date.parse(value.open_time)
  )
    return null;
  const prices = [value.open, value.high, value.low, value.close].map(Number);
  if (
    prices.some((p) => !Number.isFinite(p) || p <= 0) ||
    Number(value.high) < Math.max(Number(value.open), Number(value.close)) ||
    Number(value.low) > Math.min(Number(value.open), Number(value.close))
  )
    return null;
  return {
    ...value,
    market_instrument_id: history.market_instrument_id,
    quote_volume: value.quote_volume ?? null,
    provider_timestamp: value.provider_timestamp ?? null,
    // Client-only projection, NOT an assertion that this observation is persisted.
    ingested_at: "",
    quality_flags: ["client_stream_observation"],
  };
}

export function mergeConfirmedHistory(
  current: MarketCandle[],
  incoming: MarketCandle[],
  instrumentId: string,
  interval: MarketInterval,
): MarketCandle[] {
  const byTime = new Map<number, MarketCandle>();
  for (const candle of [...current, ...incoming]) {
    if (
      candle.is_closed === true &&
      candle.market_instrument_id === instrumentId &&
      candle.interval === interval &&
      Number.isFinite(Date.parse(candle.open_time))
    )
      byTime.set(Date.parse(candle.open_time), candle);
  }
  return [...byTime.values()]
    .sort((a, b) => Date.parse(a.open_time) - Date.parse(b.open_time))
    .slice(-MARKET_STATE_CONSTANTS.calculationWindow);
}

function confirmedSignature(candles: MarketCandle[]): string {
  return JSON.stringify(
    candles.map((c) => [
      c.open_time,
      c.close_time,
      c.open,
      c.high,
      c.low,
      c.close,
      c.volume,
      c.quote_volume,
    ]),
  );
}

export function validateHistory(
  history: MarketHistory,
  instrumentId: string,
  interval: MarketInterval,
): void {
  if (
    history.market_instrument_id !== instrumentId ||
    history.interval !== interval ||
    !Array.isArray(history.items) ||
    history.items.some(
      (c) =>
        c.market_instrument_id !== instrumentId ||
        c.interval !== interval ||
        !Number.isFinite(Date.parse(c.open_time)) ||
        !Number.isFinite(Date.parse(c.close_time)) ||
        [c.open, c.high, c.low, c.close].some(
          (p) => !Number.isFinite(Number(p)) || Number(p) <= 0,
        ),
    )
  ) {
    throw new Error("History identity or candle data mismatch");
  }
}

/** Per-workspace memory cache: no cross-instrument fallback and no live-price computations. */
export class ChartContextStore {
  private entries = new Map<string, ChartContextEntry>();
  private pending = new Map<string, Promise<void>>();

  private loader: HistoryLoader;
  private now: () => number;
  constructor(loader: HistoryLoader, now: () => number = Date.now) {
    this.loader = loader;
    this.now = now;
  }

  seed(
    history: MarketHistory,
    snapshot: TechnicalContextSnapshot | null = null,
  ): void {
    validateHistory(history, history.market_instrument_id, history.interval);
    const key = chartIdentityKey(
      history.market_instrument_id,
      history.interval,
    );
    const confirmed = mergeConfirmedHistory(
      [],
      history.items,
      history.market_instrument_id,
      history.interval,
    );
    this.entries.set(key, {
      history: { ...history, items: confirmed },
      snapshot,
      setup: snapshot
        ? calculateTradeSetup(
            snapshot,
            history.market_instrument_id,
            history.interval,
          )
        : null,
      revision: 1,
      calculatedRevision: snapshot ? "seed" : "",
    });
  }

  peek(
    instrumentId: string,
    interval: MarketInterval,
  ): ChartContextEntry | undefined {
    return this.entries.get(chartIdentityKey(instrumentId, interval));
  }

  isCurrent(instrumentId: string, interval: MarketInterval): boolean {
    const last = this.peek(instrumentId, interval)?.history.items.at(-1);
    return (
      !!last &&
      Date.parse(last.close_time) >=
        bucketStart(Math.floor(this.now() / 1000), interval) * 1000
    );
  }

  private contextRevision(
    instrumentId: string,
    interval: MarketInterval,
  ): string {
    const higher = higherMarketInterval[interval];
    return `${this.peek(instrumentId, interval)?.revision ?? 0}:${higher ? (this.peek(instrumentId, higher)?.revision ?? 0) : 0}`;
  }

  /** Read-only fast path. A history cached for confluence is not yet a computed chart. */
  cachedContext(
    instrumentId: string,
    interval: MarketInterval,
  ): ChartContextEntry | undefined {
    const entry = this.peek(instrumentId, interval);
    const higher = higherMarketInterval[interval];
    return entry?.snapshot &&
      this.isCurrent(instrumentId, interval) &&
      (!higher || this.isCurrent(instrumentId, higher)) &&
      entry.calculatedRevision === this.contextRevision(instrumentId, interval)
      ? entry
      : undefined;
  }

  private async fetchHistory(
    instrumentId: string,
    interval: MarketInterval,
  ): Promise<void> {
    if (this.isCurrent(instrumentId, interval)) return;
    const key = chartIdentityKey(instrumentId, interval);
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const task = (async () => {
      const requestEntry = this.peek(instrumentId, interval);
      const requestRevision = requestEntry?.revision;
      const start = performance.now();
      const history = await this.loader(
        instrumentId,
        interval,
        requestEntry?.history.items.at(-1)?.open_time,
      );
      const historyFetchMs = performance.now() - start;
      validateHistory(history, instrumentId, interval);
      const prior = this.peek(instrumentId, interval);
      const streamedDuringFetch = prior && prior.revision !== requestRevision;
      const items = mergeConfirmedHistory(
        streamedDuringFetch ? history.items : (prior?.history.items ?? []),
        streamedDuringFetch ? prior.history.items : history.items,
        instrumentId,
        interval,
      );
      if (prior) {
        if (
          confirmedSignature(items) !== confirmedSignature(prior.history.items)
        )
          prior.revision++;
        const dropped =
          prior.history.items[0] &&
          items[0] &&
          Date.parse(items[0].open_time) >
            Date.parse(prior.history.items[0].open_time);
        prior.history = {
          ...prior.history,
          items,
          next_end: items[0]?.open_time ?? null,
          has_more:
            prior.history.has_more || history.has_more || Boolean(dropped),
        };
      } else this.seed({ ...history, items });
      if (process.env.NODE_ENV === "development")
        console.info(
          JSON.stringify({
            event: "chart_history_fetch",
            market_instrument_id: instrumentId,
            timeframe: interval,
            history_fetch_ms: historyFetchMs,
            incremental: !!prior,
          }),
        );
    })();
    this.pending.set(key, task);
    try {
      await task;
    } finally {
      this.pending.delete(key);
    }
  }

  async load(
    instrumentId: string,
    interval: MarketInterval,
  ): Promise<ChartContextEntry> {
    const higher = higherMarketInterval[interval];
    await Promise.all([
      this.fetchHistory(instrumentId, interval),
      higher ? this.fetchHistory(instrumentId, higher) : Promise.resolve(),
    ]);
    return this.context(instrumentId, interval)!;
  }

  context(
    instrumentId: string,
    interval: MarketInterval,
  ): ChartContextEntry | undefined {
    const entry = this.peek(instrumentId, interval);
    if (!entry) return undefined;
    const higher = higherMarketInterval[interval];
    const higherEntry = higher ? this.peek(instrumentId, higher) : undefined;
    const revision = this.contextRevision(instrumentId, interval);
    if (entry.calculatedRevision !== revision) {
      const close = Number(entry.history.items.at(-1)?.close ?? 0);
      entry.snapshot = calculateTechnicalContext(
        entry.history.items,
        close,
        interval,
        higherEntry?.history.items,
        instrumentId,
        process.env.NODE_ENV === "development"
          ? (timings) =>
              logTechnicalDiagnostics(instrumentId, interval, timings)
          : undefined,
      );
      entry.setup = calculateTradeSetup(entry.snapshot, instrumentId, interval);
      entry.calculatedRevision = revision;
    }
    return entry;
  }

  /** Call after BOTH SSR histories have been seeded, retaining the exact SSR snapshot. */
  sealSeed(instrumentId: string, interval: MarketInterval): void {
    const entry = this.peek(instrumentId, interval);
    const higher = higherMarketInterval[interval];
    if (entry?.snapshot)
      entry.calculatedRevision = `${entry.revision}:${higher ? (this.peek(instrumentId, higher)?.revision ?? 0) : 0}`;
  }

  confirm(
    instrumentId: string,
    interval: MarketInterval,
    value: StreamCandle,
  ): boolean {
    let entry = this.peek(instrumentId, interval);
    if (!entry) {
      // A higher stream can close while its first REST page is still in flight.
      // Reuse only proven metadata for this exact instrument; never invent bars.
      const sameInstrument = [...this.entries.values()].find(
        (candidate) => candidate.history.market_instrument_id === instrumentId,
      );
      if (
        !sameInstrument ||
        !projectConfirmedStreamCandle(value, {
          ...sameInstrument.history,
          interval,
        })
      )
        return false;
      this.seed({
        ...sameInstrument.history,
        interval,
        items: [],
        next_end: null,
        has_more: false,
      });
      entry = this.peek(instrumentId, interval)!;
    }
    const candle = projectConfirmedStreamCandle(value, entry.history);
    if (!candle) return false;
    const items = mergeConfirmedHistory(
      entry.history.items,
      [candle],
      instrumentId,
      interval,
    );
    if (confirmedSignature(items) === confirmedSignature(entry.history.items))
      return false;
    const dropped =
      entry.history.items[0] &&
      items[0] &&
      Date.parse(items[0].open_time) >
        Date.parse(entry.history.items[0].open_time);
    entry.history = {
      ...entry.history,
      items,
      next_end: items[0]?.open_time ?? null,
      has_more: entry.history.has_more || Boolean(dropped),
    };
    entry.revision++;
    return true;
  }
}

export async function fetchChartHistory(
  instrumentId: string,
  interval: MarketInterval,
  start?: string,
): Promise<MarketHistory> {
  const params = new URLSearchParams({
    interval,
    limit: String(MARKET_STATE_CONSTANTS.calculationWindow),
  });
  if (start) {
    params.set("start", start);
    // The canonical API requires an explicit upper bound for incremental reads.
    params.set("end", new Date().toISOString());
  }
  const response = await fetch(
    `/api/v1/market-instruments/${encodeURIComponent(instrumentId)}/history?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`History unavailable (${response.status})`);
  const history = (await response.json()) as MarketHistory;
  validateHistory(history, instrumentId, interval);
  return history;
}
