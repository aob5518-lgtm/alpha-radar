/** Same-origin transport only. PostgreSQL history remains the canonical API's responsibility. */
import { logHistoryRefresh } from "../../../../../../lib/market/chart-refresh-health.ts";

export const dynamic = "force-dynamic";
const HISTORY_TIMEOUT_MS = 25000;

interface HistoryTransportFailure {
  error: {
    code: "history_timeout" | "history_unavailable";
    message: string;
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ instrumentId: string }> },
): Promise<Response> {
  const { instrumentId } = await context.params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      instrumentId,
    )
  ) {
    return Response.json(
      {
        error: {
          code: "invalid_instrument_id",
          message: "Instrument UUID required",
        },
      },
      { status: 422 },
    );
  }
  const incoming = new URL(request.url);
  const interval = incoming.searchParams.get("interval") ?? "1d";
  const role =
    incoming.searchParams.get("role") === "higher" ? "higher" : "primary";
  const incremental =
    incoming.searchParams.has("start") || incoming.searchParams.has("end");
  const started = performance.now();
  const diagnostic = (errorType: string) =>
    logHistoryRefresh({
      event: "chart_history_refresh_failed",
      market_instrument_id: instrumentId,
      timeframe: ["1m", "5m", "15m", "1h", "4h", "1d", "1w"].includes(interval)
        ? interval
        : "invalid",
      role,
      incremental,
      elapsed_ms: performance.now() - started,
      error_type: errorType,
    });
  const target = new URL(
    `/api/v1/market-instruments/${encodeURIComponent(instrumentId)}/history`,
    process.env.API_URL ?? "http://localhost:8000",
  );
  for (const key of ["interval", "limit", "start", "end"]) {
    const value = incoming.searchParams.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  const deadline = AbortSignal.timeout(HISTORY_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      cache: "no-store",
      // Covers headers AND response body, bounded below the 30s maximum retry interval.
      signal: deadline,
    });
    const body = await response.arrayBuffer();
    if (!response.ok) diagnostic(`UpstreamHTTP${response.status}`);
    return new Response(
      [204, 205, 304].includes(response.status) ? null : body,
      {
        status: response.status,
        headers: {
          "content-type":
            response.headers.get("content-type") ?? "application/json",
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    const timeout =
      (deadline.aborted && deadline.reason?.name === "TimeoutError") ||
      (error instanceof Error && error.name === "TimeoutError");
    diagnostic(
      timeout
        ? "TimeoutError"
        : error instanceof Error
          ? error.name
          : "UnknownError",
    );
    const failure: HistoryTransportFailure = {
      error: {
        code: timeout ? "history_timeout" : "history_unavailable",
        message: timeout
          ? "Confirmed history request timed out"
          : "Confirmed history unavailable",
      },
    };
    return Response.json(failure, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
