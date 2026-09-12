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

export function parseSpotifyId(input: string): string {
  const text = input.trim();
  const uri = text.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];
  const url = text.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/);
  if (url) return url[1];
  const bare = text.match(/^([A-Za-z0-9]{22})$/);
  if (bare) return bare[1];
  throw new Error("Not a Spotify track link");
}

export async function fetchSpotifyTrack(id: string): Promise<SpotifyTrack> {
  const res = await fetch(`https://open.spotify.com/embed/track/${id}`, {
    headers: { "User-Agent": UA, "Accept-Language": "en" },
  });
  if (!res.ok) throw new Error(`Spotify embed returned ${res.status}`);
  const html = await res.text();
  const blob = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!blob) throw new Error("Spotify embed markup changed, no __NEXT_DATA__");
  const entity = JSON.parse(blob[1])?.props?.pageProps?.state?.data?.entity;
  if (!entity?.name) throw new Error("Spotify embed carried no track entity");
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

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\((?:official|official music|official lyric|lyric|audio|video|visualizer)[^)]*\)/g, " ")
    .replace(/\[(?:official|audio|video|lyric)[^\]]*\]/g, " ")
    .replace(/\b(?:official (?:music )?video|official audio|lyric video|audio|visualizer|hd|hq|4k)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

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
  if (!res.ok) throw new Error(`YouTube Music search returned ${res.status}`);
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

function rank(track: SpotifyTrack, candidates: YtCandidate[]): YtCandidate[] {
  const wantArtists = track.artists.join(" ");
  for (const candidate of candidates) {
    const titleScore = tokenOverlap(track.title, candidate.title);
    const haystack = [candidate.artists.join(" "), candidate.title].join(" ");
    const artistScore = wantArtists ? tokenOverlap(wantArtists, haystack) : 0.5;
    let durationScore = 0.3;
    if (candidate.durationMs && track.durationMs) {
      const deltaSec = Math.abs(candidate.durationMs - track.durationMs) / 1000;
      durationScore = deltaSec <= 2 ? 1 : deltaSec <= 5 ? 0.8 : deltaSec <= 15 ? 0.4 : 0;
    }
    candidate.score = Number((titleScore * 0.45 + artistScore * 0.3 + durationScore * 0.25).toFixed(4));
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export async function resolve(input: string) {
  const id = parseSpotifyId(input);
  const track = await fetchSpotifyTrack(id);
  const query = [track.artists.join(" "), track.title].filter(Boolean).join(" ");
  // EgWKAQIIAWoK... restricts the shelf to songs; the second pass keeps videos in play.
  const [songs, videos] = await Promise.all([
    ytmSearch(query, "EgWKAQIIAWoKEAoQAxAEEAkQBQ%3D%3D").then(extract),
    ytmSearch(query, "EgWKAQIQAWoKEAoQAxAEEAkQBQ%3D%3D").then(extract).catch(() => []),
  ]);
  const merged = new Map<string, YtCandidate>();
  for (const candidate of [...songs, ...videos]) if (!merged.has(candidate.videoId)) merged.set(candidate.videoId, candidate);
  const ranked = rank(track, [...merged.values()]).slice(0, 8);
  if (!ranked.length) throw new Error("No YouTube match found");
  return { spotify: { ...track, url: `https://open.spotify.com/track/${id}` }, query, best: ranked[0], alternates: ranked.slice(1) };
}
