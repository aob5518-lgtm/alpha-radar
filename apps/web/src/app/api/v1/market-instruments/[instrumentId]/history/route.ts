/** Same-origin transport only. PostgreSQL history remains the canonical API's responsibility. */
export const dynamic = "force-dynamic";

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
  const target = new URL(
    `/api/v1/market-instruments/${encodeURIComponent(instrumentId)}/history`,
    process.env.API_URL ?? "http://localhost:8000",
  );
  for (const key of ["interval", "limit", "start", "end"]) {
    const value = incoming.searchParams.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  try {
    const response = await fetch(target, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type":
          response.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "chart_history_transport_failed",
        error_type: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return Response.json(
      {
        error: {
          code: "history_unavailable",
          message: "Confirmed history unavailable",
        },
      },
      { status: 503 },
    );
  }
}
