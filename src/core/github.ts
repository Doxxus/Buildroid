import { UpdateError, type HttpPort, type WrapperConfig } from './types';

export interface ReleaseAsset {
  name: string;
  url: string; // API URL (works for private repos with a token)
  browser_download_url: string;
  size: number;
}
export interface Release {
  body: string;
  publishedAt: string;
  assets: ReleaseAsset[];
}

const API_HOST = 'api.github.com';
// Hosts allowed to receive the token (only ever as an Authorization header).
const AUTH_HOSTS = new Set([API_HOST, 'github.com']);
// GitHub's own release-asset CDN hosts, reachable only via redirect.
const CDN_HOSTS = new Set([
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
]);
const MAX_HOPS = 5;

const isAllowedHost = (h: string) => AUTH_HOSTS.has(h) || CDN_HOSTS.has(h);

export function assertRepoUrl(rawUrl: string, cfg: Pick<WrapperConfig, 'owner' | 'repo'>): void {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new UpdateError('url-invalid', 'asset URL is not a valid URL');
  }
  const repo = `${cfg.owner}/${cfg.repo}`.toLowerCase();
  const path = decodeURIComponent(u.pathname).toLowerCase();
  const ok =
    u.protocol === 'https:' &&
    ((u.hostname === API_HOST && path.startsWith(`/repos/${repo}/releases/assets/`)) ||
      (u.hostname === 'github.com' && path.startsWith(`/${repo}/releases/download/`)));
  if (!ok) throw new UpdateError('url-not-owned', 'asset URL does not belong to the configured repository');
}

export type ReleaseResult = { notModified: true } | { notModified: false; release: Release; etag?: string };

export async function fetchRelease(
  http: HttpPort,
  cfg: WrapperConfig,
  token: string | null,
  etag: string | null,
): Promise<ReleaseResult> {
  const url = `https://${API_HOST}/repos/${cfg.owner}/${cfg.repo}/releases/tags/${encodeURIComponent(cfg.releaseTag)}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (etag) headers['If-None-Match'] = etag;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await http.get(url, headers, false);
  if (res.status === 304) return { notModified: true };
  if (res.status === 404) throw new UpdateError('release-not-found', 'release not found (private repo needs a token?)');
  if (res.status !== 200) throw new UpdateError('http-error', `GitHub API returned HTTP ${res.status}`);
  let j: any;
  try {
    j = JSON.parse(res.text ?? '');
  } catch {
    throw new UpdateError('release-invalid', 'release response is not valid JSON');
  }
  if (typeof j?.body !== 'string' || typeof j?.published_at !== 'string' || !Array.isArray(j?.assets)) {
    throw new UpdateError('release-invalid', 'release response is missing required fields');
  }
  const assets: ReleaseAsset[] = j.assets
    .filter((a: any) => a && typeof a.name === 'string' && typeof a.url === 'string' && typeof a.browser_download_url === 'string')
    .map((a: any) => ({ name: a.name, url: a.url, browser_download_url: a.browser_download_url, size: Number(a.size) || 0 }));
  return { notModified: false, release: { body: j.body, publishedAt: j.published_at, assets }, etag: res.headers['etag'] };
}

export function parseSha(body: string): string {
  const sha = body.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new UpdateError('release-sha', 'release body is not a full commit SHA');
  return sha;
}

/** Downloads one asset, validating every redirect hop. Token goes only to api.github.com / github.com. */
export async function downloadAsset(
  http: HttpPort,
  cfg: WrapperConfig,
  token: string | null,
  asset: ReleaseAsset,
  maxBytes: number,
): Promise<Uint8Array> {
  if (asset.size > maxBytes) throw new UpdateError('too-large', `${asset.name} exceeds the ${maxBytes} byte download limit`);
  let url = token ? asset.url : asset.browser_download_url;
  assertRepoUrl(url, cfg);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new UpdateError('url-insecure', 'refusing non-HTTPS download');
    if (!isAllowedHost(u.hostname)) throw new UpdateError('host-not-allowed', `redirect to disallowed host ${u.hostname}`);
    const headers: Record<string, string> = { Accept: 'application/octet-stream' };
    if (token && AUTH_HOSTS.has(u.hostname)) headers.Authorization = `Bearer ${token}`;
    const res = await http.get(url, headers, true);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers['location'];
      if (!loc) throw new UpdateError('http-error', 'redirect without Location');
      url = new URL(loc, url).toString();
      continue;
    }
    if (res.status !== 200 || !res.bytes) throw new UpdateError('http-error', `download of ${asset.name} returned HTTP ${res.status}`);
    if (res.bytes.length > maxBytes) throw new UpdateError('too-large', `${asset.name} exceeds the ${maxBytes} byte download limit`);
    return res.bytes;
  }
  throw new UpdateError('too-many-redirects', 'too many redirects');
}
