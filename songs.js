// GET: the station's song list and what's been force-started, for every listener.
// POST (password required): check the password, add an uploaded song, rename, delete, or play a song now.
//
// Everything the station knows lives in one small file in Vercel Blob (the manifest), so listeners
// reading it cost no paid storage operations. Each change also writes a dated copy, which the desk
// reads back so quick edits never build on a stale copy.
import { list, put, copy, del } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import { extname } from "node:path";
import { duration } from "../lib/duration.mjs";
import { passwordOk, parseSong, SONGS_PREFIX, INCOMING_PREFIX, AUDIO_EXTS, json } from "../lib/station.mjs";

const POINTER = "station/manifest.json";
const VERSIONS = "station/m/";

function storeHost() {
  let id = "";
  const tok = process.env.BLOB_READ_WRITE_TOKEN || "";
  if (tok) id = tok.split("_")[3] || "";
  if (!id) id = (process.env.BLOB_STORE_ID || "").replace(/^store_/, "");
  return id ? `https://${id}.public.blob.vercel-storage.com/` : "";
}
const empty = () => ({ songs: [], onAir: null });

// What listeners read: the shared manifest, served from Blob's CDN (can lag a write by up to a minute).
async function readPublished() {
  const host = storeHost(); if (!host) return empty();
  try {
    const r = await fetch(host + POINTER, { cache: "no-store" });
    if (r.ok) return { ...empty(), ...(await r.json()) };
  } catch {}
  return empty();
}

// What the desk edits: the newest dated copy (always fresh), or, the first time, any songs already stored.
async function readLatest() {
  const { blobs } = await list({ prefix: VERSIONS, limit: 1000 });
  if (blobs.length) {
    const newest = blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1))[0];
    const r = await fetch(newest.url, { cache: "no-store" });
    if (r.ok) return { ...empty(), ...(await r.json()), _versions: blobs };
  }
  const old = await list({ prefix: SONGS_PREFIX, limit: 1000 });
  const songs = old.blobs.map(parseSong).filter(Boolean).map((s) => ({ key: s.key, title: s.title, url: s.file, pathname: s.pathname, duration: s.duration }));
  return { ...empty(), songs, _versions: [] };
}

async function save(m) {
  const { _versions = [], ...data } = m;
  const body = JSON.stringify(data);
  const stamp = String(Date.now()).padStart(15, "0");
  await put(VERSIONS + stamp + ".json", body, { access: "public", addRandomSuffix: false, contentType: "application/json" });
  await put(POINTER, body, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });
  const stale = _versions.sort((a, b) => (a.pathname < b.pathname ? 1 : -1)).slice(2).map((b) => b.url);
  if (stale.length) await del(stale).catch(() => {});
}

async function repoSongs(origin) {
  // Songs committed to public/songs, listed in songs.json at deploy time.
  try {
    const r = await fetch(new URL("/songs.json", origin), { cache: "no-store" });
    if (r.ok) return (await r.json()).filter((t) => t && t.file && t.duration >= 1).map((t) => ({ id: "r:" + t.id, title: t.title, file: "/" + t.file, duration: t.duration }));
  } catch {}
  return [];
}

function forListeners(m, repo) {
  const songs = [...repo, ...m.songs.map((s) => ({ id: "b:" + s.key, title: s.title, file: s.url, duration: s.duration }))];
  return { songs, onAir: m.onAir && songs.some((s) => s.id === m.onAir.id) ? m.onAir : m.onAir ? { ...m.onAir, missing: true } : null };
}

export async function GET(request) {
  const url = new URL(request.url);
  const [m, repo] = await Promise.all([readPublished(), repoSongs(url.origin)]);
  return json(forListeners(m, repo), 200, {
    "cache-control": url.searchParams.has("fresh") ? "no-store" : "public, max-age=0, s-maxage=10, stale-while-revalidate=120",
  });
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  if (!passwordOk(body.password)) return json({ error: "Wrong password." }, 401);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ error: "Song storage isn't connected yet. Add BLOB_READ_WRITE_TOKEN to the project in Vercel and redeploy." }, 500);
  const origin = new URL(request.url).origin;

  try {
    if (body.action === "check") {
      const m = await readLatest();
      return json({ ok: true, ...forListeners(m, await repoSongs(origin)) });
    }

    const m = await readLatest();

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
      const key = randomBytes(6).toString("base64url");
      const title = String(body.title || "Untitled").trim().slice(0, 200) || "Untitled";
      const done = await copy(src.href, SONGS_PREFIX + key + ext, { access: "public", addRandomSuffix: false });
      await del(src.href).catch(() => {});
      m.songs.push({ key, title, url: done.url, pathname: done.pathname, duration: Math.round(seconds * 100) / 100 });
    }

    else if (body.action === "rename" || body.action === "delete") {
      const id = String(body.id || "");
      if (id.startsWith("r:")) return json({ error: "That song lives in the GitHub repo. Rename or delete it there." }, 400);
      const song = m.songs.find((s) => "b:" + s.key === id);
      if (!song) return json({ error: "That song wasn't found." }, 404);
      if (body.action === "delete") {
        await del(song.url).catch(() => {});
        m.songs = m.songs.filter((s) => s !== song);
      } else {
        const title = String(body.title || "").trim().slice(0, 200);
        if (!title) return json({ error: "Give the song a name." }, 400);
        song.title = title;
      }
    }

    else if (body.action === "play") {
      const id = String(body.id || "");
      const repo = await repoSongs(origin);
      if (!repo.some((s) => s.id === id) && !m.songs.some((s) => "b:" + s.key === id)) return json({ error: "That song wasn't found." }, 404);
      m.onAir = { id, startedAt: Date.now() + 1500 };
    }

    else return json({ error: "Unknown action." }, 400);

    await save(m);
    return json({ ok: true, ...forListeners(m, await repoSongs(origin)) });
  } catch (e) {
    return json({ error: "That didn't work: " + String(e && e.message) }, 500);
  }
}
