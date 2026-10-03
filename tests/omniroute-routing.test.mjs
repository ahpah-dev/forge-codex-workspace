import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeResponses, KILO_FREE_BASE_URL, KILO_FREE_MODEL } from '../responses-bridge.mjs';
import { createOmniRouteRouting, omniRouteFallbacks } from '../omniroute-routing.mjs';
const provider={id:'omniroute-local',name:'OmniRoute Local',nativePreset:'omniroute',baseUrl:'http://127.0.0.1:20128/v1'};
const fallback={provider:{id:'kilo-free',name:'Kilo Free',nativePreset:'kilo-free',baseUrl:KILO_FREE_BASE_URL},model:KILO_FREE_MODEL,getKey:async()=>'fixture'};
const sink=()=>({output:'',destroyed:false,writeHead(){},write(chunk){this.output+=chunk;},end(){}});
const events=res=>res.output.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5)));
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const stream=chunks=>new Response(chunks.map(chunk=>`data: ${JSON.stringify(chunk)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
const success=()=>json({choices:[{message:{content:'Ready.'},finish_reason:'stop'}]});
const restricted={error:{message:"oc/big-pickle: auth — [403]: OpenCode's free tier can only be used from within OpenCode (HTTP 403)",code:403}};

test('OpenCode HTTP rejection falls back and remembers the actually successful route',async()=>{
 const calls=[],selected=[];
 const routing=createOmniRouteRouting({getFallbacks:async()=>[fallback],onRoute:route=>selected.push(route),fetchImpl:async(url)=>{calls.push(url);return url.startsWith(provider.baseUrl)?json(restricted,403):success();}});
 for(let index=0;index<2;index++){
  const res=sink();await bridgeResponses({input:{input:'Proceed'},res,router:routing.forProvider({provider,model:'auto/coding:free',key:''})});
  assert.equal(events(res).at(-1).type,'response.completed');
 }
 assert.deepEqual(calls,[provider.baseUrl+'/chat/completions',KILO_FREE_BASE_URL+'/chat/completions',KILO_FREE_BASE_URL+'/chat/completions']);
 assert.equal(selected[0].providerName,'Kilo Free');assert.equal(selected[0].fallback,true);assert.equal(selected[0].ownerProviderId,provider.id);
 routing.reset();const res=sink();await bridgeResponses({input:{input:'Proceed'},res,router:routing.forProvider({provider,model:'auto/coding:free',key:''})});
 assert.equal(calls[3],provider.baseUrl+'/chat/completions');
});

test('early SSE access errors switch routes but partial output is never replayed',async()=>{
 for(const partial of [false,true]){
  let calls=0;const selected=[];
  const routing=createOmniRouteRouting({getFallbacks:async()=>[fallback],onRoute:route=>selected.push(route),fetchImpl:async()=>{
   calls++;if(calls>1)return success();
   return stream([...(partial?[{choices:[{delta:{content:'Partial'},finish_reason:null}]}]:[]),restricted]);
  }});
  const res=sink();await bridgeResponses({input:{input:'Proceed'},res,router:routing.forProvider({provider,model:'auto/fast:free',key:''})});
  assert.equal(calls,partial?1:2);assert.equal(events(res).at(-1).type,partial?'response.failed':'response.completed');
  assert.equal(selected.length,1);assert.equal(selected[0].fallback,!partial);
 }
});

test('explicit models are not silently switched and missing credentials have actionable errors',async()=>{
 let calls=0;
 const routing=createOmniRouteRouting({getFallbacks:async()=>[fallback],fetchImpl:async()=>{calls++;return json(restricted,403);}});
 await assert.rejects(routing.forProvider({provider,model:'specific/model',key:''}).openCompletion({messages:[]}),/accessible free model/);
 assert.equal(calls,1);
 const empty=createOmniRouteRouting({getFallbacks:async()=>[],fetchImpl:async()=>json(restricted,403)});
 await assert.rejects(empty.forProvider({provider,model:'auto/coding:free',key:''}).openCompletion({messages:[]}),/Add or update a Kilo, OpenRouter, Groq, or NVIDIA key/);
});

test('only supported saved integrations qualify and OpenRouter fallback discovers zero-price tools',async()=>{
 const providers=[fallback.provider,{id:'paid',baseUrl:'https://example.com/v1',models:[{id:'paid'}]},{id:'oc',baseUrl:'https://opencode.ai/zen/v1',models:[{id:'big-pickle'}]},{id:'or',baseUrl:'https://openrouter.ai/api/v1',models:[{id:'paid'}]}];
 const calls=[];
 const candidates=omniRouteFallbacks(providers,id=>providers.some(provider=>provider.id===id),async()=> 'fixture',async(url,options)=>{
  calls.push(url);
  if(url.includes('/models'))return json({data:[{id:'paid',pricing:{prompt:'1',completion:'1'},supported_parameters:['tools']},{id:'coder:free',pricing:{prompt:'0',completion:'0'},supported_parameters:['tools']}]});
  const body=JSON.parse(options.body);assert.equal(body.model,'coder:free');assert.deepEqual(body.provider.max_price,{prompt:0,completion:0});return success();
 });
 assert.deepEqual(candidates.map(item=>item.provider.id),['kilo-free','omni-openrouter-free']);
 await candidates[1].router().openCompletion({messages:[]});assert.equal(calls.length,2);
});

test('unusable saved credentials are skipped, attempts are bounded, and cancellation stops routing',async()=>{
 let calls=0;const many=Array.from({length:8},(_,index)=>({...fallback,provider:{...fallback.provider,id:'fixture-'+index}}));
 const routing=createOmniRouteRouting({getFallbacks:async()=>many,fetchImpl:async()=>{calls++;return json({error:{message:'Key denied'}},401);}});
 await assert.rejects(routing.forProvider({provider,model:'auto/coding:free',key:''}).openCompletion({messages:[]}),/accessible free model/);assert.equal(calls,6);
 const controller=new AbortController();let attempted=0;
 const stopped=createOmniRouteRouting({getFallbacks:async()=>[fallback],fetchImpl:async()=>{attempted++;controller.abort(new Error('Stopped'));return json(restricted,403);}});
 await assert.rejects(stopped.forProvider({provider,model:'auto/coding:free',key:''}).openCompletion({messages:[]},controller.signal),/Stopped/);assert.equal(attempted,1);
});

test('output-limit recovery stays pinned to its selected route',async()=>{
 const models=[];let candidateCalls=0;
 const routing=createOmniRouteRouting({getFallbacks:async()=>[fallback],fetchImpl:async(url,options)=>{
  models.push(JSON.parse(options.body).model);
  if(url.startsWith(provider.baseUrl))return json(restricted,403);
  candidateCalls++;return json({choices:[{message:{content:candidateCalls===1?'Part one.':' Done.'},finish_reason:candidateCalls===1?'length':'stop'}]});
 }});
 const res=sink();await bridgeResponses({input:{input:'Proceed'},res,router:routing.forProvider({provider,model:'auto/coding:free',key:''})});
 assert.equal(events(res).at(-1).type,'response.completed');assert.deepEqual(models,['auto/coding:free',KILO_FREE_MODEL,KILO_FREE_MODEL]);
});
