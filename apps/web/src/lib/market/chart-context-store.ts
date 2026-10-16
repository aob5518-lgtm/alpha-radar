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
import {
  logHistoryRefresh,
  type ChartRefreshHealth,
  type HistoryRefreshDiagnostic,
  type HistoryRole,
} from "./chart-refresh-health.ts";

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
  role?: HistoryRole,
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
  private failures = new Map<string, HistoryRefreshDiagnostic>();
  private reportedHealth = new Map<string, ChartRefreshHealth>();

  private loader: HistoryLoader;
  private now: () => number;
  private diagnostic: (event: HistoryRefreshDiagnostic) => void;
  constructor(
    loader: HistoryLoader,
    now: () => number = Date.now,
    diagnostic: (event: HistoryRefreshDiagnostic) => void = logHistoryRefresh,
  ) {
    this.loader = loader;
    this.now = now;
    this.diagnostic = diagnostic;
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
    return `${this.peek(instrumentId, interval)?.revision ?? 0}:${higher && this.isCurrent(instrumentId, higher) ? (this.peek(instrumentId, higher)?.revision ?? 0) : 0}`;
  }

  /** A stale confirmed cache is usable, but never across identities or with stale HTF evidence. */
  cachedContext(
    instrumentId: string,
    interval: MarketInterval,
  ): ChartContextEntry | undefined {
    const entry = this.peek(instrumentId, interval);
    return entry?.snapshot && entry.history.items.length > 0
      ? this.context(instrumentId, interval)
      : undefined;
  }

  refreshHealth(
    instrumentId: string,
    interval: MarketInterval,
  ): ChartRefreshHealth {
    if (!this.peek(instrumentId, interval)?.history.items.length)
      return "failed";
    const higher = higherMarketInterval[interval];
    return this.isCurrent(instrumentId, interval) &&
      (!higher || this.isCurrent(instrumentId, higher))
      ? "healthy"
      : "degraded";
  }

  private reportHealth(instrumentId: string, interval: MarketInterval): void {
    const key = chartIdentityKey(instrumentId, interval);
    const health = this.refreshHealth(instrumentId, interval);
    const previous = this.reportedHealth.get(key);
    this.reportedHealth.set(key, health);
    if (health !== "degraded" || previous === health) return;
    const higher = higherMarketInterval[interval];
    const role: HistoryRole = this.isCurrent(instrumentId, interval)
      ? "higher"
      : "primary";
    const source = role === "higher" && higher ? higher : interval;
    const failure = this.failures.get(chartIdentityKey(instrumentId, source));
    this.diagnostic({
      event: "chart_context_degraded",
      market_instrument_id: instrumentId,
      timeframe: interval,
      role,
      incremental: !!this.peek(instrumentId, source)?.history.items.length,
      elapsed_ms: failure?.elapsed_ms ?? 0,
      error_type: failure?.error_type ?? "HistoryNotCurrent",
    });
  }

  private async fetchHistory(
    instrumentId: string,
    interval: MarketInterval,
    role: HistoryRole,
  ): Promise<void> {
    if (this.isCurrent(instrumentId, interval)) return;
    const key = chartIdentityKey(instrumentId, interval);
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const task = (async () => {
      const requestEntry = this.peek(instrumentId, interval);
      const requestRevision = requestEntry?.revision;
      const start = performance.now();
      const incremental = !!requestEntry?.history.items.length;
      try {
        const history = await this.loader(
          instrumentId,
          interval,
          requestEntry?.history.items.at(-1)?.open_time,
          role,
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
            confirmedSignature(items) !==
            confirmedSignature(prior.history.items)
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
        if (this.isCurrent(instrumentId, interval) && this.failures.has(key)) {
          this.diagnostic({
            event: "chart_history_refresh_recovered",
            market_instrument_id: instrumentId,
            timeframe: interval,
            role,
            incremental,
            elapsed_ms: performance.now() - start,
            error_type: "None",
          });
          this.failures.delete(key);
        }
        if (process.env.NODE_ENV === "development")
          console.info(
            JSON.stringify({
              event: "chart_history_fetch",
              market_instrument_id: instrumentId,
              timeframe: interval,
              history_fetch_ms: historyFetchMs,
              incremental,
            }),
          );
      } catch (error) {
        const failure: HistoryRefreshDiagnostic = {
          event: "chart_history_refresh_failed",
          market_instrument_id: instrumentId,
          timeframe: interval,
          role,
          incremental,
          elapsed_ms: performance.now() - start,
          error_type: error instanceof Error ? error.name : "UnknownError",
        };
        this.failures.set(key, failure);
        this.diagnostic(failure);
        throw error;
      }
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
    onUpdate?: (entry: ChartContextEntry) => void,
  ): Promise<ChartContextEntry> {
    const higher = higherMarketInterval[interval];
    // Start both independently. Catch higher failure immediately; it cannot reject
    // the primary path, and primary data is published before a slow higher request.
    const primaryRefresh = this.fetchHistory(instrumentId, interval, "primary");
    const higherRefresh = higher
      ? this.fetchHistory(instrumentId, higher, "higher").catch(() => {})
      : Promise.resolve();
    try {
      await primaryRefresh;
    } catch (error) {
      if (!this.peek(instrumentId, interval)?.history.items.length) throw error;
    }
    if (!this.peek(instrumentId, interval)?.history.items.length)
      throw new Error("No usable confirmed primary history");
    const publish = () => {
      const entry = this.context(instrumentId, interval)!;
      this.reportHealth(instrumentId, interval);
      onUpdate?.(entry);
      return entry;
    };
    publish();
    await higherRefresh;
    return publish();
  }

  context(
    instrumentId: string,
    interval: MarketInterval,
  ): ChartContextEntry | undefined {
    const entry = this.peek(instrumentId, interval);
    if (!entry) return undefined;
    const higher = higherMarketInterval[interval];
    const higherEntry =
      higher && this.isCurrent(instrumentId, higher)
        ? this.peek(instrumentId, higher)
        : undefined;
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
      entry.calculatedRevision =
        !higher || this.isCurrent(instrumentId, higher)
          ? this.contextRevision(instrumentId, interval)
          : "";
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
    const sourceKey = chartIdentityKey(instrumentId, interval);
    const failure = this.failures.get(sourceKey);
    if (failure && this.isCurrent(instrumentId, interval)) {
      this.diagnostic({
        ...failure,
        event: "chart_history_refresh_recovered",
        elapsed_ms: 0,
        error_type: "ConfirmedStreamRecovery",
      });
      this.failures.delete(sourceKey);
    }
    return true;
  }
}

export async function fetchChartHistory(
  instrumentId: string,
  interval: MarketInterval,
  start?: string,
  role: HistoryRole = "primary",
): Promise<MarketHistory> {
  const params = new URLSearchParams({
    interval,
    limit: String(MARKET_STATE_CONSTANTS.calculationWindow),
  });
  params.set("role", role);
  if (start) {
    params.set("start", start);
    // The canonical API requires an explicit upper bound for incremental reads.
    params.set("end", new Date().toISOString());
  }
  const response = await fetch(
    `/api/v1/market-instruments/${encodeURIComponent(instrumentId)}/history?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const timedOut =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "code" in body.error &&
      body.error.code === "history_timeout";
    const error = new Error("Confirmed history unavailable");
    error.name = timedOut ? "HistoryTimeout" : `HistoryHTTP${response.status}`;
    throw error;
  }
  const history = (await response.json()) as MarketHistory;
  validateHistory(history, instrumentId, interval);
  return history;
}
