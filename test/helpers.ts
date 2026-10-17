import nacl from 'tweetnacl';
import { zipSync } from 'fflate';
import { toB64, sha256Hex } from '../src/core/crypto';
import type { FsPort, HttpPort, HttpResponse, KV, PointerPort, WrapperConfig } from '../src/core/types';
import type { UpdaterDeps } from '../src/core/updater';

export const enc = (s: string) => new TextEncoder().encode(s);
export const SHA_A = 'a'.repeat(40);
export const SHA_B = 'b'.repeat(40);
export const SHA_C = 'c'.repeat(40);

export class MemFs implements FsPort {
  files = new Map<string, Uint8Array>();
  failRename = false;
  async writeFile(p: string, d: Uint8Array) { this.files.set(p, d); }
  async rename(from: string, to: string) {
    if (this.failRename) throw new Error('rename failed');
    for (const [k, v] of [...this.files]) {
      if (k === from || k.startsWith(from + '/')) {
        this.files.delete(k);
        this.files.set(to + k.slice(from.length), v);
      }
    }
  }
  async remove(p: string) {
    for (const k of [...this.files.keys()]) if (k === p || k.startsWith(p + '/')) this.files.delete(k);
  }
  async readdir(p: string) {
    const out = new Set<string>();
    for (const k of this.files.keys()) if (k.startsWith(p + '/')) out.add(k.slice(p.length + 1).split('/')[0]);
    return [...out];
  }
  async exists(p: string) {
    return [...this.files.keys()].some((k) => k === p || k.startsWith(p + '/'));
  }
}

export class MemKV implements KV {
  m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  async set(k: string, v: string) { this.m.set(k, v); }
}

export class FakePointer implements PointerPort {
  current: string | null = null;
  fail = false;
  async activate(dir: string) {
    if (this.fail) throw new Error('pointer failed');
    this.current = dir;
  }
}

export class FakeHttp implements HttpPort {
  calls: { url: string; headers: Record<string, string> }[] = [];
  routes = new Map<string, HttpResponse>();
  async get(url: string, headers: Record<string, string>): Promise<HttpResponse> {
    this.calls.push({ url, headers });
    return this.routes.get(url) ?? { status: 404, headers: {} };
  }
}

export const testCfg = (over: Partial<WrapperConfig> = {}): WrapperConfig => ({
  owner: 'me',
  repo: 'site',
  releaseTag: 'latest-bundle',
  assetName: 'bundle.zip',
  checksumAssetName: 'bundle.sha256',
  signatureAssetName: 'bundle.sig',
  publicKey: '',
  requireSignature: true,
  maxDownloadBytes: 1024 * 1024,
  limits: { maxFiles: 20, maxTotalBytes: 100_000, maxFileBytes: 50_000 },
  ...over,
});

export const makeKeys = () => {
  const kp = nacl.sign.keyPair();
  return { pub: toB64(kp.publicKey), secret: kp.secretKey };
};

export const goodZip = (extra: Record<string, Uint8Array> = {}) => zipSync({ 'index.html': enc('<html><head></head><body>hi</body></html>'), 'app.js': enc('1'), ...extra });

const API = 'https://api.github.com/repos/me/site/releases/tags/latest-bundle';
const dl = (n: string) => `https://github.com/me/site/releases/download/latest-bundle/${n}`;

export interface PublishOpts {
  sha: string;
  zip: Uint8Array;
  publishedAt?: string;
  secret?: Uint8Array;
  tamperSum?: boolean;
  omitSig?: boolean;
  badSig?: boolean;
  etag?: string;
}

export function makeWorld(cfgOver: Partial<WrapperConfig> = {}) {
  const keys = makeKeys();
  const http = new FakeHttp();
  const fs = new MemFs();
  const kv = new MemKV();
  const pointer = new FakePointer();
  const cfg = testCfg({ publicKey: keys.pub, ...cfgOver });
  let now = 1_000_000_000_000;
  const deps: UpdaterDeps = {
    cfg, http, fs, kv, pointer,
    getToken: async () => null,
    getWrapper: async () => enc('/*wrapper*/'),
    now: () => now,
  };
  let n = 0;
  async function publish(o: PublishOpts) {
    const asset = (name: string, bytes: Uint8Array) => {
      http.routes.set(dl(name), { status: 200, headers: {}, bytes });
      return { name, url: `https://api.github.com/repos/me/site/releases/assets/${++n}`, browser_download_url: dl(name), size: bytes.length };
    };
    const sum = o.tamperSum ? 'f'.repeat(64) : await sha256Hex(o.zip);
    const sig = o.badSig ? nacl.sign.detached(enc('other'), o.secret ?? keys.secret) : nacl.sign.detached(o.zip, o.secret ?? keys.secret);
    const assets = [asset('bundle.zip', o.zip), asset('bundle.sha256', enc(sum)), ...(o.omitSig ? [] : [asset('bundle.sig', enc(toB64(sig)))])];
    http.routes.set(API, {
      status: 200,
      headers: { etag: o.etag ?? `"etag-${o.sha.slice(0, 4)}"` },
      text: JSON.stringify({ body: o.sha + '\n', published_at: o.publishedAt ?? '2026-01-01T00:00:00Z', assets }),
    });
  }
  return { keys, http, fs, kv, pointer, cfg, deps, publish, advance: (ms: number) => (now += ms) };
}
