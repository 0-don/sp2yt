import { fetchSpotifyCollection, matchBatch, parseMatchBody, parseSpotifyLink, resolve, UpstreamError } from "./resolve";

const publicDir = new URL("../public/", import.meta.url);
const port = Number(process.env.PORT ?? 8477);

/** Mirrors the Worker's static asset handling so local dev serves the built CSS too. */
async function asset(pathname: string) {
  const name = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (name.includes("..")) return null;
  const file = Bun.file(new URL(name, publicDir));
  return (await file.exists()) ? file : null;
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const route = url.pathname;
    if (route !== "/api/resolve" && route !== "/api/collection" && route !== "/api/match") {
      const file = await asset(route);
      return file ? new Response(file) : new Response("Not found", { status: 404 });
    }
    try {
      if (route === "/api/resolve") return Response.json(await resolve(url.searchParams.get("url") ?? ""));
      if (route === "/api/collection") {
        const link = parseSpotifyLink(url.searchParams.get("url") ?? "");
        if (link.kind === "track") throw new Error("That is a track link. Use /api/resolve for single tracks.");
        return Response.json(await fetchSpotifyCollection(link.kind, link.id));
      }
      if (req.method !== "POST") throw new Error("/api/match takes a POST body");
      return Response.json({ matches: await matchBatch(parseMatchBody(await req.json())) });
    } catch (err) {
      const status = err instanceof UpstreamError ? 502 : 400;
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status });
    }
  },
});

console.log(`sp2yt listening on http://127.0.0.1:${port}`);
