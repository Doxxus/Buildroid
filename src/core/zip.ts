import { unzipSync } from 'fflate';
import { UpdateError, type ZipLimits } from './types';

export const RESERVED_DIR = '__wrapper';

export interface ZipEntry {
  raw: string;
  name: string; // normalized, '/'-separated, no trailing slash
  isDir: boolean;
  size: number;
}

const bad = (code: string, msg: string) => new UpdateError(code, msg);

export function normalizeEntryName(raw: string): string {
  if (!raw || raw.includes('\0') || raw.includes('\\')) throw bad('zip-bad-name', 'zip entry has an invalid name');
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw bad('zip-slip', 'zip entry has an absolute path');
  const out: string[] = [];
  for (const p of raw.split('/')) {
    if (p === '..') throw bad('zip-slip', 'zip entry escapes the target directory');
    if (p === '' || p === '.') continue;
    out.push(p);
  }
  if (out.length === 0) throw bad('zip-bad-name', 'zip entry has an empty name');
  return out.join('/');
}

/** Parses the central directory only (no decompression) and enforces all structural limits. */
export function inspectZip(zip: Uint8Array, limits: ZipLimits): ZipEntry[] {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad('zip-corrupt', 'not a valid zip file');
  const total = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw bad('zip-unsupported', 'zip64 archives are not supported');
  if (total > limits.maxFiles) throw bad('zip-too-many-files', `zip has more than ${limits.maxFiles} entries`);
  if (cdOff + cdSize > eocd) throw bad('zip-corrupt', 'zip central directory is out of bounds');

  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  let p = cdOff;
  for (let n = 0; n < total; n++) {
    if (p + 46 > eocd || dv.getUint32(p, true) !== 0x02014b50) throw bad('zip-corrupt', 'bad zip central directory entry');
    const madeBy = dv.getUint16(p + 4, true);
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const uncompressed = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const extAttr = dv.getUint32(p + 38, true);
    const localOff = dv.getUint32(p + 42, true);
    if (p + 46 + nameLen + extraLen + commentLen > eocd) throw bad('zip-corrupt', 'zip entry is out of bounds');
    const raw = new TextDecoder('utf-8').decode(zip.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    const name = normalizeEntryName(raw);
    if (flags & 1) throw bad('zip-encrypted', 'encrypted zip entries are not allowed');
    if (method !== 0 && method !== 8) throw bad('zip-unsupported', 'unsupported zip compression method');
    // Unix mode lives in the high 16 bits of the external attributes when "made by" = 3 (Unix).
    if (madeBy >> 8 === 3) {
      const type = (extAttr >>> 16) & 0xf000;
      if (type === 0xa000) throw bad('zip-symlink', 'symlinks are not allowed in the bundle');
      if (type !== 0 && type !== 0x8000 && type !== 0x4000) throw bad('zip-special', 'special files are not allowed in the bundle');
    }
    if (name.split('/')[0] === RESERVED_DIR) throw bad('zip-reserved', `"${RESERVED_DIR}" is reserved`);
    const key = name.toLowerCase();
    if (seen.has(key)) throw bad('zip-duplicate', 'duplicate zip entry names');
    seen.add(key);

    const isDir = raw.endsWith('/');
    if (uncompressed > limits.maxFileBytes) throw bad('zip-bomb', 'zip entry exceeds the per-file size limit');
    totalBytes += uncompressed;
    // The local header must agree with the central directory (unless sizes are in a data descriptor).
    if (localOff + 30 > cdOff || dv.getUint32(localOff, true) !== 0x04034b50) throw bad('zip-corrupt', 'bad zip local header');
    if (!(flags & 8) && dv.getUint32(localOff + 22, true) !== uncompressed) throw bad('zip-bomb', 'zip entry size does not match its header');
    if (totalBytes > limits.maxTotalBytes) throw bad('zip-bomb', 'zip uncompressed size exceeds the limit');
    entries.push({ raw, name, isDir, size: uncompressed });
  }
  if (!entries.some((e) => !e.isDir && e.name === 'index.html')) throw bad('zip-no-index', 'index.html is missing at the zip root');
  return entries;
}

/** Validates, then decompresses. Declared sizes are re-checked against actual output. */
export function extractZip(zip: Uint8Array, limits: ZipLimits): Map<string, Uint8Array> {
  const entries = inspectZip(zip, limits);
  const files = new Map(entries.filter((e) => !e.isDir).map((e) => [e.raw, e]));
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(zip, { filter: (f) => files.has(f.name) });
  } catch {
    throw bad('zip-corrupt', 'failed to decompress zip');
  }
  const out = new Map<string, Uint8Array>();
  let total = 0;
  for (const [rawName, e] of files) {
    const data = raw[rawName];
    if (!data || data.length !== e.size) throw bad('zip-bomb', 'zip entry size does not match its header');
    total += data.length;
    if (total > limits.maxTotalBytes) throw bad('zip-bomb', 'zip uncompressed size exceeds the limit');
    out.set(e.name, data);
  }
  return out;
}
