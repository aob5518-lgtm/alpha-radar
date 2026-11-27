export const dynamic = "force-dynamic";

async function proxy(request: Request): Promise<Response> {
  const headers = {
    "cache-control": "no-store",
    "content-type": "application/json",
  };
  if (process.env.EVENT_SIMULATOR_ENABLED !== "true") {
    return Response.json(
      { error: { code: "simulator_disabled" } },
      { status: 404, headers },
    );
  }
  const mutating = request.method !== "GET";
  const authorization = request.headers.get("authorization");
  if (
    mutating &&
    (!authorization ||
      !request.headers.get("content-type")?.startsWith("application/json"))
  ) {
    return Response.json(
      { error: { code: "simulator_admin_required" } },
      { status: 401, headers },
    );
  }
  try {
    const target = new URL(
      "/api/v1/event-simulator",
      process.env.API_URL ?? "http://localhost:8000",
    );
    target.search = new URL(request.url).search;
    const body = mutating ? await request.text() : undefined;
    if (body && body.length > 8192) {
      return Response.json(
        { error: { code: "invalid_settings" } },
        { status: 413, headers },
      );
    }
    const upstream = await fetch(target, {
      method: request.method,
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
      headers:
        mutating && authorization
          ? { authorization, "content-type": "application/json" }
          : undefined,
      body,
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers,
    });
  } catch {
    return Response.json(
      { error: { code: "simulator_unavailable" } },
      { status: 503, headers },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
