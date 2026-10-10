import test from 'node:test';
import assert from 'node:assert/strict';
import {createFlagshipRouterRouting} from '../flagshiprouter-routing.mjs';
import {createChatProviderRouter,modelAvailabilityError,bridgeResponses} from '../responses-bridge.mjs';
const provider={id:'flagshiprouter',name:'FlagshipRouter',nativePreset:'flagshiprouter',baseUrl:'http://localhost:20128/v1',models:['oc/union-alpha','oc/jev-1.13-free','oc/muse-1.3-free','oc/muse-1.2-free','oc/paid-model','gpt-6-astra'].map(id=>({id}))};
const success=()=>new Response(JSON.stringify({choices:[{message:{content:'READY'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
const rejection=(type,message,status=401)=>new Response(JSON.stringify({error:{type:'authentication_error',code:'invalid_api_key',message:`[${status}]: ${JSON.stringify({type:'error',error:{type,message}})}`}}),{status});
const catalog=()=>Response.json({data:['jev-1.13-free','muse-1.3-free','muse-1.2-free','paid-model'].map(id=>({id}))});
const sink=()=>({output:'',destroyed:false,writeHead(){},write(chunk){this.output+=chunk;},end(){}});
const final=res=>res.output.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5))).at(-1);

test('nested model and protocol rejections take precedence over misleading HTTP auth codes',async()=>{
  for(const [type,message] of [['ModelError','Model union-alpha is not supported'],['ModelProtocolUnsupported','Model does not support this protocol.']]){
    const response=rejection(type,message);assert.equal(modelAvailabilityError(await response.clone().json()),message);
    const router=createChatProviderRouter({provider,model:'oc/union-alpha',key:'secret',fetchImpl:async()=>response});
    await assert.rejects(router.openCompletion({messages:[]}),error=>error.code==='model_unavailable' && !error.message.includes('Check your API key'));
  }
  assert.equal(modelAvailabilityError({error:{message:'Invalid API key'}}),null);
});

test('live catalogs remove stale OpenCode models without removing gateway aliases or adding upstream models',async()=>{
  let calls=0;
  const routing=createFlagshipRouterRouting({fetchImpl:async(url,options)=>{calls++;assert.equal(options.headers.Authorization,undefined);assert.equal(url,'https://opencode.ai/zen/v1/models');return catalog();}});
  const result=await routing.discover(provider,provider.models);
  assert.ok(!result.some(row=>row.id==='oc/union-alpha'));assert.ok(result.some(row=>row.id==='gpt-6-astra'));
  await routing.refresh();assert.equal(calls,1);
});

test('stale selections fall back to a current same-provider free route and stay on it for follow-ups',async()=>{
  const requests=[],routes=[];
  const routing=createFlagshipRouterRouting({onRoute:route=>routes.push(route),fetchImpl:async(url,options)=>{if(url.endsWith('/models'))return catalog();requests.push(JSON.parse(options.body).model);return success();}});
  for(let turn=0;turn<2;turn++){
    const res=sink();await bridgeResponses({res,router:routing.forProvider({provider,model:'oc/union-alpha',key:'secret',scopeId:'chat'}),input:{input:'hi'}});
    assert.equal(final(res).type,'response.completed');
  }
  assert.deepEqual(requests,['oc/muse-1.3-free','oc/muse-1.3-free']);assert.ok(routes.every(route=>route.fallback));
});

test('protocol failures cool down only that route and try another free route before output',async()=>{
  const requests=[];
  const routing=createFlagshipRouterRouting({fetchImpl:async(url,options)=>{if(url.endsWith('/models'))return catalog();const model=JSON.parse(options.body).model;requests.push(model);return model==='oc/jev-1.13-free'?rejection('ModelProtocolUnsupported','Model does not support this protocol.',400):success();}});
  const res=sink();await bridgeResponses({res,router:routing.forProvider({provider,model:'oc/jev-1.13-free',key:'secret'}),input:{input:'hi'}});
  assert.equal(final(res).type,'response.completed');assert.deepEqual(requests,['oc/jev-1.13-free','oc/muse-1.3-free']);
  assert.ok(!routing.filterModels(provider).some(row=>row.id==='oc/jev-1.13-free'));
});

test('real authentication failures, quota failures and paid selections never trigger free fallback',async()=>{
  for(const [model,status,detail] of [['oc/jev-1.13-free',401,{error:{message:'Invalid API key'}}],['oc/jev-1.13-free',429,{error:{message:'Quota exceeded'}}],['oc/paid-model',401,{error:{message:'Model paid-model is not supported'}}]]){
    let calls=0;const routing=createFlagshipRouterRouting({fetchImpl:async(url)=>{if(url.endsWith('/models'))return catalog();calls++;return Response.json(detail,{status});}});
    await assert.rejects(routing.forProvider({provider,model,key:'secret'}).openCompletion({messages:[]}));assert.equal(calls,1);
  }
});

test('failed or empty catalog refreshes preserve saved models and do not become a stuck pending request',async()=>{
  let calls=0;let clock=0;const routing=createFlagshipRouterRouting({now:()=>clock,fetchImpl:()=>{calls++;throw new Error('offline');}});
  await routing.refresh();assert.equal(routing.filterModels(provider).length,provider.models.length);clock=31000;await routing.refresh();assert.equal(calls,2);
});

test('partial streamed output is retained and never replayed on another route',async()=>{
  let calls=0;const routing=createFlagshipRouterRouting({fetchImpl:async(url)=>{if(url.endsWith('/models'))return catalog();calls++;return new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"Model does not support this protocol.","type":"ModelProtocolUnsupported"}}\n\n',{headers:{'Content-Type':'text/event-stream'}});}});
  const res=sink();await bridgeResponses({res,router:routing.forProvider({provider,model:'oc/jev-1.13-free',key:'secret'}),input:{input:'hi'}});
  assert.equal(final(res).type,'response.failed');assert.equal(calls,1);assert.equal(final(res).response.output[0].content[0].text,'partial');
});
