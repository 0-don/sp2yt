import { resolve } from "./resolve";

const input = process.argv[2];
if (!input) {
  console.error("usage: bun cli.ts <spotify track url>");
  process.exit(1);
}

const result = await resolve(input);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const sp = result.spotify;
  console.log(`${sp.artists.join(", ")} - ${sp.title}`);
  console.log(result.best.url);
  console.log(`match ${(result.best.score * 100).toFixed(0)}%  ${result.best.title} [${result.best.artists.join(", ")}]`);
}
