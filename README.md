# sp2yt

Paste a Spotify track link, get the song on YouTube.

**[sp2yt.coding-global.com](https://sp2yt.coding-global.com)**

No API keys, no account, no OAuth. Two unauthenticated requests resolve a Spotify track to its YouTube video, and one Cloudflare Worker serves both the page and the API.

## Why this exists

[song.link / Odesli](https://odesli.co) did exactly this until its public `v1-alpha.1` API was retired on 2026-07-31. It now answers:

```json
{"statusCode":401,"code":"PUBLIC_API_ACCESS_DEPRECATED"}
```

Every remaining service is either a full playlist transfer that wants to link your accounts, or an AI music video generator. Nothing free takes one link and hands back one link, so this does.

## Use it

The hosted page: paste a link, press Find. The result appears as an embedded player with links to YouTube and YouTube Music, a copy button, and the runner up matches.

Deep link straight to a result:

```
https://sp2yt.coding-global.com/?url=<spotify track url>
```

As JSON:

```bash
curl -A 'Mozilla/5.0' 'https://sp2yt.coding-global.com/api/resolve?url=https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'
```

```json
{
  "spotify": { "title": "Never Gonna Give You Up", "artists": ["Rick Astley"], "durationMs": 213573 },
  "query": "Rick Astley Never Gonna Give You Up",
  "best": { "videoId": "dQw4w9WgXcQ", "score": 0.7857, "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  "alternates": ["... 7 lower scoring candidates ..."]
}
```

Accepted inputs: `open.spotify.com/track/<id>`, `open.spotify.com/intl-xx/track/<id>`, `spotify:track:<id>`, or a bare 22 character id.

## Run it locally

Needs [Bun](https://bun.sh).

```bash
bun install
./sp2yt                                             # page on http://127.0.0.1:8477
./sp2yt https://open.spotify.com/track/<id>         # print the YouTube URL
./sp2yt https://open.spotify.com/track/<id> --json  # full payload
bunx wrangler deploy                                # ship to your own Cloudflare account
```

## How it resolves

1. **Metadata.** Spotify's public embed page carries title, artists and duration in its `__NEXT_DATA__` blob. No token, no app registration.
2. **Search.** Two unauthenticated YouTube Music searches with the public web client key, the songs shelf and the videos shelf, merged and deduplicated.
3. **Ranking.** Title token overlap 45 percent, artist overlap 30 percent, duration closeness 25 percent. Titles are normalized first, so "Official Music Video" and similar noise does not count against a match.

Tested against plain pop, a classical piano sonata, a two artist collaboration and an obscure 2026 single. All resolved to the correct video, with the top score well clear of the runner up.

## Architecture

| Path | Served by |
| --- | --- |
| `/` | `public/index.html` as a Worker static asset |
| `/api/resolve` | `worker.ts`, which calls `resolve.ts` |

Both live on one origin, so the browser never makes a cross origin request. That matters, because a purely static host cannot do this job at all: Spotify's embed page sends no `Access-Control-Allow-Origin`, and YouTube Music answers the CORS preflight with a 403. GitHub Pages, Netlify and plain object storage are all ruled out for that reason.

Responses carry `Cache-Control: public, max-age=86400`, so repeat lookups of a track come from Cloudflare's cache instead of the upstreams.

Status codes: 400 for a link that is not a Spotify track, 429 when the per IP rate limit of 20 requests a minute is exceeded, 502 when an upstream refuses.

It runs on the Cloudflare Workers free plan, which bills nothing by design. Past the free allowance of 100,000 requests a day Cloudflare returns 429 rather than charging, and the rate limit binding plus the response cache keep normal traffic far below it.

`resolve.ts` uses only standard web APIs, so the same file backs the Worker, the local Bun server and the CLI.

## Gotchas

Automated clients hitting the hosted URL with a default user agent, python `urllib` among them, get a 403 from Cloudflare's managed challenge before the Worker ever runs. Send a normal browser user agent.

YouTube Music 403s individual Cloudflare edge colos sporadically. Each shelf search retries up to three times with backoff, and a result still comes back when only one of the two shelves succeeds.

Both upstream hops read undocumented endpoints and can change without notice. If results go empty, check in this order: the embed page's `__NEXT_DATA__` shape, then the `WEB_REMIX` client version and the search `params` blobs in `resolve.ts`.

`compatibility_date` in `wrangler.toml` cannot exceed what the installed `workerd` supports, or `wrangler dev` refuses to start.

## License

MIT
