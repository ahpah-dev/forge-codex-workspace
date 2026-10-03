import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('desktop external links accept OmniRoute HTTP dashboards without accepting file or script URLs',async()=>{
 const source=await readFile(new URL('../desktop.cjs',import.meta.url),'utf8');
 const fn=source.match(/function isExternalPageUrl\(target\) \{[\s\S]*?\n\}/)?.[0];assert.ok(fn);
 const context={URL};vm.createContext(context);vm.runInContext(fn,context);
 for(const url of ['http://127.0.0.1:20128/dashboard','http://localhost:20128/dashboard','http://[::1]:20128/dashboard','https://example.com/'])assert.equal(context.isExternalPageUrl(url),true);
 for(const url of ['file:///C:/file.txt','javascript:alert(1)','http://example.com/','http://127.0.0.1.example.com/','http://user:key@localhost/'])assert.equal(context.isExternalPageUrl(url),false);
});
