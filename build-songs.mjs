// Scans public/songs and writes public/songs.json: each song's title (from its file name)
// and exact length, which every listener's page uses to work out what's on air.
// Runs on every Vercel deploy. No dependencies.
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { duration } from "../lib/duration.mjs";

const SONGS_DIR = "public/songs";
const OUT = "public/songs.json";
const AUDIO = new Set([".mp3", ".m4a", ".mp4", ".aac", ".wav"]);

const title = (file) => basename(file, extname(file)).replace(/_+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";

async function main() {
  let files = [];
  try { files = (await readdir(SONGS_DIR)).filter((f) => AUDIO.has(extname(f).toLowerCase()) && !f.startsWith(".")); }
  catch { console.log(`No ${SONGS_DIR} folder yet.`); }
  const songs = [];
  for (const f of files.sort()) {
    const path = join(SONGS_DIR, f);
    if (!(await stat(path)).isFile()) continue;
    const d = duration(await readFile(path), extname(f).toLowerCase());
    if (!d || !isFinite(d) || d < 1) { console.warn(`Skipped ${f}: couldn't read its length.`); continue; }
    songs.push({ id: f, title: title(f), file: "songs/" + encodeURIComponent(f), duration: Math.round(d * 100) / 100 });
    console.log(`${f}  ${d.toFixed(2)}s`);
  }
  await writeFile(OUT, JSON.stringify(songs, null, 2) + "\n");
  console.log(`Wrote ${OUT} with ${songs.length} song${songs.length === 1 ? "" : "s"}.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
