import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('provider setup opens with Free Auto Route enabled, long catalogs, small windows and no models', {timeout:45000}, async()=>{
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'forge-provider-ui-test-'));
  await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({freeRouting:{enabled:true},providers:[{id:'nvidia-nim',name:'NVIDIA NIM',baseUrl:'https://integrate.api.nvidia.com/v1',models:[{id:'openai/gpt-oss-20b'}]}]}));
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,FORGE_PORT:'0',FORGE_DATA_DIR:profile,FORGE_NO_BROWSER:'1'},stdio:['ignore','pipe','ignore'],windowsHide:true});
  let browser;
  try {
    const url=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Forge startup timed out')),20000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.stdout.on('data',bytes=>{const match=String(bytes).match(/Forge is ready at (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    });
    const folders=await fs.readdir(path.join(root,'build/browser'));
    const folder=folders.find(name=>name.startsWith('chromium_headless_shell-'));
    browser=await chromium.launch({headless:true,executablePath:path.join(root,'build/browser',folder,'chrome-headless-shell-win64/chrome-headless-shell.exe')});
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);await page.waitForSelector('#prompt-input');
    await page.waitForFunction(()=>state.providers.some(provider=>provider.id==='forge-free'));
    // Freeze model refreshes while exercising realistic catalog extremes.
    await page.evaluate(()=>{window.originalRefreshState=refreshState;refreshState=async()=>{};});
    for (const scenario of [{width:1440,height:960,count:100,shape:'rounded'}, {width:900,height:640,count:100,shape:'pill'}, {width:900,height:640,count:0,shape:'rounded'}]) {
      await page.setViewportSize({width:scenario.width,height:scenario.height});
      await page.evaluate(({count,shape})=>{
        state.providers=[{id:'nvidia-nim',name:'NVIDIA NIM',baseUrl:'https://integrate.api.nvidia.com/v1',authConfigured:true,models:[{id:'openai/gpt-oss-20b'}]}, {id:'forge-free',name:'Free Auto Route',authConfigured:true,models:[{id:'auto-free',name:'OpenRouter Free Auto Route'}]}];
        state.models=Array.from({length:count},(_,index)=>({id:'test-model-'+index,name:'Test model '+index}));
        document.documentElement.dataset.composerShape=shape;renderModelPicker();
      },scenario);
      await page.locator('#model-picker-trigger').click();
      await page.waitForTimeout(180);
      const rect=await page.locator('#model-picker-menu').boundingBox();
      assert.ok(rect.y>=11 && rect.y+rect.height<=scenario.height-11,JSON.stringify(rect));
      await page.locator('#model-search').fill('test');
      await page.locator('#manage-providers').click();
      assert.equal(await page.locator('#providers-modal').isVisible(),true);
      assert.equal(await page.locator('[data-provider-edit="forge-free"], [data-provider-remove="forge-free"]').count(),0);
      assert.equal(await page.locator('[data-provider-edit="nvidia-nim"]').count(),1);
      assert.equal(await page.locator('#provider-list').innerText().then(text=>text.includes('undefined')),false);
      await page.locator('[data-provider-preset="nvidia"]').click();
      assert.equal(await page.locator('#provider-base-url').inputValue(),'https://integrate.api.nvidia.com/v1');
      await page.locator('[data-provider-routing]').click();
      assert.equal(await page.locator('#providers-modal').isVisible(),false);
      assert.equal(await page.locator('#settings-modal').isVisible(),true);
      assert.equal(await page.locator('#free-routing-enabled').evaluate(element=>element===document.activeElement),true);
      await page.locator('#appearance-close').click();
    }
    await page.route('**/api/omniroute',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({phase:'idle',running:false,installed:false})}));
    await page.evaluate(()=>{refreshState=window.originalRefreshState;openProvidersDialog();});
    await page.locator('[data-provider-preset="omniroute"]').click();
    assert.equal(await page.locator('#omniroute-setup').isVisible(),true);
    await page.waitForFunction(()=>document.querySelector('#omniroute-status').textContent==='Not installed yet');
    assert.equal(await page.locator('#provider-base-url').inputValue(),'http://127.0.0.1:20128/v1');
    assert.equal(await page.locator('#provider-models').inputValue(),'auto/coding:free\nauto/fast:free');
    assert.equal(await page.locator('#provider-api-format').isDisabled(),true);
    assert.equal(await page.locator('#provider-api-key').inputValue(),'');
    await page.locator('#provider-save').click();
    await page.waitForFunction(()=>state.providers.some(provider=>provider.nativePreset==='omniroute'));
    const saved=JSON.parse(await fs.readFile(path.join(profile,'settings.json'),'utf8')).providers.find(provider=>provider.nativePreset==='omniroute');
    assert.equal(saved.apiFormat,'chat');assert.equal(saved.models[0].id,'auto/coding:free');
    const localId=await page.evaluate(()=>state.providers.find(provider=>provider.nativePreset==='omniroute').id);
    await page.locator(`[data-provider-edit="${localId}"]`).click();
    assert.match(await page.locator('#provider-key-hint').innerText(),/Optional/);
    await page.route('**/api/omniroute/dashboard',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({url:'http://127.0.0.1:20128/dashboard'})}));
    await page.evaluate(()=>{window.ForgeDesktop={openExternalUrl:async url=>{window.openedDashboard=url;}};});
    await page.locator('#omniroute-dashboard').click();
    await page.waitForFunction(()=>window.openedDashboard==='http://127.0.0.1:20128/dashboard');
    await page.route('**/api/omniroute/start',route=>route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({phase:'installing'})}));
    await page.route('**/api/omniroute',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({phase:'installing',running:false,installed:false})}));
    await page.locator('#omniroute-start').click();
    await page.waitForFunction(()=>document.querySelector('#omniroute-start').textContent==='Installing…');
    assert.equal(await page.locator('#omniroute-start').isDisabled(),true);
    await page.locator('[data-provider-preset="nvidia"]').click();
    assert.equal(await page.locator('#omniroute-setup').isVisible(),false);
    assert.equal(await page.locator('#provider-api-format').isDisabled(),false);
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();child.kill();
    await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('close',resolve);});
    const resolved=path.resolve(profile);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'forge-provider-ui-test-'));
    await fs.rm(resolved,{recursive:true,force:true});
  }
});
