# sp2yt

Paste a Spotify track, playlist or album link, get the songs on YouTube.

**[sp2yt.coding-global.com](https://sp2yt.coding-global.com)**

No API keys, no account, no OAuth. Unauthenticated requests resolve Spotify metadata to YouTube videos, and one Cloudflare Worker serves both the page and the API.

## Why this exists

[song.link / Odesli](https://odesli.co) did exactly this until its public `v1-alpha.1` API was retired on 2026-07-31. It now answers:

```json
{"statusCode":401,"code":"PUBLIC_API_ACCESS_DEPRECATED"}
```

Every remaining service is either a full playlist transfer that wants to link your accounts, or an AI music video generator. Nothing free takes one link and hands back one link, so this does.

## Use it

The hosted page: paste a link, press Find.

A **track** appears as an embedded player with links to YouTube and YouTube Music, a copy button, and the runner up matches.

A **playlist or album** renders every track as a row and fills in matches as they resolve, with a progress bar and a running tally. When it finishes you get one queue link per 50 tracks, plus a button that copies every YouTube URL.

Deep link straight to a result:

```
https://sp2yt.coding-global.com/?url=<spotify track, playlist or album url>
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

Collections use two endpoints, because one Worker invocation may only make 50 subrequests:

```bash
# 1. the track list, one request
curl -A 'Mozilla/5.0' 'https://sp2yt.coding-global.com/api/collection?url=https://open.spotify.com/playlist/<id>'

# 2. match up to 12 of those tracks per call
curl -A 'Mozilla/5.0' -X POST 'https://sp2yt.coding-global.com/api/match' \
  -H 'Content-Type: application/json' \
  -d '{"tracks":[{"title":"Loser","artists":["Tame Impala"],"durationMs":223069}]}'
```

Accepted inputs: `open.spotify.com/{track,playlist,album}/<id>`, the same with an `intl-xx` prefix, `spotify:{track,playlist,album}:<id>`, or a bare 22 character track id.

## Making a YouTube playlist

There is no way to create a permanent YouTube playlist without the owner's consent. The two real options:

- **Queue links**, which this tool uses. `youtube.com/watch_videos?video_ids=a,b,c` answers with a 303 to a generated `list=TLGG...` playlist. It holds 50 videos, needs no login, and the player offers a Save button so a viewer can keep it. The list is temporary until saved.
- **YouTube Data API v3**, `playlists.insert` plus `playlistItems.insert`. This makes a permanent playlist but needs OAuth against the viewer's Google account, and each inserted item costs 50 quota units against a default 10,000 a day, so one project can add only 200 tracks a day in total. That is unusable for a public tool, so it is deliberately not implemented.

## Run it locally

Needs [Bun](https://bun.sh).

```bash
bun install
bun run build                                   # compile public/tailwind.css
./sp2yt                                         # page on http://127.0.0.1:8477
./sp2yt https://open.spotify.com/track/<id>     # print the YouTube URL
./sp2yt https://open.spotify.com/playlist/<id>  # resolve a whole playlist
./sp2yt <any spotify url> --json                # full payload
bun run deploy                                  # build the CSS, then ship to Cloudflare
```

## How it resolves

1. **Metadata.** Spotify's public embed page carries title, artists and duration in its `__NEXT_DATA__` blob. No token, no app registration.
2. **Search.** Two unauthenticated YouTube Music searches with the public web client key, the songs shelf and the videos shelf, merged and deduplicated.
3. **Ranking.** Title token overlap 45 percent, artist overlap 30 percent, duration closeness 25 percent, minus a penalty for a different recording.

Normalization carries the accuracy. Both sides are stripped of packaging noise, so "Bohemian Rhapsody - Remastered 2011" compares cleanly against a plain YouTube title. The artist score reads YouTube's artist field rather than the title, because a reupload repeats the artist name in its title to look relevant. A candidate whose title says live, acoustic, cover, remix or lyrics loses points unless the Spotify title says the same.

Both mistakes were real. Before the artist field change, a channel called 7clouds Acoustic beat the official audio for a Sam Fender track. Before the noise stripping, Wonderwall matched a live recording from 2025 rather than the studio version.

Tested against plain pop, a classical piano sonata, a two artist collaboration and an obscure 2026 single. All resolved to the correct video, with the top score well clear of the runner up.

## Architecture

| Path | Purpose |
| --- | --- |
| `/` | `public/index.html` and `public/tailwind.css` as Worker static assets |
| `/api/resolve` | one track, metadata plus match |
| `/api/collection` | a playlist or album track list |
| `/api/match` | up to 12 tracks matched by metadata, POST |

Both live on one origin, so the browser never makes a cross origin request. That matters, because a purely static host cannot do this job at all: Spotify's embed page sends no `Access-Control-Allow-Origin`, and YouTube Music answers the CORS preflight with a 403. GitHub Pages, Netlify and plain object storage are all ruled out for that reason.

Responses carry `Cache-Control: public, max-age=86400`, so repeat lookups of a track come from Cloudflare's cache instead of the upstreams.

Status codes: 400 for a link that is not a Spotify track, 429 when the per IP rate limit of 20 requests a minute is exceeded, 502 when an upstream refuses.

It runs on the Cloudflare Workers free plan, which bills nothing by design. Past the free allowance of 100,000 requests a day Cloudflare returns 429 rather than charging, and the rate limit binding plus the response cache keep normal traffic far below it.

`src/resolve.ts` uses only standard web APIs, so the same file backs the Worker, the local Bun server and the CLI. The page is plain HTML with Tailwind compiled ahead of time into `public/tailwind.css`, so there is no build step in the request path and no framework.

## Gotchas

Automated clients hitting the hosted URL with a default user agent, python `urllib` among them, get a 403 from Cloudflare's managed challenge before the Worker ever runs. Send a normal browser user agent.

YouTube Music 403s individual Cloudflare edge colos sporadically. Each shelf search retries up to three times with backoff, and a result still comes back when only one of the two shelves succeeds.

Both upstream hops read undocumented endpoints and can change without notice. If results go empty, check in this order: the embed page's `__NEXT_DATA__` shape, then the `WEB_REMIX` client version and the search `params` blobs in `resolve.ts`.

Spotify's embed stops at 100 tracks, so longer playlists arrive clipped and the response says `truncated: true`.

`compatibility_date` in `wrangler.toml` cannot exceed what the installed `workerd` supports, or `wrangler dev` refuses to start.

Tailwind scans `public/index.html` as text, so utility classes inside the page's inline JavaScript are picked up. Run `bun run build` after editing classes, or the new ones will be missing from the stylesheet.

## License

MIT
