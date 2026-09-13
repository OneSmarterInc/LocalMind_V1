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
const bundle=await build({entryPoints:[path.join(root,'scripts/parser-entry.mjs')],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,write:false,logLevel:'warning',external:['node:*']});
const code=bundle.outputFiles[0].text;
fs.writeFileSync(path.join(dest,'parser.js'),code);
const html='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' blob:; worker-src blob:; connect-src \'none\'"><script type="module">'+code.replace(/<\/script/gi,'<\\/script')+'</script>';
fs.mkdirSync(path.join(root,'src/private/generated'),{recursive:true});
fs.writeFileSync(path.join(root,'src/private/generated/parser.ts'),'// Generated from pinned dependencies by prepare-private-assets.mjs\nexport const PARSER_HTML='+JSON.stringify(html)+';\n');
console.log('Private PDF/DOCX parser and browser AI assets, including compatibility fallback, bundled locally.');
