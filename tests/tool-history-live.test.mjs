import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {bridgeResponses,createChatProviderRouter,KILO_FREE_BASE_URL,KILO_FREE_MODEL} from '../responses-bridge.mjs';
import {readEncryptedProviderKeys,decryptProviderKey} from '../provider-secrets.mjs';

test('live Kilo continues removed exec_command history with current tools and with tools disabled', {skip:process.env.FORGE_TOOL_LIVE!=='1',timeout:150000},async()=>{
  const data=process.env.FORGE_TOOL_DATA||path.join(process.env.APPDATA,'forge-codex-workspace','data');
  const settings=JSON.parse(await readFile(path.join(data,'settings.json'),'utf8'));
  const keys=await readEncryptedProviderKeys(path.join(data,'provider-secrets.json'));
  const eligible=settings.providers.filter(provider=>provider.nativePreset==='kilo-free'&&provider.baseUrl===KILO_FREE_BASE_URL&&keys[provider.id]);
  const provider=eligible.find(provider=>provider.id==='kilo-free-router-2')||eligible[0];
  assert.ok(provider,'Save a Kilo Free provider key in Forge first.');
  const key=await decryptProviderKey(keys[provider.id]);
  const requests=[];
  const router=createChatProviderRouter({provider,model:KILO_FREE_MODEL,key,fetchImpl:async(url,options)=>{
    requests.push(JSON.parse(options.body));
    return fetch(url,options);
  }});
  const history=[
    {role:'user',content:'Inspect the current directory.'},
    {type:'function_call',namespace:'functions',name:'exec_command',call_id:'historical-exec',arguments:'{"cmd":"Get-Location"}'},
    {type:'function_call_output',call_id:'historical-exec',output:'C:\\forge-history-fixture\n'},
    {role:'user',content:'Continue by calling read_file with path marker.txt. exec_command is no longer available. Use the current tool.'},
  ];
  const res={output:'',destroyed:false,writeHead(){},write(chunk){this.output+=chunk;},end(){}};
  await bridgeResponses({input:{model:KILO_FREE_MODEL,input:history,tool_choice:{type:'function',name:'read_file'},tools:[{type:'function',name:'read_file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}]},res,router,signal:AbortSignal.timeout(65000)});
  const events=res.output.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5)));
  assert.equal(events.at(-1).type,'response.completed',events.at(-1).response.error?.code);
  const call=events.at(-1).response.output.find(item=>item.type==='function_call');
  assert.equal(call.name,'read_file');assert.equal(JSON.parse(call.arguments).path,'marker.txt');
  assert.ok(requests[0].messages.some(message=>message.tool_calls?.[0].function.name==='functions__exec_command'));
  assert.equal(requests[0].tools.some(tool=>tool.function.name.includes('exec_command')),false);

  const reply={output:'',destroyed:false,writeHead(){},write(chunk){this.output+=chunk;},end(){}};
  await bridgeResponses({input:{model:KILO_FREE_MODEL,tool_choice:'none',tools:[],input:[...history,
    call,{type:'function_call_output',call_id:call.call_id,output:'fixture contents'},
    {role:'user',content:'This is a protocol verification fixture; no filesystem action is required. Reply exactly Forge continuation works. Do not call tools.'},
  ]},res:reply,router,signal:AbortSignal.timeout(65000)});
  const replies=reply.output.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5)));
  assert.equal(replies.at(-1).type,'response.completed',replies.at(-1).response.error?.code);
  assert.ok(replies.some(event=>event.type==='response.output_text.delta'&&event.delta.length));
  assert.equal(requests.at(-1).tools,undefined);
  console.log(JSON.stringify({provider:provider.id,model:KILO_FREE_MODEL,verified:['removed exec_command history accepted','current read_file call returned','tool-disabled continuation completed'],requests:requests.length}));
});
