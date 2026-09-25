import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {ANSWER_SCHEMA,groundedSchema,GROUNDING,validateAnswer} from '../src/private/core';

test('compare single and multiple CPU threads with the same real model and doubt',async({page})=>{
 test.skip(!process.env.LM_E2E_MODEL_FILE,'Provide the verified local GGUF file.');test.setTimeout(1200000);
 await page.goto('/offline-files.json');
 expect(await page.evaluate(()=>crossOriginIsolated)).toBe(true);
 await page.evaluate(async()=>{await import(/* webpackIgnore: true */ '/private-assets/runtime-loader.js' as string);document.body.innerHTML='<input type="file" id="model">';});
 await page.locator('#model').setInputFiles(process.env.LM_E2E_MODEL_FILE!);
 const source='Photosynthesis happens in the chloroplasts of green leaves. Chlorophyll absorbs sunlight. Plants use light energy to convert carbon dioxide and water into glucose and oxygen.';
 const request={messages:[{role:'system',content:GROUNDING},{role:'user',content:`Answer in at most 120 words from the reference. If unsupported set supported=false.\nREFERENCE:\n${source}\nQUESTION: Where does photosynthesis happen?`}],max_tokens:420,temperature:0.1,stream:false,chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_schema',json_schema:{name:'study',schema:groundedSchema(ANSWER_SCHEMA,source),strict:true}}};
 const results=[];
 for(const threads of [1,4]){
  const result=await page.evaluate(async({threads,request})=>{
   const engine=new (window as any).__LM_WLLAMA__({default:'/private-assets/wllama/esm/wasm/wllama.wasm'});
   try{
    const start=performance.now();await engine.loadModel([(document.querySelector('#model') as HTMLInputElement).files![0]],{n_ctx:4096,n_threads:threads,n_gpu_layers:0});
    const loadMs=performance.now()-start,timings=[];
    for(let i=0;i<2;i++){const begin=performance.now();const response=await engine.createChatCompletion(request);timings.push({ms:performance.now()-begin,response});}
    return {requestedThreads:threads,multithread:engine.isMultithread(),loadMs,timings};
   }finally{await engine.exit();}
  },{threads,request});
  for(const timing of result.timings){expect(timing.response.choices[0].finish_reason).not.toBe('length');validateAnswer(JSON.parse(timing.response.choices[0].message.content),source);}
  results.push(result);console.log(JSON.stringify(result));
 }
 fs.writeFileSync('test-results/private-performance.json',JSON.stringify({hardware:'Linux CI/workspace Chromium; not the user laptop',results},null,2));
});
