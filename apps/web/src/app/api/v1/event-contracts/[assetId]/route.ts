export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await context.params;
  const horizon = new URL(request.url).searchParams.get("horizon") ?? "10";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      assetId,
    ) ||
    !["10", "30"].includes(horizon)
  )
    return Response.json(
      { error: { code: "invalid_research_identity" } },
      { status: 422 },
    );
  try {
    const target = new URL(
      `/api/v1/event-contracts/${encodeURIComponent(assetId)}?horizon=${horizon}`,
      process.env.API_URL ?? "http://localhost:8000",
    );
    const response = await fetch(target, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: { code: "research_unavailable" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
