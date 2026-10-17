// Idempotent hardening of the generated android/ project. Run after `cap add android` and every `cap sync`.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const appId = process.env.APP_ID ?? 'com.example.wrapper';
const appName = process.env.APP_NAME ?? 'Site Wrapper';
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(appId)) throw new Error(`Invalid APP_ID: ${appId}`);

const app = join('android', 'app');
if (!existsSync(app)) throw new Error('android/ not found. Run `npm run android:add` first.');
const main = join(app, 'src', 'main');

// Native sources
const javaDir = join(main, 'java', ...appId.split('.'));
mkdirSync(javaDir, { recursive: true });
for (const f of ['MainActivity.java', 'BundlePointerPlugin.java']) {
  writeFileSync(join(javaDir, f), readFileSync(join('native', f), 'utf8').replaceAll('__PACKAGE__', appId));
}

// XML resources
mkdirSync(join(main, 'res', 'xml'), { recursive: true });
writeFileSync(
  join(main, 'res', 'xml', 'network_security_config.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors><certificates src="system" /></trust-anchors>
    </base-config>
</network-security-config>
`,
);
writeFileSync(
  join(main, 'res', 'xml', 'data_extraction_rules.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup><exclude domain="root" path="." /><exclude domain="file" path="." /><exclude domain="sharedpref" path="." /><exclude domain="database" path="." /></cloud-backup>
    <device-transfer><exclude domain="root" path="." /><exclude domain="file" path="." /><exclude domain="sharedpref" path="." /><exclude domain="database" path="." /></device-transfer>
</data-extraction-rules>
`,
);

// Manifest
const manifestPath = join(main, 'AndroidManifest.xml');
let manifest = readFileSync(manifestPath, 'utf8');
for (const attr of ['allowBackup', 'fullBackupContent', 'dataExtractionRules', 'usesCleartextTraffic', 'networkSecurityConfig']) {
  manifest = manifest.replace(new RegExp(`\\s+android:${attr}="[^"]*"`, 'g'), '');
}
manifest = manifest.replace(
  '<application',
  `<application
        android:allowBackup="false"
        android:fullBackupContent="false"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:usesCleartextTraffic="false"
        android:networkSecurityConfig="@xml/network_security_config"`,
);
writeFileSync(manifestPath, manifest);

// App name
const stringsPath = join(main, 'res', 'values', 'strings.xml');
if (existsSync(stringsPath)) {
  const esc = appName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, "\\'");
  let s = readFileSync(stringsPath, 'utf8');
  s = s.replace(/(<string name="app_name">)[^<]*/, `$1${esc}`).replace(/(<string name="title_activity_main">)[^<]*/, `$1${esc}`);
  writeFileSync(stringsPath, s);
}

// Release builds: minify + shrink
const gradlePath = join(app, 'build.gradle');
let gradle = readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(/minifyEnabled\s+false/, 'minifyEnabled true');
if (!gradle.includes('shrinkResources')) gradle = gradle.replace(/minifyEnabled true/, 'minifyEnabled true\n            shrinkResources true');
writeFileSync(gradlePath, gradle);

const proguardPath = join(app, 'proguard-rules.pro');
const keep = `-keep class ${appId}.BundlePointerPlugin { *; }\n`;
const pg = existsSync(proguardPath) ? readFileSync(proguardPath, 'utf8') : '';
if (!pg.includes('BundlePointerPlugin')) writeFileSync(proguardPath, pg + '\n' + keep);

console.log(`Patched android/ for ${appId} ("${appName}")`);
