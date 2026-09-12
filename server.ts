import { resolve } from "./resolve";

const page = await Bun.file(new URL("./public/index.html", import.meta.url)).text();
const port = Number(process.env.PORT ?? 8477);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/resolve") {
      const input = url.searchParams.get("url") ?? "";
      try {
        return Response.json(await resolve(input));
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
      }
    }
    if (url.pathname === "/") return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    return new Response("Not found", { status: 404 });
  },
});

console.log(`sp2yt listening on http://127.0.0.1:${port}`);
