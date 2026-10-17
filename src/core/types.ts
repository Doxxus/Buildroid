export interface ZipLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
}

export interface WrapperConfig {
  owner: string;
  repo: string;
  releaseTag: string;
  assetName: string;
  checksumAssetName: string;
  signatureAssetName: string;
  /** base64 ed25519 public key, embedded at build time, never fetched. */
  publicKey: string;
  /** Optional second key, accepted during key rotation. */
  nextPublicKey?: string;
  requireSignature: boolean;
  maxDownloadBytes: number;
  limits: ZipLimits;
}

export class UpdateError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'UpdateError';
  }
}

export interface HttpResponse {
  status: number;
  /** lower-cased header names */
  headers: Record<string, string>;
  text?: string;
  bytes?: Uint8Array;
}

export interface HttpPort {
  /** Must NOT follow redirects; the caller validates each hop. */
  get(url: string, headers: Record<string, string>, binary: boolean): Promise<HttpResponse>;
}

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** Paths are relative to the app data directory. */
export interface FsPort {
  writeFile(path: string, data: Uint8Array): Promise<void>; // creates parents
  rename(from: string, to: string): Promise<void>;
  /** Recursive; must not throw if missing. */
  remove(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>; // [] if missing
  exists(path: string): Promise<boolean>;
}

export interface PointerPort {
  /** Persistently make `dir` (relative to app data) the directory served on next launch. */
  activate(dir: string): Promise<void>;
}
