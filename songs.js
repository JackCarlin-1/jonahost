// GET: the station's song list (songs uploaded from the desk plus any in public/songs).
// POST (password required): check the password, add an uploaded song, rename or delete one.
import { list, copy, del } from "@vercel/blob";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { extname } from "node:path";
import { duration } from "../lib/duration.mjs";
import { passwordOk, songPath, parseSong, SONGS_PREFIX, INCOMING_PREFIX, AUDIO_EXTS, json } from "../lib/station.mjs";

async function blobSongs() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: SONGS_PREFIX, cursor, limit: 1000 });
    for (const b of page.blobs) { const s = parseSong(b); if (s) out.push(s); }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function repoSongs(origin) {
  // Songs committed to public/songs, listed in songs.json at deploy time.
  try {
    const r = await fetch(new URL("/songs.json", origin), { cache: "no-store" });
    if (r.ok) return (await r.json()).filter((t) => t && t.file && t.duration >= 1).map((t) => ({ ...t, id: "r:" + t.id, file: "/" + t.file }));
  } catch {}
  return [];
}

export async function GET(request) {
  const url = new URL(request.url);
  const fresh = url.searchParams.has("fresh");
  try {
    const [b, r] = await Promise.all([blobSongs(), repoSongs(url.origin)]);
    const songs = [...r, ...b].map(({ id, title, file, duration }) => ({ id, title, file, duration }));
    return json(songs, 200, {
      "cache-control": fresh ? "no-store" : "public, max-age=0, s-maxage=20, stale-while-revalidate=300",
    });
  } catch (e) {
    return json({ error: "The song list couldn't load." }, 500, { "cache-control": "no-store" });
  }
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  if (!passwordOk(body.password)) return json({ error: "Wrong password." }, 401);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ error: "Song storage isn't connected yet. Connect a Blob store to this project in Vercel." }, 500);

  try {
    if (body.action === "check") return json({ ok: true });

    if (body.action === "add") {
      // body.url is the file the desk just uploaded to station/incoming/.
      const src = new URL(body.url);
      const pathname = decodeURIComponent(src.pathname.replace(/^\//, ""));
      if (!src.hostname.endsWith(".blob.vercel-storage.com") || !pathname.startsWith(INCOMING_PREFIX)) return json({ error: "That upload can't be added." }, 400);
      let ext = extname(pathname).toLowerCase();
      if (!AUDIO_EXTS.includes(ext)) ext = ".mp3";
      const buf = Buffer.from(await (await fetch(src, { cache: "no-store" })).arrayBuffer());
      const seconds = duration(buf, ext);
      if (!seconds || !isFinite(seconds) || seconds < 1) {
        await del(src.href).catch(() => {});
        return json({ error: "Couldn't read that song's length. Try exporting it as an MP3." }, 422);
      }
      const title = String(body.title || "Untitled").trim().slice(0, 200) || "Untitled";
      const id = randomBytes(6).toString("base64url");
      const done = await copy(src.href, songPath(id, seconds, title, ext), { access: "public", addRandomSuffix: false });
      await del(src.href).catch(() => {});
      return json({ ok: true, song: { id: "b:" + id, title, file: done.url, duration: Math.round(seconds * 100) / 100 } });
    }

    if (body.action === "rename" || body.action === "delete") {
      const key = String(body.id || "").replace(/^b:/, "");
      const songs = await blobSongs();
      const song = songs.find((s) => s.key === key);
      if (!song) return json({ error: String(body.id || "").startsWith("r:") ? "That song lives in the GitHub repo. Rename or delete it there." : "That song wasn't found." }, 404);
      if (body.action === "delete") { await del(song.file); return json({ ok: true }); }
      const title = String(body.title || "").trim().slice(0, 200);
      if (!title) return json({ error: "Give the song a name." }, 400);
      if (title === song.title) return json({ ok: true });
      await copy(song.file, songPath(song.key, song.duration, title, song.ext), { access: "public", addRandomSuffix: false });
      await del(song.file);
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: "That didn't work: " + String(e && e.message) }, 500);
  }
}
