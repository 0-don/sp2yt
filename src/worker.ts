import { fetchSpotifyCollection, matchBatch, parseMatchBody, parseSpotifyLink, resolve, UpstreamError } from "./resolve";

type Env = {
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function fail(err: unknown) {
  const upstream = err instanceof UpstreamError;
  return Response.json(
    { error: err instanceof Error ? err.message : String(err) },
    { status: upstream ? 502 : 400, headers: cors },
  );
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const route = url.pathname;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (route !== "/api/resolve" && route !== "/api/collection" && route !== "/api/match") {
      return new Response("Not found", { status: 404 });
    }

    const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
    const allowed = await env.RATE_LIMITER.limit({ key: ip });
    if (!allowed.success) {
      return Response.json(
        { error: "Rate limited. Try again in a minute." },
        { status: 429, headers: { ...cors, "Retry-After": "60" } },
      );
    }

    const cacheable = { ...cors, "Cache-Control": "public, max-age=86400" };
    try {
      if (route === "/api/resolve") {
        return Response.json(await resolve(url.searchParams.get("url") ?? ""), { headers: cacheable });
      }
      if (route === "/api/collection") {
        const link = parseSpotifyLink(url.searchParams.get("url") ?? "");
        if (link.kind === "track") throw new Error("That is a track link. Use /api/resolve for single tracks.");
        return Response.json(await fetchSpotifyCollection(link.kind, link.id), { headers: cacheable });
      }
      if (req.method !== "POST") throw new Error("/api/match takes a POST body");
      const tracks = parseMatchBody(await req.json());
      return Response.json({ matches: await matchBatch(tracks) }, { headers: cacheable });
    } catch (err) {
      return fail(err);
    }
  },
};
