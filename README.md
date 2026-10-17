# Buildroid: live-updating, signed web wrapper for Android (Capacitor)

Loads a static site from a locally stored bundle (served from `https://localhost`), checks a GitHub release for a newer
bundle at launch and on resume, verifies it (SHA-256 + ed25519), and swaps it in atomically. Offline or failing
updates keep serving the cached bundle.

## Layout

| Path | Purpose |
|---|---|
| `src/config.ts` | Per-site config (owner, repo, tag, asset names, public keys, `requireSignature`) |
| `src/core/` | Platform-independent update pipeline (fully unit-tested): `github`, `crypto`, `zip`, `bundles`, `updater` |
| `src/native/adapters.ts` | Capacitor adapters: Filesystem, Preferences, Keystore token, no-redirect HTTP |
| `src/ui.ts`, `src/main.ts` | Wrapper runtime injected into every page: toast, debug screen, back button, external links |
| `native/` | Java plugin `BundlePointer` + `MainActivity` (copied into `android/` by `scripts/patch-android.mjs`) |
| `scripts/` | `prepare-web` (inject runtime into bundled site), `patch-android` (hardening), `gradle` |
| `tools/sign-bundle.mjs` | Zero-dependency keygen and signer (copy into the site repo) |
| `docs/publish-bundle.snippet.yml` | Workflow steps for `.github/workflows/publish-bundle.yml` |
| `bundled-site/` | Initial site copy shipped in the APK (replace with your build; `index.html` at root) |

## How it works

The wrapper runtime (`/__wrapper/wrapper.js`) is injected into every HTML file, both in the bundled copy (at build) and in
each downloaded bundle (after verification). Capacitor serves the active directory using its persisted `serverBasePath`,
which the `BundlePointer` plugin writes (this is the "active pointer"). Update flow:

1. Launch / resume (throttled to 15 min) -> `GET /repos/{o}/{r}/releases/tags/{tag}` with `If-None-Match`. 304 -> stop.
2. Body must be a full 40-hex SHA; equal to stored SHA -> stop (new ETag saved).
3. Reject if `published_at` is older than the installed release (unless **Force update**).
4. Download `bundle.zip`, `bundle.sha256`, `bundle.sig` (size capped at 50 MB, checked from release metadata and again after download).
5. Verify SHA-256, then ed25519 (either configured public key). Abort on first failure.
6. Validate zip structure (zip-slip, absolute paths, symlinks, encryption, duplicates, file-count/size caps, header consistency, `index.html` at root), then extract.
7. Write to `site/.tmp-<sha>`, rename to `site/<sha>`, persist pointer, then write state (SHA, ETag, publishedAt). If any step fails the new dir is removed and the previous pointer restored.
8. Prune everything except the new and previous versions. Toast "Updated to latest version" with a **Reload** action; otherwise it applies on next launch.

Failures are stored in `lastError` (token scrubbed) and shown on the debug screen. **Debug screen:** long-press the page
`<h1>`/`<header>` (or any element with `data-wrapper-title`), or the top-left 56px corner, for ~0.8 s.

## Pointing the wrapper at another repo (build variants)

Variants are env vars read at build time. Nothing else changes.

```powershell
$env:APP_ID='com.acme.blog'; $env:APP_NAME='Acme Blog'
$env:OWNER='acme'; $env:REPO='blog'; $env:PUBLIC_KEY='<base64 public key>'
# optional: RELEASE_TAG, ASSET_NAME, CHECKSUM_ASSET_NAME, SIGNATURE_ASSET_NAME, NEXT_PUBLIC_KEY, REQUIRE_SIGNATURE=false
```

Replace `bundled-site/` with a build of that site. Use a separate `android/` checkout per package id (`APP_ID` is baked in by
`cap add android`); delete `android/` before switching variants.

Private repo: open the debug screen and paste a fine-grained token with read-only **Contents** on that repo. It goes into
Android Keystore-backed storage (`capacitor-secure-storage-plugin`), is sent only as an `Authorization` header to
`api.github.com` / `github.com`, and never to the CDN redirect target. Never bake a token into the build.

## Build

Requires Node 20+, JDK 17+, Android SDK.

```powershell
npm install
npm test                      # unit tests
npm run android:add           # npx cap add android + hardening patch (once)
npm run android:debug         # build, cap sync, patch, gradle assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

Equivalent manual commands: `npm run build; npx cap add android; node scripts/patch-android.mjs; npx cap sync android; node scripts/patch-android.mjs; cd android; ./gradlew assembleDebug`.
Always re-run `patch-android` after `cap sync`; the script is idempotent.

Icons / splash: replace `resources/icon.svg` and `resources/splash.svg`, then `npx @capacitor/assets generate --android`.

### Signed release APK / AAB

```powershell
keytool -genkeypair -v -keystore release.keystore -alias release -keyalg RSA -keysize 4096 -validity 10000
```

Add to `~/.gradle/gradle.properties` (never commit):
```
RELEASE_STORE_FILE=C:/path/release.keystore
RELEASE_STORE_PASSWORD=...
RELEASE_KEY_ALIAS=release
RELEASE_KEY_PASSWORD=...
```
In `android/app/build.gradle` add inside `android { }`:
```groovy
signingConfigs { release {
  storeFile file(RELEASE_STORE_FILE); storePassword RELEASE_STORE_PASSWORD
  keyAlias RELEASE_KEY_ALIAS; keyPassword RELEASE_KEY_PASSWORD } }
buildTypes { release { signingConfig signingConfigs.release } }
```
(merge with the existing `release` block). Then `npm run android:release` produces
`android/app/build/outputs/apk/release/app-release.apk` and `bundle/release/app-release.aab`. Release builds are minified
(R8, `shrinkResources`), and `console`/`debugger` are stripped from the wrapper JS. Back up the keystore; losing it means
you cannot update the app.

## Keys

```powershell
node tools/sign-bundle.mjs keygen
```
* **Public key** -> `PUBLIC_KEY` build variable (embedded in the APK, never fetched).
* **Private key** -> GitHub repo secret `BUNDLE_SIGNING_KEY` in the *site* repo only. Never commit it.
* CI signs with `node tools/sign-bundle.mjs sign bundle.zip bundle.sig` (see `docs/publish-bundle.snippet.yml`).

**Rotation** (no flag day): (1) generate a new keypair; (2) ship an app release with `PUBLIC_KEY=<old>`, `NEXT_PUBLIC_KEY=<new>`;
(3) once adoption is high, switch CI to the new private key; (4) a later app release sets `PUBLIC_KEY=<new>` and drops the old key.
Users who never update the app past step 2 will stop receiving updates after step 3 (they keep working on the cached bundle).
If the private key is compromised, ship an app release that drops the old key immediately; old apps remain exposed.

## Release contract

Tag `latest-bundle` (configurable); release body = full commit SHA; assets `bundle.zip` (index.html at root, no symlinks),
`bundle.sha256` (hex, or `sha256sum` format), `bundle.sig` (base64 ed25519 over the raw bytes of `bundle.zip`), `version.txt`.
The workflow must delete and recreate the release so `published_at` moves forward (downgrade protection compares it).

## Threat model

| Attacker | Can | Cannot |
|---|---|---|
| **Network attacker / malicious CDN** | Block updates (stale site) | Alter bundles: HTTPS only, hosts allowlisted, SHA-256 + signature checked |
| **Compromised repo write access / Actions without the signing key** | Publish or replace a release | Get it installed: signature fails, app keeps the cached bundle. Can cause DoS (failed updates) |
| **Compromised repo write access + replace release with an *older, validly signed* bundle** | Try replay | Install it: `published_at` downgrade check (but an attacker who can also set an old-looking timestamp or who controls the key is not stopped; see limitations) |
| **Compromised signing key (`BUNDLE_SIGNING_KEY`)** | Ship arbitrary web code to all users, running in the app's WebView with plugin access (Filesystem/Preferences/Browser, token storage via plugin) | Anything outside the WebView sandbox (no native code, no other apps' data). Mitigation: rotate and ship a new app |
| **Stolen GitHub token (device)** | Read private releases | Modify releases (use read-only tokens). Token is in Keystore, excluded from backup |
| **Malicious zip** | n/a | Escape the target dir, symlinks, bombs: rejected before extraction |
| **Other apps / `adb backup`** | n/a | Read site dir or token (`allowBackup=false`, private storage, file access off) |

Limitations to be aware of:
* The signature covers `bundle.zip` only. The commit SHA (release body) and `published_at` are not signed, so someone with
  release-write access but not the key can replay an old signed bundle with a fresh `published_at`. Signing a manifest
  `{sha, publishedAt, zipSha256}` closes this (changes the contract).
* The wrapper runtime is injected into HTML after verification (so served HTML differs from the signed bytes).
* Downloads are buffered in memory (CapacitorHttp has no streaming); the 50 MB cap and the size check from release
  metadata bound this, but the cap is enforced after receipt if metadata lies.
* A bundled site's own CSP may block the injected `/__wrapper/wrapper.js` (same-origin scripts must be allowed).
* The injected runtime is reachable by site JavaScript, so a compromised *signed* site has the same capabilities as the wrapper.
* Cross-origin fetches from the site to `api.github.com` depend on that API's CORS policy (unrelated to the updater, which uses native HTTP).
* Every full page navigation of a multi-page site re-runs the runtime; only the first load per app session triggers the launch check.

## Tests

`npm test` covers ETag/SHA comparison and throttling, checksum and signature failure paths (including key rotation),
zip-slip/symlink/bomb/header-lying rejection, downgrade rejection and force, rollback when pointer activation, directory
rename or state persistence fails, host allowlist/redirect handling and token non-leakage.

Not verified in this repo: the Android native layer (Java plugin, manifest patching, Gradle release build) and on-device
behavior. Smoke test on a device: install the debug APK, publish a release, relaunch, confirm the toast and the debug screen.
