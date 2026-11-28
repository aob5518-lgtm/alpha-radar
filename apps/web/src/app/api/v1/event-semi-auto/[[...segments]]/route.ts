export const dynamic = "force-dynamic";

type Context = { params: Promise<{ segments?: string[] }> };
const uuid = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const alertRoutes: Record<string, RegExp> = {
  GET: new RegExp(`^alerts(?:/(?:config|devices|intents/${uuid}))?$`, "i"),
  POST: new RegExp(
    `^alerts/(?:devices(?:/${uuid}/test)?|intents/${uuid}/opened)$`,
    "i",
  ),
  DELETE: new RegExp(`^alerts/devices/${uuid}$`, "i"),
};

async function proxy(request: Request, context: Context): Promise<Response> {
  const headers = {
    "cache-control": "private, no-store",
    "content-type": "application/json",
  };
  const error = (status: number, code: string) =>
    Response.json({ error: { code } }, { status, headers });
  const path = ((await context.params).segments ?? []).join("/");
  const { method } = request;
  const alerts =
    process.env.EVENT_ALERTS_ENABLED === "true" &&
    alertRoutes[method]?.test(path);
  if (
    process.env.EVENT_SEMI_AUTO_AVAILABLE !== "true" ||
    !(
      alerts ||
      (method === "GET" && !path) ||
      (method === "PATCH" && path === "settings") ||
      (method === "POST" &&
        new RegExp(
          `^(intents/${uuid}/(decision|confirm)|bets/${uuid}/settle)$`,
          "i",
        ).test(path))
    )
  )
    return error(404, "semi_auto_unavailable");
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (origin && origin !== `https://${host}` && origin !== `http://${host}`)
  )
    return error(403, "operator_required");
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > 512)
    return error(401, "operator_required");
  const mutating = method === "POST" || method === "PATCH";
  if (
    mutating &&
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return error(415, "invalid_request");
  try {
    const target = new URL(
      "/api/v1/event-semi-auto" + (path ? "/" + path : ""),
      process.env.API_URL ?? "http://localhost:8000",
    );
    const query = new URL(request.url).searchParams;
    for (const key of ["intent_before", "bet_before", "history"]) {
      const value = query.get(key);
      if (value) target.searchParams.set(key, value);
    }
    const body = mutating ? await request.text() : undefined;
    if (body && body.length > 8192) return error(413, "invalid_request");
    const response = await fetch(target, {
      method,
      body,
      cache: "no-store",
      redirect: "error",
      headers: { authorization, "content-type": "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    return new Response(
      response.status === 204 ? null : await response.text(),
      { status: response.status, headers },
    );
  } catch {
    return error(503, "semi_auto_unavailable");
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
