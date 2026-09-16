import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {sourceCaption,usefulPicture,pdfPictureContext,wordPictureContext} from '../frontend/scripts/picture-context.mjs';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'visual-placement-'));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local=path.join(root,'frontend/node_modules/typescript/bin/tsc');
const compiled=spawnSync(fs.existsSync(local)?process.execPath:'tsc',[...(fs.existsSync(local)?[local]:[]),'--strict','--target','ES2022','--module','commonjs','--skipLibCheck','--outDir',temp,path.join(root,'frontend/src/private/visualPlacement.ts')],{encoding:'utf8'});
assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
const {lessonVisualIds}=createRequire(import.meta.url)(path.join(temp,'visualPlacement.js'));
process.on('exit',()=>fs.rmSync(temp,{recursive:true,force:true}));
test('source caption is copied, not invented',()=>{assert.equal(sourceCaption(['A paragraph.','Figure 4: Costs by department']), 'Figure 4: Costs by department');assert.equal(sourceCaption(['No caption here.']),'');});
test('small compressed but meaningful images pass geometry policy',()=>{assert.equal(usefulPicture(110,110),true);assert.equal(usefulPicture(20,200),false);assert.equal(usefulPicture(1000,40),false);});
test('nearby PDF context ignores a distant or different-column paragraph',()=>{
 const item=(str,x,y)=>({str,width:200,height:10,transform:[10,0,0,10,x,y]});
 const r=pdfPictureContext([item('Figure 1: Plant energy',100,410),item('Distant text',100,30),item('Other column',500,300)],{scale:1,convertToViewportPoint:(x,y)=>[x,y]},[80,180,330,400]);
 assert.equal(r.caption,'Figure 1: Plant energy');assert.ok(!r.contextText.includes('Distant'));assert.ok(!r.contextText.includes('Other column'));
});
test('Word context does not cross the next authored heading',()=>{
 const nodes=[{s:'Heading A',h:true},{s:'Sunlight supplies energy'},{s:''},{s:'Figure 1: Sunlight'},{s:'Heading B',h:true},{s:'Unrelated costs'}];
 const r=wordPictureContext(nodes,2,n=>n.s,n=>n.h);assert.equal(r.caption,'Figure 1: Sunlight');assert.ok(!r.contextText.includes('Unrelated'));
});
test('lesson pictures attach to matching explanation rather than first section',()=>{
 const sections=[{heading:'Water',content:'Roots absorb water from the soil and transport it into leaves.',quote:'Roots absorb water from the soil and transport it into leaves.'},{heading:'Energy',content:'Chlorophyll absorbs sunlight and supplies energy for photosynthesis.',quote:'Chlorophyll absorbs sunlight and supplies energy for photosynthesis.'}];
 assert.deepEqual(lessonVisualIds(sections,[{id:'v1',caption:'Source image',width:300,height:200,dataUrl:'',contextText:sections[1].quote}]),[[],['v1']]);
});
test('ambiguous figures and legacy pages are not forced into an explanation',()=>{
 const s={heading:'Same',content:'Chlorophyll absorbs sunlight and supplies energy for photosynthesis.',quote:'Chlorophyll absorbs sunlight and supplies energy for photosynthesis.'};
 assert.deepEqual(lessonVisualIds([s,s],[{id:'v1',caption:'Source image',width:300,height:200,dataUrl:'',contextText:s.quote},{id:'v2',kind:'page',caption:'Original page',width:300,height:600,dataUrl:'',contextText:s.quote}]),[[],[]]);
});
