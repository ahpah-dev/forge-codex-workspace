import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOmniRouteManager, isLocalOmniRoute, OMNIROUTE_BASE_URL } from '../omniroute-manager.mjs';
import { createChatProviderRouter, providerApiFormat } from '../responses-bridge.mjs';

test('keyless OmniRoute is limited to explicit local presets', () => {
  for (const baseUrl of [OMNIROUTE_BASE_URL, 'http://localhost:20128/v1', 'http://[::1]:20128/v1']) assert.equal(isLocalOmniRoute({nativePreset:'omniroute',baseUrl}), true);
  for (const baseUrl of ['https://example.com/v1','http://127.0.0.1.example.com/v1','http://user:pass@127.0.0.1/v1','file:///tmp/router']) assert.equal(isLocalOmniRoute({nativePreset:'omniroute',baseUrl}),false);
  assert.equal(isLocalOmniRoute({baseUrl:OMNIROUTE_BASE_URL}),false);
  assert.equal(providerApiFormat({nativePreset:'omniroute',baseUrl:OMNIROUTE_BASE_URL}), 'chat');
});

test('keyless local inference omits authorization and preserves readable errors', async () => {
  const router = createChatProviderRouter({provider:{name:'OmniRoute',nativePreset:'omniroute',baseUrl:OMNIROUTE_BASE_URL},model:'auto/coding:free',key:'',fetchImpl:async(_url,options)=>{
    assert.equal(options.headers.Authorization,undefined);
    assert.equal(JSON.parse(options.body).model,'auto/coding:free');
    return new Response(JSON.stringify({error:{message:'No free models available'}}),{status:503});
  }});
  await assert.rejects(router.openCompletion({messages:[]}),/No free models available/);
});

test('managed gateway serializes startup, binds locally, enforces free pools and stops only its own process',async()=>{
  const area=await mkdtemp(path.join(os.tmpdir(),'forge-omniroute-test-'));
  try {
    const entry=path.join(area,'omniroute/runtime/node_modules/omniroute/dist/server.js');
    await mkdir(path.dirname(entry),{recursive:true});await writeFile(entry,'');
    await writeFile(path.join(area,'omniroute/runtime/.forge-installed-3.8.51'),'3.8.51\n');
    let processCount=0,kills=0,ready=false;
    const manager=createOmniRouteManager({appRoot:area,dataRoot:area,fetchImpl:async(_url,options)=>{
      if(!ready)throw Error('not started');
      assert.equal(options.method,'HEAD');
      return new Response(null,{status:200,headers:{'x-omniroute-version':'3.8.51'}});
    },spawnImpl:(_exe,args,options)=>{
      processCount++;assert.equal(args[0],entry);assert.equal(options.windowsHide,true);
      assert.equal(options.env.HOSTNAME,'127.0.0.1');assert.equal(options.env.OMNIROUTE_AUTO_FREE_FALLBACK_TO_FULL_POOL,'false');
      const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{kills++;child.emit('exit',0);};ready=true;return child;
    }});
    const [first,second]=await Promise.all([manager.start(),manager.start()]);
    assert.equal(first.running,true);assert.equal(second.managed,true);assert.equal(processCount,1);
    await manager.stop();assert.equal(kills,1);
    await assert.rejects(manager.start(),/closing/);
    const adopted=createOmniRouteManager({appRoot:area,dataRoot:area,fetchImpl:async()=>new Response(JSON.stringify({object:'list',data:[{id:'auto/coding'}]}),{headers:{'Content-Type':'application/json'}}),spawnImpl:()=>{throw Error('must not spawn');}});
    assert.equal((await adopted.start()).managed,false);await adopted.stop();assert.equal(kills,1);
  }finally{assert.ok(path.resolve(area).startsWith(path.resolve(os.tmpdir())+path.sep+'forge-omniroute-test-'));await rm(area,{recursive:true,force:true});}
});

test('unrelated services are not adopted and missing installers fail visibly',async()=>{
  const manager=createOmniRouteManager({appRoot:'missing-installer',dataRoot:'missing-runtime',fetchImpl:async()=>new Response(JSON.stringify({object:'list',data:[{id:'other'}]}))});
  assert.equal((await manager.status()).running,false);
  manager.installAndStart();await new Promise(resolve=>setImmediate(resolve));
  assert.match((await manager.status()).error,/bundled installer is missing/);
  await manager.stop();
});

test('partial downloads are not treated as installed gateways',async()=>{
  const area=await mkdtemp(path.join(os.tmpdir(),'forge-omniroute-test-'));
  try {
    const entry=path.join(area,'omniroute/runtime/node_modules/omniroute/dist/server.js');
    await mkdir(path.dirname(entry),{recursive:true});await writeFile(entry,'');
    const manager=createOmniRouteManager({appRoot:area,dataRoot:area,fetchImpl:async()=>{throw Error('offline');},spawnImpl:()=>{throw Error('must not start an incomplete runtime');}});
    assert.equal((await manager.status()).installed,false);
    await assert.rejects(manager.start(),/Install OmniRoute/);
    manager.installAndStart();await new Promise(resolve=>setImmediate(resolve));
    assert.match((await manager.status()).error,/bundled installer is missing/);
    await manager.stop();
  }finally{assert.ok(path.resolve(area).startsWith(path.resolve(os.tmpdir())+path.sep+'forge-omniroute-test-'));await rm(area,{recursive:true,force:true});}
});
