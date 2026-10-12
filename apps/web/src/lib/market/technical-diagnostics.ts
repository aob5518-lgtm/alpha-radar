export interface TechnicalTimings {
  history_fetch_ms: number;
  structural_levels_ms: number;
  trend_regime_ms: number;
  market_state_ms: number;
  marker_replay_ms: number;
  total_technical_context_ms: number;
}

export function createTechnicalTimings(): TechnicalTimings {
  return {
    history_fetch_ms: 0,
    structural_levels_ms: 0,
    trend_regime_ms: 0,
    market_state_ms: 0,
    marker_replay_ms: 0,
    total_technical_context_ms: 0,
  };
}

export function measureTechnical<T>(
  timings: TechnicalTimings | undefined,
  stage: keyof TechnicalTimings,
  run: () => T,
): T {
  if (!timings) return run();
  const start = performance.now();
  try {
    return run();
  } finally {
    timings[stage] += performance.now() - start;
  }
}

export function logTechnicalDiagnostics(
  instrumentId: string,
  interval: string,
  timings: TechnicalTimings,
): void {
  if (process.env.NODE_ENV === "development")
    console.info(
      JSON.stringify({
        event: "chart_technical_context",
        market_instrument_id: instrumentId,
        timeframe: interval,
        ...timings,
      }),
    );
}
