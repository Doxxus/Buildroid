import { describe, expect, it } from 'vitest';
import { checkForUpdate, scrub } from '../src/core/updater';
import { StateStore } from '../src/core/state';
import { zipSync } from 'fflate';
import { SHA_A, SHA_B, SHA_C, enc, goodZip, makeKeys, makeWorld } from './helpers';

const state = (w: ReturnType<typeof makeWorld>) => new StateStore(w.kv).load();

describe('ETag / SHA comparison', () => {
  it('sends If-None-Match from the stored ETag and does nothing on 304', async () => {
    const w = makeWorld();
    await w.publish({ sha: SHA_A, zip: goodZip(), etag: '"v1"' });
    expect((await checkForUpdate(w.deps)).status).toBe('updated');
    w.http.calls.length = 0;
    w.http.routes.set('https://api.github.com/repos/me/site/releases/tags/latest-bundle', { status: 304, headers: {} });
    const r = await checkForUpdate(w.deps);
    expect(r.status).toBe('not-modified');
    expect(w.http.calls).toHaveLength(1);
    expect(w.http.calls[0].headers['If-None-Match']).toBe('"v1"');
  });

  it('does not download when the release SHA equals the installed SHA, but stores the new ETag', async () => {
    const w = makeWorld();
    await w.publish({ sha: SHA_A, zip: goodZip(), etag: '"v1"' });
    await checkForUpdate(w.deps);
    await w.publish({ sha: SHA_A, zip: goodZip(), etag: '"v2"' });
    w.http.calls.length = 0;
    expect((await checkForUpdate(w.deps)).status).toBe('up-to-date');
    expect(w.http.calls).toHaveLength(1);
    expect((await state(w)).etag).toBe('"v2"');
  });

  it('throttles non-forced resume checks to once per 15 minutes', async () => {
    const w = makeWorld();
    await w.publish({ sha: SHA_A, zip: goodZip() });
    await checkForUpdate(w.deps, { throttle: true });
    w.advance(14 * 60_000);
    expect((await checkForUpdate(w.deps, { throttle: true })).status).toBe('throttled');
    w.advance(2 * 60_000);
    expect((await checkForUpdate(w.deps, { throttle: true })).status).not.toBe('throttled');
  });

  it('rejects a release body that is not a full SHA', async () => {
    const w = makeWorld();
    await w.publish({ sha: '../../etc', zip: goodZip() });
    const r = await checkForUpdate(w.deps);
    expect(r.status).toBe('failed');
    expect(w.pointer.current).toBeNull();
  });
});

describe('successful update', () => {
  it('installs, injects the wrapper, switches pointer, stores state, keeps only current + previous', async () => {
    const w = makeWorld();
    await w.publish({ sha: SHA_A, zip: goodZip(), publishedAt: '2026-01-01T00:00:00Z' });
    await checkForUpdate(w.deps);
    await w.publish({ sha: SHA_B, zip: goodZip(), publishedAt: '2026-01-02T00:00:00Z' });
    await checkForUpdate(w.deps);
    await w.publish({ sha: SHA_C, zip: goodZip(), publishedAt: '2026-01-03T00:00:00Z' });
    const r = await checkForUpdate(w.deps);
    expect(r).toEqual({ status: 'updated', sha: SHA_C });
    expect(w.pointer.current).toBe(`site/${SHA_C}`);
    const s = await state(w);
    expect(s).toMatchObject({ sha: SHA_C, previousSha: SHA_B, sigStatus: 'verified' });
    expect((await w.fs.readdir('site')).sort()).toEqual([SHA_B, SHA_C]);
    expect(new TextDecoder().decode(w.fs.files.get(`site/${SHA_C}/index.html`))).toContain('/__wrapper/wrapper.js');
    expect(w.fs.files.has(`site/${SHA_C}/__wrapper/wrapper.js`)).toBe(true);
  });
});

describe('checksum and signature failures', () => {
  it('aborts on checksum mismatch and changes nothing', async () => {
    const w = makeWorld();
    await w.publish({ sha: SHA_A, zip: goodZip(), tamperSum: true });
    const r = await checkForUpdate(w.deps);
    expect(r).toMatchObject({ status: 'failed' });
    expect((r as any).error).toContain('checksum-mismatch');
    expect(w.pointer.current).toBeNull();
    expect(w.fs.files.size).toBe(0);
    const s = await state(w);
    expect(s.sha).toBeUndefined();
    expect(s.etag).toBeUndefined();
    expect(s.lastError).toContain('checksum-mismatch');
  });

  it('rejects a signature made with the wrong key', async () => {
    const w = makeWorld();
    await w.publish({ sha: SHA_A, zip: goodZip(), secret: makeKeys().secret });
    const r = await checkForUpdate(w.deps);
    expect((r as any).error).toContain('signature-invalid');
    expect(w.pointer.current).toBeNull();
    expect((await state(w)).sigStatus).toBe('invalid');
  });

  it('rejects a signature over different content', async () => {
    const w = makeWorld();
    await w.publish({ sha: SHA_A, zip: goodZip(), badSig: true });
    expect((await checkForUpdate(w.deps)).status).toBe('failed');
  });

  it('rejects a missing signature when required, accepts when not required', async () => {
    const w = makeWorld();
    await w.publish({ sha: SHA_A, zip: goodZip(), omitSig: true });
    expect((await checkForUpdate(w.deps)).status).toBe('failed');
    const w2 = makeWorld({ requireSignature: false });
    await w2.publish({ sha: SHA_A, zip: goodZip(), omitSig: true });
    expect((await checkForUpdate(w2.deps)).status).toBe('updated');
    expect((await state(w2)).sigStatus).toBe('missing');
  });

  it('accepts the secondary key during rotation', async () => {
    const next = makeKeys();
    const w = makeWorld({ nextPublicKey: next.pub });
    await w.publish({ sha: SHA_A, zip: goodZip(), secret: next.secret });
    expect((await checkForUpdate(w.deps)).status).toBe('updated');
  });
});

describe('malicious archives through the full pipeline', () => {
  it('rejects zip-slip and leaves nothing on disk', async () => {
    const w = makeWorld();
    await w.publish({ sha: SHA_A, zip: zipSync({ 'index.html': enc('x'), '../../evil': enc('x') }) });
    const r = await checkForUpdate(w.deps);
    expect((r as any).error).toContain('zip-slip');
    expect(w.fs.files.size).toBe(0);
    expect(w.pointer.current).toBeNull();
  });

  it('rejects a zip bomb', async () => {
    const w = makeWorld();
    await w.publish({ sha: SHA_A, zip: zipSync({ 'index.html': enc('x'), big: new Uint8Array(60_000) }) });
    expect((await checkForUpdate(w.deps) as any).error).toContain('zip-bomb');
  });

  it('rejects oversized downloads', async () => {
    const w = makeWorld({ maxDownloadBytes: 100 });
    await w.publish({ sha: SHA_A, zip: goodZip() });
    expect((await checkForUpdate(w.deps) as any).error).toContain('too-large');
  });
});

describe('downgrade protection', () => {
  it('rejects an older release unless forced', async () => {
    const w = makeWorld();
    await w.publish({ sha: SHA_B, zip: goodZip(), publishedAt: '2026-02-01T00:00:00Z' });
    await checkForUpdate(w.deps);
    await w.publish({ sha: SHA_A, zip: goodZip(), publishedAt: '2026-01-01T00:00:00Z' });
    expect((await checkForUpdate(w.deps)).status).toBe('rejected-downgrade');
    expect((await state(w)).sha).toBe(SHA_B);
    expect(w.pointer.current).toBe(`site/${SHA_B}`);
    expect((await checkForUpdate(w.deps, { force: true })).status).toBe('updated');
    expect((await state(w)).sha).toBe(SHA_A);
  });
});

describe('rollback when the swap fails', () => {
  async function installed() {
    const w = makeWorld();
    await w.publish({ sha: SHA_A, zip: goodZip(), publishedAt: '2026-01-01T00:00:00Z' });
    await checkForUpdate(w.deps);
    await w.publish({ sha: SHA_B, zip: goodZip(), publishedAt: '2026-01-02T00:00:00Z' });
    return w;
  }

  it('restores the previous pointer and removes the new dir when activation fails', async () => {
    const w = await installed();
    let calls = 0;
    const orig = w.pointer.activate.bind(w.pointer);
    w.pointer.activate = async (d) => {
      if (++calls === 1) throw new Error('boom');
      return orig(d);
    };
    const r = await checkForUpdate(w.deps);
    expect(r.status).toBe('failed');
    expect(w.pointer.current).toBe(`site/${SHA_A}`);
    expect(await w.fs.exists(`site/${SHA_B}`)).toBe(false);
    expect(await w.fs.exists(`site/${SHA_A}/index.html`)).toBe(true);
    expect((await state(w)).sha).toBe(SHA_A);
  });

  it('keeps the current bundle when the directory rename fails', async () => {
    const w = await installed();
    w.fs.failRename = true;
    expect((await checkForUpdate(w.deps)).status).toBe('failed');
    expect(w.pointer.current).toBe(`site/${SHA_A}`);
    expect((await w.fs.readdir('site')).sort()).toEqual([SHA_A]);
    expect((await state(w)).sha).toBe(SHA_A);
  });

  it('reverts the pointer if persisting state fails', async () => {
    const w = await installed();
    const set = w.kv.set.bind(w.kv);
    let armed = false;
    w.kv.set = async (k, v) => {
      if (armed && v.includes(SHA_B)) throw new Error('disk full');
      return set(k, v);
    };
    armed = true;
    expect((await checkForUpdate(w.deps)).status).toBe('failed');
    expect(w.pointer.current).toBe(`site/${SHA_A}`);
    expect(await w.fs.exists(`site/${SHA_B}`)).toBe(false);
  });
});

describe('host and token handling', () => {
  it('refuses a redirect to a foreign host and never sends the token to the CDN', async () => {
    const w = makeWorld();
    w.deps.getToken = async () => 'ghp_SECRET123456789012345678';
    await w.publish({ sha: SHA_A, zip: goodZip() });
    const apiAsset = JSON.parse(w.http.routes.get('https://api.github.com/repos/me/site/releases/tags/latest-bundle')!.text!).assets[0].url;
    w.http.routes.set(apiAsset, { status: 302, headers: { location: 'https://evil.example.com/x.zip' } });
    const r = await checkForUpdate(w.deps);
    expect((r as any).error).toContain('host-not-allowed');
    expect((r as any).error).not.toContain('SECRET');
    expect(w.http.calls.some((c) => c.url.includes('evil.example.com'))).toBe(false);
  });

  it('follows a redirect to GitHub CDN without the Authorization header', async () => {
    const w = makeWorld();
    w.deps.getToken = async () => 'tok';
    await w.publish({ sha: SHA_A, zip: goodZip() });
    const assets = JSON.parse(w.http.routes.get('https://api.github.com/repos/me/site/releases/tags/latest-bundle')!.text!).assets;
    for (const a of assets) {
      const cdn = `https://objects.githubusercontent.com/${a.name}`;
      w.http.routes.set(cdn, w.http.routes.get(a.browser_download_url)!);
      w.http.routes.set(a.url, { status: 302, headers: { location: cdn } });
    }
    expect((await checkForUpdate(w.deps)).status).toBe('updated');
    const cdnCalls = w.http.calls.filter((c) => c.url.startsWith('https://objects.'));
    expect(cdnCalls.length).toBeGreaterThan(0);
    expect(cdnCalls.every((c) => !('Authorization' in c.headers))).toBe(true);
    expect(w.http.calls.find((c) => c.url.startsWith('https://api.github.com/repos/me/site/releases/assets'))!.headers.Authorization).toBe('Bearer tok');
  });

  it('rejects assets that belong to another repo', async () => {
    const w = makeWorld();
    await w.publish({ sha: SHA_A, zip: goodZip() });
    const rel = JSON.parse(w.http.routes.get('https://api.github.com/repos/me/site/releases/tags/latest-bundle')!.text!);
    rel.assets[0].browser_download_url = 'https://github.com/attacker/site/releases/download/latest-bundle/bundle.zip';
    w.http.routes.set('https://api.github.com/repos/me/site/releases/tags/latest-bundle', { status: 200, headers: {}, text: JSON.stringify(rel) });
    expect(((await checkForUpdate(w.deps)) as any).error).toContain('url-not-owned');
  });

  it('scrubs tokens from messages', () => {
    expect(scrub('bad ghp_abcdefghijklmnop and Bearer xyz and mytoken', 'mytoken')).not.toMatch(/ghp_|xyz|mytoken/);
  });
});
