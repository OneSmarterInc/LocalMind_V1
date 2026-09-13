import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=path.resolve('dist');const files=[];
function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())scan(p);else if(!p.endsWith('.map') && !['sw.js','offline-files.json'].includes(e.name))files.push('/'+path.relative(root,p).split(path.sep).join('/'));}}
scan(root);files.sort();
const digest=crypto.createHash('sha256');for(const f of files)digest.update(f).update(fs.readFileSync(path.join(root,f)));
fs.writeFileSync(path.join(root,'offline-files.json'),JSON.stringify({version:digest.digest('hex').slice(0,20),files}));
console.log(`Offline manifest contains ${files.length} local application assets. No API replies or personal data included.`);
