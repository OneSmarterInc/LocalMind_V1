import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dest=path.join(root,'public/private-assets');fs.mkdirSync(dest,{recursive:true});
const wllama=path.join(root,'node_modules/@wllama/wllama');
fs.cpSync(path.join(wllama,'esm'),path.join(dest,'wllama/esm'),{recursive:true});
const entry=path.join(dest,'wllama/esm/index.js');
if(!fs.existsSync(entry)||!fs.existsSync(path.join(dest,'wllama/esm/wasm/wllama.wasm'))) throw Error('Expected wllama 3.7.0 runtime assets are missing.');
fs.writeFileSync(path.join(dest,'runtime-loader.js'),"import {Wllama} from './wllama/esm/index.js'; window.__LM_WLLAMA__=Wllama;\n");
const bundle=await build({entryPoints:[path.join(root,'scripts/parser-entry.mjs')],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false,logLevel:'warning',external:['node:*']});
const code=bundle.outputFiles[0].text;
fs.writeFileSync(path.join(dest,'parser.js'),code);
// The native parser is bundled into the same app. It does not load from a web URL.
const html='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' blob:; worker-src blob:; connect-src \'none\'"><script type="module">'+code.replace(/<\/script/gi,'<\\/script')+'</script>';
fs.mkdirSync(path.join(root,'src/private/generated'),{recursive:true});
fs.writeFileSync(path.join(root,'src/private/generated/parser.ts'),'// Generated from pinned dependencies by prepare-private-assets.mjs\nexport const PARSER_HTML='+JSON.stringify(html)+';\n');
console.log('Private PDF/DOCX parser and browser AI assets prepared locally.');
