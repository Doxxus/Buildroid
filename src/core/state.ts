import type { KV } from './types';

export interface State {
  sha?: string;
  publishedAt?: string;
  etag?: string;
  previousSha?: string;
  lastCheck?: number;
  lastError?: string;
  sigStatus?: 'verified' | 'invalid' | 'missing' | 'not-required';
}

const KEY = 'bw.state';

export class StateStore {
  constructor(private kv: KV) {}

  async load(): Promise<State> {
    const raw = await this.kv.get(KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as State;
    } catch {
      return {};
    }
  }

  /** Single-key JSON write so state updates are all-or-nothing. */
  async patch(p: Partial<State>): Promise<State> {
    const next = { ...(await this.load()), ...p };
    await this.kv.set(KEY, JSON.stringify(next));
    return next;
  }
}
