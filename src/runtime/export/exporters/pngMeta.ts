/**
 * Minimal PNG text-chunk codec, so a still export can carry the scene that produced it. We write
 * one iTXt chunk (UTF-8, uncompressed) right after IHDR  -  ancillary, so every PNG reader ignores
 * it  -  and read back both iTXt and tEXt for tolerance. No dependency, no full PNG parse: chunks
 * are length-prefixed, so we can walk and splice them directly.
 */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function isPng(data: Uint8Array): boolean {
  return data.length > 8 && PNG_SIG.every((b, i) => data[i] === b);
}

/** Build one chunk: length + type + payload + CRC (CRC covers type + payload). */
function buildChunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(out.subarray(4, 8 + payload.length)));
  return out;
}

/** iTXt payload: keyword \0 compressionFlag(0) compressionMethod(0) langTag \0 translated \0 utf8. */
function buildITxtPayload(keyword: string, text: string): Uint8Array {
  const enc = new TextEncoder();
  const kw = enc.encode(keyword);
  const body = enc.encode(text);
  const out = new Uint8Array(kw.length + 5 + body.length);
  out.set(kw, 0);
  // five zero bytes: keyword terminator, both compression fields, empty lang tag + translated kw
  out.set(body, kw.length + 5);
  return out;
}

/** Insert `text` under `keyword` into PNG bytes. Null when the data isn't a PNG. */
export function embedPngTextBytes(data: Uint8Array, keyword: string, text: string): Uint8Array<ArrayBuffer> | null {
  if (!isPng(data)) return null;
  // IHDR is mandatory-first and fixed-size: signature(8) + length(4) + type(4) + data(13) + crc(4).
  const insertAt = 8 + 4 + 4 + 13 + 4;
  const chunk = buildChunk("iTXt", buildITxtPayload(keyword, text));
  const out = new Uint8Array(new ArrayBuffer(data.length + chunk.length));
  out.set(data.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(data.subarray(insertAt), insertAt + chunk.length);
  return out;
}

/** Blob-level wrapper for {@link embedPngTextBytes} (non-PNG blobs pass through unchanged). */
export async function embedPngText(blob: Blob, keyword: string, text: string): Promise<Blob> {
  const out = embedPngTextBytes(new Uint8Array(await blob.arrayBuffer()), keyword, text);
  return out ? new Blob([out], { type: blob.type || "image/png" }) : blob;
}

/** Find the text stored under `keyword` (iTXt or tEXt), or null. */
export function readPngText(data: Uint8Array, keyword: string): string | null {
  if (!isPng(data)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 8;
  while (at + 12 <= data.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(data[at + 4], data[at + 5], data[at + 6], data[at + 7]);
    const payload = data.subarray(at + 8, at + 8 + len);
    if (type === "iTXt" || type === "tEXt") {
      const nul = payload.indexOf(0);
      if (nul >= 0 && new TextDecoder().decode(payload.subarray(0, nul)) === keyword) {
        if (type === "tEXt") return new TextDecoder("latin1").decode(payload.subarray(nul + 1));
        // iTXt: skip compression flag/method, then two more nul-terminated fields.
        if (payload[nul + 1] !== 0) return null; // compressed text  -  we never write it, skip
        let p = nul + 3;
        for (let fields = 0; fields < 2 && p < payload.length; p++) if (payload[p] === 0) fields++;
        return new TextDecoder().decode(payload.subarray(p));
      }
    }
    if (type === "IEND") break;
    at += 12 + len;
  }
  return null;
}
