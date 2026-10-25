import { TechnicalWorkerEngine } from "./technical-worker-engine.ts";
import type {
  TechnicalRequest,
  TechnicalResult,
} from "./technical-worker-protocol.ts";

const engine = new TechnicalWorkerEngine();
let warm: ReturnType<typeof setTimeout> | undefined;
const scope = self as unknown as {
  onmessage: (event: MessageEvent<TechnicalRequest>) => void;
  postMessage: (result: TechnicalResult) => void;
};
scope.onmessage = ({ data }) => {
  clearTimeout(warm);
  try {
    scope.postMessage(engine.compute(data));
    warm = setTimeout(() => {
      try {
        engine.prewarm(data);
      } catch {
        /* Optional checkpoint: next request can rebuild safely. */
      }
    }, 0);
  } catch (error) {
    scope.postMessage({
      market_instrument_id: data.market_instrument_id,
      timeframe: data.timeframe,
      generation: data.generation,
      revision: data.revision,
      ok: false,
      error_type: error instanceof Error ? error.name : "WorkerError",
    });
  }
};
