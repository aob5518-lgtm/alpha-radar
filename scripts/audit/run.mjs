/** node --experimental-strip-types scripts/audit/run.mjs INPUT.json OUTPUT_DIR [workers=3]
 * Outputs are derived local artifacts, not provider/canonical market records.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { join } from "node:path";
import { replay } from "./replay.mjs";
import { higherMarketInterval } from "../../apps/web/src/lib/market/intervals.ts";
if (!isMainThread) {
  const { series, higher, start, end } = workerData;
  const result = replay(series, higher, start, end, {
    progress: (value) => parentPort.postMessage({ progress: value }),
  });
  parentPort.postMessage({ result });
} else {
  const [input, directory, parallel = "3"] = process.argv.slice(2);
  assert.ok(
    input && directory,
    "Usage: run.mjs INPUT.json OUTPUT_DIR [workers=3]",
  );
  const bytes = readFileSync(input),
    data = JSON.parse(bytes);
  assert.equal(data.format, "alpha-radar-signal-history-v1");
  assert.equal(data.base_sha, "69a74425e68157ef634a723309d665b3996d9509");
  execFileSync(
    "git",
    [
      "diff",
      "--exit-code",
      data.base_sha,
      "--",
      ...[
        "technical-levels",
        "market-state",
        "trade-setup",
        "trade-guide",
        "technical-context",
        "intervals",
      ].map((n) => "apps/web/src/lib/market/" + n + ".ts"),
    ],
    { stdio: "pipe" },
  );
  const start = Date.parse(data.requested_start),
    end = Date.parse(data.exported_at);
  assert.ok(Number.isFinite(start) && end > start);
  const keys = data.series.map((s) => s.symbol + ":" + s.interval);
  assert.equal(new Set(keys).size, keys.length);
  const queue = [];
  for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT"])
    for (const interval of ["15m", "1h", "4h"]) {
      const series = data.series.find(
        (s) => s.symbol === symbol && s.interval === interval,
      );
      const higher = data.series.find(
        (s) =>
          s.symbol === symbol && s.interval === higherMarketInterval[interval],
      );
      assert.ok(series && higher, `Missing stored input ${symbol}/${interval}`);
      queue.push({ series, higher, start, end });
    }
  mkdirSync(directory, { recursive: true });
  const results = [];
  async function consume() {
    while (queue.length) {
      const task = queue.shift(),
        key = task.series.symbol + "-" + task.series.interval;
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), {
          workerData: task,
          execArgv: [
            "--experimental-strip-types",
            "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
          ],
        });
        worker.on("error", reject);
        let received = false;
        worker.on("exit", (code) => {
          if (code !== 0 || !received)
            reject(new Error(`Replay ${key} exited ${code}`));
        });
        worker.on("message", (message) => {
          if (message.progress) console.log(JSON.stringify(message.progress));
          else {
            received = true;
            resolve(message.result);
          }
        });
      });
      writeFileSync(
        join(directory, key + ".json"),
        JSON.stringify(result, null, 2) + "\n",
      );
      results.push({
        ...result,
        samples: result.samples.map((s) => ({
          state: s.guide.state,
          confirmed_at: s.guide.confirmed_at,
        })),
      });
      console.log(
        JSON.stringify({ completed: key, n: result.n, counts: result.counts }),
      );
    }
  }
  const workers = Number(parallel);
  assert.ok(Number.isInteger(workers) && workers >= 1 && workers <= 4);
  await Promise.all(Array.from({ length: workers }, consume));
  results.sort((a, b) =>
    (a.symbol + a.interval).localeCompare(b.symbol + b.interval),
  );
  const summary = {
    format: "alpha-radar-signal-audit-v1",
    base_sha: data.base_sha,
    input_sha256: createHash("sha256").update(bytes).digest("hex"),
    exported_at: data.exported_at,
    requested_start: data.requested_start,
    results,
  };
  writeFileSync(
    join(directory, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log("Audit complete: " + join(directory, "summary.json"));
}
