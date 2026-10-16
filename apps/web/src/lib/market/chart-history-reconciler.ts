import type { MarketInterval } from "@alpha-radar/types/market-data";
import type {
  ChartContextEntry,
  ChartContextStore,
} from "./chart-context-store.ts";
import type { ChartRefreshHealth } from "./chart-refresh-health.ts";

export const HISTORY_RETRY_DELAYS_MS = [2000, 5000, 10000, 30000] as const;

interface RetryTimers {
  schedule: (run: () => void, delay: number) => number;
  cancel: (id: number) => void;
}
type Update = (
  entry: ChartContextEntry | undefined,
  health: ChartRefreshHealth,
) => void;

/** Per-selected-identity REST lifecycle; deliberately owns no chart or socket. */
export class ChartHistoryReconciler {
  private disposed = false;
  private attempt = 0;
  private timer: number | null = null;
  private inFlight: Promise<void> | null = null;
  private store: ChartContextStore;
  private instrumentId: string;
  private interval: MarketInterval;
  private update: Update;
  private timers: RetryTimers;

  constructor(
    store: ChartContextStore,
    instrumentId: string,
    interval: MarketInterval,
    update: Update,
    timers: RetryTimers = {
      schedule: (run, delay) => window.setTimeout(run, delay),
      cancel: (id) => window.clearTimeout(id),
    },
  ) {
    this.store = store;
    this.instrumentId = instrumentId;
    this.interval = interval;
    this.update = update;
    this.timers = timers;
  }

  private publish = () => {
    if (this.disposed) return;
    const health = this.store.refreshHealth(this.instrumentId, this.interval);
    this.update(this.store.context(this.instrumentId, this.interval), health);
  };

  private cancelRetry() {
    if (this.timer !== null) this.timers.cancel(this.timer);
    this.timer = null;
  }

  private settle() {
    if (this.disposed) return;
    this.cancelRetry();
    if (
      this.store.refreshHealth(this.instrumentId, this.interval) === "healthy"
    ) {
      this.attempt = 0;
      return;
    }
    const delay =
      HISTORY_RETRY_DELAYS_MS[
        Math.min(this.attempt++, HISTORY_RETRY_DELAYS_MS.length - 1)
      ]!;
    this.timer = this.timers.schedule(() => {
      this.timer = null;
      void this.refresh();
    }, delay);
  }

  refresh(manual = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (manual) this.attempt = 0;
    this.cancelRetry();
    if (this.inFlight) return this.inFlight;
    const task = this.store
      .load(this.instrumentId, this.interval, this.publish)
      .then(this.publish, this.publish)
      .finally(() => {
        this.inFlight = null;
        this.settle();
      });
    this.inFlight = task;
    return task;
  }

  /** Stream closes publish immediately, even while REST is blocked/failing. */
  confirmed() {
    if (this.disposed) return;
    this.publish();
    if (!this.inFlight && this.timer === null) this.settle();
    else if (
      this.store.refreshHealth(this.instrumentId, this.interval) === "healthy"
    ) {
      this.cancelRetry();
      this.attempt = 0;
    }
  }

  dispose() {
    this.disposed = true;
    this.cancelRetry();
  }
}
