import { TechnicalWorkerClient } from "./technical-worker-client.ts";

export function createBrowserTechnicalComputer() {
  if (typeof window === "undefined")
    return { request() {}, select() {}, retry() {}, dispose() {} };
  return new TechnicalWorkerClient(
    () =>
      new Worker(new URL("./technical-context.worker.ts", import.meta.url), {
        type: "module",
      }),
  );
}

/** Browser-wide long tasks are correlation diagnostics, not attribution proof. */
export function observeChartLongTasks() {
  if (
    process.env.NODE_ENV !== "development" ||
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("longtask")
  )
    return () => {};
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (entry.duration > 50)
        console.info(
          JSON.stringify({
            event: "chart_page_long_task",
            main_thread_long_task_ms: entry.duration,
            attribution: "page-wide; may include unrelated layout/rendering",
          }),
        );
  });
  observer.observe({ type: "longtask", buffered: true });
  return () => observer.disconnect();
}
