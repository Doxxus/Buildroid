import { StateStore } from './core/state';
import { THROTTLE_MS, checkForUpdate, type UpdateResult } from './core/updater';
import { config } from './config';
import { kv, fs, http, pointer, reloadNow, tokenStore } from './native/adapters';

const css = (el: HTMLElement, s: string) => (el.style.cssText = s);

export function toast(text: string, action?: { label: string; run: () => void }): void {
  const el = document.createElement('div');
  css(el, 'position:fixed;left:12px;right:12px;bottom:24px;z-index:2147483647;background:#222;color:#fff;padding:12px 16px;border-radius:8px;font:14px sans-serif;display:flex;gap:12px;align-items:center;justify-content:space-between');
  const span = document.createElement('span');
  span.textContent = text;
  el.append(span);
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    css(b, 'background:none;border:0;color:#8ab4ff;font:600 14px sans-serif');
    b.onclick = () => {
      el.remove();
      action.run();
    };
    el.append(b);
  }
  document.body.append(el);
  setTimeout(() => el.remove(), 8000);
}

async function getWrapper(): Promise<Uint8Array> {
  const r = await fetch('/__wrapper/wrapper.js', { cache: 'no-store' });
  if (!r.ok) throw new Error('wrapper runtime not available');
  return new Uint8Array(await r.arrayBuffer());
}

export async function runCheck(opts: { force?: boolean; throttle?: boolean }): Promise<UpdateResult> {
  const res = await checkForUpdate(
    { cfg: config, http, fs, kv, pointer, getToken: () => tokenStore.get(), getWrapper, now: () => Date.now() },
    opts,
  );
  if (res.status === 'updated') toast('Updated to latest version', { label: 'Reload', run: () => void reloadNow() });
  return res;
}

export { THROTTLE_MS };

export async function openDebug(): Promise<void> {
  const state = await new StateStore(kv).load();
  const root = document.createElement('div');
  css(root, 'position:fixed;inset:0;z-index:2147483647;background:#fff;color:#111;overflow:auto;padding:16px;font:14px sans-serif');
  const rows: [string, string][] = [
    ['Current SHA', state.sha ?? '(bundled copy)'],
    ['Release published', state.publishedAt ?? '-'],
    ['Last check', state.lastCheck ? new Date(state.lastCheck).toISOString() : '-'],
    ['Last error', state.lastError ?? '-'],
    ['Signature', state.sigStatus ?? '-'],
    ['Repo', `${config.owner}/${config.repo}@${config.releaseTag}`],
    ['Token set', (await tokenStore.get()) ? 'yes' : 'no'],
  ];
  const h = document.createElement('h2');
  h.textContent = 'Debug';
  root.append(h);
  for (const [k, v] of rows) {
    const p = document.createElement('p');
    const b = document.createElement('b');
    b.textContent = `${k}: `;
    p.append(b, document.createTextNode(v));
    p.style.wordBreak = 'break-all';
    root.append(p);
  }
  const btn = (label: string, run: () => void | Promise<void>) => {
    const b = document.createElement('button');
    b.textContent = label;
    css(b, 'margin:6px 6px 0 0;padding:10px 14px;font:14px sans-serif');
    b.onclick = () => void run();
    root.append(b);
  };
  btn('Check now', async () => {
    const r = await runCheck({ force: false });
    root.remove();
    toast(`Check: ${r.status}`);
  });
  btn('Force update', async () => {
    const r = await runCheck({ force: true });
    root.remove();
    toast(`Force update: ${r.status}`);
  });
  const input = document.createElement('input');
  input.type = 'password';
  input.placeholder = 'GitHub token (private repos)';
  input.autocomplete = 'off';
  css(input, 'display:block;width:100%;margin-top:16px;padding:10px;box-sizing:border-box');
  root.append(input);
  btn('Save token', async () => {
    if (input.value.trim()) await tokenStore.set(input.value.trim());
    input.value = '';
    root.remove();
    toast('Token saved');
  });
  btn('Clear token', async () => {
    await tokenStore.clear();
    root.remove();
  });
  btn('Close', () => root.remove());
  document.body.append(root);
}
