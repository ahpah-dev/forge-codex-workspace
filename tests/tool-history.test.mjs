import test from 'node:test';
import assert from 'node:assert/strict';
import {toChatRequest,bridgeResponses,createToolCatalog} from '../responses-bridge.mjs';

const history = [
  {role:'user',content:'Inspect the workspace.'},
  {type:'function_call',namespace:'functions',name:'exec_command',call_id:'past-command',arguments:'{"cmd":"pwd"}'},
  {type:'function_call_output',call_id:'past-command',output:'C:\\workspace\n'},
  {role:'user',content:'Continue using the tools available now.'},
];
const read = {type:'function',name:'read_file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}};
const sink=()=>({output:'',destroyed:false,writeHead(){},write(chunk){this.output+=chunk;},end(){}});
const events=res=>res.output.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5)));

test('removed exec_command history retains its arguments and result without restoring execution',()=>{
  const {request,toolMap}=toChatRequest({tools:[read],input:history});
  const call=request.messages.find(message=>message.tool_calls)?.tool_calls[0];
  assert.equal(call.function.name,'functions__exec_command');
  assert.equal(call.function.arguments,'{"cmd":"pwd"}');
  assert.equal(request.messages.find(message=>message.role==='tool').content,'C:\\workspace\n');
  assert.equal(toolMap.has(call.function.name),false);
  assert.deepEqual(request.tools.map(tool=>tool.function.name),['read_file']);
  assert.match(request.messages.find(message=>String(message.content).includes('historical functions')).content,/no longer available/);
  const catalog=createToolCatalog(request);
  assert.equal(catalog.request.tools.some(tool=>tool.function.name===call.function.name),false);
});

test('a request without tools can retain removed function and custom-call history',()=>{
  const {request,toolMap}=toChatRequest({input:[...history,
    {type:'custom_tool_call',name:'apply_patch',call_id:'past-patch',input:'*** Begin Patch\n*** End Patch\n'},
    {type:'custom_tool_call_output',call_id:'past-patch',output:{saved:true}},
  ]});
  assert.equal(request.tools,undefined);assert.equal(toolMap.size,0);
  const patch=request.messages.find(message=>message.tool_calls?.some(call=>call.id==='past-patch')).tool_calls[0];
  assert.equal(patch.function.name,'apply_patch');
  assert.equal(JSON.parse(patch.function.arguments).input,'*** Begin Patch\n*** End Patch\n');
  assert.equal(request.messages.find(message=>message.tool_call_id==='past-patch').content,'{"saved":true}');
});

test('an old namespace cannot be rewritten to a different currently active namespace',()=>{
  const {request,toolMap}=toChatRequest({tools:[{type:'namespace',name:'new_plugin',tools:[read]}],input:[
    {type:'function_call',namespace:'old_plugin',name:'read_file',call_id:'old-plugin',arguments:'{"path":"source.txt"}'},
    {type:'function_call_output',call_id:'old-plugin',output:'original contents'},
  ]});
  const name=request.messages.find(message=>message.tool_calls).tool_calls[0].function.name;
  assert.equal(name,'old_plugin__read_file');assert.equal(toolMap.has(name),false);
  assert.equal(request.tools[0].function.name,'new_plugin__read_file');
});

test('historical adapter names avoid current-tool collisions and remain stable',()=>{
  const items=['foo.bar','foo.bar','x'.repeat(80),'x'.repeat(79)+'y'].flatMap((name,index)=>[
    {type:'function_call',name,call_id:'past-'+index,arguments:'{}'},
    {type:'function_call_output',call_id:'past-'+index,output:'done'},
  ]);
  const {request,toolMap}=toChatRequest({tools:[{type:'function',name:'foo_bar'},{type:'function',name:'x'.repeat(64)}],input:items});
  const names=request.messages.flatMap(message=>(message.tool_calls||[]).map(call=>call.function.name));
  assert.equal(names[0],names[1]);assert.notEqual(names[2],names[3]);
  for(const name of names){assert.ok(name.length<=64);assert.match(name,/^[a-zA-Z0-9_-]+$/);assert.equal(toolMap.has(name),false);}
});

test('changed-tool history reaches inference while new calls to removed tools are rejected',async()=>{
  for(const requestedName of ['read_file','functions__exec_command']){
    const res=sink();let requests=0;
    await bridgeResponses({input:{tools:[read],input:history},res,router:{async openCompletion(request){
      requests++;assert.equal(request.tools.length,1);
      assert.equal(request.messages.find(message=>message.role==='tool').content,'C:\\workspace\n');
      return {route:{name:'Kilo fixture'},response:new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'new-call',type:'function',function:{name:requestedName,arguments:'{"path":"source.txt"}'}}]},finish_reason:'tool_calls'}]}),{headers:{'Content-Type':'application/json'}})};
    }}});
    assert.equal(requests,1);
    assert.equal(events(res).at(-1).type,requestedName==='read_file'?'response.completed':'response.failed');
    assert.equal(events(res).filter(event=>event.type==='response.function_call_arguments.done').length,requestedName==='read_file'?1:0);
  }
});

test('disabled tools preserve history while still denying new execution',async()=>{
  const res=sink();
  await bridgeResponses({input:{tools:[{type:'namespace',name:'functions',tools:[{type:'function',name:'exec_command'}]}],tool_choice:'none',input:history},res,router:{async openCompletion(request){
    assert.equal(request.tools,undefined);
    assert.ok(request.messages.some(message=>message.tool_calls?.[0].function.name==='functions__exec_command'));
    return {route:{name:'Read-only fixture'},response:new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'forbidden',type:'function',function:{name:'functions__exec_command',arguments:'{}'}}]},finish_reason:'tool_calls'}]}),{headers:{'Content-Type':'application/json'}})};
  }}});
  assert.equal(events(res).at(-1).type,'response.failed');
  assert.match(events(res).at(-1).response.error.message,/did not allow/);
});
