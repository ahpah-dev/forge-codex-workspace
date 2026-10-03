import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeResponses, chatChunks } from '../responses-bridge.mjs';
import { createOmniRouteRouting } from '../omniroute-routing.mjs';
import { createOmniRouteSync } from '../omniroute-sync.mjs';
const provider={id:'omni',name:'OmniRoute',baseUrl:'http://127.0.0.1:20128/v1',nativePreset:'omniroute'};
const success=()=>new Response(JSON.stringify({choices:[{message:{content:'Ready'},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
test('route notifications are scoped to chats and change only when the destination changes',async()=>{
 let clock=0, native=false; const notices=[],urls=[];
 const fallback={provider:{id:'kilo',name:'Kilo',baseUrl:'https://fixture.test/v1'},model:'free',getKey:async()=> 'fixture'};
 const routing=createOmniRouteRouting({now:()=>clock,getFallbacks:async()=>[fallback],onRoute:r=>notices.push(r),fetchImpl:async url=>{urls.push(url);return native || !url.includes('20128') ? success() : new Response('{"error":{"message":"quota"}}',{status:429});}});
 async function request(scopeId){const router=routing.forProvider({provider,model:'auto/coding:free',scopeId});const opened=await router.openCompletion({messages:[]});router.confirmRoute(opened.route);}
 await request('a');await request('a');await request('b');assert.equal(notices.length,2);
 native=true;clock=61000;await request('a');await request('a');assert.equal(notices.length,3);assert.equal(notices.at(-1).fallback,false);assert.ok(urls.at(-1).includes('20128'));
});
test('SSE accepts CRLF split across bytes, split UTF8 and a valid EOF frame',async()=>{
 const bytes=new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'🌙'}}]})+'\r\n\r\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]}));
 const body=new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}});
 const chunks=[];for await(const chunk of chatChunks(new Response(body,{headers:{'content-type':'text/event-stream'}})))chunks.push(chunk);
 assert.equal(chunks[0].choices[0].delta.content,'🌙');assert.equal(chunks[1].choices[0].finish_reason,'stop');
});
test('repeated function names and JSON object arguments remain one structured call',async()=>{
 const chunks=[{choices:[{delta:{tool_calls:[{index:0,id:'call_one',function:{name:'read_file',arguments:{path:'a.txt'}}}]}}]},{choices:[{delta:{tool_calls:[{index:0,id:'call_one',function:{name:'read_file'}}]},finish_reason:'tool_calls'}]}];
 const router={openCompletion:async()=>({route:{name:'Fixture'},response:new Response(chunks.map(chunk=>'data: '+JSON.stringify(chunk)+'\n\n').join('')+'data: [DONE]\n\n')})};
 const res={output:'',writeHead(){},write(bytes){this.output+=bytes;},end(){}};
 await bridgeResponses({input:{input:'Read',tools:[{type:'function',name:'read_file',parameters:{type:'object',properties:{path:{type:'string'}}}}]},res,router});
 const events=res.output.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5)));
 const result=events.at(-1);assert.equal(result.type,'response.completed');assert.equal(result.response.output[0].name,'read_file');assert.deepEqual(JSON.parse(result.response.output[0].arguments),{path:'a.txt'});
});
test('managed gateway receives only eligible free proxies, sync is cached, and adopted instances are untouched',async()=>{
 const calls=[];let managed=true;
 const manager={status:async()=>({managed}),management:async(route,method='GET',body)=>{
  calls.push({route,method,body});if(method==='GET')return {nodes:[],connections:[],combos:[]};
  if(route==='provider-nodes')return {node:{id:'node1'}};if(route==='providers')return {id:'connection1'};return {};
 }};
 const sync=createOmniRouteSync({manager,getCandidates:async()=>[{provider:{id:'kilo',name:'Kilo',baseUrl:'https://fixture.test'},model:'free',getKey:async()=>{throw Error('Secrets must not be copied');}}],baseUrl:'http://127.0.0.1:4173',token:'local-fixture'});
 assert.equal(await sync.configure(),'forge-free');const size=calls.length;await sync.configure();assert.equal(calls.length,size);
 const combo=calls.find(c=>c.route==='combos' && c.method==='POST');assert.equal(combo.body.strategy,'priority');assert.match(combo.body.models[0],/^forge-[a-f0-9]{16}\/free$/);
 assert.ok(calls.find(c=>c.route==='providers' && c.method==='POST').body.apiKey==='local-fixture');
 managed=false;sync.reset();assert.equal(await sync.configure(),null);assert.equal(calls.length,size);
});
