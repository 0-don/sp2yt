import { resolve, UpstreamError } from "./resolve";

type Env = {
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
};

const cors = { "Access-Control-Allow-Origin": "*" };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/api/resolve") return new Response("Not found", { status: 404 });

    const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
    const allowed = await env.RATE_LIMITER.limit({ key: ip });
    if (!allowed.success) {
      return Response.json(
        { error: "Rate limited. Try again in a minute." },
        { status: 429, headers: { ...cors, "Retry-After": "60" } },
      );
    }

    try {
      const result = await resolve(url.searchParams.get("url") ?? "");
      return Response.json(result, {
        headers: { ...cors, "Cache-Control": "public, max-age=86400" },
      });
    } catch (err) {
      const upstream = err instanceof UpstreamError;
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: upstream ? 502 : 400, headers: cors },
      );
    }
  },
};
