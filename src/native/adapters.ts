import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
import { fromB64, toB64 } from '../core/crypto';
import type { FsPort, HttpPort, HttpResponse, KV, PointerPort } from '../core/types';

export const http: HttpPort = {
  async get(url, headers, binary): Promise<HttpResponse> {
    const r = await CapacitorHttp.get({
      url,
      headers,
      responseType: binary ? 'blob' : 'text',
      disableRedirects: true,
      connectTimeout: 15000,
      readTimeout: 60000,
    });
    const h: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.headers ?? {})) h[k.toLowerCase()] = String(v);
    if (binary) {
      return { status: r.status, headers: h, bytes: r.status === 200 && typeof r.data === 'string' ? fromB64(r.data) : undefined };
    }
    return { status: r.status, headers: h, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) };
  },
};

export const kv: KV = {
  async get(key) {
    return (await Preferences.get({ key })).value;
  },
  async set(key, value) {
    await Preferences.set({ key, value });
  },
};

const directory = Directory.Data;

export const fs: FsPort = {
  async writeFile(path, data) {
    await Filesystem.writeFile({ path, data: toB64(data), directory, recursive: true });
  },
  async rename(from, to) {
    await Filesystem.rename({ from, to, directory, toDirectory: directory });
  },
  async remove(path) {
    try {
      await Filesystem.rmdir({ path, directory, recursive: true });
    } catch {
      /* already gone */
    }
  },
  async readdir(path) {
    try {
      return (await Filesystem.readdir({ path, directory })).files.map((f) => f.name);
    } catch {
      return [];
    }
  },
  async exists(path) {
    try {
      await Filesystem.stat({ path, directory });
      return true;
    } catch {
      return false;
    }
  },
};

interface BundlePointerPlugin {
  activate(o: { path: string }): Promise<void>;
  reloadNow(): Promise<void>;
}
const BundlePointer = registerPlugin<BundlePointerPlugin>('BundlePointer');

export const pointer: PointerPort = {
  async activate(dir) {
    const { uri } = await Filesystem.getUri({ path: dir, directory });
    await BundlePointer.activate({ path: uri.replace(/^file:\/\//, '') });
  },
};

export const reloadNow = () => BundlePointer.reloadNow();

// Token lives only in Android Keystore-backed storage; it is never logged or put in a URL.
const TOKEN_KEY = 'github_token';
export const tokenStore = {
  async get(): Promise<string | null> {
    try {
      return (await SecureStoragePlugin.get({ key: TOKEN_KEY })).value || null;
    } catch {
      return null;
    }
  },
  async set(token: string): Promise<void> {
    await SecureStoragePlugin.set({ key: TOKEN_KEY, value: token });
  },
  async clear(): Promise<void> {
    await SecureStoragePlugin.remove({ key: TOKEN_KEY }).catch(() => undefined);
  },
};
