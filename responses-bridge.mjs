import { randomUUID } from 'node:crypto';

// Documented free-plan coding models; discovery intersects this list with the
// authenticated catalog, which does not expose the account's billing plan.
export const GROQ_CODING_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
export function isGroqProvider(provider) {
  try { return new URL(provider.baseUrl).hostname.toLowerCase() === 'api.groq.com'; }
  catch { return false; }
}

// Codex owns filesystem tools, sandboxing and approval prompts. This adapter only
// translates inference between Responses and OpenAI-compatible Chat Completions.
export function toChatRequest(input) {
  const toolMap = new Map();
  const tools = [];
  function register(tool, namespace = '') {
    if (tool.type === 'namespace') { for (const nested of tool.tools || []) register(nested, tool.name); return; }
    if (!['function', 'custom'].includes(tool.type)) throw new Error(`The Chat Completions adapter cannot translate the ${tool.type} hosted tool. Configure an MCP/function equivalent or use a provider endpoint that supports this tool.`);
    const source = tool.function || tool;
    const original = source.name;
    if (!original) throw new Error('An inference tool has no name.');
    const name = `${namespace ? namespace + '__' : ''}${original}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    if (toolMap.has(name)) throw new Error('Two tools have the same adapter name.');
    toolMap.set(name, { name: original, namespace, custom: tool.type === 'custom' });
    tools.push({ type: 'function', function: {
      name, description: String(source.description || '').slice(0, 10000),
      parameters: tool.type === 'custom' ? { type: 'object', properties: { input: { type: 'string', description: 'The exact free-form tool input.' } }, required: ['input'], additionalProperties: false } : source.parameters || { type: 'object', properties: {} },
      ...(typeof source.strict === 'boolean' ? { strict: source.strict } : {}),
    } });
  }
  for (const tool of input.tools || []) register(tool);
  // Unknown model families may lack Codex's native patch tool. Provide simple
  // file operations through its existing shell tool, retaining runtime approvals
  // and filesystem sandboxing rather than writing from this HTTP adapter.
  const shell = [...toolMap.values()].find((tool) => !tool.custom && tool.name === 'exec_command');
  if (shell && ![...toolMap.values()].some((tool) => tool.name === 'apply_patch')) {
    for (const operation of ['write', 'edit']) {
      const name = `forge_${operation}_file`;
      if (toolMap.has(name)) continue;
      toolMap.set(name, { ...shell, fileOperation: operation });
      const properties = operation === 'write'
        ? { path: { type: 'string' }, content: { type: 'string' } }
        : { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } };
      tools.push({ type: 'function', function: { name,
        description: operation === 'write' ? 'Save exact UTF-8 content to a file in the current workspace; creates parent folders. Read existing files before overwriting.' : 'Edit an existing UTF-8 file by replacing exactly one matching text segment. Read the file first. Fails if the old text is absent or ambiguous.',
        parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
      } });
    }
  }
  const messages = [];
  if (input.instructions) messages.push({ role: 'system', content: String(input.instructions) });
  if (tools.length) messages.push({ role: 'system', content: 'Use only the structured function-calling interface and the tools listed in this request. Never print tool-call markup such as <tool_call> or raw function names such as functions.* in assistant text. If a needed tool is unavailable, explain that plainly instead of inventing a tool call.' });
  if (shell) messages.push({ role: 'system', content: 'Only call tools actually listed in this request. Use forge_write_file and forge_edit_file when provided to save files, or the available shell tool. Do not invent apply_patch calls when it is absent. A successful tool result confirms a save; text describing code does not save it. Verify saved files before claiming completion. Free-form tools exposed as JSON require their exact original input in the input string.' });
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
      throw new Error(`The Chat Completions adapter cannot translate ${part.type} input.`);
    });
    const role = item.role === 'developer' ? 'system' : item.role || 'user';
    // NIM accepts content parts for user messages, but requires plain strings
    // for system and assistant messages.
    const normalized = role !== 'user' && Array.isArray(content)
      ? content.map((part) => part.text || '').join('\n') : content;
    messages.push({ role, content: normalized });
  }
  const { value: toolChoice, allowedNames } = translateToolChoice(input.tool_choice, toolMap, tools.length > 0);
  const requestTools = allowedNames ? tools.filter((tool) => allowedNames.has(tool.function.name)) : tools;
  return { request: { messages, ...(requestTools.length ? {
    tools: requestTools,
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(typeof input.parallel_tool_calls === 'boolean' ? { parallel_tool_calls: input.parallel_tool_calls } : {}),
  } : {}) }, toolMap, allowedToolNames: allowedNames };
}

function translateToolChoice(choice, toolMap, hasTools) {
  if (choice === undefined || choice === null) return { value: hasTools ? 'auto' : undefined, allowedNames: null };
  if (typeof choice === 'string') {
    if (['auto', 'none', 'required'].includes(choice)) {
      if (!hasTools && choice === 'required') throw new Error('This request requires a tool, but no tools were provided.');
      return { value: hasTools ? choice : undefined, allowedNames: choice === 'none' ? new Set() : null };
    }
    throw new Error(`The Chat Completions adapter cannot translate tool choice “${choice}”.`);
  }
  const resolveName = (name, namespace = '') => {
    if (toolMap.has(name)) return name;
    const matches = [...toolMap.entries()].filter(([, tool]) => tool.name === name && (!namespace || tool.namespace === namespace));
    if (matches.length === 1) return matches[0][0];
    if (matches.length > 1) throw new Error(`Tool choice “${name}” is ambiguous across namespaces.`);
    throw new Error(`Tool choice “${name || '(unnamed)'}” is not present in this request.`);
  };
  if (choice?.type === 'function') {
    const chatName = resolveName(String(choice.name || choice.function?.name || ''), String(choice.namespace || ''));
    return { value: { type: 'function', function: { name: chatName } }, allowedNames: new Set([chatName]) };
  }
  if (choice?.type === 'allowed_tools') {
    const mode = choice.mode || 'auto';
    if (!['auto', 'required'].includes(mode)) throw new Error(`The Chat Completions adapter cannot translate allowed-tools mode “${mode}”.`);
    const tools = Array.isArray(choice.tools) ? choice.tools : [];
    const allowedNames = new Set(tools.map((tool) => {
      if (!['function', 'custom'].includes(tool?.type)) throw new Error('Allowed tools must be function or custom tools.');
      return resolveName(String(tool.name || tool.function?.name || ''), String(tool.namespace || ''));
    }));
    if (!allowedNames.size && mode === 'required') throw new Error('This request requires a tool, but its allowed-tools list is empty.');
    return { value: allowedNames.size ? mode : undefined, allowedNames };
  }
  throw new Error('The Chat Completions adapter supports automatic, disabled, required, named, or restricted function tool choices.');
}

export function fileOperationArguments(operation, args) {
  for (const field of operation === 'write' ? ['path', 'content'] : ['path', 'old_text', 'new_text']) {
    if (typeof args[field] !== 'string') throw new Error(`File tool requires a string ${field}.`);
  }
  if (!args.path.trim() || args.path.includes('\0')) throw new Error('File tool requires a valid path.');
  if (operation === 'edit' && !args.old_text) throw new Error('File edit requires nonempty old_text.');
  const payload = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
  const script = `$ErrorActionPreference='Stop'; $a=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json; $p=[IO.Path]::GetFullPath($a.path); ` + (operation === 'write'
    ? '$content=$a.content; [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p)) | Out-Null; '
    : "$content=[IO.File]::ReadAllText($p); $at=$content.IndexOf($a.old_text,[StringComparison]::Ordinal); if($at -lt 0){throw 'Old text was not found; read the file again'}; if($content.IndexOf($a.old_text,$at+$a.old_text.Length,[StringComparison]::Ordinal) -ge 0){throw 'Old text is ambiguous; provide a larger unique segment'}; $content=$content.Substring(0,$at)+$a.new_text+$content.Substring($at+$a.old_text.Length); ")
    + "[IO.File]::WriteAllText($p,$content,(New-Object Text.UTF8Encoding($false))); [Console]::WriteLine('Saved: '+$p);";
  return { cmd: `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`, max_output_tokens: 1000 };
}

export function providerApiFormat(provider) {
  if (provider.apiFormat === 'chat' || provider.apiFormat === 'responses') return provider.apiFormat;
  try {
    const hostname = new URL(provider.baseUrl).hostname.toLowerCase();
    if (hostname === 'integrate.api.nvidia.com' || hostname === 'openrouter.ai' || hostname === 'api.groq.com') return 'chat';
  } catch { /* Invalid saved endpoints are rejected before making a request. */ }
  return 'responses';
}

export function createChatProviderRouter({ provider, model, key, fetchImpl = fetch }) {
  let tokenLimit = 32768;
  return {
    async openCompletion(request, signal, { maxTokens = 16384 } = {}) {
      const body = { ...request, model, stream: true, max_tokens: Math.min(maxTokens, tokenLimit) };
      if (isGroqProvider(provider)) {
        body.max_tokens = Math.min(body.max_tokens, 4096);
        // GPT-OSS does not support parallel tool calls on Groq. Keep local file,
        // shell, browser, and question tools on the existing Codex executor.
        if (model.startsWith('openai/gpt-oss-')) body.parallel_tool_calls = false;
        for (const field of ['logprobs', 'top_logprobs', 'logit_bias']) delete body[field];
        body.messages = (body.messages || []).map(({ name, ...message }) => message);
      }
      // NVIDIA NIM models may reject parallel_tool_calls; other OpenAI-compatible
      // providers receive the Codex setting unchanged.
      if (provider.id === 'nvidia' || new URL(provider.baseUrl).hostname.toLowerCase() === 'integrate.api.nvidia.com') delete body.parallel_tool_calls;
      const invoke = () => fetchImpl(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body), signal,
      });
      let response = await invoke();
      let rejectedDetail;
      if ([400, 422].includes(response.status)) {
        rejectedDetail = await response.json().catch(() => ({}));
        const description = JSON.stringify(rejectedDetail);
        const match = description.match(/max_tokens[\s\S]{0,180}?(?:less than or equal to|at most|maximum(?: is| of)?|<=)\s*(\d+)/i)
          || description.match(/max_tokens[\s\S]{0,120}?between\s*\d+\s*and\s*(\d+)/i);
        const maximum = Number(match?.[1]);
        if (maximum >= 256 && maximum < body.max_tokens) {
          tokenLimit = maximum;
          body.max_tokens = maximum;
          response = await invoke();
          rejectedDetail = undefined;
        }
      }
      if (!response.ok || response.status === 202) {
        const detail = rejectedDetail || await response.json().catch(() => ({}));
        const explanation = String(detail.error?.message || detail.message || (typeof detail.detail === 'string' ? detail.detail : '')).replaceAll(key, '[redacted]').slice(0, 500);
        const hint = [401, 403].includes(response.status) ? 'Check your API key and model access in Settings.'
          : response.status === 429 ? (isGroqProvider(provider) ? 'Groq’s request or token limit was reached. Try a shorter task or a new chat with less context, or wait for your quota to reset. Check your Groq account limits.' : 'The provider rate limit was reached. Wait before retrying.')
            : [400, 422].includes(response.status) ? 'Choose a model that supports tool calling and this message type.'
              : response.status === 202 ? 'The provider queued this request instead of returning a live stream. Retry with a streaming model.' : '';
        throw Object.assign(new Error(`${provider.name} returned HTTP ${response.status}. ${hint}${explanation ? ' ' + explanation : ''}`.trim()), { status: response.status });
      }
      return { response, route: { provider: provider.id, model, name: model }, maxTokens: body.max_tokens };
    },
    rejectRoute(_route, error) { throw error; },
  };
}

function normalizeChatChoice(choice, legacyCallId, inferFinishReason = false) {
  const delta = choice.delta || choice.message || {};
  const rawCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : delta.function_call ? [{ id: legacyCallId, function: delta.function_call }] : [];
  const tool_calls = rawCalls.map((call, index) => ({ ...call, index: Number.isInteger(call.index) ? call.index : index }));
  return {
    ...choice,
    delta: { ...delta, ...(tool_calls.length ? { tool_calls } : {}) },
    finish_reason: inferFinishReason ? choice.finish_reason || (tool_calls.length ? (delta.function_call ? 'function_call' : 'tool_calls') : 'stop') : choice.finish_reason,
  };
}

function toolMarkerPrefixLength(value) {
  const marker = '<tool_call>';
  const lower = value.toLowerCase();
  for (let size = Math.min(marker.length - 1, lower.length); size > 0; size -= 1) {
    if (marker.startsWith(lower.slice(-size))) return size;
  }
  return 0;
}

export async function* chatChunks(responseOrBody) {
  const legacyCallId = 'call_' + randomUUID().replaceAll('-', '');
  const contentType = responseOrBody?.headers?.get?.('content-type')?.toLowerCase() || '';
  if (contentType.includes('json') && !contentType.includes('event-stream')) {
    const payload = await responseOrBody.json();
    if (payload.error) { yield payload; return; }
    const choices = (payload.choices || []).map((choice) => normalizeChatChoice(choice, legacyCallId, true));
    yield { ...payload, choices };
    return;
  }
  const body = responseOrBody?.body || responseOrBody;
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
      const payload = JSON.parse(data);
      if (!payload.choices) { yield payload; continue; }
      yield { ...payload, choices: payload.choices.map((choice) => normalizeChatChoice(choice, legacyCallId)) };
    }
  }
  if (buffer.trim()) throw new Error('The provider returned an incomplete stream.');
}

export async function bridgeResponses({ input, res, router, signal }) {
  const { request, toolMap, allowedToolNames } = toChatRequest(input);
  let route, chunks, firstChunk;
  for (let attempt = 0; attempt < 3; attempt++) {
    const opened = await router.openCompletion(request, signal, { maxTokens: 16384 });
    route = opened.route;
    if (!opened.response.body) throw new Error('The routed provider did not return a response stream.');
    chunks = chatChunks(opened.response);
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
  let pendingDisplayText = '';
  const envelope = (status) => ({ id, object: 'response', created_at, model: input.model, status, output, usage: {
    input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0,
    total_tokens: usage.total_tokens || 0, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 },
  } });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  function send(type, value = {}) {
    if (res.destroyed || signal?.aborted) throw new Error('The task was stopped.');
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...value })}\n\n`);
  }
  function emitText(delta) {
    if (!delta) return;
    if (!message) {
      message = { id: 'msg_' + randomUUID(), type: 'message', role: 'assistant', status: 'in_progress', content: [{ type: 'output_text', text: '', annotations: [] }] };
      output.push(message);
      send('response.output_item.added', { output_index: output.indexOf(message), item: message });
      send('response.content_part.added', { item_id: message.id, output_index: output.indexOf(message), content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    }
    message.content[0].text += delta;
    send('response.output_text.delta', { item_id: message.id, output_index: output.indexOf(message), content_index: 0, delta });
  }
  send('response.created', { response: envelope('in_progress') });
  send('response.in_progress', { response: envelope('in_progress') });
  const keepalive = setInterval(() => { if (!res.destroyed) res.write(': working\n\n'); }, 15000);
  try {
    async function* withFirst() { yield firstChunk; yield* chunks; }
    let currentChunks = withFirst();
    let currentRequest = request;
    for (let recovery = 0; ; recovery += 1) {
      finishReason = null;
      calls.clear();
      let segmentText = '';
      let segmentUsage = {};
      for await (const chunk of currentChunks) {
        if (chunk.error) throw new Error(String(chunk.error.message || 'The model stream failed.'));
        if (chunk.usage) segmentUsage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta || {};
        if (delta.content) {
          segmentText += delta.content;
          pendingDisplayText += delta.content;
          const markerIndex = pendingDisplayText.toLowerCase().indexOf('<tool_call>');
          if (markerIndex >= 0) {
            throw new Error(`${route.name} returned a text-form tool call instead of a structured function call. Forge did not execute it. Choose a model/provider that supports Chat Completions tool calling.`);
          }
          const possibleMarker = toolMarkerPrefixLength(pendingDisplayText);
          const safeLength = pendingDisplayText.length - possibleMarker;
          if (safeLength > 0) {
            emitText(pendingDisplayText.slice(0, safeLength));
            pendingDisplayText = pendingDisplayText.slice(safeLength);
          }
        }
        for (const call of delta.tool_calls || []) {
          let pending = calls.get(call.index);
          if (!pending) { pending = { id: call.id, name: '', arguments: '' }; calls.set(call.index, pending); }
          if (call.id) pending.id = call.id;
          if (call.function?.name) pending.name += call.function.name;
          if (call.function?.arguments) pending.arguments += call.function.arguments;
        }
      }
      for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) usage[key] = (usage[key] || 0) + Number(segmentUsage[key] || 0);
      if (pendingDisplayText.length >= 5 && toolMarkerPrefixLength(pendingDisplayText) === pendingDisplayText.length) {
        throw new Error(`${route.name} stopped in the middle of text-form tool-call markup. Forge did not execute it. Choose a model/provider that supports Chat Completions tool calling.`);
      }
      if (finishReason !== 'length') break;
      if (recovery >= 2) throw new Error(`${route.name} reached its output limit after two automatic recovery attempts. Partial text was retained; unfinished tool calls were not executed. Retry with a smaller task or a model with a larger output budget.`);
      const truncatedTools = calls.size > 0;
      const continuation = truncatedTools
        ? 'The previous inference reached its output limit while generating tool arguments. None of the tool calls from that truncated inference were executed. Regenerate the complete necessary tool call, using smaller file edits and shorter tool arguments. Do not repeat previous commentary. Use the original task and existing tool results as context.'
        : segmentText
          ? 'Continue exactly where your previous response was cut off by the output limit. Do not repeat the text already shown. Finish the remaining work, keeping reasoning concise and splitting large file edits into smaller tool calls.'
          : 'Your previous inference exhausted its output budget before producing an answer or complete tool call. Keep reasoning concise and proceed with the task. Use smaller individual file edits.';
      currentRequest = { ...currentRequest, messages: [...currentRequest.messages,
        ...(segmentText ? [{ role: 'assistant', content: segmentText }] : []),
        { role: 'user', content: continuation },
      ] };
      const opened = await router.openCompletion(currentRequest, signal, { maxTokens: 32768, route });
      route = opened.route;
      if (!opened.response.body) throw new Error('The provider did not return a recovery stream.');
      currentChunks = chatChunks(opened.response);
    }
    if (!finishReason) throw new Error(`${route.name} disconnected before finishing. Partial output was retained; no tools were replayed.`);
    if (pendingDisplayText) { emitText(pendingDisplayText); pendingDisplayText = ''; }
    if (message) {
      message.status = 'completed';
      send('response.output_text.done', { item_id: message.id, output_index: output.indexOf(message), content_index: 0, text: message.content[0].text });
      send('response.content_part.done', { item_id: message.id, output_index: output.indexOf(message), content_index: 0, part: message.content[0] });
      send('response.output_item.done', { output_index: output.indexOf(message), item: message });
    }
    if (!['stop', 'tool_calls', 'function_call'].includes(finishReason)) throw new Error(`${route.name} stopped with ${finishReason}. Partial output was retained; incomplete tool calls were not executed.`);
    // Validate the whole batch before exposing any executable tool calls.
    const completedCalls = [...calls.values()].map((call) => {
      // Some NIM GPT-OSS streams leak a Harmony channel suffix into the
      // function name. Accept only that known suffix, never an arbitrary tool.
      const name = call.name.replace(/<\|channel\|>(?:analysis|commentary|final)$/, '');
      const tool = toolMap.get(name);
      if (!tool || !call.id) throw new Error(`The model returned an unknown or incomplete tool call (${String(call.name).slice(0, 64)}).`);
      if (allowedToolNames && !allowedToolNames.has(name)) throw new Error(`The model called ${name}, which this request did not allow.`);
      const args = JSON.parse(call.arguments || '{}');
      if (tool.custom && typeof args.input !== 'string') throw new Error('A free-form tool call was missing its input.');
      const item = {
        id: 'fc_' + randomUUID(), type: tool.custom ? 'custom_tool_call' : 'function_call',
        call_id: call.id, name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), status: 'completed',
        ...(tool.custom ? { input: args.input } : { arguments: tool.fileOperation ? JSON.stringify(fileOperationArguments(tool.fileOperation, args)) : call.arguments || '{}' }),
      };
      return item;
    });
    for (const item of completedCalls) {
      const custom = item.type === 'custom_tool_call';
      output.push(item);
      const output_index = output.length - 1;
      send('response.output_item.added', { output_index, item: { ...item, status: 'in_progress', ...(custom ? { input: '' } : { arguments: '' }) } });
      send(custom ? 'response.custom_tool_call_input.delta' : 'response.function_call_arguments.delta', { item_id: item.id, output_index, delta: custom ? item.input : item.arguments });
      send(custom ? 'response.custom_tool_call_input.done' : 'response.function_call_arguments.done', { item_id: item.id, output_index, ...(custom ? { input: item.input } : { arguments: item.arguments }) });
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
