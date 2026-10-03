import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('stream batching keeps drafting, navigation and settings responsive; Stop cancels a silent startup', {timeout:45000},async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'forge-responsive-ui-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,FORGE_PORT:'0',FORGE_DATA_DIR:profile,FORGE_NO_BROWSER:'1'},stdio:['ignore','pipe','ignore'],windowsHide:true});let browser;
 try{
  const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timed out')),20000);child.stdout.on('data',bytes=>{const match=String(bytes).match(/Forge is ready at (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});});
  const folder=(await fs.readdir(path.join(root,'build/browser'))).find(name=>name.startsWith('chromium_headless_shell-'));
  browser=await chromium.launch({headless:true,executablePath:path.join(root,'build/browser',folder,'chrome-headless-shell-win64/chrome-headless-shell.exe')});
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>state.models.length>0);
  await page.evaluate(()=>{
   state.workspace={path:'C:\\Forge UI fixture',name:'Fixture'};state.account={connected:true};state.threadId='ui-thread';state.activeTurnId='ui-turn';state.threadProviderId='omni';state.isBusy=true;
   state.messages=Array.from({length:70},(_,index)=>({id:'old-'+index,role:'assistant',text:'Completed paragraph. '.repeat(100)}));
   renderSurface();globalThis.renderCount=0;const original=renderMessages;renderMessages=(...args)=>{renderCount++;return original(...args);};
   globalThis.heartbeats=0;globalThis.heartbeatTimer=setInterval(()=>heartbeats++,20);
   for(let index=0;index<1200;index++)queueRuntimeEvent({type:'notification',method:'item/agentMessage/delta',params:{threadId:'ui-thread',turnId:'ui-turn',itemId:'live-message',delta:'Code '+index+'\n'}});
  });
  await page.locator('#prompt-input').fill('My next draft');assert.equal(await page.locator('#prompt-input').isDisabled(),false);
  await page.locator('#sidebar-collapse').click();await page.locator('#sidebar-reopen').click();
  await page.locator('#model-picker-trigger').click();await page.locator('#manage-providers').click();assert.equal(await page.locator('#providers-modal').isVisible(),true);
  await page.waitForFunction(()=>runtimeEvents.length===0 && !runtimeDrainScheduled);
  const result=await page.evaluate(()=>{clearInterval(heartbeatTimer);return {renders:renderCount,heartbeats,text:state.messages.find(message=>message.id==='live-message')?.text};});
  assert.ok(result.renders<200,`Expected coalescing, got ${result.renders} renders`);assert.ok(result.heartbeats>3);assert.ok(result.text?.includes('Code 1199'));assert.equal(await page.locator('#prompt-input').inputValue(),'My next draft');
  await page.evaluate(()=>{
   const event={type:'notification',method:'routing/model/selected',params:{threadId:'ui-thread',route:{ownerProviderId:'omni',providerName:'OmniRoute',name:'free-model',fallback:false}}};
   handleCodexEvent(event);state.messages.push({role:'assistant',text:'File saved.'});handleCodexEvent(event);
  });
  assert.equal(await page.evaluate(()=>state.messages.filter(message=>message.role==='routing').length),1);
  await page.locator('#providers-modal .dialog-close').click();
  await page.evaluate(()=>{state.isBusy=false;state.pendingSend=false;state.threadId=null;state.activeTurnId=null;state.messages=[];state.threadProviderId='openai';renderSurface();});
  let startBody, interruptBody, release;
  const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/messages',async route=>{startBody=route.request().postDataJSON();await gate;try{await route.fulfill({contentType:'application/json',body:JSON.stringify({threadId:'late',turnId:'late'})});}catch{}});
  await page.route('**/api/interrupt',async route=>{interruptBody=route.request().postDataJSON();await route.fulfill({contentType:'application/json',body:'{"ok":true}'});});
  await page.evaluate(()=>{state.workspace={path:'C:\\Forge UI fixture',name:'Fixture'};state.models=[{id:'fixture',name:'Fixture',providerId:'fixture',providerModel:'fixture'}];state.modelId='fixture';state.autoModelRouting=false;state.threadLoading=false;renderSurface();});
  await page.locator('#prompt-input').fill('Start a task');await page.locator('#send-button').click();
  await page.waitForFunction(()=>startingTurn!==null);await page.locator('#stop-turn').click();await page.waitForFunction(()=>!state.isBusy && startingTurn===null);
  assert.ok(startBody.requestId);assert.equal(interruptBody.requestId,startBody.requestId);release();
  console.log(JSON.stringify({events:1200,renders:result.renders,heartbeats:result.heartbeats,verified:['draft input','sidebar toggle','Manage providers','routing notice dedupe','Stop before first output']}));
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('close',resolve));assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep+'forge-responsive-ui-'));await fs.rm(profile,{recursive:true,force:true});}
});
