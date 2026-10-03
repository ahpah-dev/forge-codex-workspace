import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { createOmniRouteManager, OMNIROUTE_BASE_URL } from '../omniroute-manager.mjs';
import { createOmniRouteSync } from '../omniroute-sync.mjs';
import { createOmniRouteRouting } from '../omniroute-routing.mjs';
import { bridgeResponses } from '../responses-bridge.mjs';
test('real OmniRoute fails over a rejected free upstream and preserves structured tools', {skip:process.env.FORGE_OMNI_LIVE!=='1',timeout:180000},async()=>{
 const root=process.cwd(),manager=createOmniRouteManager({appRoot:root,dataRoot:path.join(root,'data/omniroute-check')});
 let blocked=0,working=0;
 const response=payload=>new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}});
 const candidates=['blocked','working'].map(id=>({provider:{id:'gateway-fixture-'+id,name:id},model:'free',router:()=>({openCompletion:async request=>{
  if(!request.tools?.length)return {response:response({choices:[{message:{content:'Ready.'},finish_reason:'stop'}]})};
  if(id==='blocked'){blocked++;throw Object.assign(Error('Fixture access restricted'),{status:403});}
  working++;return {response:response({model:'fixture-coder',choices:[{message:{tool_calls:[{id:'call_write',type:'function',function:{name:request.tools[0].function.name,arguments:JSON.stringify({path:'a.txt',content:'saved'})}}]},finish_reason:'tool_calls'}]})};
 }})}));
 const token='fixture-gateway-session';let sync;
 const server=createServer(async(req,res)=>{
  try{
   const match=req.url.match(/^\/internal\/omni-upstreams\/([a-f0-9]{16})\/v1\/(models|chat\/completions)$/);assert.ok(match);assert.equal(req.headers.authorization,'Bearer '+token);
   if(match[2]==='models'){res.writeHead(200,{'content-type':'application/json'});res.end('{"object":"list","data":[{"id":"free","object":"model"}]}');return;}
   let body='';for await(const bytes of req)body+=bytes;
   const opened=await sync.open(match[1],JSON.parse(body),AbortSignal.timeout(15000));res.writeHead(200,{'content-type':'application/json'});res.end(await opened.response.text());
  }catch(error){res.writeHead(error.status || 500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:error.message}}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 sync=createOmniRouteSync({manager,getCandidates:async()=>candidates,baseUrl:`http://127.0.0.1:${server.address().port}`,token});
 try{
  await manager.start();assert.equal(await sync.configure(),'forge-free');const routes=[];
  const routing=createOmniRouteRouting({getFallbacks:async()=>[],onRoute:route=>routes.push(route)});
  const router=routing.forProvider({provider:{id:'omni-fixture',name:'OmniRoute',nativePreset:'omniroute',baseUrl:OMNIROUTE_BASE_URL},model:'auto/coding:free',ensureGateway:()=>sync.configure()});
  const res={output:'',writeHead(){},write(bytes){this.output+=bytes;},end(){}};
  await bridgeResponses({res,router,signal:AbortSignal.timeout(60000),input:{input:'Save the file',tools:[{type:'function',name:'write_file',parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'}}}}]}});
  const events=res.output.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5)));
  assert.equal(events.at(-1).type,'response.completed');assert.ok(blocked>0);assert.ok(working>0);assert.equal(routes[0].fallback,false);
  assert.equal(events.at(-1).response.output[0].name,'write_file');assert.deepEqual(JSON.parse(events.at(-1).response.output[0].arguments),{path:'a.txt',content:'saved'});
  console.log(JSON.stringify({gateway:'3.8.51',rejectedUpstreamRequests:blocked,workingUpstreamRequests:working,throughOmniRoute:true,structuredToolCall:true}));
 }finally{await manager.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
