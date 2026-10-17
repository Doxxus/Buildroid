import type { WrapperConfig } from './core/types';

// Replaced at build time by vite.config.ts from env vars (OWNER, REPO, PUBLIC_KEY, ...).
declare const __CFG__: Record<string, string | undefined> | undefined;
const e: Record<string, string | undefined> = typeof __CFG__ !== 'undefined' && __CFG__ ? __CFG__ : {};

/** Edit these defaults or override them per variant with env vars at build time. */
export const config: WrapperConfig = {
  owner: e.owner ?? 'your-github-user',
  repo: e.repo ?? 'your-site-repo',
  releaseTag: e.releaseTag ?? 'latest-bundle',
  assetName: e.assetName ?? 'bundle.zip',
  checksumAssetName: e.checksumAssetName ?? 'bundle.sha256',
  signatureAssetName: e.signatureAssetName ?? 'bundle.sig',
  publicKey: e.publicKey ?? '',
  nextPublicKey: e.nextPublicKey || undefined,
  requireSignature: e.requireSignature !== 'false',
  maxDownloadBytes: 50 * 1024 * 1024,
  limits: { maxFiles: 5000, maxTotalBytes: 200 * 1024 * 1024, maxFileBytes: 50 * 1024 * 1024 },
};
