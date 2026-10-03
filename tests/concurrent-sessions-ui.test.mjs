import test from 'node:test';import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
const root=process.cwd();
test('two sessions start concurrently, retain their own streams/drafts/questions, and Stop targets only its session',{timeout:45000},async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'forge-concurrent-ui-'));
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,FORGE_PORT:'0',FORGE_DATA_DIR:profile,FORGE_NO_BROWSER:'1'},stdio:['ignore','pipe','ignore'],windowsHide:true});let browser;
 try{
  const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),20000);child.stdout.on('data',bytes=>{const match=String(bytes).match(/Forge is ready at (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});});
  const folder=(await fs.readdir(path.join(root,'build/browser'))).find(name=>name.startsWith('chromium_headless_shell-'));
  browser=await chromium.launch({headless:true,executablePath:path.join(root,'build/browser',folder,'chrome-headless-shell-win64/chrome-headless-shell.exe')});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const workspace={path:profile,name:'Fixture'};
  await page.route('**/api/state',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({account:{connected:true},workspace,models:[{id:'gpt-6.1-sol',name:'GPT 6.1 Sol'}],providers:[],threads:[],recentWorkspaces:[],git:{entries:[]}})}));
  await page.route('**/api/threads/open',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({thread:{id:route.request().postDataJSON().threadId,modelProvider:'openai'},workspace,messages:[]})}));
  await page.route('**/api/files**',route=>route.fulfill({contentType:'application/json',body:'{"entries":[]}'}));
  const starts=[],stops=[],answers=[];
  await page.route('**/api/messages',async route=>{const body=route.request().postDataJSON();let release;const gate=new Promise(resolve=>release=resolve);starts.push({body,release});await gate;await route.fulfill({contentType:'application/json',body:JSON.stringify({threadId:body.text==='Session A'?'chat-a':'chat-b',turnId:body.text==='Session A'?'turn-a':'turn-b',providerId:'openai'})});});
  await page.route('**/api/interrupt',route=>{stops.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:'{"ok":true}'});});
  await page.route('**/api/approval',route=>{answers.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:'{"ok":true}'});});
  await page.goto(url);await page.waitForFunction(()=>state.models.length>0);
  await page.locator('#prompt-input').fill('Session A');await page.locator('#send-button').click();await page.waitForFunction(()=>startingTurn!==null);while(starts.length<1)await new Promise(resolve=>setTimeout(resolve,20));
  await page.locator('#new-task').click();assert.equal(await page.locator('#send-button').isDisabled(),false);
  await page.locator('#prompt-input').fill('Session B');await page.locator('#send-button').click();while(starts.length<2)await new Promise(resolve=>setTimeout(resolve,20));
  for(const [index,id] of [[1,'b'],[0,'a']])await page.evaluate(({requestId,id})=>{
   dispatchSessionEvent({type:'notification',method:'session/thread/assigned',params:{requestId,threadId:'chat-'+id,providerId:'openai'}});
   dispatchSessionEvent({type:'notification',method:'turn/started',params:{threadId:'chat-'+id,turn:{id:'turn-'+id}}});
   dispatchSessionEvent({type:'notification',method:'item/agentMessage/delta',params:{threadId:'chat-'+id,turnId:'turn-'+id,itemId:'reply-'+id,delta:'Reply '+id}});
  },{requestId:starts[index].body.requestId,id});
  assert.equal(await page.evaluate(()=>state.threadId),'chat-b');assert.equal(await page.evaluate(()=>[...sessions.records.values()].filter(record=>record.running).length),2);
  starts[0].release();await page.waitForFunction(()=>!sessions.find('chat-a').view.startingTurn);assert.equal(await page.evaluate(()=>state.threadId),'chat-b');starts[1].release();await page.waitForFunction(()=>startingTurn===null);
  await page.locator('#prompt-input').fill('Draft B');await page.locator('[data-thread-id="chat-a"]').click();await page.waitForFunction(()=>state.threadId==='chat-a');
  assert.equal(await page.evaluate(()=>state.messages.some(message=>message.text==='Reply a')),true);assert.equal(await page.evaluate(()=>state.messages.some(message=>message.text==='Reply b')),false);
  await page.evaluate(()=>dispatchSessionEvent({type:'server-request',id:'question-b',method:'item/tool/requestUserInput',params:{threadId:'chat-b',turnId:'turn-b',questions:[{id:'theme',header:'Theme',question:'Which theme for B?',options:[{label:'Dark',description:'Dark theme'},{label:'Light',description:'Light theme'}]}]}}));
  assert.ok((await page.locator('[data-thread-id="chat-b"]').innerText()).includes('Needs your attention'));assert.equal(await page.locator('#approval-slot').innerText(),'');
  await page.locator('#prompt-input').fill('Draft A');await page.locator('#stop-turn').click();assert.equal(stops.at(-1).threadId,'chat-a');assert.equal(stops.at(-1).turnId,'turn-a');
  await page.evaluate(()=>dispatchSessionEvent({type:'notification',method:'turn/interrupted',params:{threadId:'chat-a',turn:{id:'turn-a'}}}));assert.equal(await page.evaluate(()=>sessions.find('chat-b').running),true);
  await page.locator('[data-thread-id="chat-b"]').click();await page.waitForFunction(()=>state.threadId==='chat-b');assert.equal(await page.locator('#prompt-input').inputValue(),'Draft B');
  assert.ok((await page.locator('#approval-slot').innerText()).includes('Which theme for B?'));await page.getByText('Dark',{exact:true}).click();await page.getByRole('button',{name:'Send answer',exact:true}).click();assert.equal(answers.at(-1).id,'question-b');
  await page.evaluate(()=>dispatchSessionEvent({type:'notification',method:'turn/completed',params:{threadId:'chat-b',turn:{id:'turn-b',status:'completed'}}}));
  await page.locator('[data-thread-id="chat-a"]').click();await page.waitForFunction(()=>state.threadId==='chat-a');assert.equal(await page.locator('#prompt-input').inputValue(),'Draft A');assert.equal(await page.evaluate(()=>state.isBusy),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({verified:['two tasks run concurrently','out-of-order starts remain isolated','background output retained','per-session drafts','background question restored','Stop targets only A','B continues after A stops']}));
 }finally{await browser?.close();child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('close',resolve));assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep+'forge-concurrent-ui-'));await fs.rm(profile,{recursive:true,force:true});}
});
