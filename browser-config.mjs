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
    tool_timeout_sec: 90,
    required: true,
  } };
}
