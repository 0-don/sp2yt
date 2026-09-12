import { fetchSpotifyCollection, matchBatch, MATCH_BATCH_LIMIT, parseSpotifyLink, resolve } from "./resolve";

const input = process.argv[2];
if (!input) {
  console.error("usage: bun cli.ts <spotify track, playlist or album url> [--json]");
  process.exit(1);
}
const wantJson = process.argv.includes("--json");
const link = parseSpotifyLink(input);

if (link.kind === "track") {
  const result = await resolve(input);
  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.spotify.artists.join(", ")} - ${result.spotify.title}`);
    console.log(result.best.url);
    console.log(`match ${(result.best.score * 100).toFixed(0)}%  ${result.best.title} [${result.best.artists.join(", ")}]`);
  }
} else {
  const collection = await fetchSpotifyCollection(link.kind, link.id);
  const rows: { track: (typeof collection.tracks)[number]; url: string | null; score: number; error: string | null }[] = [];
  for (let start = 0; start < collection.tracks.length; start += MATCH_BATCH_LIMIT) {
    const slice = collection.tracks.slice(start, start + MATCH_BATCH_LIMIT);
    const matches = await matchBatch(slice);
    for (const match of matches) {
      rows.push({
        track: slice[match.index],
        url: match.best ? match.best.url : null,
        score: match.best ? match.best.score : 0,
        error: match.error,
      });
    }
    if (!wantJson) console.error(`resolved ${rows.length}/${collection.tracks.length}`);
  }
  if (wantJson) {
    console.log(JSON.stringify({ collection: { ...collection, tracks: undefined }, rows }, null, 2));
  } else {
    console.log(`${collection.name} (${collection.kind}, ${rows.length} tracks)`);
    if (collection.truncated) console.log("note: Spotify's embed caps the track list at 100");
    for (const row of rows) {
      const label = `${row.track.artists.join(", ")} - ${row.track.title}`.slice(0, 52).padEnd(52);
      console.log(`${label} ${row.url ?? `FAILED ${row.error ?? ""}`} ${row.url ? `${Math.round(row.score * 100)}%` : ""}`);
    }
  }
}
