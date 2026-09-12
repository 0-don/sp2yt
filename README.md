# sp2yt

Paste a Spotify track link, get the song on YouTube.

Live: https://sp2yt.don-cryptus.workers.dev

```bash
./sp2yt                                             # local page on 8477
./sp2yt https://open.spotify.com/track/<id>         # one-shot, prints the YouTube URL
./sp2yt https://open.spotify.com/track/<id> --json  # full payload with alternates
bunx wrangler deploy                                # ship to Cloudflare
```

Accepts `open.spotify.com/track/<id>`, `open.spotify.com/intl-xx/track/<id>`, `spotify:track:<id>`, or a bare 22-char id.

## How it resolves

1. Track metadata from Spotify's embed page (`__NEXT_DATA__`), no token, no app registration.
2. Two unauthenticated YouTube Music searches, songs shelf plus videos shelf.
3. Candidates ranked on title token overlap (45%), artist overlap (30%), duration closeness (25%).

Odesli / song.link is not used: its public `v1-alpha.1` API was retired 2026-07-31 and now answers 401 `PUBLIC_API_ACCESS_DEPRECATED`.

## Hosting

One Worker serves both the page (`public/index.html` as a static asset) and `/api/resolve`, so the browser never makes a cross-origin call. Static hosting alone cannot work: Spotify's embed page sends no `Access-Control-Allow-Origin`, and YouTube Music answers the CORS preflight with 403.

Responses carry `Cache-Control: public, max-age=86400`, so repeat lookups of the same track come from Cloudflare's cache.

## Gotchas

Scripted clients hitting the public URL with a default user agent (python `urllib`, some bots) get a 403 from Cloudflare's managed challenge before reaching the Worker. Send a normal browser user agent for automated use.

Both upstream hops read undocumented endpoints. If results go empty, check in this order: the embed page's `__NEXT_DATA__` shape, then the `WEB_REMIX` client version and the search `params` blobs in `resolve.ts`.

`compatibility_date` in `wrangler.toml` must not exceed what the installed `workerd` supports, or `wrangler dev` refuses to start.
