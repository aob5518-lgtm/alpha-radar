import { parentPort } from "node:worker_threads";
import { TechnicalWorkerEngine } from "../apps/web/src/lib/market/technical-worker-engine.ts";
const engine = new TechnicalWorkerEngine();
parentPort.on("message", (input) =>
  parentPort.postMessage(engine.compute(input)),
);
