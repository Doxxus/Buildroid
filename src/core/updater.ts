import { parseChecksumFile, sha256Hex, timingSafeEqual, verifySignature } from './crypto';
import { activate, prune, siteDir, stage } from './bundles';
import { downloadAsset, fetchRelease, parseSha, type Release } from './github';
import { injectWrapper } from './inject';
import { StateStore, type State } from './state';
import { extractZip } from './zip';
import { UpdateError, type FsPort, type HttpPort, type KV, type PointerPort, type WrapperConfig } from './types';

export const THROTTLE_MS = 15 * 60 * 1000;

export interface UpdaterDeps {
  cfg: WrapperConfig;
  http: HttpPort;
  fs: FsPort;
  kv: KV;
  pointer: PointerPort;
  getToken: () => Promise<string | null>;
  /** Returns the wrapper runtime JS to inject into the new bundle. */
  getWrapper: () => Promise<Uint8Array>;
  now: () => number;
}

export type UpdateResult =
  | { status: 'throttled' | 'not-modified' | 'up-to-date' }
  | { status: 'updated'; sha: string }
  | { status: 'rejected-downgrade'; error: string }
  | { status: 'failed'; error: string };

/** Removes anything that looks like a credential from a message that will be shown/stored. */
export function scrub(msg: string, token: string | null): string {
  let m = msg;
  if (token) m = m.split(token).join('***');
  return m.replace(/(gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, '***').replace(/Bearer\s+\S+/gi, 'Bearer ***');
}

function findAsset(rel: Release, name: string) {
  return rel.assets.find((a) => a.name === name);
}

function isDowngrade(state: State, rel: Release): boolean {
  if (!state.publishedAt) return false;
  const next = Date.parse(rel.publishedAt);
  const cur = Date.parse(state.publishedAt);
  return Number.isNaN(next) || Number.isNaN(cur) || next < cur; // fail closed on unparsable dates
}

export async function checkForUpdate(d: UpdaterDeps, opts: { force?: boolean; throttle?: boolean } = {}): Promise<UpdateResult> {
  const store = new StateStore(d.kv);
  const state = await store.load();
  const now = d.now();
  if (opts.throttle && !opts.force && state.lastCheck && now - state.lastCheck < THROTTLE_MS) return { status: 'throttled' };
  await store.patch({ lastCheck: now });

  const token = await d.getToken();
  try {
    const r = await fetchRelease(d.http, d.cfg, token, opts.force ? null : (state.etag ?? null));
    if (r.notModified) return { status: 'not-modified' };
    const { release } = r;
    const sha = parseSha(release.body);

    if (sha === state.sha) {
      await store.patch({ etag: r.etag, lastError: undefined });
      return { status: 'up-to-date' };
    }
    if (!opts.force && isDowngrade(state, release)) {
      const error = 'downgrade rejected: release is older than the installed bundle';
      await store.patch({ lastError: error });
      return { status: 'rejected-downgrade', error };
    }

    const bundleAsset = findAsset(release, d.cfg.assetName);
    const sumAsset = findAsset(release, d.cfg.checksumAssetName);
    const sigAsset = findAsset(release, d.cfg.signatureAssetName);
    if (!bundleAsset || !sumAsset) throw new UpdateError('asset-missing', 'release is missing the bundle or checksum asset');
    if (d.cfg.requireSignature && !sigAsset) throw new UpdateError('signature-missing', 'release has no signature asset');

    const dec = new TextDecoder();
    const zip = await downloadAsset(d.http, d.cfg, token, bundleAsset, d.cfg.maxDownloadBytes);
    const sumText = dec.decode(await downloadAsset(d.http, d.cfg, token, sumAsset, 4096));
    const sigText = sigAsset ? dec.decode(await downloadAsset(d.http, d.cfg, token, sigAsset, 4096)) : null;

    // (a) checksum
    const expected = parseChecksumFile(sumText);
    if (!timingSafeEqual(await sha256Hex(zip), expected)) throw new UpdateError('checksum-mismatch', 'bundle checksum does not match bundle.sha256');

    // (b) signature
    let sigStatus: State['sigStatus'] = 'not-required';
    if (sigText !== null) {
      const keys = [d.cfg.publicKey, d.cfg.nextPublicKey ?? ''];
      if (!verifySignature(zip, sigText.trim(), keys)) {
        await store.patch({ sigStatus: 'invalid' });
        if (d.cfg.requireSignature) throw new UpdateError('signature-invalid', 'bundle signature is invalid');
      } else {
        sigStatus = 'verified';
      }
    } else {
      sigStatus = 'missing';
    }

    // (c) URL ownership and redirect-host checks are enforced inside downloadAsset on every hop.

    const files = extractZip(zip, d.cfg.limits);
    injectWrapper(files, await d.getWrapper());

    const previousDir = state.sha ? siteDir(state.sha) : null;
    const dest = await stage(d.fs, sha, files);
    await activate(d.fs, d.pointer, dest, previousDir, async () => {
      await store.patch({
        sha,
        publishedAt: release.publishedAt,
        etag: r.etag,
        previousSha: state.sha,
        lastError: undefined,
        sigStatus,
      });
    });
    // After the swap succeeded: keep the new and the previous version only.
    const keep = [sha, ...(state.sha ? [state.sha] : [])];
    await prune(d.fs, keep).catch(() => undefined);
    return { status: 'updated', sha };
  } catch (e) {
    const error = scrub(e instanceof UpdateError ? `${e.code}: ${e.message}` : `unexpected: ${(e as Error)?.message ?? e}`, token);
    await store.patch({ lastError: error }).catch(() => undefined);
    return { status: 'failed', error };
  }
}
