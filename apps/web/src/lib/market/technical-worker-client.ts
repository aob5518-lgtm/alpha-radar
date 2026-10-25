import type { MarketInterval } from "@alpha-radar/types/market-data";
import type {
  TechnicalComputer,
  TechnicalRequest,
  TechnicalResult,
} from "./technical-worker-protocol.ts";

interface WorkerPort {
  postMessage(input: TechnicalRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<TechnicalResult>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}
type Task = {
  input: TechnicalRequest;
  complete: (result: TechnicalResult) => void;
  queued: number;
};
export class TechnicalWorkerClient implements TechnicalComputer {
  private worker: WorkerPort | null = null;
  private selected = "";
  private generation = 0;
  private active: Task | null = null;
  private pending: Task | null = null;
  private restarts = 0;
  private disposed = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private factory: () => WorkerPort;
  constructor(factory: () => WorkerPort) {
    this.factory = factory;
  }
  select(id: string, interval: MarketInterval) {
    const key = `${id}:${interval}`;
    if (key === this.selected) return;
    this.selected = key;
    this.generation++;
    this.pending = null;
  }
  request(
    input: Omit<TechnicalRequest, "generation">,
    complete: Task["complete"],
  ) {
    if (this.disposed) return;
    const task = {
      input: { ...input, generation: ++this.generation },
      complete,
      queued: performance.now(),
    };
    this.pending = task;
    this.pump();
  }
  private applicable(task: Task) {
    return (
      !this.disposed &&
      task.input.generation === this.generation &&
      `${task.input.market_instrument_id}:${task.input.timeframe}` ===
        this.selected
    );
  }
  private pump() {
    if (this.disposed || this.active || !this.pending) return;
    const task = this.pending;
    this.pending = null;
    this.active = task;
    try {
      if (!this.worker) {
        const worker = this.factory();
        this.worker = worker;
        worker.onmessage = ({ data }) => {
          if (this.worker === worker) this.receive(data);
        };
        worker.onerror = () => {
          if (this.worker === worker) this.failed("WorkerError");
        };
        worker.onmessageerror = () => {
          if (this.worker === worker) this.failed("WorkerMessageError");
        };
      }
      this.watchdog = setTimeout(() => this.failed("WorkerTimeout"), 30000);
      this.worker.postMessage(task.input);
    } catch {
      this.failed("WorkerInitializationError");
    }
  }
  private receive(result: TechnicalResult) {
    const task = this.active;
    if (
      !task ||
      result.generation !== task.input.generation ||
      result.market_instrument_id !== task.input.market_instrument_id ||
      result.timeframe !== task.input.timeframe ||
      result.revision !== task.input.revision
    )
      return;
    if (!result.ok) {
      this.failed(result.error_type);
      return;
    }
    this.clearWatchdog();
    this.active = null;
    if (this.applicable(task)) {
      if (process.env.NODE_ENV === "development")
        console.info(
          JSON.stringify({
            event: "chart_worker_context",
            market_instrument_id: result.market_instrument_id,
            timeframe: result.timeframe,
            worker_queue_ms: Math.max(
              0,
              performance.now() -
                task.queued -
                result.timings.worker_compute_ms,
            ),
            ...result.timings,
          }),
        );
      task.complete(result);
    }
    this.pump();
  }
  private clearWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }
  private failed(error_type: string) {
    this.clearWatchdog();
    this.worker?.terminate();
    this.worker = null;
    const task = this.active;
    this.active = null;
    if (!task) return;
    if (this.restarts++ < 1) {
      if (!this.pending && this.applicable(task)) this.pending = task;
      this.pump();
      return;
    }
    if (this.applicable(task))
      task.complete({ ...task.input, ok: false, error_type });
    this.pump();
  }
  retry() {
    this.restarts = 0;
  }
  dispose() {
    this.disposed = true;
    this.clearWatchdog();
    this.worker?.terminate();
    this.worker = null;
    this.active = null;
    this.pending = null;
  }
}
