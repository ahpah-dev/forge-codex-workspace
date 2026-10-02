import path from 'node:path';

// Passed per session; never changes the user's global Codex or Claude config.
export function browserMcpConfig(appRoot, dataRoot, cwd) {
  if (process.env.FORGE_IN_APP_BROWSER === '1' && process.env.FORGE_BROWSER_API_URL && process.env.FORGE_BROWSER_API_TOKEN) {
    return {
      command: process.execPath,
      args: [path.join(appRoot, 'computer-use-mcp.mjs')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        FORGE_BROWSER_API_URL: process.env.FORGE_BROWSER_API_URL,
        FORGE_BROWSER_API_TOKEN: process.env.FORGE_BROWSER_API_TOKEN,
        FORGE_APP_VERSION: process.env.FORGE_APP_VERSION || '1.0.34',
      },
    };
  }
  return {
    command: process.execPath,
    args: [path.join(appRoot, 'browser-mcp.mjs'), '--workspace', cwd || appRoot, '--output-dir', path.join(dataRoot, 'browser-artifacts')],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

export function browserCodexConfig(appRoot, dataRoot, cwd) {
  // A dotted override adds Forge's browser without replacing other configured MCP servers.
  return { 'mcp_servers.forge_browser': {
    ...browserMcpConfig(appRoot, dataRoot, cwd),
    startup_timeout_sec: 30,
    tool_timeout_sec: 120,
    enabled: true,
    required: true,
  } };
}

// CLI -c values are TOML, not JSON objects. Use the same bridge at process
// startup and on thread resume so tool discovery and old sessions agree.
function tomlValue(value) {
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (value && typeof value === 'object') return `{ ${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)} = ${tomlValue(item)}`).join(', ')} }`;
  return JSON.stringify(value);
}

export function browserCodexArgs(appRoot, dataRoot, cwd) {
  return Object.entries(browserCodexConfig(appRoot, dataRoot, cwd)).flatMap(([key, value]) => ['-c', `${key}=${tomlValue(value)}`]);
}
