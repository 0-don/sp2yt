const YTM_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export type SpotifyTrack = {
  id: string;
  title: string;
  artists: string[];
  durationMs: number;
  artwork: string | null;
};

export type YtCandidate = {
  videoId: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  score: number;
  url: string;
  musicUrl: string;
};

/** An upstream refused or misbehaved, as opposed to the caller sending a bad link. */
export class UpstreamError extends Error {}

export type SpotifyKind = "track" | "playlist" | "album";

export type SpotifyLink = { kind: SpotifyKind; id: string };

export type CollectionTrack = {
  id: string | null;
  title: string;
  artists: string[];
  durationMs: number;
  url: string | null;
};

export type SpotifyCollection = {
  kind: "playlist" | "album";
  id: string;
  name: string;
  subtitle: string;
  artwork: string | null;
  url: string;
  tracks: CollectionTrack[];
  /** Spotify's embed stops at 100 entries, so longer collections arrive clipped. */
  truncated: boolean;
};

export function parseSpotifyLink(input: string): SpotifyLink {
  const text = input.trim();
  const uri = text.match(/^spotify:(track|playlist|album):([A-Za-z0-9]{22})$/);
  if (uri) return { kind: uri[1] as SpotifyKind, id: uri[2] };
  const url = text.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|playlist|album)\/([A-Za-z0-9]{22})/);
  if (url) return { kind: url[1] as SpotifyKind, id: url[2] };
  const bare = text.match(/^([A-Za-z0-9]{22})$/);
  if (bare) return { kind: "track", id: bare[1] };
  throw new Error("Not a Spotify track, playlist or album link");
}

async function fetchEmbedEntity(kind: SpotifyKind, id: string) {
  const target = `https://open.spotify.com/embed/${kind}/${id}`;
  const headers = { "User-Agent": UA, "Accept-Language": "en" };
  let res = await fetch(target, { headers });
  if (res.status >= 500 || res.status === 429) {
    await new Promise((done) => setTimeout(done, 200));
    res = await fetch(target, { headers });
  }
  if (res.status === 404) throw new Error(`No such Spotify ${kind}`);
  if (!res.ok) throw new UpstreamError(`Spotify embed returned ${res.status}`);
  const html = await res.text();
  const blob = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!blob) throw new UpstreamError("Spotify embed markup changed, no __NEXT_DATA__");
  const entity = JSON.parse(blob[1])?.props?.pageProps?.state?.data?.entity;
  if (!entity?.name) throw new UpstreamError(`Spotify embed carried no ${kind} entity`);
  return entity;
}

function biggestImage(entity: { visualIdentity?: { image?: { url: string }[] }; coverArt?: { sources?: { url: string }[] } }) {
  const sources = entity.visualIdentity?.image ?? entity.coverArt?.sources ?? [];
  return sources.length ? sources[sources.length - 1].url : null;
}

export async function fetchSpotifyCollection(kind: "playlist" | "album", id: string): Promise<SpotifyCollection> {
  const entity = await fetchEmbedEntity(kind, id);
  const list: Record<string, unknown>[] = entity.trackList ?? [];
  const tracks: CollectionTrack[] = [];
  for (const item of list) {
    const title = typeof item.title === "string" ? item.title : "";
    if (!title) continue;
    const uri = typeof item.uri === "string" ? item.uri : "";
    const trackId = uri.match(/^spotify:track:([A-Za-z0-9]{22})$/)?.[1] ?? null;
    const subtitle = typeof item.subtitle === "string" ? item.subtitle : "";
    const fallback: string = typeof entity.subtitle === "string" ? entity.subtitle : "";
    tracks.push({
      id: trackId,
      title,
      artists: (subtitle || fallback).split(",").map((name) => name.trim()).filter(Boolean),
      durationMs: typeof item.duration === "number" ? item.duration : 0,
      url: trackId ? `https://open.spotify.com/track/${trackId}` : null,
    });
  }
  return {
    kind,
    id,
    name: entity.name,
    subtitle: typeof entity.subtitle === "string" ? entity.subtitle : "",
    artwork: biggestImage(entity),
    url: `https://open.spotify.com/${kind}/${id}`,
    tracks,
    truncated: tracks.length >= 100,
  };
}

export async function fetchSpotifyTrack(id: string): Promise<SpotifyTrack> {
  const entity = await fetchEmbedEntity("track", id);
  const sources = entity.visualIdentity?.image ?? [];
  const biggest = sources.length ? sources[sources.length - 1].url : null;
  return {
    id,
    title: entity.name,
    artists: (entity.artists ?? []).map((a: { name: string }) => a.name).filter(Boolean),
    durationMs: entity.duration ?? 0,
    artwork: biggest,
  };
}

function collect(node: unknown, key: string, out: Record<string, unknown>[] = []) {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, key, out);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === key && v && typeof v === "object") out.push(v as Record<string, unknown>);
      collect(v, key, out);
    }
  }
  return out;
}

function runText(column: any): string {
  return (column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [])
    .map((r: { text: string }) => r.text)
    .join("");
}

function runs(column: any): { text: string; isLink: boolean }[] {
  return (column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []).map(
    (r: { text: string; navigationEndpoint?: unknown }) => ({
      text: r.text,
      isLink: Boolean(r.navigationEndpoint),
    }),
  );
}

function parseClock(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0) * 1000;
}

/**
 * Spotify and YouTube label the same recording differently, so both sides are stripped of
 * packaging noise before comparison. Without this, "Bohemian Rhapsody - Remastered 2011"
 * scores poorly against the plain YouTube title and a live take can win instead.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\((?:official|official music|official lyric|lyric|audio|video|visualizer)[^)]*\)/g, " ")
    .replace(/\[(?:official|audio|video|lyric)[^\]]*\]/g, " ")
    .replace(/\b(?:official (?:music )?video|official audio|lyric video|audio|visualizer|hd|hq|4k)\b/g, " ")
    .replace(/[-–—]?\s*\b(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\b/g, " ")
    .replace(/\((?:remaster(?:ed)?|deluxe|expanded|mono|stereo)[^)]*\)/g, " ")
    .replace(/[-–—]\s*\b(?:radio edit|single version|album version|bonus track|deluxe(?: edition)?|anniversary edition)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Markers of a different recording or a third party upload rather than the release itself. */
const VERSION_NOISE =
  /\((?:live|acoustic|instrumental|demo|karaoke|sped up|slowed|nightcore|8d)[^)]*\)|\[(?:live|acoustic|instrumental|demo)[^\]]*\]|[-–—]\s*(?:live|acoustic|instrumental|demo|karaoke)\b|\blive (?:at|from|in|on)\b|\b(?:lyrics?|lyric video|cover|remix|karaoke|nightcore|sped up|slowed|8d audio)\b/i;

function tokenOverlap(a: string, b: string): number {
  const left = new Set(normalize(a).split(" ").filter(Boolean));
  const right = new Set(normalize(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

async function ytmSearch(query: string, params: string) {
  const res = await fetch("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Referer: "https://music.youtube.com/",
      Origin: "https://music.youtube.com",
      "X-Goog-Api-Key": YTM_KEY,
    },
    body: JSON.stringify({
      context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20240101.01.00", hl: "en", gl: "US" } },
      query,
      params,
    }),
  });
  if (!res.ok) throw new UpstreamError(`YouTube Music search returned ${res.status}`);
  return res.json();
}

function extract(payload: unknown): YtCandidate[] {
  const items = collect(payload, "musicResponsiveListItemRenderer");
  const seen = new Set<string>();
  const out: YtCandidate[] = [];
  for (const item of items) {
    const videoId =
      (item as any)?.playlistItemData?.videoId ??
      collect(item, "watchEndpoint").find((e) => (e as any).videoId)?.videoId;
    if (typeof videoId !== "string" || seen.has(videoId)) continue;
    seen.add(videoId);
    const columns = (item as any).flexColumns ?? [];
    const title = runText(columns[0]);
    if (!title) continue;
    const meta = runs(columns[1]);
    const artists: string[] = [];
    let album: string | null = null;
    let durationMs: number | null = null;
    for (const run of meta) {
      const clock = parseClock(run.text);
      if (clock !== null) {
        durationMs = clock;
        continue;
      }
      if (run.text.trim() === "" || /^[•·]$/.test(run.text.trim())) continue;
      if (!run.isLink) continue;
      if (normalize(run.text) === normalize(title)) {
        album = album ?? run.text;
        continue;
      }
      if (/^(song|video|single|album|ep)$/i.test(run.text.trim())) continue;
      artists.push(run.text);
    }
    out.push({
      videoId,
      title,
      artists,
      album,
      durationMs,
      score: 0,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      musicUrl: `https://music.youtube.com/watch?v=${videoId}`,
    });
  }
  return out;
}

function rank(
  track: { title: string; artists: string[]; durationMs: number },
  candidates: YtCandidate[],
): YtCandidate[] {
  const wantArtists = track.artists.join(" ");
  for (const candidate of candidates) {
    // A reupload often repeats the artist in its title, so the artist score reads the
    // artist field first and only falls back to the title when that field is empty.
    const titleScore = tokenOverlap(track.title, candidate.title);
    const credited = candidate.artists.join(" ");
    let artistScore = 0.5;
    if (wantArtists) {
      artistScore = credited
        ? tokenOverlap(wantArtists, credited)
        : tokenOverlap(wantArtists, candidate.title) * 0.6;
    }
    let durationScore = 0.3;
    if (candidate.durationMs && track.durationMs) {
      const deltaSec = Math.abs(candidate.durationMs - track.durationMs) / 1000;
      durationScore = deltaSec <= 2 ? 1 : deltaSec <= 5 ? 0.8 : deltaSec <= 15 ? 0.4 : 0;
    }
    const penalty = VERSION_NOISE.test(candidate.title) && !VERSION_NOISE.test(track.title) ? 0.12 : 0;
    const raw = titleScore * 0.45 + artistScore * 0.3 + durationScore * 0.25 - penalty;
    candidate.score = Number(Math.max(0, raw).toFixed(4));
  }
  return candidates.sort((a, b) => b.score - a.score);
}

async function searchShelf(query: string, params: string, attempts = 3): Promise<YtCandidate[]> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return extract(await ytmSearch(query, params));
    } catch (err) {
      last = err;
      // YouTube Music 403s individual edge colos sporadically; a retry usually lands elsewhere.
      if (attempt + 1 < attempts) await new Promise((done) => setTimeout(done, 150 * (attempt + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

const SONGS_SHELF = "EgWKAQIIAWoKEAoQAxAEEAkQBQ%3D%3D";
const VIDEOS_SHELF = "EgWKAQIQAWoKEAoQAxAEEAkQBQ%3D%3D";

/**
 * Matches one track by metadata alone, so a collection does not refetch every embed page.
 * Attempt counts are the subrequest budget: a Worker invocation allows 50 in total.
 */
export async function matchTrack(
  track: { title: string; artists: string[]; durationMs: number },
  options: { songAttempts?: number; videoAttempts?: number } = {},
) {
  const query = [track.artists.join(" "), track.title].filter(Boolean).join(" ");
  const [songs, videos] = await Promise.all([
    searchShelf(query, SONGS_SHELF, options.songAttempts ?? 3).catch((err) => err as Error),
    options.videoAttempts === 0
      ? Promise.resolve([] as YtCandidate[])
      : searchShelf(query, VIDEOS_SHELF, options.videoAttempts ?? 3).catch(() => [] as YtCandidate[]),
  ]);
  if (songs instanceof Error && !videos.length) throw new UpstreamError(songs.message);
  const merged = new Map<string, YtCandidate>();
  for (const candidate of [...(songs instanceof Error ? [] : songs), ...videos]) {
    if (!merged.has(candidate.videoId)) merged.set(candidate.videoId, candidate);
  }
  const ranked = rank(track, [...merged.values()]).slice(0, 8);
  if (!ranked.length) throw new Error("No YouTube match found");
  return { query, best: ranked[0], alternates: ranked.slice(1) };
}

/** One Worker invocation allows 50 subrequests, and a batch entry can spend up to three. */
export const MATCH_BATCH_LIMIT = 12;

export type BatchMatch = {
  index: number;
  best: YtCandidate | null;
  alternates: YtCandidate[];
  error: string | null;
};

type MatchInput = { title: string; artists: string[]; durationMs: number };

/** Validates a decoded JSON body into match inputs; the request boundary is untyped. */
export function parseMatchBody(body: unknown): MatchInput[] {
  const list = body && typeof body === "object" ? (body as Record<string, unknown>).tracks : undefined;
  if (!Array.isArray(list)) throw new Error("Body must be { tracks: [...] }");
  return list.map((entry, position) => {
    if (!entry || typeof entry !== "object") throw new Error(`Track ${position} is not an object`);
    const record: Record<string, unknown> = { ...entry };
    if (typeof record.title !== "string" || !record.title.trim()) {
      throw new Error(`Track ${position} needs a title`);
    }
    const artists = Array.isArray(record.artists)
      ? record.artists.filter((name): name is string => typeof name === "string")
      : [];
    return {
      title: record.title,
      artists,
      durationMs: typeof record.durationMs === "number" ? record.durationMs : 0,
    };
  });
}

export async function matchBatch(tracks: MatchInput[]): Promise<BatchMatch[]> {
  if (tracks.length > MATCH_BATCH_LIMIT) {
    throw new Error(`At most ${MATCH_BATCH_LIMIT} tracks per batch, got ${tracks.length}`);
  }
  const results: BatchMatch[] = [];
  let next = 0;
  const worker = async () => {
    while (next < tracks.length) {
      const index = next;
      next += 1;
      try {
        const matched = await matchTrack(tracks[index], { songAttempts: 2, videoAttempts: 1 });
        results.push({ index, best: matched.best, alternates: matched.alternates, error: null });
      } catch (err) {
        results.push({ index, best: null, alternates: [], error: err instanceof Error ? err.message : String(err) });
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return results.sort((a, b) => a.index - b.index);
}

export async function resolve(input: string) {
  const link = parseSpotifyLink(input);
  if (link.kind !== "track") throw new Error(`That is a Spotify ${link.kind} link, not a track link`);
  const track = await fetchSpotifyTrack(link.id);
  const matched = await matchTrack(track);
  return { spotify: { ...track, url: `https://open.spotify.com/track/${link.id}` }, ...matched };
}
