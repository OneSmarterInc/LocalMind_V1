// Guards for the September portal changes: quiz back button, module tab
// scroll, reopened-module labels, the required model setup and the new logo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const front = path.join(root, 'frontend');
const require = createRequire(path.join(front, 'package.json'));
const read = f => fs.readFileSync(path.join(front, f), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-portal-changes-'));
process.on('exit', () => fs.rmSync(tmp, {recursive:true, force:true}));

test('"Back to quizzes" on a quiz page always returns to the Quizzes section, under "About this page"', () => {
  const quiz = read('src/screens/QuizWorkspace.tsx');
  assert.doesNotMatch(quiz, /previousWebPath|router\.canGoBack\(\)|fromBook/, 'no history guessing on the quiz page');
  assert.match(quiz, /const goBack = \(\) => backTo\("\/manage\/quizzes"\);/);
  assert.match(quiz, /below=\{<Button title="Back to quizzes" variant="secondary" icon="arrow-back" onPress=\{goBack\} \/>\}/);
  assert.match(read('src/ui/index.tsx'), /\{actions \? <View style=\{s\.actions\}>\{actions\}<\/View> : null\}\n\s*\{below\}/, 'the button sits under the heading buttons');
});

test('the module page returns to the top when the tab changes', () => {
  assert.match(read('app/student/module/[id].tsx'), /scrollTopOn=\{`\$\{id\}:\$\{tab\}`\}/);
});

test('reopened modules get a label students can act on', async () => {
  const out = path.join(tmp, 'labels.cjs');
  await require('esbuild').build({entryPoints:[path.join(front,'src/api/progressLabels.ts')],outfile:out,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {reopenedLabel} = require(out);
  assert.equal(reopenedLabel('new_quiz'), 'New quiz published');
  assert.equal(reopenedLabel('updated'), 'Content updated');
  for (const none of ['', null, undefined, 'other']) assert.equal(reopenedLabel(none), null);
});

test('every signed-in workspace shows the required model setup', () => {
  const layout = read('app/_layout.tsx');
  assert.match(layout, /\{workspace \? <ModelGate \/> : null\}/);
  const screen = read('src/private/screens/OfflineAI.tsx');
  assert.doesNotMatch(screen, /\(await device\(\)\)\.download\(/, 'the screen no longer owns the download');
});

function png(file) {
  const b = fs.readFileSync(path.join(front, file));
  assert.equal(b.toString('ascii', 1, 4), 'PNG', `${file} is a PNG`);
  return {width:b.readUInt32BE(16), height:b.readUInt32BE(20), colorType:b[25]};
}
test('app icons are square, full size and without transparency where stores require it', () => {
  for (const f of ['assets/images/icon.png', 'ios/LocalMind/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png']) {
    const p = png(f);
    assert.deepEqual([p.width, p.height], [1024, 1024], f);
    assert.equal(p.colorType, 2, `${f} must be RGB without alpha (the App Store rejects transparent icons)`);
  }
  for (const f of ['assets/images/android-icon-foreground.png', 'assets/images/splash-icon.png', 'assets/images/brand-mark.png', 'assets/images/favicon.png'])
    assert.equal(png(f).colorType, 6, `${f} keeps its transparent background`);
  assert.match(read('src/ui/Shell.tsx'), /require\("\.\.\/\.\.\/assets\/images\/brand-mark\.png"\)/);
});
