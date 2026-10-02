import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('provider setup stays clickable with long catalogs, small windows, pill composer and no models', {timeout:45000}, async()=>{
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'forge-provider-ui-test-'));
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
    // Freeze model refreshes while exercising realistic catalog extremes.
    await page.evaluate(()=>{refreshState=async()=>{};});
    for (const scenario of [{width:1440,height:960,count:100,shape:'rounded'}, {width:900,height:640,count:100,shape:'pill'}, {width:900,height:640,count:0,shape:'rounded'}]) {
      await page.setViewportSize({width:scenario.width,height:scenario.height});
      await page.evaluate(({count,shape})=>{
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
      await page.locator('[data-provider-preset="nvidia"]').click();
      assert.equal(await page.locator('#provider-base-url').inputValue(),'https://integrate.api.nvidia.com/v1');
      await page.locator('#providers-modal .dialog-close').click();
      assert.equal(await page.locator('#providers-modal').isVisible(),false);
    }
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();child.kill();
    await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('close',resolve);});
    const resolved=path.resolve(profile);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'forge-provider-ui-test-'));
    await fs.rm(resolved,{recursive:true,force:true});
  }
});
