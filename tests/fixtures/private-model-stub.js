// TEST FIXTURE ONLY. The browser test server copies this into a TEMPORARY web
// export. Production exports and the real-model smoke use the actual Wllama.
let sequence=0;
window.__LM_WLLAMA__=class {
 async loadModel(files,options){window.__LM_TEST_THREADS__=options.n_threads;await new Promise(r=>setTimeout(r,30));}
 async exit(){}
 async createChatCompletion(request){
  if(request.abortSignal?.aborted)throw new DOMException('Cancelled','AbortError');
  await new Promise(r=>setTimeout(r,window.__LM_TEST_DELAY__||100));
  if(request.abortSignal?.aborted)throw new DOMException('Cancelled','AbortError');
  const properties=request.response_format.json_schema.schema.properties;
  const quote=(properties.quote||properties.sections?.items?.properties.quote)?.enum?.[0]||'Photosynthesis happens in the chloroplasts of green leaves.';
  window.__LM_TEST_CALLS__=(window.__LM_TEST_CALLS__||0)+1;
  if(window.__LM_TEST_FAIL_AT__===window.__LM_TEST_CALLS__)throw Error('Local AI timed out: simulated interruption');
  const earlier=[...JSON.stringify(request.messages).matchAll(/Practice (\d+):/g)].map(m=>Number(m[1]));
  sequence=Math.max(sequence,...earlier);
  let data;
  if(window.__LM_TEST_FAIL_ONCE__){window.__LM_TEST_FAIL_ONCE__=false;data={};}
  else if(properties.introduction)data={introduction:'A local lesson about photosynthesis.',sections:[{heading:'How leaves use light',content:'Leaves use chlorophyll to absorb light.',quote}],takeaways:['Photosynthesis happens in chloroplasts.']};
  else if(properties.question)data={question:`Practice ${++sequence}: where does photosynthesis happen?`,options:['Chloroplasts','Roots','Bark','Flowers'],answer:0,explanation:'The stored book describes chloroplasts in green leaves.',quote};
  else data={answer:'The local model explains that photosynthesis happens in chloroplasts.',quote,supported:true};
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]};
 }
};
