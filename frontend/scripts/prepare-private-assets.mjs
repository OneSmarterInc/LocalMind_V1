import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dest=path.join(root,'public/private-assets');fs.mkdirSync(dest,{recursive:true});
const wllama=path.join(root,'node_modules/@wllama/wllama');
fs.cpSync(path.join(wllama,'esm'),path.join(dest,'wllama/esm'),{recursive:true});
const compat=path.join(root,'node_modules/@wllama/wllama-compat/wasm');
fs.cpSync(compat,path.join(dest,'wllama-compat'),{recursive:true});
for(const name of ['wllama/esm/index.js','wllama/esm/wasm/wllama.wasm','wllama-compat/wllama.wasm','wllama-compat/wllama.js']) {
 if(!fs.existsSync(path.join(dest,name)))throw Error('Pinned browser AI runtime asset missing: '+name);
}
// Compat assets must also be local: the default library CDN fallback cannot work offline.
fs.writeFileSync(path.join(dest,'runtime-loader.js'),`import {Wllama} from './wllama/esm/index.js';
window.__LM_WLLAMA__=class extends Wllama {
 constructor(paths,options){super(paths,options);this.setCompat({wasm:'/private-assets/wllama-compat/wllama.wasm',worker:'/private-assets/wllama-compat/wllama.js'});}
};\n`);
// Embed the non-SIMD LSTM core to support older phones; no runtime network is needed.
let ocrWorker=fs.readFileSync(path.join(root,'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js'),'utf8')+';\n'+fs.readFileSync(path.join(root,'node_modules/tesseract.js/dist/worker.min.js'),'utf8');
const ocrLanguage=fs.readFileSync(path.join(root,'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz')).toString('base64');
// Language bytes are served inside the worker. All external worker fetches fail closed.
// Passing a language object to Tesseract 6 misidentifies its data as the language name.
ocrWorker='self.fetch=async function(url){if(String(url)!=="https://localmind.invalid/bundled-ocr/eng.traineddata.gz")throw Error("Offline OCR cannot access the network");return new Response(Uint8Array.from(atob('+JSON.stringify(ocrLanguage)+'),c=>c.charCodeAt(0)));};\n'+ocrWorker;
fs.writeFileSync(path.join(root,'scripts/generated-ocr.mjs'),'export const OCR_WORKER='+JSON.stringify(ocrWorker)+';\n');
const bundle=await build({entryPoints:[path.join(root,'scripts/parser-entry.mjs')],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false,logLevel:'warning',external:['node:*']});
const code=bundle.outputFiles[0].text;
fs.writeFileSync(path.join(dest,'parser.js'),code);
const html='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' blob:; worker-src blob:; connect-src blob: data:; img-src blob: data:; style-src \'unsafe-inline\'"><script type="module">'+code.replace(/<\/script/gi,'<\\/script')+'</script>';
fs.mkdirSync(path.join(root,'src/private/generated'),{recursive:true});
fs.writeFileSync(path.join(root,'src/private/generated/parser.ts'),'// Generated from pinned dependencies by prepare-private-assets.mjs\nexport const PARSER_HTML='+JSON.stringify(html)+';\n');
console.log('Private PDF/DOCX parser and browser AI assets, including compatibility fallback, bundled locally.');
