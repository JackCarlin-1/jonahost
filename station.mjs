// Shared helpers for the station desk API: the password check and how a song's
// details are stored in its file name in Vercel Blob.
import { createHash, timingSafeEqual } from "node:crypto";

export const SONGS_PREFIX = "station/songs/";
export const INCOMING_PREFIX = "station/incoming/";
export const AUDIO_TYPES = ["audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/wave", "video/mp4"];
export const AUDIO_EXTS = [".mp3", ".m4a", ".mp4", ".aac", ".wav"];
export const MAX_BYTES = 60 * 1024 * 1024;

export function passwordOk(given) {
  const real = process.env.STATION_PASSWORD;
  if (!real || typeof given !== "string" || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(real).digest();
  return timingSafeEqual(a, b);
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s) => Buffer.from(s, "base64url").toString("utf8");

// station/songs/<id>~<length in hundredths of a second>~<title, base64url>.<ext>
export function songPath(id, seconds, title, ext) {
  return `${SONGS_PREFIX}${id}~${Math.round(seconds * 100)}~${b64(title.slice(0, 200))}${ext}`;
}

export function parseSong(blob) {
  const name = blob.pathname.slice(SONGS_PREFIX.length);
  const m = /^([A-Za-z0-9_-]+)~(\d+)~([A-Za-z0-9_-]*)(\.[a-z0-9]+)$/.exec(name);
  if (!m) return null;
  let title = "Untitled";
  try { title = unb64(m[3]) || "Untitled"; } catch {}
  return { id: "b:" + m[1], key: m[1], title, file: blob.url, duration: Number(m[2]) / 100, ext: m[4], pathname: blob.pathname };
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
