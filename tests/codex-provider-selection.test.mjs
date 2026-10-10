import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {isFlagshipRouterProvider,providerBaseInstructions} from '../responses-bridge.mjs';

const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
const start=source.slice(source.indexOf('async function startCodexTask('),source.indexOf('async function continuationText('));
const resume=source.slice(source.indexOf('function resumeThread('),source.indexOf('async function openThread('));

test('official Codex has no custom provider and keeps its default instructions',()=>{
  for(const provider of [null,undefined,{},false,'openai']){
    assert.equal(isFlagshipRouterProvider(provider),false);
    assert.equal(providerBaseInstructions(provider),undefined);
  }
});

for(const retry of [false,true])test(retry?'retrying an official Codex session resumes it without custom provider instructions':'sending a new official Codex message starts its thread without a null-provider crash',async()=>{
  const calls=[];
  const context=vm.createContext({
    FREE_PROVIDER_ID:'forge-free',settings:{providers:[],askExternalApprovals:true},
    providerBaseInstructions,activeWorkspace:'fixture',computerUseDeveloperInstruction:'fixture tools',
    readEncryptedProviderKeys:async()=>({}),providerKeysPath:'fixture',getAccount:async()=>({connected:true}),
    runtimeThreadConfig:provider=>{assert.ok(provider==null);return {fixture:true};},
    getThreadHistory:async()=>({thread:{id:'existing',modelProvider:'openai',cwd:'fixture'}}),
    resumedThreads:new Set(),threadResumeLoads:new Map(),invalidateThreadHistory(){},
    turnRequests:new Map(),turnErrors:new Map(),publish(){},
    codex:{rpc:async(method,params)=>{calls.push({method,params});return method==='turn/start'?{turn:{id:'turn'}}:{thread:{id:'new'}};}},
  });
  vm.runInContext(`${resume}\n${start}`,context);
  const result=await vm.runInContext(`startCodexTask({text:'hi',model:'gpt-6-luna',providerId:'openai',threadId:${retry?"'existing'":"''"}},'fixture')`,context);
  assert.equal(result.providerId,'openai');assert.equal(result.turnId,'turn');
  assert.deepEqual(calls.map(call=>call.method),[retry?'thread/resume':'thread/start','turn/start']);
  assert.equal(calls[0].params.baseInstructions,undefined);
  assert.equal(calls[0].params.modelProvider,undefined);
  assert.equal(calls[1].params.model,'gpt-6-luna');
  assert.equal(calls[1].params.approvalPolicy,'never');
});
