import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {createServer} from 'node:http';
import fs from 'node:fs/promises';import path from 'node:path';import {bridgeResponses} from '../responses-bridge.mjs';
test('real Codex runs two isolated sessions; stopping A leaves B able to write files',{timeout:45000},async()=>{
 const root=process.cwd();await fs.mkdir(path.join(root,'data/concurrent-checks'),{recursive:true});
 const area=await fs.mkdtemp(path.join(root,'data/concurrent-checks/run-'));const profile=path.join(area,'profile');await fs.mkdir(profile);
 const workspaces={A:path.join(area,'A'),B:path.join(area,'B')};for(const cwd of Object.values(workspaces))await fs.mkdir(cwd);
 const gates=new Map(),threads=new Map(),events=[];let child;
 const server=createServer(async(req,res)=>{
  const controller=new AbortController();res.on('close',()=>{controller.abort();gates.get(req.headers['thread-id'])?.();});
  try{
   let text='';for await(const bytes of req)text+=bytes;const input=JSON.parse(text),id=req.headers['thread-id'];const name=threads.get(id);assert.ok(name);
   const router={openCompletion:async request=>{
    if(!request.messages.some(message=>message.role==='tool'))await new Promise(resolve=>gates.set(id,resolve));
    const payload=request.messages.some(message=>message.role==='tool') ? {choices:[{message:{content:'Saved '+name},finish_reason:'stop'}]} : {choices:[{message:{tool_calls:[{id:'call_'+name,type:'function',function:{name:request.tools.find(tool=>/exec_command$/.test(tool.function.name)).function.name,arguments:JSON.stringify({cmd:`[System.IO.File]::WriteAllText('marker.txt','${name}')`,workdir:workspaces[name],max_output_tokens:1000})}}]},finish_reason:'tool_calls'}]};
    return {route:{name:'Fixture'},response:new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}})};
   }};await bridgeResponses({input,res,router,signal:controller.signal});
  }catch(error){if(!res.headersSent)res.writeHead(500);res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 child=spawn(process.execPath,[path.join(root,'node_modules/@openai/codex/bin/codex.js'),'app-server','--listen','stdio://'],{env:{...process.env,CODEX_HOME:profile},windowsHide:true,stdio:['pipe','pipe','pipe']});
 let buffer='',nextId=1;const pending=new Map();child.stderr.on('data',()=>{});
 child.stdout.on('data',bytes=>{buffer+=bytes;let boundary;while((boundary=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,boundary);buffer=buffer.slice(boundary+1);if(!line.trim())continue;const message=JSON.parse(line);
  if(message.method&&message.id!=null)child.stdin.write(JSON.stringify({id:message.id,result:{decision:'accept'}})+'\n');
  else if(message.id!=null){const request=pending.get(message.id);pending.delete(message.id);message.error?request?.reject(Error(message.error.message)):request?.resolve(message.result);}
  else events.push(message);
 }});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=nextId++;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 async function until(condition){const deadline=Date.now()+25000;while(!condition()){if(Date.now()>deadline)throw Error('Concurrent runtime check timed out');await new Promise(resolve=>setTimeout(resolve,20));}}
 try{
  await rpc('initialize',{clientInfo:{name:'forge_parallel_check',version:'1.0.45'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized","params":{}}\n');
  const config={web_search:'disabled',model_providers:{fixture:{name:'Fixture',base_url:`http://127.0.0.1:${server.address().port}`,wire_api:'responses',requires_openai_auth:false,supports_websockets:false}}};
  const ids={};for(const name of ['A','B']){ids[name]=(await rpc('thread/start',{cwd:workspaces[name],model:'fixture',modelProvider:'fixture',sandbox:'workspace-write',approvalPolicy:'on-request',config})).thread.id;threads.set(ids[name],name);}
  const turns=await Promise.all(['A','B'].map(name=>rpc('turn/start',{threadId:ids[name],cwd:workspaces[name],input:[{type:'text',text:'Write your marker file.'}],sandboxPolicy:{type:'workspaceWrite',writableRoots:[workspaces[name]],networkAccess:false}})));
  await until(()=>gates.has(ids.A)&&gates.has(ids.B));
  await rpc('turn/interrupt',{threadId:ids.A,turnId:turns[0].turn.id});gates.get(ids.B)();
  await until(()=>['A','B'].every(name=>events.some(event=>event.method==='turn/completed'&&event.params.threadId===ids[name])));
  assert.equal(events.find(event=>event.method==='turn/completed'&&event.params.threadId===ids.A).params.turn.status,'interrupted');
  assert.equal(events.find(event=>event.method==='turn/completed'&&event.params.threadId===ids.B).params.turn.status,'completed');
  await assert.rejects(fs.readFile(path.join(workspaces.A,'marker.txt')),error=>error.code==='ENOENT');assert.equal(await fs.readFile(path.join(workspaces.B,'marker.txt'),'utf8'),'B');
  console.log(JSON.stringify({simultaneouslyProcessing:2,stoppedSession:'A',continuingSession:'B',verified:['A wrote no file after cancellation','B wrote marker in its own workspace']}));
 }finally{child.kill();for(const release of gates.values())release();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
