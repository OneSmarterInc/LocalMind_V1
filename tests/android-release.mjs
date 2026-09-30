// Android release build: the checks from the APK review of 30 Sep 2026.
// The APK was signed with the public debug key, shipped permissions it does not
// need, every build was versionCode 1, and the phone model URL followed a
// moving branch. These keep each fix in place, in android/ and in the app.json
// settings that `expo prebuild --clean` rebuilds android/ from.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const front = path.join(root, 'frontend');
const read = f => fs.readFileSync(path.join(front, f), 'utf8');
const require = createRequire(path.join(front, 'package.json'));
const app = JSON.parse(read('app.json')).expo;
const BLOCKED = ['SYSTEM_ALERT_WINDOW', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE'].map(p => `android.permission.${p}`);

test('the release manifest does not ask for drawing over apps or storage, and blocks libraries from adding them', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  for (const p of BLOCKED) {
    const lines = manifest.split('\n').filter(l => l.includes(`"${p}"`));
    assert.equal(lines.length, 1, p);
    assert.match(lines[0], /tools:node="remove"/, `${p} is removed, not requested`);
  }
  assert.match(manifest, /xmlns:tools="http:\/\/schemas\.android\.com\/tools"/);
  for (const p of ['INTERNET', 'ACCESS_NETWORK_STATE']) assert.match(manifest, new RegExp(`android\\.permission\\.${p}"/>`));
  assert.deepEqual([...app.android.blockedPermissions].sort(), [...BLOCKED].sort(), 'app.json keeps it after expo prebuild --clean');
});

test('release builds use the upload key from the person\'s own Gradle settings, also after prebuild --clean', () => {
  const plugin = require(path.join(front, 'plugins/withReleaseSigning.js'));
  assert.ok(app.plugins.includes('./plugins/withReleaseSigning'));
  const gradle = read('android/app/build.gradle');
  assert.equal(plugin.applyReleaseSigning(gradle), gradle, 'already applied, and applying again changes nothing');
  assert.match(gradle, /signingConfig project\.hasProperty\('LOCALMIND_UPLOAD_STORE_FILE'\) \? signingConfigs\.release : signingConfigs\.debug/);
  assert.match(gradle, /storeFile file\(LOCALMIND_UPLOAD_STORE_FILE\)/);
  assert.doesNotMatch(gradle, /LOCALMIND_UPLOAD_STORE_PASSWORD\s*=|storePassword '(?!android')/, 'no password in the repository');
  const stock = "android {\n    signingConfigs {\n        debug {\n            storeFile file('debug.keystore')\n        }\n    }\n    buildTypes {\n        debug {\n            signingConfig signingConfigs.debug\n        }\n        release {\n            signingConfig signingConfigs.debug\n            minifyEnabled false\n        }\n    }\n}\n";
  const signed = plugin.applyReleaseSigning(stock);
  assert.match(signed, /release \{\n\s+if \(project\.hasProperty\('LOCALMIND_UPLOAD_STORE_FILE'\)\)/);
  assert.equal((signed.match(/signingConfig signingConfigs\.debug\n/g) || []).length, 1, 'debug builds keep the debug key');
  assert.throws(() => plugin.applyReleaseSigning('android {}'), /not found/);
  for (const f of fs.readdirSync(path.join(front, 'android/app')).concat(fs.readdirSync(front)))
    assert.ok(!/\.(jks|keystore)$/.test(f) || f === 'debug.keystore', `no keystore in the repository: ${f}`);
});

test('app.json and android/ carry the same version, and EAS tester builds count up', () => {
  const gradle = read('android/app/build.gradle');
  assert.equal(Number(gradle.match(/versionCode (\d+)/)[1]), app.android.versionCode);
  assert.equal(gradle.match(/versionName "([^"]+)"/)[1], app.version);
  assert.ok(app.android.versionCode > 1, 'the first review build was versionCode 1');
  const eas = JSON.parse(read('eas.json'));
  assert.equal(eas.build.preview.autoIncrement, true);
  assert.equal(eas.build.production.autoIncrement, true);
});

test('every downloadable AI model is pinned to a commit, not a branch', () => {
  const spec = read('src/private/modelSpec.ts');
  const urls = [...spec.matchAll(/url:'([^']+)'/g)].map(m => m[1]);
  assert.ok(urls.length >= 2, urls.join(' '));
  for (const u of urls) assert.match(u, /\/resolve\/[0-9a-f]{40}\//, u);
  assert.match(spec, /Qwen3-0\.6B-GGUF\/resolve\/f2d6f9ca53a254cc379437c49e4b2eb447f779df\/Qwen3-0\.6B-Q4_K_M\.gguf/);
});

test('My profile shows the version and the commit of the build', async () => {
  const {build} = require('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localmind-version-'));
  const out = path.join(tmp, 'v.cjs');
  await build({entryPoints:[path.join(front,'src/ui/appVersion.ts')], outfile:out, bundle:true, platform:'node', format:'cjs', logLevel:'silent',
    plugins:[{name:'stub', setup(b){ b.onResolve({filter:/^expo-constants$/},()=>({path:'c',namespace:'stub'})); b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export default {expoConfig:null}',loader:'js'})); }}]});
  const {appVersionLabel} = require(out);
  fs.rmSync(tmp, {recursive:true, force:true});
  assert.equal(appVersionLabel({version:'1.0.1', extra:{gitCommit:'a1b2c3d'}}), 'Version 1.0.1 · a1b2c3d');
  assert.equal(appVersionLabel({version:'1.0.1', extra:{}}), 'Version 1.0.1');
  assert.equal(appVersionLabel(null), 'Version unknown');
  assert.match(read('src/ui/ProfileScreen.tsx'), /LocalMind \{appVersionLabel\(\)\}/);
  const config = require(path.join(front, 'app.config.js'));
  const saved = process.env.EAS_BUILD_GIT_COMMIT_HASH;
  process.env.EAS_BUILD_GIT_COMMIT_HASH = '0123456789abcdef';
  const made = config({config:app});
  if (saved === undefined) delete process.env.EAS_BUILD_GIT_COMMIT_HASH; else process.env.EAS_BUILD_GIT_COMMIT_HASH = saved;
  assert.equal(made.extra.gitCommit, '0123456');
  assert.equal(made.extra.eas.projectId, app.extra.eas.projectId, 'app.json settings are kept');
  assert.equal(made.version, app.version);
});

test('the build steps, ABIs, minimum Android version and signing are written down', () => {
  const doc = read('MOBILE_BUILD.md');
  for (const needle of ['-PreactNativeArchitectures=arm64-v8a', 'arm64-v8a', '7.0 (API 24)', 'LOCALMIND_UPLOAD_STORE_FILE', 'CN=Android Debug', 'blockedPermissions', 'Never commit'])
    assert.ok(doc.includes(needle), needle);
});
