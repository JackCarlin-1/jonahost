// Hands the station desk a short-lived token to upload one song straight to Vercel Blob,
// but only when the right password comes with the request.
import { handleUpload } from "@vercel/blob/client";
import { passwordOk, INCOMING_PREFIX, AUDIO_TYPES, MAX_BYTES, json } from "../lib/station.mjs";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let password = "";
        try { password = JSON.parse(clientPayload || "{}").password; } catch {}
        if (!passwordOk(password)) throw new Error("wrong-password");
        if (!pathname.startsWith(INCOMING_PREFIX) || pathname.includes("..")) throw new Error("bad-path");
        return { allowedContentTypes: AUDIO_TYPES, maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true };
      },
    });
    return json(result);
  } catch (e) {
    const msg = String(e && e.message);
    if (msg.includes("wrong-password")) return json({ error: "Wrong password." }, 401);
    return json({ error: "Upload couldn't start. " + msg }, 400);
  }
}
