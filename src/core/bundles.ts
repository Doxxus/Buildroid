import type { FsPort, PointerPort } from './types';

export const SITE_ROOT = 'site';
export const siteDir = (sha: string) => `${SITE_ROOT}/${sha}`;
const tmpDir = (sha: string) => `${SITE_ROOT}/.tmp-${sha}`;

/** Writes files to a temp dir, then renames into site/<sha>. On failure nothing is left behind. */
export async function stage(fs: FsPort, sha: string, files: Map<string, Uint8Array>): Promise<string> {
  const tmp = tmpDir(sha);
  const dest = siteDir(sha);
  await fs.remove(tmp);
  try {
    for (const [name, data] of files) await fs.writeFile(`${tmp}/${name}`, data);
    if (!(await fs.exists(`${tmp}/index.html`))) throw new Error('index.html missing after extraction');
    await fs.remove(dest); // stale leftover for the same SHA, never the active dir (sha equality is checked earlier)
    await fs.rename(tmp, dest);
  } catch (e) {
    await fs.remove(tmp);
    throw e;
  }
  return dest;
}

/**
 * Atomically points the app at `dest`. If the switch fails, restores `previousDir`
 * and removes `dest`, so the current bundle keeps being served.
 */
export async function activate(fs: FsPort, pointer: PointerPort, dest: string, previousDir: string | null, after: () => Promise<void>): Promise<void> {
  try {
    await pointer.activate(dest);
    await after();
  } catch (e) {
    if (previousDir) await pointer.activate(previousDir).catch(() => undefined);
    await fs.remove(dest);
    throw e;
  }
}

/** Deletes every site/ subdirectory except the ones in `keep`. */
export async function prune(fs: FsPort, keep: string[]): Promise<void> {
  const keepSet = new Set(keep);
  for (const name of await fs.readdir(SITE_ROOT)) {
    if (!keepSet.has(name)) await fs.remove(`${SITE_ROOT}/${name}`);
  }
}
