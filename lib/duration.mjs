// Exact song lengths for MP3, M4A/MP4 and WAV, with no dependencies.
// Shared by the deploy-time song scan and the station desk's upload API.
// ---------- MP4 / M4A: read the movie header's timescale and duration ----------
export function mp4Duration(buf) {
  const walk = (start, end) => {
    let p = start;
    while (p + 8 <= end) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString("latin1", p + 4, p + 8);
      let header = 8;
      if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); header = 16; }
      else if (size === 0) size = end - p;
      if (size < header) return null;
      if (type === "moov") { const r = walk(p + header, Math.min(p + size, end)); if (r) return r; }
      if (type === "mvhd") {
        const v = buf[p + header];
        if (v === 1) {
          const ts = buf.readUInt32BE(p + header + 20);
          const d = Number(buf.readBigUInt64BE(p + header + 24));
          return ts ? d / ts : null;
        }
        const ts = buf.readUInt32BE(p + header + 12);
        const d = buf.readUInt32BE(p + header + 16);
        return ts ? d / ts : null;
      }
      p += size;
    }
    return null;
  };
  return walk(0, buf.length);
}

// ---------- WAV: data size / byte rate ----------
export function wavDuration(buf) {
  if (buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WAVE") return null;
  let p = 12, byteRate = 0;
  while (p + 8 <= buf.length) {
    const id = buf.toString("latin1", p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(p + 16);
    if (id === "data" && byteRate) return Math.min(size, buf.length - p - 8) / byteRate;
    p += 8 + size + (size & 1);
  }
  return null;
}

// ---------- MP3: walk every frame and add up its samples (exact for CBR and VBR) ----------
const BITRATES = {
  "1-1": [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448],
  "1-2": [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],
  "1-3": [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],
  "2-1": [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],
  "2-2": [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
};
BITRATES["2-3"] = BITRATES["2-2"];
const RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };

function parseFrame(buf, p) {
  if (p + 4 > buf.length || buf[p] !== 0xff || (buf[p + 1] & 0xe0) !== 0xe0) return null;
  const vBits = (buf[p + 1] >> 3) & 3, lBits = (buf[p + 1] >> 1) & 3;
  if (vBits === 1 || lBits === 0) return null;
  const version = vBits === 3 ? 1 : vBits === 2 ? 2 : 2.5;
  const layer = 4 - lBits;
  const bIdx = buf[p + 2] >> 4, rIdx = (buf[p + 2] >> 2) & 3, pad = (buf[p + 2] >> 1) & 1;
  if (bIdx === 0 || bIdx === 15 || rIdx === 3) return null;
  const kbps = BITRATES[`${version === 1 ? 1 : 2}-${layer}`][bIdx];
  const rate = RATES[version][rIdx];
  const samples = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152;
  const len = layer === 1 ? (Math.floor((12 * kbps * 1000) / rate) + pad) * 4 : Math.floor((samples / 8) * kbps * 1000 / rate) + pad;
  return len > 4 ? { len, samples, rate } : null;
}

export function mp3Duration(buf) {
  let p = 0;
  // Skip any ID3v2 tags at the front.
  while (buf.toString("latin1", p, p + 3) === "ID3") {
    const size = ((buf[p + 6] & 0x7f) << 21) | ((buf[p + 7] & 0x7f) << 14) | ((buf[p + 8] & 0x7f) << 7) | (buf[p + 9] & 0x7f);
    p += 10 + size + ((buf[p + 5] & 0x10) ? 10 : 0);
  }
  // Find the first frame that is followed by a second valid frame.
  while (p < buf.length - 4) {
    const f = parseFrame(buf, p);
    if (f && parseFrame(buf, p + f.len)) break;
    p++;
  }
  let total = 0, rate = 0, frames = 0;
  while (p < buf.length - 4) {
    const f = parseFrame(buf, p);
    if (!f) { if (buf.toString("latin1", p, p + 3) === "TAG") break; p++; continue; }
    if (frames === 0) {
      // A Xing/Info header frame carries no audio; skip it.
      const tag = buf.indexOf("Xing", p), info = buf.indexOf("Info", p);
      const hit = [tag, info].filter((x) => x >= 0 && x < p + f.len);
      if (hit.length) { p += f.len; frames++; continue; }
    }
    total += f.samples; rate = f.rate; frames++; p += f.len;
  }
  return rate ? total / rate : null;
}

export function duration(buf, ext) {
  if (ext === ".wav") return wavDuration(buf);
  if (ext === ".mp3") return mp3Duration(buf);
  return mp4Duration(buf) ?? mp3Duration(buf);
}

