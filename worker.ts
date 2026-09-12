import { resolve } from "./resolve";

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/api/resolve") return new Response("Not found", { status: 404 });
    try {
      const result = await resolve(url.searchParams.get("url") ?? "");
      return Response.json(result, {
        headers: { "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*" },
      });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }
  },
};
