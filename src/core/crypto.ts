import nacl from 'tweetnacl';
import { UpdateError } from './types';

export function fromB64(s: string): Uint8Array {
  const bin = atob(s.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const dig = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  const d = new Uint8Array(dig);
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Accepts "<hex>" or "<hex>  bundle.zip" (sha256sum format). */
export function parseChecksumFile(text: string): string {
  const tok = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!/^[0-9a-f]{64}$/.test(tok)) throw new UpdateError('checksum-format', 'bundle.sha256 is not a valid SHA-256 hex digest');
  return tok;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** True if the detached signature verifies under ANY of the given base64 public keys. */
export function verifySignature(data: Uint8Array, sigB64: string, publicKeysB64: string[]): boolean {
  let sig: Uint8Array;
  try {
    sig = fromB64(sigB64);
  } catch {
    return false;
  }
  if (sig.length !== nacl.sign.signatureLength) return false;
  for (const k of publicKeysB64) {
    if (!k) continue;
    let pk: Uint8Array;
    try {
      pk = fromB64(k);
    } catch {
      continue;
    }
    if (pk.length !== nacl.sign.publicKeyLength) continue;
    if (nacl.sign.detached.verify(data, sig, pk)) return true;
  }
  return false;
}
