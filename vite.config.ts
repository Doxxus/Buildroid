import { defineConfig } from 'vitest/config';

const env = process.env;

// Per-variant values come from env vars at build time (see README).
const cfg = {
  owner: env.OWNER,
  repo: env.REPO,
  releaseTag: env.RELEASE_TAG,
  assetName: env.ASSET_NAME,
  checksumAssetName: env.CHECKSUM_ASSET_NAME,
  signatureAssetName: env.SIGNATURE_ASSET_NAME,
  publicKey: env.PUBLIC_KEY,
  nextPublicKey: env.NEXT_PUBLIC_KEY,
  requireSignature: env.REQUIRE_SIGNATURE,
};

export default defineConfig(({ mode }) => ({
  define: {
    __CFG__: JSON.stringify(cfg),
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
  },
  esbuild: {
    // Strip all debug logging from release builds.
    drop: mode === 'production' ? ['console', 'debugger'] : [],
    legalComments: 'none',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false,
    // The wrapper is a single IIFE injected into the site (and the bundled copy) as /__wrapper/wrapper.js.
    lib: {
      entry: 'src/main.ts',
      formats: ['iife'],
      name: 'BuildroidWrapper',
      fileName: () => '__wrapper/wrapper.js',
    },
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
}));
