# Guide: build a new app with Buildroid

Step-by-step for wrapping a new static site (hosted in a GitHub repo) as a live-updating Android app, from a clean machine to a signed release, plus how to ship later updates. Commands are PowerShell on Windows. For design and threat-model background see [../README.md](../README.md).

Throughout, replace these placeholders:

| Placeholder | Example |
|---|---|
| `OWNER` / `REPO` | `Doxxus` / `KairoMixes` (the site repo) |
| `APP_ID` | `com.doxxus.kaimix` (lowercase, dot-separated, unique, **permanent** once published) |
| `APP_NAME` | `Kairo Mixes` (name under the launcher icon) |

---

## Part 0: One-time machine setup

1. **Node 20+** and **git**.
2. **JDK 21.** Android Studio's bundled JDK is too new for Gradle 8.11, so install Temurin 21:
   ```powershell
   winget install EclipseAdoptium.Temurin.21.JDK
   ```
   The path is typically `C:\Program Files\Eclipse Adoptium\jdk-21.x.x.x-hotspot` (check the folder name).
3. **Android Studio**, then in SDK Manager install an Android SDK Platform and Platform-Tools. Gradle downloads the rest on first build. The SDK is usually at `%LOCALAPPDATA%\Android\Sdk`.
4. In every new terminal, set the environment (adjust the JDK folder name):
   ```powershell
   $env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot'
   $env:PATH="$env:JAVA_HOME\bin;$env:PATH"
   $env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
   ```
5. In this project: `npm install`, then `npm test` (should pass).

---

## Part 1: Signing keys for bundle updates (ed25519), once per app

The app only installs site bundles signed with your private key. The public key is embedded in the APK.

1. Generate the keypair:
   ```powershell
   node tools/sign-bundle.mjs keygen
   ```
2. Copy the printed **PUBLIC KEY** (base64). You use it as `PUBLIC_KEY` in Part 4. It is not secret.
3. Copy the printed **PRIVATE KEY**. It goes only into a GitHub Actions secret (Part 2). Do not commit it, email it or paste it into chat. Keep a copy in a password manager; if lost, generate a new pair and follow key rotation (Part 8).

---

## Part 2: Configure the site repo (once per site)

1. **Add the secret.** In the site repo: Settings, Secrets and variables, Actions, New repository secret. Name `BUNDLE_SIGNING_KEY`, value the private key from Part 1.
2. **Copy the signer** `tools/sign-bundle.mjs` from this project into the site repo at `tools/sign-bundle.mjs` and commit it.
3. **Edit `.github/workflows/publish-bundle.yml`** so it builds, packages, signs, deletes the old release, and publishes. Recreating the release gives it a fresh `published_at`, which the app's downgrade check relies on. Example (adjust `build` to your site's output folder; pin action SHAs as you prefer):
   ```yaml
   name: Publish web bundle
   on:
     push:
       branches: [main]
     workflow_dispatch:
   permissions: {}
   concurrency:
     group: publish-bundle
     cancel-in-progress: false
   jobs:
     bundle:
       runs-on: ubuntu-latest
       timeout-minutes: 15
       permissions:
         contents: write
       steps:
         - uses: actions/checkout@v4
           with:
             persist-credentials: false
         - uses: actions/setup-node@v4
           with:
             node-version: 22
             cache: npm
         - run: npm ci --ignore-scripts
         - run: npm run build

         - name: Package bundle
           env:
             COMMIT_SHA: ${{ github.sha }}
           run: |
             cd build
             zip -r -X ../bundle.zip .
             cd ..
             echo "$COMMIT_SHA" > version.txt
             sha256sum bundle.zip | cut -d' ' -f1 > bundle.sha256

         - name: Sign bundle (ed25519)
           env:
             BUNDLE_SIGNING_KEY: ${{ secrets.BUNDLE_SIGNING_KEY }}
           run: node tools/sign-bundle.mjs sign bundle.zip bundle.sig

         - name: Delete previous release
           env:
             GH_TOKEN: ${{ github.token }}
           run: gh release delete latest-bundle --repo "$GITHUB_REPOSITORY" --yes --cleanup-tag || true

         - name: Publish release
           uses: softprops/action-gh-release@v2
           with:
             tag_name: latest-bundle
             target_commitish: ${{ github.sha }}
             name: Latest bundle (${{ github.sha }})
             body: ${{ github.sha }}
             files: |
               bundle.zip
               bundle.sha256
               bundle.sig
               version.txt
             make_latest: true
   ```
4. **Site requirements:**
   - `index.html` at the zip root (the contents of the build folder, not the folder itself).
   - The site must work when served from `https://localhost/` at the root path (for Vite use `base: '/'` or `'./'`).
   - No symlinks in the build output.
   - Any CSP must allow same-origin scripts (the wrapper injects `/__wrapper/wrapper.js`).
   - To make the title long-pressable for the debug screen, it must be an `<h1>`, a `<header>`, or have `data-wrapper-title`; the top-left corner of the screen also works.
5. **Run the workflow** (push to `main`, or Actions, Run workflow). Check the Releases page: tag `latest-bundle`, assets `bundle.zip`, `bundle.sha256`, `bundle.sig`, `version.txt`, and the release description is the 40-character commit SHA.
6. **Private repo only:** create a fine-grained token limited to that repo with read-only Contents. You paste it into the app's debug screen later (stored in the Android Keystore, never in the build).

---

## Part 3: Prepare the wrapper project for the new app

Starting a **different app** in an existing checkout, delete the old generated project first, because the package id is baked into it:
```powershell
Remove-Item -Recurse -Force android -ErrorAction SilentlyContinue
```

1. **Initial site copy.** Replace everything in `bundled-site\` with a build of the site (the contents of its build output, with `index.html` at the root). This is what users see before the first update downloads.
2. **Icon and splash (optional).** Replace `resources\icon.svg` and `resources\splash.svg`, then `npx @capacitor/assets generate --android` (run after step 4 in Part 4, once `android\` exists).

---

## Part 4: Build and test a debug APK

Per-app values are build-time environment variables. Set them in the same terminal you build in (after the Part 0 step 4 environment):
```powershell
$env:APP_ID='com.doxxus.kaimix'
$env:APP_NAME='Kairo Mixes'
$env:OWNER='Doxxus'
$env:REPO='KairoMixes'
$env:PUBLIC_KEY='<public key from Part 1>'
# optional: RELEASE_TAG, ASSET_NAME, CHECKSUM_ASSET_NAME, SIGNATURE_ASSET_NAME,
#           NEXT_PUBLIC_KEY (rotation), REQUIRE_SIGNATURE=false
```
You can instead edit the defaults in `src\config.ts`; env vars override them.

```powershell
cd f:\Documents\Personal\Code_Projects\Buildroid
npm run android:add          # first time only (creates android/ and applies hardening)
"sdk.dir=" + ($env:ANDROID_HOME -replace '\\','\\') | Set-Content android\local.properties -Encoding ascii
$env:CAP_DEBUG='true'
npm run android:debug
```
Output: `android\app\build\outputs\apk\debug\app-debug.apk`.

**Test on the emulator:**
```powershell
& "$env:ANDROID_HOME\emulator\emulator.exe" -list-avds            # pick a name
Start-Process "$env:ANDROID_HOME\emulator\emulator.exe" -ArgumentList '-avd','<avd name>'
$adb="$env:ANDROID_HOME\platform-tools\adb.exe"
& $adb wait-for-device
& $adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```
For a phone, enable USB debugging and use the same `adb install`.

Checks, in order:
1. The bundled site loads.
2. Wait 30 to 60 seconds (first download), relaunch, and open the debug screen (long-press the title for about a second). It should show the release SHA and `Signature: verified`.
3. Push a site change, wait for the workflow, tap **Check now**, relaunch: the SHA changes. Resume checks are throttled to 15 minutes.
4. Failure path: temporarily set a wrong `BUNDLE_SIGNING_KEY`, re-run the workflow, then **Check now**. Expect `signature-invalid` and the old site still works. Restore the real key afterwards.
5. Airplane mode, relaunch: the cached site loads.
6. Back button navigates history, then exits. External links open in the system browser.

Logs: `& $adb logcat -d -s Capacitor:*`.

---

## Part 5: Release signing keystore (Android app signing), once per app

This is separate from the bundle-signing key in Part 1. It identifies your app to Android and the Play Store. **If you lose it you can never update existing installs.**

1. Create the keystore outside the repo:
   ```powershell
   $kt="$env:JAVA_HOME\bin\keytool.exe"
   New-Item -ItemType Directory -Force C:\Keys | Out-Null
   & $kt -genkeypair -v -keystore C:\Keys\myapp-release.keystore -alias myapp -keyalg RSA -keysize 4096 -validity 10000
   ```
   Choose a strong password (use the same for store and key) and fill in your details.
2. Back up the keystore file and password (password manager plus offline copy).
3. Put the settings in your user-level `C:\Users\<you>\.gradle\gradle.properties` (outside the repo, never committed):
   ```
   RELEASE_STORE_FILE=C:/Keys/myapp-release.keystore
   RELEASE_STORE_PASSWORD=<password>
   RELEASE_KEY_ALIAS=myapp
   RELEASE_KEY_PASSWORD=<password>
   ```
   Use forward slashes. These four properties are one set: with several apps you need either different keystores swapped in before each build, or one shared keystore for all your apps. Pass them per build with `-P` flags if you prefer (the build script forwards extra Gradle arguments): `node scripts/gradle.mjs assembleRelease -PRELEASE_STORE_FILE=...`.
   `scripts\patch-android.mjs` already wires `signingConfigs.release` to these properties. Without them the build is unsigned and cannot be installed.

---

## Part 6: Build the signed release

Use the same terminal and env vars as Part 4, **without** `CAP_DEBUG`:
```powershell
Remove-Item Env:CAP_DEBUG -ErrorAction SilentlyContinue
npm run android:release
```
Outputs:
- APK for sideloading: `android\app\build\outputs\apk\release\app-release.apk`
- AAB for Play Store: `android\app\build\outputs\bundle\release\app-release.aab`

Test the release APK (uninstall the debug one first; the signing keys differ):
```powershell
& $adb uninstall com.doxxus.kaimix
& $adb install android\app\build\outputs\apk\release\app-release.apk
```
Repeat the Part 4 checks. Release builds are minified; if anything fails, capture `adb logcat -d | Select-String 'AndroidRuntime|Capacitor'`.

---

## Part 7: Shipping updates later

**Site content changes (the common case): no app rebuild.**
1. Push to the site repo's `main` (or run the workflow).
2. Installed apps pick it up on the next launch or resume (at most once per 15 minutes), show the "Updated to latest version" toast, and apply it on Reload or the next launch.
3. If a release is rejected (bad signature, checksum, zip rules, downgrade), the app keeps serving the current bundle and the reason shows on the debug screen (Last error).

**Rolling back a bad site release.** The app rejects releases older than the installed one. Revert the commit and push so a *new* release is published (its `published_at` is newer). A device that already took a bad bundle can use the debug screen's **Force update** to move to a different one.

**App changes (wrapper code, icon, name, native config, key rotation) need a new APK/AAB:**
1. Update this project (`git pull`, `npm install`).
2. Bump `versionCode` (integer, must increase) and optionally `versionName` in `android\app\build.gradle`. If you regenerated `android\`, set it again.
3. Refresh `bundled-site\` with the latest site build (so fresh installs start current).
4. Set the Part 4 env vars again, then `npm run android:release`.
5. Install over the old version with the **same keystore**, or upload the AAB to Play.

Note: the wrapper script inside an already-downloaded bundle is a copy from when that bundle was installed. New wrapper features reach existing users after their next site update or a **Force update**.

---

## Part 8: Rotating the bundle-signing key

No flag day needed; the app accepts two public keys during the transition.
1. `node tools/sign-bundle.mjs keygen` to get a new pair.
2. Ship an app release with `PUBLIC_KEY=<old>` and `NEXT_PUBLIC_KEY=<new>` (Part 7, app changes).
3. After most users have updated, change the site repo's `BUNDLE_SIGNING_KEY` secret to the **new private key** and republish.
4. In a later app release set `PUBLIC_KEY=<new>` and drop `NEXT_PUBLIC_KEY`.

Users who never update the app past step 2 stop receiving site updates after step 3 but keep working on their cached bundle. If the old private key is compromised, skip the wait: ship an app release without the old key immediately (older installs stay exposed until they update).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Unsupported class file major version` in Gradle | `JAVA_HOME` points at the wrong JDK. Use JDK 21 (Part 0). |
| SDK location not found | Create `android\local.properties` (Part 4) or set `ANDROID_HOME`. |
| Release APK won't install / "unsigned" in the file name | `gradle.properties` signing values are missing or wrong (Part 5). |
| Install fails with signature mismatch | Uninstall the existing app first (debug and release use different keys). |
| Debug screen shows `release-not-found` | Wrong `OWNER`/`REPO`/tag, no release yet, or a private repo without a token. |
| `signature-invalid` | `PUBLIC_KEY` in the build does not match the private key in `BUNDLE_SIGNING_KEY`. Rebuild the app with the right public key, or fix the secret. |
| `checksum-mismatch` / `zip-*` errors | Bundle problem. Check the zip has `index.html` at the root and no symlinks/absolute paths. |
| `downgrade rejected` | Release `published_at` is older than the installed one. Publish a new release or use **Force update**. |
| Still on the bundled copy after first launch | First download takes 30 to 60 s; don't force-stop during it. Tap **Check now**. |
| Long-press does nothing | The title must be an `<h1>`/`<header>`/`[data-wrapper-title]`, or use the top-left corner. Hold about a second. |
| `android:add` fails with "already exists" | Delete `android\` first (Part 3) if the package id changed. |
| Changed env vars have no effect | They are baked in at build time and read in the terminal where you build. Set them in that terminal. |

## Security reminders

- Never commit: the ed25519 private key, `*.keystore`, `gradle.properties` with passwords, or GitHub tokens. `.gitignore` covers keystores and `android/`.
- The bundle private key lives only in the GitHub secret `BUNDLE_SIGNING_KEY` (plus your offline backup). The public key is not secret.
- Back up the Android keystore and its password separately from the machine.
