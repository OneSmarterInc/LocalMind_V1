import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';import test from 'node:test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lm-private-tests-'));
const tsc=fs.existsSync(path.join(root,'frontend/node_modules/typescript/bin/tsc'))?[process.execPath,[path.join(root,'frontend/node_modules/typescript/bin/tsc')]]:['tsc',[]];
const result=spawnSync(tsc[0],[...tsc[1],'--strict','--target','ES2022','--module','commonjs','--skipLibCheck','--outDir',tmp,...['core.ts','busy.ts','offlinePolicy.ts','jobs.ts','performance.ts','parserBridge.ts'].map(f=>path.join(root,'frontend/src/private',f))],{encoding:'utf8'});
if(result.status!==0){console.error(result.stdout,result.stderr);process.exit(1);}
const require=createRequire(import.meta.url),c=require(path.join(tmp,'core.js')),b=require(path.join(tmp,'busy.js')),policy=require(path.join(tmp,'offlinePolicy.js'));
const source='Photosynthesis occurs in chloroplasts. Chlorophyll absorbs sunlight. Plants use carbon dioxide and release oxygen.';
const q={question:'Where does photosynthesis occur?',options:['Chloroplasts','Roots','Soil','Flowers'],answer:0,explanation:'Photosynthesis occurs in chloroplasts.',quote:'Photosynthesis occurs in chloroplasts.'};
const question=()=>c.validateMCQ(q,source,'s1','q1');
test('one useful question is validated against actual source',()=>assert.equal(question().answer,0));
for(const [name,change] of [['missing answer',{answer:'Option A'}],['out of range',{answer:4}],['empty question',{question:''}],['duplicate options',{options:['A','a','C','D']}],['missing option',{options:['A','B','C']}],['invented quote',{quote:'The moon produces the energy for plants.'}],['trivial quote',{quote:'a'}]]) test('reject '+name,()=>assert.throws(()=>c.validateMCQ({...q,...change},source,'s1','q1')));
test('wrong answer is marked wrong without an AI call',()=>{const r=c.markQuiz([question()],{q1:2});assert.equal(r.correct,0);assert.equal(r.percentage,0);});
test('right answer marked from persisted key',()=>assert.equal(c.markQuiz([question()],{q1:0}).correct,1));
test('no completion of an empty quiz',()=>assert.throws(()=>c.markQuiz([],{})));
test('no completion without all answers',()=>assert.throws(()=>c.markQuiz([question()],{})));
test('no completion with foreign question ID',()=>assert.throws(()=>c.markQuiz([question()],{q1:0,other:0})));
test('score rounded not truncated',()=>{const qs=['q1','q2','q3'].map(id=>({...question(),id}));assert.equal(c.markQuiz(qs,{q1:0,q2:1,q3:1}).percentage,33);});
test('answer grounded in stored source',()=>assert.equal(c.validateAnswer({answer:'In chloroplasts.',quote:q.quote,supported:true},source).supported,true));
test('unsupported answer cannot smuggle invented explanations',()=>assert.equal(c.validateAnswer({answer:'Invented!',quote:'',supported:false},source).answer.includes('Invented'),false));
test('invented answer citation refused',()=>assert.throws(()=>c.validateAnswer({answer:'A!',quote:'This is fabricated evidence.',supported:true},source)));
test('lesson needs a quoted supporting passage',()=>assert.throws(()=>c.validateLesson({introduction:'Intro',sections:[{heading:'H',content:'C',quote:'Not present anywhere in the book.'}],takeaways:['T']},source)));
test('short lesson needs no forced three sections',()=>assert.equal(c.validateLesson({introduction:'Intro',sections:[{heading:'H',content:'C',quote:q.quote}],takeaways:['T']},source).sections.length,1));
test('source split is lossless and bounded',()=>{const s=(source+'\n\n').repeat(200);const rows=c.makeSections([{title:'Plants',text:s}]);assert.ok(rows.length>1);assert.ok(rows.every(r=>r.source.length<=c.MAX_SECTION_CHARS));assert.equal(rows.map(r=>r.source).join('').replace(/\s/g,''),s.replace(/\s/g,''));});
test('no empty source module',()=>assert.throws(()=>c.makeSections([{title:'Empty',text:'  '}])));
test('introduction is kept',()=>assert.equal(c.makeSections([{title:'Introduction',text:source}])[0].title,'Introduction'));
test('private source has no progress locks',()=>{const sections=c.makeSections([{title:'One',text:source},{title:'Two',text:source}]);assert.equal(sections.length,2);assert.ok(sections.every(s=>!('locked' in s)));});
test('duplicate module identifiers are refused',()=>{const sections=[{id:'s1',title:'One',source},{id:'s1',title:'Two',source}];assert.throws(()=>c.validateBook({id:'a',title:'Book',importedAt:'now',sections,warnings:[]}));});
for(const [status,code,want] of [[0,'NETWORK',true],[0,'CANCELLED',false],[401,'NETWORK',false],[403,'NETWORK',false],[404,'NOT_FOUND',false],[409,'MODULE_LOCKED',false],[502,'HTTP_ERROR',true],[503,'AI_UNAVAILABLE',true],[429,'RATE_LIMITED',false]])test(`offline fallback ${status}/${code} = ${want}`,()=>assert.equal(policy.offlineFallbackAllowed(status,code),want));
test('overlapping operations cannot use or replace the model',async()=>{const lock=new b.Exclusive();let end;const first=lock.run(()=>new Promise(r=>end=r));await assert.rejects(lock.run(async()=>1));end(0);await first;assert.equal(await lock.run(async()=>2),2);});
test('model operation failure releases its lock',async()=>{const lock=new b.Exclusive();await assert.rejects(lock.run(async()=>{throw Error('bad');}));assert.equal(await lock.run(async()=>3),3);});
test('cancelled operations fail explicitly',()=>{const abort=new AbortController();abort.abort();assert.throws(()=>b.cancelled(abort.signal));});
test('old publishing bookmark redirects into the integrated flow',()=>{const s=fs.readFileSync(path.join(root,'frontend/app/manage/study/[id].tsx'),'utf8');assert.match(s,/Redirect/);assert.doesNotMatch(s,/AuthoringView|ContentBlock|TeachingAid/);});
test('private service never posts learner data to an API',()=>{const s=fs.readFileSync(path.join(root,'frontend/src/private/library.ts'),'utf8');assert.doesNotMatch(s,/fetch\(|api\(/);});
process.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));

test('constrained quotations are exact source passages and do not mutate the shared schema',()=>{
 const schema=c.groundedSchema(c.LESSON_SCHEMA,source),quotes=schema.properties.sections.items.properties.quote.enum;
 assert.ok(quotes.length);for(const quote of quotes)assert.equal(c.quoteIn(quote,source),quote);
 assert.equal(c.LESSON_SCHEMA.properties.sections.items.properties.quote.enum,undefined);
});
test('source pages remain attached after module splitting',()=>{
 const sections=c.makeSections([{title:'Scan',text:source.repeat(60),page:3,visualIds:['v3'],ocr:true}]);
 assert.ok(sections.length>1);assert.ok(sections.every(s=>s.page===3&&s.visualIds[0]==='v3'&&s.ocr));
});
test('an image-only diagram is retained without fake OCR text',()=>{
 const sections=c.makeSections([{title:'Diagram',text:'',visualIds:['v1']}]);
 assert.equal(sections[0].source,'');assert.doesNotThrow(()=>c.validateBook({id:'x',title:'Diagram',importedAt:'now',sections,warnings:[]}));
 assert.throws(()=>c.groundedSchema(c.LESSON_SCHEMA,sections[0].source));
});

test('a decimal table value remains available in source-constrained quotations',()=>{
 const source='Plant\n\nHeight in cm\n\nBean\n\n12.5';
 const quotes=c.groundedSchema(c.MCQ_SCHEMA,source).properties.quote.enum;
 assert.ok(quotes.some(q=>q.includes('12.5')));for(const q of quotes)c.quoteIn(q,source);
});


test('lesson passages cover the last sentence as well as the first',()=>{
 const source=('A source paragraph with several concepts. ').repeat(75)+'FINAL CONCEPT.';
 const parts=c.lessonPassages(source);assert.ok(parts.length>1);assert.equal(parts.join('').replace(/\s/g,''),source.replace(/\s/g,''));assert.ok(parts.at(-1).includes('FINAL CONCEPT.'));
});
test('private doubts find a misspelled term in another module within the prompt limit',()=>{
 const sections=[{id:'one',title:'Unrelated',source:'Plants grow in sunlight.'},{id:'two',title:'Charge',source:'The coulomb is the SI unit of electric charge.'}];
 const reference=c.bookReference(sections,'one','what is columb');assert.ok(reference.startsWith('[Charge]'));assert.ok(reference.includes('SI unit'));assert.ok(reference.length<=c.MAX_SECTION_CHARS);
});
test('PDF script runs remain attached to their mathematical base',async()=>{
 const {readablePdfText}=await import('../frontend/scripts/pdf-layout.mjs');
 const run=(str,x,y,h=12,width=12)=>({str,width,height:h,transform:[h,0,0,h,x,y]});
 const result=readablePdfText([run('Charge q',20,700,12,50),run('1',70,697,8,5),run(' + q',78,700,12,25),run('2',103,697,8,5),run(' is conserved.',112,700,12,100)]);
 assert.equal(result,'Charge q₁ + q₂ is conserved.');
});


test('model completion queue is FIFO, cancellable and never overlaps',async()=>{
 const lock=new b.Exclusive(),events=[];let finish;
 const first=lock.queue(async()=>{events.push('first');await new Promise(r=>{finish=r;});});
 const abort=new AbortController();const second=lock.queue(async()=>events.push('cancelled should not run'),abort.signal);const rejected=assert.rejects(second,/Cancelled/);
 const third=lock.queue(async()=>events.push('third'));abort.abort();finish();await Promise.all([first,rejected,third]);assert.deepEqual(events,['first','third']);
});
test('app jobs bound concurrency and cancel queued work on account change',async()=>{
 const {JobQueue}=require(path.join(tmp,'jobs.js'));const queue=new JobQueue(2),release=[];let running=0,peak=0;
 const meta=i=>({scope:'old',bookId:'book',sectionId:String(i),kind:'lesson',label:'Lesson'});
 for(let i=0;i<3;i++)queue.enqueue(meta(i),async signal=>{running++;peak=Math.max(peak,running);await new Promise(r=>release.push(r));running--;if(signal.aborted)throw Error('cancelled');});
 assert.deepEqual(queue.list('old').map(j=>j.state),['running','running','queued']);queue.cancelOtherScopes('new');release.forEach(r=>r());await queue.cancelBook('old','book');assert.equal(peak,2);assert.ok(queue.list('old').every(j=>j.state==='cancelled'));assert.deepEqual(queue.list('new'),[]);
});
test('one failed background job does not block later work',async()=>{
 const {JobQueue}=require(path.join(tmp,'jobs.js'));const queue=new JobQueue(1);
 const meta=i=>({scope:'user',bookId:'book',sectionId:String(i),kind:'lesson',label:'Lesson'});
 queue.enqueue(meta(1),async()=>{throw Error('failed generation');});queue.enqueue(meta(2),async()=>{});
 await new Promise(r=>setTimeout(r,0));assert.deepEqual(queue.list('user').map(j=>j.state),['failed','completed']);
});
test('split page context includes a tiny tail without borrowing adjacent pages',()=>{
 const sections=[{id:'a',title:'Page 3 part 1',page:3,source:'Full explanation of conductors and charge.'},{id:'b',title:'Page 3 part 2',page:3,source:'A short heading'},{id:'c',title:'Other',page:4,source:'Unrelated'}];
 assert.equal(c.pageSource(sections,'b'),'Full explanation of conductors and charge.\n\nA short heading');
});
test('balanced page splitting does not orphan a tiny trailing heading',()=>{
 const input=('An entire sentence about charge. '.repeat(104))+'\n1.3 Conductors';const rows=c.makeSections([{title:'Page',text:input}]);
 assert.ok(rows.every(s=>s.source.length>500));assert.equal(rows.map(s=>s.source).join('').replace(/\s/g,''),input.replace(/\s/g,''));
});
test('doubt lane starts while two long study jobs are active',async()=>{
 const {JobQueue}=require(path.join(tmp,'jobs.js')),queue=new JobQueue(2,true);const release=[];
 const run=()=>new Promise(resolve=>release.push(resolve));
 for(const [i,kind] of ['lesson','quiz','lesson','doubt','doubt'].entries())queue.enqueue({scope:'u',bookId:'b',sectionId:String(i),kind,label:kind},run);
 assert.deepEqual(queue.list('u').map(j=>j.state),['running','running','queued','running','queued']);
 queue.cancelOtherScopes('');release.forEach(r=>r());await queue.cancelBook('u','b');
});
test('PDF small caps normalize display casing without changing ordinary scientific text',async()=>{
 const {readablePdfText}=await import('../frontend/scripts/pdf-layout.mjs');
 const run=(str,x,h,width)=>({str,transform:[h,0,0,h,x,700],height:h,width});
 assert.equal(readablePdfText([run('C',0,12,8),run('onductors',8,9,55)]),'CONDUCTORS');
 assert.equal(readablePdfText([run('Charge',0,12,40),run('q',45,9,5)]),'Charge q');
});

const perf=require(path.join(tmp,'performance.js'));
test('inference threads preserve a non-isolated fallback and cap CPU use',()=>{
 assert.equal(perf.inferenceThreads(false,true,16),1);assert.equal(perf.inferenceThreads(true,false,16),1);
 assert.equal(perf.inferenceThreads(true,true,8),4);assert.equal(perf.inferenceThreads(true,true,4),2);
 assert.equal(perf.inferenceThreads(true,true,1),1);assert.equal(perf.inferenceThreads(true,true,NaN),1);
});
test('checkpoint retry after reload generates only missing validated parts',async()=>{
 let saved, calls=[];const signal=new AbortController().signal;
 const options={checkpoint:{id:'version-one',parts:[]},total:3,signal,save:async row=>{saved=structuredClone(row);},generate:async index=>{calls.push(index);if(index===1)throw Error('timeout');return 'first';}};
 await assert.rejects(perf.resumeParts(options));assert.deepEqual(saved.parts,['first']);
 const resumed=await perf.resumeParts({...options,checkpoint:structuredClone(saved),generate:async index=>{calls.push(index);return 'part '+index;}});
 assert.deepEqual(calls,[0,1,1,2]);assert.deepEqual(resumed,['first','part 1','part 2']);assert.equal(saved.id,'version-one');
});
test('checkpoint cancellation preserves completed parts but never accepts interrupted output',async()=>{
 const abort=new AbortController();let saved;
 await assert.rejects(perf.resumeParts({checkpoint:{id:'v',parts:[]},total:2,signal:abort.signal,
 save:async row=>{saved=structuredClone(row);},generate:async index=>{if(index===1)abort.abort();return index;}}));
 assert.deepEqual(saved.parts,[0]);
});
test('doubt retrieval removes unrelated filler and keeps AI acronym matches',()=>{
 const sections=[{id:'s1',title:'Other',source:'Photosynthesis uses sunlight. '.repeat(40)},
 {id:'s2',title:'Phones',source:'AI in smartphones supports voice recognition and camera processing.'}];
 const ref=c.bookReference(sections,'s1','Tell me AI in smartphones');assert.ok(ref.includes('voice recognition'));assert.ok(!ref.includes('Photosynthesis'));assert.ok(ref.length<=1800);
});


test('native import cancellation waits for an in-flight image save before rollback',async()=>{
 const bridge=require(path.join(tmp,'parserBridge.js'));let parseId;let finishSave;let settled=false;let acked=false;
 bridge.attachParser(id=>{parseId=id;},()=>{},()=>{acked=true;});
 const abort=new AbortController();
 const job=bridge.parseNative('book.pdf','AA==',abort.signal,undefined,()=>new Promise(resolve=>{finishSave=resolve;}));
 const outcome=job.then(()=>{settled=true;return '';},e=>{settled=true;return e.message;});
 bridge.parserResult({id:parseId,visual:{id:'v1',dataUrl:'data:image/png;base64,AA==',width:1,height:1,caption:'Page'}});
 abort.abort();await Promise.resolve();assert.equal(settled,false);
 finishSave();assert.match(await outcome,/cancel/i);assert.equal(acked,false);
 bridge.attachParser(undefined);
});
