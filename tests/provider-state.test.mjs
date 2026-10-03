import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
const save=source.slice(source.indexOf('async function saveSettings()'),source.indexOf('async function codexPluginCommand('));
const warmup=source.slice(source.indexOf('const startupSettingsRevision ='),source.indexOf('await Promise.race([accountWarmup'));

for(const changed of [false,true])test(changed?'saving a provider invalidates cached and in-flight startup snapshots':'unchanged settings retain the startup snapshot',async()=>{
 let resolveSnapshot;
 const pendingSnapshot=new Promise(resolve=>{resolveSnapshot=resolve;});
 const context=vm.createContext({
  settings:{providers:[{id:'before'}]},dataRoot:'fixture',settingsPath:'fixture/settings.json',
  mkdir:async()=>{},writeFile:async()=>{},
  codex:{ensureStarted:async()=>{}},getAppState:()=>pendingSnapshot,
  console:{log(){},warn(){}},
 });
 vm.runInContext(`let settingsRevision=0;let initialAppState={providers:[{id:'old-cache'}]};${save}${warmup}`,context);
 if(changed){
  await vm.runInContext(`settings.providers=[{id:'new-provider'}];saveSettings()`,context);
  assert.equal(vm.runInContext('initialAppState',context),null);
  assert.equal(vm.runInContext('settingsRevision',context),1);
 }
 resolveSnapshot({providers:[{id:'old-snapshot'}]});
 await vm.runInContext('accountWarmup',context);
 assert.equal(vm.runInContext('initialAppState?.providers[0].id ?? null',context),changed?null:'old-snapshot');
});
