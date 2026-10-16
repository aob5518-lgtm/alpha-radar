export type ChartRefreshHealth = "healthy" | "degraded" | "failed";
export type HistoryRole = "primary" | "higher";

export interface HistoryRefreshDiagnostic {
  event:
    | "chart_history_refresh_failed"
    | "chart_history_refresh_recovered"
    | "chart_context_degraded";
  market_instrument_id: string;
  timeframe: string;
  role: HistoryRole;
  incremental: boolean;
  elapsed_ms: number;
  error_type: string;
}

export function logHistoryRefresh(event: HistoryRefreshDiagnostic): void {
  // Deliberately exclude request URLs, response bodies and exception messages.
  const write =
    event.event === "chart_history_refresh_recovered"
      ? console.info
      : console.warn;
  write(JSON.stringify(event));
}
