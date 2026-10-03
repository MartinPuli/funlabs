/**
 * MediaRecorder writes WebM without a Duration element, so players report an
 * infinite duration and seeking to a moment fails. This inserts the measured
 * duration into the Segment Info header (TimecodeScale assumed 1 ms, which is
 * what MediaRecorder writes). The media data is not touched.
 */

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_DURATION = 0x4489;
const ID_TIMECODE_SCALE = 0x2ad7b1;

function readId(b: Uint8Array, p: number): { id: number; len: number } | null {
  const first = b[p];
  if (first === undefined) return null;
  let len = 0;
  for (let mask = 0x80, i = 1; i <= 4; i++, mask >>= 1) {
    if (first & mask) {
      len = i;
      break;
    }
  }
  if (!len || p + len > b.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[p + i];
  return { id, len };
}

function readSize(b: Uint8Array, p: number): { size: number; len: number; unknown: boolean } | null {
  const first = b[p];
  if (first === undefined) return null;
  let len = 0;
  for (let mask = 0x80, i = 1; i <= 8; i++, mask >>= 1) {
    if (first & mask) {
      len = i;
      break;
    }
  }
  if (!len || p + len > b.length) return null;
  let value = first & ((1 << (8 - len)) - 1);
  let allOnes = value === (1 << (8 - len)) - 1;
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[p + i];
    if (b[p + i] !== 0xff) allOnes = false;
  }
  return { size: value, len, unknown: allOnes };
}

function encodeSize(size: number): Uint8Array {
  for (let len = 1; len <= 8; len++) {
    if (size < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len);
      let v = size;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = v & 0xff;
        v = Math.floor(v / 256);
      }
      out[0] |= 1 << (8 - len);
      return out;
    }
  }
  throw new Error('EBML size too large');
}

function float64(value: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, false);
  return new Uint8Array(buf);
}

/** Returns the patched header bytes, or null when the file is not a patchable WebM. */
export function patchWebmHead(head: Uint8Array, durationMs: number): Uint8Array | null {
  let p = 0;
  const ebml = readId(head, p);
  if (!ebml || ebml.id !== ID_EBML) return null;
  p += ebml.len;
  const ebmlSize = readSize(head, p);
  if (!ebmlSize || ebmlSize.unknown) return null;
  p += ebmlSize.len + ebmlSize.size;
  const seg = readId(head, p);
  if (!seg || seg.id !== ID_SEGMENT) return null;
  p += seg.len;
  const segSize = readSize(head, p);
  if (!segSize) return null;
  p += segSize.len;
  // Walk the Segment's first children until Info.
  for (let guard = 0; guard < 16 && p < head.length; guard++) {
    const el = readId(head, p);
    if (!el) return null;
    const size = readSize(head, p + el.len);
    if (!size || size.unknown) return null;
    const dataStart = p + el.len + size.len;
    const dataEnd = dataStart + size.size;
    if (dataEnd > head.length) return null;
    if (el.id !== ID_INFO) {
      p = dataEnd;
      continue;
    }
    // Inside Info: overwrite an existing Duration, or append one.
    let q = dataStart;
    let scale = 1_000_000;
    while (q < dataEnd) {
      const c = readId(head, q);
      if (!c) return null;
      const cs = readSize(head, q + c.len);
      if (!cs) return null;
      const cData = q + c.len + cs.len;
      if (c.id === ID_TIMECODE_SCALE) {
        let v = 0;
        for (let i = 0; i < cs.size; i++) v = v * 256 + head[cData + i];
        scale = v || 1_000_000;
      }
      if (c.id === ID_DURATION && cs.size === 8) {
        const out = head.slice();
        out.set(float64((durationMs * 1_000_000) / scale), cData);
        return out;
      }
      q = cData + cs.size;
    }
    const durationEl = new Uint8Array([0x44, 0x89, 0x88, ...float64((durationMs * 1_000_000) / scale)]);
    const newInfoSize = size.size + durationEl.length;
    const sizeBytes = encodeSize(newInfoSize);
    const before = head.subarray(0, p + el.len);
    const children = head.subarray(dataStart, dataEnd);
    const after = head.subarray(dataEnd);
    const out = new Uint8Array(before.length + sizeBytes.length + children.length + durationEl.length + after.length);
    let o = 0;
    out.set(before, o);
    o += before.length;
    out.set(sizeBytes, o);
    o += sizeBytes.length;
    out.set(children, o);
    o += children.length;
    out.set(durationEl, o);
    o += durationEl.length;
    out.set(after, o);
    return out;
  }
  return null;
}

/** Patches a recorded WebM blob. Returns the original blob when not applicable. */
export async function withWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!blob.type.includes('webm') || !(durationMs > 0)) return blob;
  const headLen = Math.min(blob.size, 256 * 1024);
  const head = new Uint8Array(await blob.slice(0, headLen).arrayBuffer());
  const patched = patchWebmHead(head, durationMs);
  if (!patched) return blob;
  return new Blob([patched as BlobPart, blob.slice(headLen)], { type: blob.type });
}
