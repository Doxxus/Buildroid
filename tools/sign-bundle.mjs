#!/usr/bin/env node
// Zero-dependency ed25519 helper (Node >= 18). Used locally and in the target repo's GitHub Action.
//   node tools/sign-bundle.mjs keygen
//   BUNDLE_SIGNING_KEY=<private key b64> node tools/sign-bundle.mjs sign bundle.zip [bundle.sig]
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [cmd, file, out = 'bundle.sig'] = process.argv.slice(2);

if (cmd === 'keygen') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  console.log('PUBLIC KEY  (embed in the app: PUBLIC_KEY):\n' + rawPub.toString('base64'));
  console.log('\nPRIVATE KEY (store ONLY as GitHub Actions secret BUNDLE_SIGNING_KEY; never commit):\n' + privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'));
} else if (cmd === 'sign' && file) {
  const b64 = process.env.BUNDLE_SIGNING_KEY;
  if (!b64) {
    console.error('BUNDLE_SIGNING_KEY is not set');
    process.exit(1);
  }
  const key = createPrivateKey({ key: Buffer.from(b64.trim(), 'base64'), format: 'der', type: 'pkcs8' });
  const sig = sign(null, readFileSync(file), key);
  writeFileSync(out, sig.toString('base64'));
  // Self-check against the derived public key so a bad secret fails the build, not the users.
  const pub = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  console.log(`Signed ${file} -> ${out}. Public key: ${pub}`);
} else {
  console.error('usage: sign-bundle.mjs keygen | sign <bundle.zip> [bundle.sig]');
  process.exit(1);
}
