import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const before = `                    ctx->completion->rewind();
                    if (!ctx->completion->initSampling()) {`;
export const after = `                    // LocalMind: preserve this request's grammar and stops across rewind.
                    // parseCompletionParams has already populated these fields. The
                    // 0.10.0 reset clears both before initSampling can consume them.
                    const auto requestGrammar = ctx->params.sampling.grammar;
                    const auto requestStops = ctx->params.antiprompt;
                    ctx->completion->rewind();
                    ctx->params.sampling.grammar = requestGrammar;
                    ctx->params.antiprompt = requestStops;
                    if (!ctx->completion->initSampling()) {`;

/** Patch the JSI wrapper that Android CMake always builds, even with prebuilt cores.
 * Never patch rn-completion.cpp alone: its shipped .so would still contain the bug.
 * Version and exact-context guards fail the build if an upgrade needs review.
 */
export function patchRuntime(packageRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (pkg.version !== '0.10.0') throw new Error(`Review the LocalMind native patch for llama.rn ${pkg.version}; expected 0.10.0.`);
  const cmake = fs.readFileSync(path.join(packageRoot, 'android/src/main/CMakeLists.txt'), 'utf8');
  if (!cmake.includes('${CMAKE_SOURCE_DIR}/../../../cpp/jsi/RNLlamaJSI.cpp')) {
    throw new Error('The Android build no longer compiles the patched JSI wrapper. Review the native patch.');
  }
  const filename = path.join(packageRoot, 'cpp/jsi/RNLlamaJSI.cpp');
  const original = fs.readFileSync(filename, 'utf8');
  const source = original.replace(/\r\n/g, '\n');
  const occurrences = (text, needle) => text.split(needle).length - 1;
  if (occurrences(source, after) === 1 && !source.includes(before)) return 'already patched';
  if (source.includes('LocalMind: preserve') || occurrences(source, before) !== 1) {
    throw new Error('Unexpected llama.rn completion source; refusing to apply a partial native patch.');
  }
  const updated = source.replace(before, after);
  fs.writeFileSync(filename, original.includes('\r\n') ? updated.replace(/\n/g, '\r\n') : updated);
  return 'patched';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log(`LocalMind llama.rn grammar/stops: ${patchRuntime(path.join(frontend, 'node_modules/llama.rn'))}`);
}
