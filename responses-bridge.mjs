import { randomUUID } from 'node:crypto';

// Codex owns filesystem tools, sandboxing and approval prompts. This adapter only
// translates inference between Responses and OpenAI-compatible Chat Completions.
export function toChatRequest(input) {
  const toolMap = new Map();
  const tools = [];
  function register(tool, namespace = '') {
    if (tool.type === 'namespace') { for (const nested of tool.tools || []) register(nested, tool.name); return; }
    if (!['function', 'custom'].includes(tool.type)) throw new Error(`Free Auto Route does not support the ${tool.type} hosted tool. Disable that tool for this session.`);
    const source = tool.function || tool;
    const original = source.name;
    if (!original) throw new Error('An inference tool has no name.');
    const name = `${namespace ? namespace + '__' : ''}${original}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    if (toolMap.has(name)) throw new Error('Two tools have the same adapter name.');
    toolMap.set(name, { name: original, namespace, custom: tool.type === 'custom' });
    tools.push({ type: 'function', function: {
      name, description: String(source.description || '').slice(0, 10000),
      parameters: tool.type === 'custom' ? { type: 'object', properties: { input: { type: 'string', description: 'The exact free-form tool input.' } }, required: ['input'], additionalProperties: false } : source.parameters || { type: 'object', properties: {} },
    } });
  }
  for (const tool of input.tools || []) register(tool);
  const messages = [];
  if (input.instructions) messages.push({ role: 'system', content: String(input.instructions) });
  const items = typeof input.input === 'string' ? [{ role: 'user', content: input.input }] : input.input || [];
  for (const item of items) {
    if (item.type === 'reasoning') continue;
    if (['function_call', 'custom_tool_call'].includes(item.type)) {
      const namespace = item.namespace || '';
      const entry = [...toolMap.entries()].find(([, value]) => value.name === item.name && value.namespace === namespace)
        || [...toolMap.entries()].find(([, value]) => value.name === item.name);
      if (!entry) throw new Error(`The previous ${item.name} tool is unavailable in this request.`);
      const call = { id: item.call_id, type: 'function', function: { name: entry[0], arguments: item.type === 'custom_tool_call' ? JSON.stringify({ input: item.input || '' }) : item.arguments || '{}' } };
      const previous = messages.at(-1);
      if (previous?.role === 'assistant' && previous.tool_calls) previous.tool_calls.push(call);
      else messages.push({ role: 'assistant', content: null, tool_calls: [call] });
      continue;
    }
    if (['function_call_output', 'custom_tool_call_output'].includes(item.type)) {
      messages.push({ role: 'tool', tool_call_id: item.call_id, content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output) });
      continue;
    }
    if (item.type && item.type !== 'message') throw new Error(`Cannot safely translate ${item.type} conversation history to a free model.`);
    const content = typeof item.content === 'string' ? item.content : (item.content || []).map((part) => {
      if (['input_text', 'output_text', 'text'].includes(part.type)) return { type: 'text', text: part.text || '' };
      if (part.type === 'input_image') return { type: 'image_url', image_url: { url: part.image_url, detail: part.detail || 'auto' } };
      throw new Error(`Free Auto Route cannot translate ${part.type} input.`);
    });
    const role = item.role === 'developer' ? 'system' : item.role || 'user';
    messages.push({ role, content });
  }
  return { request: { messages, ...(tools.length ? { tools, tool_choice: 'auto', parallel_tool_calls: false } : {}) }, toolMap };
}

export async function* chatChunks(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true }).replace(/\r\n/g, '\n');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
      if (!data) continue;
      if (data === '[DONE]') return;
      yield JSON.parse(data);
    }
  }
  if (buffer.trim()) throw new Error('The provider returned an incomplete stream.');
}

export async function bridgeResponses({ input, res, router, signal }) {
  const { request, toolMap } = toChatRequest(input);
  let route, chunks, firstChunk;
  for (let attempt = 0; attempt < 3; attempt++) {
    const opened = await router.openCompletion(request, signal);
    route = opened.route;
    if (!opened.response.body) throw new Error('The routed provider did not return a response stream.');
    chunks = chatChunks(opened.response.body);
    try {
      while (true) {
        const next = await chunks.next();
        if (next.done) throw new Error('The provider returned an empty stream.');
        if (next.value.error) throw Object.assign(new Error(next.value.error.message || 'The provider stream failed.'), next.value.error);
        const choice = next.value.choices?.[0];
        if (choice?.delta?.content || choice?.delta?.tool_calls?.length || choice?.finish_reason) { firstChunk = next.value; break; }
      }
      break;
    } catch (error) {
      await chunks.return();
      if (signal?.aborted) throw error;
      router.rejectRoute(route, error);
      if (attempt === 2) throw error;
    }
  }
  const id = 'resp_' + randomUUID().replaceAll('-', '');
  const created_at = Math.floor(Date.now() / 1000);
  let sequence = 0;
  const output = [];
  const calls = new Map();
  let message = null;
  let finishReason = null;
  let usage = {};
  const envelope = (status) => ({ id, object: 'response', created_at, model: input.model, status, output, usage: {
    input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0,
    total_tokens: usage.total_tokens || 0, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 },
  } });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  function send(type, value = {}) {
    if (res.destroyed || signal?.aborted) throw new Error('The task was stopped.');
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...value })}\n\n`);
  }
  send('response.created', { response: envelope('in_progress') });
  send('response.in_progress', { response: envelope('in_progress') });
  const keepalive = setInterval(() => { if (!res.destroyed) res.write(': working\n\n'); }, 15000);
  try {
    async function* withFirst() { yield firstChunk; yield* chunks; }
    for await (const chunk of withFirst()) {
      if (chunk.error) throw new Error(String(chunk.error.message || 'The model stream failed.'));
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || {};
      if (delta.content) {
        if (!message) {
          message = { id: 'msg_' + randomUUID(), type: 'message', role: 'assistant', status: 'in_progress', content: [{ type: 'output_text', text: '', annotations: [] }] };
          output.push(message);
          send('response.output_item.added', { output_index: output.indexOf(message), item: message });
          send('response.content_part.added', { item_id: message.id, output_index: output.indexOf(message), content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
        }
        message.content[0].text += delta.content;
        send('response.output_text.delta', { item_id: message.id, output_index: output.indexOf(message), content_index: 0, delta: delta.content });
      }
      for (const call of delta.tool_calls || []) {
        let pending = calls.get(call.index);
        if (!pending) { pending = { id: call.id, name: '', arguments: '' }; calls.set(call.index, pending); }
        if (call.id) pending.id = call.id;
        if (call.function?.name) pending.name += call.function.name;
        if (call.function?.arguments) pending.arguments += call.function.arguments;
      }
    }
    if (!finishReason) throw new Error(`${route.name} disconnected before finishing. Partial output was retained; no tools were replayed.`);
    if (message) {
      message.status = 'completed';
      send('response.output_text.done', { item_id: message.id, output_index: output.indexOf(message), content_index: 0, text: message.content[0].text });
      send('response.content_part.done', { item_id: message.id, output_index: output.indexOf(message), content_index: 0, part: message.content[0] });
      send('response.output_item.done', { output_index: output.indexOf(message), item: message });
    }
    if (!['stop', 'tool_calls', 'function_call'].includes(finishReason)) throw new Error(`The routed model stopped with ${finishReason}. Its partial output was retained.`);
    for (const call of calls.values()) {
      const tool = toolMap.get(call.name);
      if (!tool || !call.id) throw new Error('The model returned an unknown or incomplete tool call.');
      const args = JSON.parse(call.arguments || '{}');
      if (tool.custom && typeof args.input !== 'string') throw new Error('A free-form tool call was missing its input.');
      const item = {
        id: 'fc_' + randomUUID(), type: tool.custom ? 'custom_tool_call' : 'function_call',
        call_id: call.id, name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), status: 'completed',
        ...(tool.custom ? { input: args.input } : { arguments: call.arguments || '{}' }),
      };
      output.push(item);
      const output_index = output.length - 1;
      send('response.output_item.added', { output_index, item: { ...item, status: 'in_progress', ...(tool.custom ? { input: '' } : { arguments: '' }) } });
      if (!tool.custom) send('response.function_call_arguments.delta', { item_id: item.id, output_index, delta: item.arguments });
      if (!tool.custom) send('response.function_call_arguments.done', { item_id: item.id, output_index, arguments: item.arguments });
      send('response.output_item.done', { output_index, item });
    }
    send('response.completed', { response: envelope('completed') });
  } catch (error) {
    if (!res.destroyed && !signal?.aborted) send('response.failed', { response: { ...envelope('failed'), error: { code: 'provider_stream_error', message: error.message } } });
  } finally {
    clearInterval(keepalive);
    res.end();
  }
}
