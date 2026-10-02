import { computerUseInstructions } from './browser-config.mjs';

const endpoint = process.env.FORGE_BROWSER_API_URL;
const token = process.env.FORGE_BROWSER_API_TOKEN;

if (!endpoint || !token) {
  process.stderr.write('Forge computer-use connection is not configured.\n');
  process.exit(1);
}

const tools = [
  { name: 'computer_use_connection', description: 'Check Forge’s own Windows desktop helper and browser connection independently of Codex’s connected-app inventory. Reports native helper health, actual window inventory, displays, Forge browser pages, and recovery guidance. Empty app/tab lists are not proof of a disconnected desktop. Call this before declaring computer access unavailable.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, action: 'computer-connection' },
  { name: 'computer_use_open', description: 'Open an absolute application, file, or folder path on Windows, or open an HTTP/HTTPS URL in the user’s default system browser. Inspect state and a screenshot afterward to verify it opened. For Forge’s embedded browser use browser_open instead.', inputSchema: { type: 'object', properties: { target: { type: 'string', minLength: 1 } }, required: ['target'], additionalProperties: false }, action: 'computer-open' },
  { name: 'computer_use_focus_window', description: 'Restore and focus an open Windows app using its exact window handle or title from computer_use_state. Take a fresh screenshot after switching windows.', inputSchema: { type: 'object', properties: { target: { type: 'string', minLength: 1 } }, required: ['target'], additionalProperties: false }, action: 'computer-focus' },
  { name: 'computer_use_state', description: 'Inspect the real Windows desktop: foreground window, all open window handles and titles, pointer position, and connected displays. These are host-level controls outside Forge’s browser sandbox.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, action: 'computer-state' },
  { name: 'computer_use_screenshot', description: 'Capture the actual Windows display so you can see and operate the user’s computer, including apps outside Forge. This is host-level, unsandboxed desktop access. Take a fresh screenshot before coordinate actions.', inputSchema: { type: 'object', properties: { displayId: { type: 'string', description: 'Display id from computer_use_state; omit to capture the primary display.' } }, additionalProperties: false }, action: 'computer-screenshot' },
  { name: 'computer_use_click', description: 'Click the actual Windows desktop at pixel coordinates from the latest computer_use_screenshot. This can operate any visible app, not only Forge’s browser.', inputSchema: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, displayId: { type: 'string' }, button: { type: 'string', enum: ['left', 'right', 'middle'] }, count: { type: 'integer', enum: [1, 2] } }, required: ['x', 'y'], additionalProperties: false }, action: 'computer-click' },
  { name: 'computer_use_move', description: 'Move the real Windows pointer to screenshot pixel coordinates. Use the latest computer_use_screenshot.', inputSchema: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, displayId: { type: 'string' } }, required: ['x', 'y'], additionalProperties: false }, action: 'computer-move' },
  { name: 'computer_use_drag', description: 'Drag across the real Windows desktop between screenshot pixel coordinates. Use the latest screenshot and the same displayId for both points.', inputSchema: { type: 'object', properties: { fromX: { type: 'integer' }, fromY: { type: 'integer' }, toX: { type: 'integer' }, toY: { type: 'integer' }, displayId: { type: 'string' }, button: { type: 'string', enum: ['left', 'right', 'middle'] } }, required: ['fromX', 'fromY', 'toX', 'toY'], additionalProperties: false }, action: 'computer-drag' },
  { name: 'computer_use_scroll', description: 'Scroll the actual Windows desktop at an optional point from the latest screenshot. Positive vertical values scroll down; negative values scroll up. Values are wheel steps, up to 12 per call.', inputSchema: { type: 'object', properties: { vertical: { type: 'integer', minimum: -12, maximum: 12 }, horizontal: { type: 'integer', minimum: -12, maximum: 12 }, x: { type: 'integer' }, y: { type: 'integer' }, displayId: { type: 'string' } }, additionalProperties: false }, action: 'computer-scroll' },
  { name: 'computer_use_type', description: 'Type text into the currently focused control on the real Windows desktop, including controls in other apps. Click or focus the intended control first.', inputSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 10000 } }, required: ['text'], additionalProperties: false }, action: 'computer-type' },
  { name: 'computer_use_press_key', description: 'Press a key or shortcut on the real Windows desktop, such as Enter, Ctrl+S, or Alt+Tab. This operates the currently focused app.', inputSchema: { type: 'object', properties: { key: { type: 'string', description: 'A key or chord using + between keys, such as Ctrl+Shift+S.' } }, required: ['key'], additionalProperties: false }, action: 'computer-press-key' },
  { name: 'browser_open', description: 'Reveal Forge’s embedded browser even if it was closed, and optionally open a URL or search phrase. Use this to start browser work or recover a hidden browser. Omit URL only when a page is already open.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, additionalProperties: false }, action: 'open' },
  { name: 'browser_tabs', description: 'List browser pages including real login popups; select a pageId to target subsequent browser tools, or close a popup. Popups preserve their opener and shared sign-in session.', inputSchema: { type: 'object', properties: { operation: { type: 'string', enum: ['list', 'select', 'close'] }, pageId: { type: 'string' } }, additionalProperties: false }, action: 'tabs' },
  { name: 'browser_navigate', description: 'Open a URL or search phrase in the active Forge browser page. The user can watch and interact with the same page. Waits for a usable document and reports navigation failures.', inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'HTTP/HTTPS URL or search phrase.' } }, required: ['url'], additionalProperties: false }, action: 'navigate' },
  { name: 'browser_snapshot', description: 'Read the current page text and visible interactive controls from Forge’s in-app browser.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, action: 'snapshot' },
  { name: 'browser_take_screenshot', description: 'Capture the current visible page in Forge’s in-app browser.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, action: 'screenshot' },
  { name: 'browser_click', description: 'Click a visible page element by CSS selector or its accessible label/text.', inputSchema: { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector or visible button/link/field label.' } }, required: ['selector'], additionalProperties: false }, action: 'click' },
  { name: 'browser_type', description: 'Focus an editable page field and type text into it.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, selector: { type: 'string', description: 'Optional CSS selector or field label. If omitted, types into the currently focused field.' } }, required: ['text'], additionalProperties: false }, action: 'type' },
  { name: 'browser_press_key', description: 'Press a key in the current page, such as Enter, Tab, Escape, an arrow key, or Ctrl+A.', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false }, action: 'press-key' },
  { name: 'browser_mouse_click_xy', description: 'Click at viewport-relative page coordinates shown in the browser screenshot.', inputSchema: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, doubleClick: { type: 'boolean' } }, required: ['x', 'y'], additionalProperties: false }, action: 'click-at' },
  { name: 'browser_mouse_move_xy', description: 'Move the pointer to viewport-relative page coordinates.', inputSchema: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'], additionalProperties: false }, action: 'move' },
  { name: 'browser_mouse_drag_xy', description: 'Drag from one viewport-relative page coordinate to another.', inputSchema: { type: 'object', properties: { fromX: { type: 'integer' }, fromY: { type: 'integer' }, toX: { type: 'integer' }, toY: { type: 'integer' } }, required: ['fromX', 'fromY', 'toX', 'toY'], additionalProperties: false }, action: 'drag' },
  { name: 'browser_mouse_wheel', description: 'Scroll the in-app browser page. Positive deltaY scrolls down; negative scrolls up.', inputSchema: { type: 'object', properties: { deltaY: { type: 'integer' }, deltaX: { type: 'integer' }, x: { type: 'integer' }, y: { type: 'integer' } }, required: ['deltaY'], additionalProperties: false }, action: 'scroll' },
  { name: 'browser_go_back', description: 'Navigate back in the in-app browser history.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, action: 'back' },
  { name: 'browser_go_forward', description: 'Navigate forward in the in-app browser history.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, action: 'forward' },
  { name: 'browser_reload', description: 'Reload the current in-app browser page.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, action: 'reload' },
];

const requests = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function callForgeComputer(action, params = {}, signal) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params }),
    signal: AbortSignal.any([AbortSignal.timeout(115000), signal]),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Forge computer-use bridge returned HTTP ${response.status}.`);
  return payload.result || {};
}

function textResult(result, prefix = '') {
  if (result.message) return `${prefix}${result.message}\n${result.title || ''}${result.url ? `\n${result.url}` : ''}`.trim();
  if (result.text !== undefined) {
    const controls = result.controls?.length ? `\n\n## Interactive elements\n${result.controls.join('\n')}` : '';
    return `# ${result.title || 'Browser page'}\nURL: ${result.url || 'about:blank'}${result.loading ? '\nStatus: loading' : ''}${result.error ? `\nError: ${result.error}` : ''}\n\n${result.text || '(The page has no visible text.)'}${controls}`;
  }
  return `${prefix}${result.title || 'In-app browser'}${result.url ? `\n${result.url}` : ''}${result.loading ? '\nStatus: loading' : ''}${result.error ? `\nError: ${result.error}` : ''}`.trim();
}

async function handle(message) {
  const { id, method, params = {} } = message;
  if (method === 'notifications/cancelled') { requests.get(String(params.requestId))?.abort(); return; }
  if (method === 'notifications/initialized') return;
  if (id === undefined) return;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: { protocolVersion: params.protocolVersion || '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'forge-computer-use', version: process.env.FORGE_APP_VERSION || '1.0.41' }, instructions: computerUseInstructions() } });
    return;
  }
  if (method === 'ping') { send({ jsonrpc: '2.0', id, result: {} }); return; }
  if (method === 'tools/list') { send({ jsonrpc: '2.0', id, result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } }); return; }
  if (method === 'tools/call') {
    const tool = tools.find((item) => item.name === params.name);
    if (!tool) { send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Unknown Forge computer-use tool: ${String(params.name || '')}` }], isError: true } }); return; }
    const controller = new AbortController();
    requests.set(String(id), controller);
    try {
      const result = await callForgeComputer(tool.action, params.arguments || {}, controller.signal);
      const content = result.imageBase64
        ? [{ type: 'text', text: result.message || `${result.title || 'In-app browser'}\n${result.url || ''}`.trim() }, { type: 'image', data: result.imageBase64, mimeType: result.mimeType || 'image/png' }]
        : [{ type: 'text', text: textResult(result) }];
      send({ jsonrpc: '2.0', id, result: { content } });
    } catch (error) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: error.message || 'The in-app browser action failed.' }], isError: true } });
    } finally {
      requests.delete(String(id));
    }
    return;
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${String(method || '')}` } });
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  if (buffer.length > 12 * 1024 * 1024) {
    process.stderr.write('Forge browser MCP message exceeded the size limit.\n');
    process.exit(1);
  }
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try { void handle(JSON.parse(line)).catch((error) => process.stderr.write(`${error.message || 'Browser MCP request failed.'}\n`)); }
    catch { process.stderr.write('Ignored an invalid browser MCP message.\n'); }
  }
});

process.stdin.on('end', () => process.exit(0));
