const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const token = $('meta[name="session-token"]')?.content || '';

const state = {
  account: null,
  codexCli: null,
  workspace: null,
  recentWorkspaces: [],
  providers: [],
  anthropic: null,
  models: [],
  limits: null,
  git: { branch: null, changedFiles: 0, entries: [] },
  threadId: null,
  threadProviderId: null,
  threadName: '',
  threadLoading: false,
  threadOpenVersion: 0,
  threadLoadOrigin: null,
  threadHistoryCache: new Map(),
  deletingThreads: new Set(),
  historyVisibleCount: 60,
  messages: [],
  activeTurnId: null,
  activityStatus: 'Starting task',
  isBusy: false,
  pendingSend: false,
  approvals: [],
  treeCache: new Map(),
  expandedDirs: new Set(),
  selectedFile: null,
  activeContextTab: 'files',
  collapsedAgentGroups: new Set(['complete']),
  selectedAgentId: null,
  agentFilter: 'all',
  agentRosterSignature: '',
  pinnedAgentIds: new Set((() => { try { const ids = JSON.parse(localStorage.getItem('forge.pinned-agents') || '[]'); return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string').slice(-200) : []; } catch { return []; } })()),
  diff: '',
  changePreview: null,
  changePreviewVersion: 0,
  modelId: localStorage.getItem('forge.model') || '',
  effort: localStorage.getItem('forge.effort') || 'medium',
  autoModelRouting: localStorage.getItem('forge.auto-model-routing') === 'true',
  freeRouting: { enabled: false, codexFallback: false },
  routingDraftDirty: false,
  routingBusy: false,
  fallbackSourceThreadId: null,
  mode: 'code',
  preferredAccess: localStorage.getItem('forge.access') || 'write',
};

const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function createSvgIcon(viewBox, className) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.classList.add(...className.split(' '));
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}

function createOpenAIMark() {
  const svg = createSvgIcon('0 0 24 24', 'gpt-mark');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z');
  svg.append(path);
  return svg;
}

function getModelTier(modelId = '', providerId = '') {
  if (providerId) return providerId.toLowerCase().includes('nvidia') ? 'nvidia' : 'provider';
  const id = String(modelId).toLowerCase();
  if (id.includes('astra')) return 'astra';
  if (id.includes('sol')) return 'sol';
  if (id.includes('luna')) return 'luna';
  return 'default';
}

function createModelIcon(modelId, providerId = '') {
  const tier = getModelTier(modelId, providerId);
  const svg = createSvgIcon('0 0 24 24', `model-tier-icon tier-${tier}`);
  const ns = 'http://www.w3.org/2000/svg';
  const appendPath = (d, fill = 'currentColor') => {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', fill);
    svg.append(path);
  };
  if (tier === 'provider') {
    appendPath('M12 2.7 21.3 12 12 21.3 2.7 12 12 2.7Zm0 4.2L6.9 12l5.1 5.1 5.1-5.1L12 6.9Z', 'none');
    svg.querySelector('path')?.setAttribute('stroke', 'currentColor');
    svg.querySelector('path')?.setAttribute('stroke-width', '1.5');
    svg.querySelector('path')?.setAttribute('fill-rule', 'evenodd');
  } else if (tier === 'nvidia') {
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', '12'); label.setAttribute('y', '17'); label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-family', 'Arial, sans-serif'); label.setAttribute('font-size', '15'); label.setAttribute('font-weight', '700');
    label.setAttribute('fill', 'currentColor'); label.textContent = 'N'; svg.append(label);
  } else if (tier === 'astra') {
    appendPath('M10 3.5 12.2 9.8 18.5 12l-6.3 2.2L10 20.5l-2.2-6.3L1.5 12l6.3-2.2Z', 'none');
    svg.lastChild.setAttribute('stroke', 'currentColor');
    svg.lastChild.setAttribute('stroke-width', '1.5');
    svg.lastChild.setAttribute('stroke-linejoin', 'round');
    appendPath('M19.3 2.2 20.1 4.6 22.5 5.4 20.1 6.2 19.3 8.6 18.5 6.2 16.1 5.4 18.5 4.6Z');
  } else if (tier === 'sol') {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '4');
    circle.setAttribute('fill', 'none'); circle.setAttribute('stroke', 'currentColor'); circle.setAttribute('stroke-width', '1.8');
    svg.append(circle);
    const rays = document.createElementNS(ns, 'path');
    rays.setAttribute('d', 'M12 2.2v2.1m0 15.4v2.1M4.95 4.95l1.5 1.5m11.1 11.1 1.5 1.5M2.2 12h2.1m15.4 0h2.1M4.95 19.05l1.5-1.5m11.1-11.1 1.5-1.5');
    rays.setAttribute('fill', 'none'); rays.setAttribute('stroke', 'currentColor'); rays.setAttribute('stroke-width', '1.8'); rays.setAttribute('stroke-linecap', 'round');
    svg.append(rays);
  } else if (tier === 'luna') {
    appendPath('M20.1 14.8A8.6 8.6 0 0 1 9.2 3.9a8.7 8.7 0 1 0 10.9 10.9Z', 'none');
    svg.lastChild.setAttribute('stroke', 'currentColor');
    svg.lastChild.setAttribute('stroke-width', '1.7');
    svg.lastChild.setAttribute('stroke-linejoin', 'round');
    appendPath('M18.3 2.6 19 4.7 21.1 5.4 19 6.1 18.3 8.2 17.6 6.1 15.5 5.4 17.6 4.7Z');
  } else {
    return createOpenAIMark();
  }
  return svg;
}

async function api(route, options = {}) {
  const headers = { 'X-Forge-Session': token, ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(route, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  } catch {
    throw new Error('Could not reach Forge. If its terminal window was closed, start the app again.');
  }
  let result;
  try { result = await response.json(); } catch { result = {}; }
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function showToast(message, type = '') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`.trim();
  toast.textContent = message;
  $('#toast-region').append(toast);
  setTimeout(() => toast.remove(), 4200);
}

function setModal(id, open) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = !open;
  if (id === 'agent-assign-modal') {
    $('.app-shell').inert = open;
    if (!open) ($('#agent-assign').disabled ? $('#context-close') : $('#agent-assign')).focus({ preventScroll: true });
  }
  if (open) {
    const input = modal.querySelector('input:not([type="hidden"]), textarea');
    if (input) setTimeout(() => input.focus(), 30);
  }
}

function showProviderError(message) {
  const error = $('#provider-error');
  error.textContent = message;
  error.hidden = !message;
}

function resetProviderForm() {
  $('#provider-id').value = '';
  $('#provider-name').value = '';
  $('#provider-base-url').value = '';
  $('#provider-api-key').value = '';
  $('#provider-api-key').placeholder = 'Paste provider API key';
  $('#provider-key-hint').textContent = 'Stored encrypted on this Windows account';
  $('#provider-models').value = '';
  $('#provider-form-title').textContent = 'Add a provider';
  $('#provider-save').textContent = 'Add provider';
  $('#provider-cancel-edit').hidden = true;
  $$('.provider-preset').forEach((button) => button.classList.remove('selected'));
  showProviderError('');
}

function renderProviderList() {
  const list = $('#provider-list');
  list.replaceChildren();
  if (!state.providers.length) {
    const empty = document.createElement('div');
    empty.className = 'provider-list-empty';
    empty.textContent = 'Add an API provider to make its compatible models available in the model picker.';
    list.append(empty);
    return;
  }
  for (const provider of state.providers) {
    const row = document.createElement('div');
    row.className = 'provider-entry';
    const mark = document.createElement('span');
    mark.className = `provider-entry-mark ${provider.id.includes('nvidia') ? 'nvidia' : ''}`.trim();
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = provider.id.includes('nvidia') ? 'N' : provider.id.includes('openrouter') ? '◈' : '◇';
    const copy = document.createElement('span');
    copy.className = 'provider-entry-copy';
    const name = document.createElement('strong');
    name.textContent = provider.name;
    const endpoint = document.createElement('small');
    endpoint.textContent = `${provider.baseUrl} · ${provider.models.length} model${provider.models.length === 1 ? '' : 's'}`;
    copy.append(name, endpoint);
    const status = document.createElement('span');
    status.className = 'provider-entry-state';
    status.textContent = provider.authConfigured ? 'Key saved' : 'Add API key';
    if (!provider.authConfigured) status.style.color = '#a15e49';
    const actions = document.createElement('span');
    actions.className = 'provider-entry-actions';
    const edit = document.createElement('button');
    edit.type = 'button'; edit.textContent = 'Edit'; edit.dataset.providerEdit = provider.id;
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'provider-remove'; remove.textContent = 'Remove'; remove.dataset.providerRemove = provider.id;
    actions.append(edit, remove);
    row.append(mark, copy, status, actions);
    list.append(row);
  }
}

function renderAnthropicAccount() {
  const status = state.anthropic;
  const copy = $('#anthropic-account-status');
  const button = $('#anthropic-connect');
  if (!copy || !button) return;
  if (!status) {
    copy.textContent = 'Checking Claude Code sign-in…';
    button.textContent = 'Connect';
    return;
  }
  if (!status.available) {
    copy.textContent = 'Install Claude Code to use a Claude subscription here.';
    button.textContent = 'Install';
  } else if (status.connected) {
    copy.textContent = status.authMethod && status.authMethod !== 'none'
      ? 'Claude subscription connected · ' + status.authMethod
      : 'Claude subscription connected';
    button.textContent = 'Connected';
  } else {
    copy.textContent = 'Sign in once with your Claude Pro, Max, Team, or Enterprise account.';
    button.textContent = 'Sign in';
  }
  button.disabled = Boolean(state.anthropicConnecting) || Boolean(status.connected);
}

function openProvidersDialog() {
  setModelPickerOpen(false);
  resetProviderForm();
  renderAnthropicAccount();
  renderProviderList();
  setModal('providers-modal', true);
}

async function connectAnthropic() {
  if (state.anthropic?.connected) return;
  const button = $('#anthropic-connect');
  if (!window.ForgeDesktop?.connectAnthropic) {
    showToast('Install Claude Code and run “claude auth login” in a terminal, then refresh Forge.');
    return;
  }
  state.anthropicConnecting = true;
  button.disabled = true;
  button.textContent = 'Opening…';
  let pollingStarted = false;
  try {
    const result = await window.ForgeDesktop.connectAnthropic();
    if (!result?.ok) {
      showToast(result?.error || 'Claude Code could not start its sign-in flow.', 'error');
      return;
    }
    showToast('Finish signing in to Claude Code. Forge will connect automatically.');
    renderAnthropicAccount();
    pollingStarted = true;
    let stopped = false;
    const interval = setInterval(async () => {
      if (stopped) return;
      await refreshState({ quiet: true });
      if (state.anthropic?.connected || Date.now() > deadline) {
        stopped = true;
        clearInterval(interval);
        state.anthropicConnecting = false;
        renderAnthropicAccount();
        if (state.anthropic?.connected) showToast('Claude subscription connected.');
      }
    }, 1800);
    const deadline = Date.now() + 120000;
  } catch (error) {
    showToast(error.message || 'Claude Code could not start.', 'error');
  } finally {
    if (!pollingStarted) {
      state.anthropicConnecting = false;
      renderAnthropicAccount();
    }
  }
}

function selectProviderPreset(preset) {
  $$('.provider-preset').forEach((button) => button.classList.toggle('selected', button.dataset.providerPreset === preset));
  const presets = {
    openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', placeholder: 'sk-or-…' },
    nvidia: { name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', placeholder: 'nvapi-…' },
    custom: { name: '', baseUrl: '', placeholder: 'Paste provider API key' },
  };
  const value = presets[preset];
  if (!value) return;
  if (!$('#provider-id').value || preset === 'custom') $('#provider-name').value = value.name;
  $('#provider-base-url').value = value.baseUrl;
  $('#provider-api-key').placeholder = value.placeholder;
  showProviderError('');
}

function editProvider(providerId) {
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider) return;
  $('#provider-id').value = provider.id;
  $('#provider-name').value = provider.name;
  $('#provider-base-url').value = provider.baseUrl;
  $('#provider-api-key').value = '';
  $('#provider-api-key').placeholder = 'Leave blank to keep the saved key';
  $('#provider-key-hint').textContent = provider.authConfigured ? 'A saved key is already encrypted locally' : 'Stored encrypted on this Windows account';
  $('#provider-models').value = provider.models.map((model) => model.id).join('\n');
  $('#provider-form-title').textContent = `Edit ${provider.name}`;
  $('#provider-save').textContent = 'Save provider';
  $('#provider-cancel-edit').hidden = false;
  const preset = provider.id.includes('nvidia') ? 'nvidia' : provider.id.includes('openrouter') ? 'openrouter' : 'custom';
  $$('.provider-preset').forEach((button) => button.classList.toggle('selected', button.dataset.providerPreset === preset));
  showProviderError('');
  $('#provider-name').focus();
}

async function discoverProviderModels() {
  const button = $('#provider-discover');
  button.disabled = true;
  button.textContent = 'Loading…';
  showProviderError('');
  try {
    const result = await api('/api/providers/discover', { method: 'POST', body: {
      id: $('#provider-id').value,
      baseUrl: $('#provider-base-url').value,
      apiKey: $('#provider-api-key').value,
    } });
    const current = $('#provider-models').value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
    $('#provider-models').value = [...new Set([...current, ...result.modelIds])].join('\n');
    showToast(`Loaded ${result.modelIds.length} model IDs.`);
  } catch (error) {
    showProviderError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Load models';
  }
}

async function saveProvider() {
  const button = $('#provider-save');
  button.disabled = true;
  showProviderError('');
  try {
    await api('/api/providers/save', { method: 'POST', body: {
      id: $('#provider-id').value,
      name: $('#provider-name').value,
      baseUrl: $('#provider-base-url').value,
      apiKey: $('#provider-api-key').value,
      models: $('#provider-models').value,
    } });
    resetProviderForm();
    await refreshState({ quiet: true });
    renderProviderList();
    showToast('Provider saved. Your ChatGPT sign-in is unchanged.');
  } catch (error) {
    showProviderError(error.message);
  } finally {
    button.disabled = false;
  }
}

async function removeProvider(providerId) {
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider) return;
  try {
    await api('/api/providers/remove', { method: 'POST', body: { id: provider.id } });
    if ($('#provider-id').value === provider.id) resetProviderForm();
    await refreshState({ quiet: true });
    renderProviderList();
    showToast(`${provider.name} removed from Forge.`);
  } catch (error) { showProviderError(error.message); }
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Recent';
  const seconds = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp) / 1000;
  const delta = Math.max(0, Math.floor(Date.now() / 1000 - seconds));
  if (delta < 60) return 'Just now';
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  if (delta < 604800) return `${Math.floor(delta / 86400)}d ago`;
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatWindow(minutes) {
  if (!minutes) return 'current window';
  if (minutes % 10080 === 0) return `${minutes / 10080}-week window`;
  if (minutes % 1440 === 0) return `${minutes / 1440}-day window`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour window`;
  return `${minutes}-minute window`;
}

function renderAccount() {
  const connected = Boolean(state.account?.connected);
  const connectionError = Boolean(state.account?.connectionError);
  const planName = String(state.account?.planType || 'ChatGPT').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  $('#connection-dot').className = `connection-dot ${connected ? 'connected' : state.account ? 'disconnected' : ''}`;
  $('#connection-label').textContent = connected ? 'ChatGPT connected' : connectionError ? 'Codex unavailable' : state.account ? 'Connect ChatGPT' : 'Connecting to Codex';
  $('#account-plan').textContent = connected
    ? 'Saved Codex sign-in'
    : connectionError ? 'Check that Codex CLI is running'
    : state.account ? 'Use your ChatGPT account' : 'Starting the Codex App Server';
  const codexLimit = state.limits?.codex || state.limits?.rateLimitsByLimitId?.codex || state.limits;
  const window = codexLimit?.primary;
  const selectedModel = state.models.find((model) => model.id === state.modelId);
  let codexPercent = null;
  if (connected && window && Number.isFinite(window.usedPercent)) {
    const percent = Math.max(0, Math.min(100, window.usedPercent));
    codexPercent = percent;
    $('#usage-label').textContent = `${percent}% used`;
    $('#usage-bar').style.width = `${percent}%`;
    $('#usage-reset').textContent = window.resetsAt
      ? `${formatWindow(window.windowDurationMins)} · resets ${new Date(window.resetsAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      : `${formatWindow(window.windowDurationMins)} · standard Codex allowance`;
  } else {
    $('#usage-label').textContent = '—';
    $('#usage-bar').style.width = '0%';
    $('#usage-reset').textContent = connected ? 'Codex plan limits apply to every task' : 'Plan limits apply to every task';
  }
  if (connected && selectedModel?.providerId) {
    const provider = state.providers.find((item) => item.id === selectedModel.providerId);
    $('#composer-usage').textContent = selectedModel.providerId === 'forge-free'
      ? state.freeRouting.lastRoute ? `${state.freeRouting.lastRoute.provider === 'nvidia' ? 'NIM' : 'Free'} · ${state.freeRouting.lastRoute.name}` : 'OpenRouter free → NVIDIA NIM'
      : `${provider?.name || 'Custom provider'} billing · ChatGPT stays connected`;
  } else {
    $('#composer-usage').textContent = connected
      ? codexPercent === null ? 'Codex plan limits apply' : `${codexPercent}% of Codex limit used`
      : 'Connect Codex to start';
  }
  if (connected && state.account.planType) $('#connection-label').textContent = `ChatGPT ${planName}`;
  const cliVersion = state.codexCli?.version;
  $('#cli-version').textContent = cliVersion ? `Codex ${cliVersion}` : 'Codex CLI';
  renderModelNotice();
}

function renderModelNotice() {
  const notice = $('#model-update-notice');
  if (!notice) return;
  const hasGpt6 = state.models.some((model) => /^gpt-6(?:\.1)?-/.test(model.id));
  const connected = Boolean(state.account?.connected);
  notice.hidden = !connected || hasGpt6;
  if (!connected || hasGpt6) return;
  if (state.codexCli?.supportsGpt6Family) {
    $('#model-update-title').textContent = 'GPT-6 unavailable';
    $('#model-update-copy').textContent = `This account’s connected model list has not returned GPT-6 yet. Refresh Codex or check account availability. ${state.codexCli.version ? `Detected Codex ${state.codexCli.version}.` : ''}`;
  } else {
    $('#model-update-title').textContent = 'Update Codex for GPT-6';
    $('#model-update-copy').textContent = `Detected Codex ${state.codexCli?.version || 'version unknown'}. Forge needs Codex 0.156.1 or newer for the GPT-6 Sol and Luna model picker. Restart Forge after updating.`;
  }
  notice.title = $('#model-update-copy').textContent;
  notice.setAttribute('aria-label', `${$('#model-update-title').textContent}. ${notice.title}`);
}

function renderFreeRoutingSettings() {
  const route = state.freeRouting;
  if (!state.routingDraftDirty) {
    $('#free-routing-enabled').checked = Boolean(route.enabled);
    $('#codex-free-fallback').checked = Boolean(route.codexFallback);
  }
  $('#routing-openrouter-status').textContent = route.openrouterConfigured ? 'Saved securely' : 'Required';
  $('#routing-nvidia-status').textContent = route.nvidiaConfigured ? 'Saved securely' : 'Required';
  $('#routing-openrouter-key').placeholder = route.openrouterConfigured ? 'Leave blank to keep saved key' : 'Enter OpenRouter key';
  $('#routing-nvidia-key').placeholder = route.nvidiaConfigured ? 'Leave blank to keep saved key' : 'Enter NVIDIA key';
  $('#codex-free-fallback').disabled = !$('#free-routing-enabled').checked || state.routingBusy;
  $('#routing-discover').disabled = state.routingBusy || !route.openrouterConfigured || !route.nvidiaConfigured;
  $('#routing-save').disabled = state.routingBusy;
  $('#routing-use').hidden = !route.enabled;
  if (!state.routingDraftDirty && !state.routingBusy && $('#routing-status').textContent === 'Save both API keys to get started.' && route.openrouterConfigured && route.nvidiaConfigured) $('#routing-status').textContent = route.enabled ? 'Free Auto Route is ready in your model picker.' : 'Both keys are saved. Enable the route and save to use it.';
}

function selectFreeRouteModel() {
  const model = state.models.find((item) => item.providerId === 'forge-free');
  if (!model) return;
  state.modelId = model.id;
  localStorage.setItem('forge.model', model.id);
  renderModels();
  renderAccount();
}

async function saveFreeRouting() {
  state.routingBusy = true;
  const status = $('#routing-status');
  status.classList.remove('is-error');
  status.textContent = 'Encrypting and saving your routing settings…';
  renderFreeRoutingSettings();
  try {
    const result = await api('/api/routing/save', { method: 'POST', body: {
      enabled: $('#free-routing-enabled').checked,
      codexFallback: $('#codex-free-fallback').checked,
      openrouterKey: $('#routing-openrouter-key').value,
      nvidiaKey: $('#routing-nvidia-key').value,
    } });
    state.freeRouting = result.freeRouting;
    state.providers = result.providers;
    state.routingDraftDirty = false;
    $('#routing-openrouter-key').value = '';
    $('#routing-nvidia-key').value = '';
    status.textContent = state.freeRouting.enabled ? `Saved · Free Auto Route is available in your model picker.${state.freeRouting.codexFallback ? ' Codex limit fallback is on.' : ''}` : 'Saved · Free Auto Route is off. Your keys remain encrypted on this device.';
    await refreshState({ quiet: true });
  } catch (error) {
    status.classList.add('is-error');
    status.textContent = error.message;
  } finally {
    state.routingBusy = false;
    renderFreeRoutingSettings();
  }
}

async function discoverFreeRouting() {
  state.routingBusy = true;
  const status = $('#routing-status');
  status.classList.remove('is-error');
  status.textContent = 'Checking the current OpenRouter and NVIDIA catalogs…';
  renderFreeRoutingSettings();
  try {
    const result = await api('/api/routing/discover', { method: 'POST', body: {} });
    const host = $('#routing-catalogs');
    host.replaceChildren();
    for (const catalog of result.catalogs) {
      const row = document.createElement('div');
      row.className = 'routing-catalog-row';
      const name = document.createElement('strong');
      name.textContent = catalog.provider === 'openrouter' ? 'OpenRouter free' : 'NVIDIA NIM';
      const detail = document.createElement('span');
      detail.textContent = catalog.error || `${catalog.name} · ${catalog.count} eligible models`;
      detail.title = catalog.model || catalog.error;
      row.append(name, detail);
      host.append(row);
    }
    host.hidden = false;
    status.textContent = result.catalogs.some((catalog) => catalog.error) ? 'Some providers need attention. See the results below.' : 'Both catalogs are ready. Models are refreshed automatically every ten minutes.';
  } catch (error) {
    status.classList.add('is-error');
    status.textContent = error.message;
  } finally {
    state.routingBusy = false;
    renderFreeRoutingSettings();
  }
}

function renderWorkspace() {
  const open = Boolean(state.workspace?.path);
  document.documentElement.classList.toggle('workspace-ready', open);
  $('#workspace-name').textContent = open ? state.workspace.name : 'Choose a folder';
  $('#workspace-short-path').textContent = open ? state.workspace.path : 'Open a local project';
  $('#breadcrumb-current').textContent = open ? state.workspace.name : 'New workspace';
  $('#breadcrumb-current').title = open ? state.workspace.path : '';
  $('#context-footer-status').textContent = open ? state.workspace.name : 'Not open';
  $('#composer-dock').hidden = false;
  $('#open-project-panel').hidden = open;
  $('#empty-workspace-note').hidden = open;
  if (open && !state.threadId && !state.messages.length) {
    $('#welcome-title').textContent = 'What would you like to change?';
    $('#welcome-copy').textContent = 'Choose a starting point or describe the next step.';
  } else if (!open) {
    $('#welcome-title').textContent = 'Build something useful.';
    $('#welcome-copy').textContent = 'Open a project, then tell Codex what you want to change.';
  }
  const list = $('#recent-workspaces');
  list.replaceChildren();
  for (const recent of state.recentWorkspaces.slice(0, 4)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `recent-workspace ${recent.path === state.workspace?.path ? 'active' : ''}`;
    button.textContent = recent.name || recent.path;
    button.title = recent.path;
    button.dataset.path = recent.path;
    list.append(button);
  }
  renderGit();
}

function renderGit() {
  const pill = $('#branch-pill');
  const hasGit = Boolean(state.workspace && state.git?.branch);
  pill.hidden = !hasGit;
  $('#branch-name').textContent = state.git?.branch || '';
  $('#branch-changes').textContent = state.git?.changedFiles ? `· ${state.git.changedFiles}` : '';
  const count = $('#change-count');
  count.textContent = String(state.git?.changedFiles || 0);
  count.hidden = !state.git?.changedFiles;
  $('#changes-toggle').title = `${state.git?.changedFiles || 0} changed files · +${state.git?.added || 0} -${state.git?.removed || 0} lines · Ctrl+Shift+2`;
}

function buildModelCatalog(codexModels, providers, anthropicStatus) {
  const builtIn = normalizeModelCatalog(codexModels || []);
  const custom = [];
  for (const provider of providers || []) {
    for (const model of provider.models || []) {
      custom.push({
        id: `custom:${provider.id}:${model.id}`,
        name: model.name || model.id,
        description: model.id,
        providerId: provider.id,
        providerModel: model.id,
        reasoningEfforts: ['low', 'medium', 'high'],
        defaultEffort: 'medium',
      });
    }
  }
  const claudeModels = [
    { id: 'anthropic:opus', name: 'Claude Opus', description: 'Latest Opus via Claude Code subscription', providerId: 'anthropic', providerModel: 'opus', reasoningEfforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
    { id: 'anthropic:sonnet', name: 'Claude Sonnet', description: 'Latest Sonnet via Claude Code subscription', providerId: 'anthropic', providerModel: 'sonnet', reasoningEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: !codexModels?.length && !custom.length },
    { id: 'anthropic:haiku', name: 'Claude Haiku', description: 'Latest Haiku via Claude Code subscription', providerId: 'anthropic', providerModel: 'haiku', reasoningEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  ];
  return [...builtIn, ...custom, ...claudeModels];
}

function renderModels() {
  const select = $('#model-select');
  if (state.modelId === 'gpt-6-sol') state.modelId = 'gpt-6.1-sol';
  const gpt6Models = state.models.filter((model) => (!model.providerId || model.providerId === 'openai') && /^gpt-6(?:\.1)?-/.test(model.id));
  const orderedModels = [...state.models].sort((left, right) => {
    const order = (model) => ({ 'gpt-6-astra': 0, 'gpt-6.1-sol': 1, 'gpt-6-luna': 2 }[model.id] ?? 10);
    const priority = order(left) - order(right);
    if (priority) return priority;
    const leftProvider = left.providerId ? state.providers.find((provider) => provider.id === left.providerId)?.name || left.providerId : '';
    const rightProvider = right.providerId ? state.providers.find((provider) => provider.id === right.providerId)?.name || right.providerId : '';
    return leftProvider.localeCompare(rightProvider) || left.name.localeCompare(right.name);
  });
  const savedModel = state.models.find((model) => model.id === state.modelId);
  const automaticCodexModel = state.autoModelRouting && (!savedModel || !savedModel.providerId || savedModel.providerId === 'openai') && !/^gpt-6(?:\.1)?-/.test(savedModel?.id || '');
  const automaticDefault = automaticCodexModel ? findGpt6Model('luna') || findGpt6Model('sol') || findGpt6Model('astra') : null;
  const current = automaticCodexModel
    ? automaticDefault
    : gpt6Models.length && savedModel && !savedModel.providerId && !/^gpt-6(?:\.1)?-/.test(savedModel.id)
      ? state.models.find((model) => model.isDefault && /^gpt-6(?:\.1)?-/.test(model.id)) || gpt6Models[0]
      : savedModel || state.models.find((model) => model.isDefault) || state.models[0];
  select.replaceChildren();
  if (!state.models.length) {
    const option = new Option(state.account?.connected ? 'Models unavailable' : 'Connect to choose a model', '');
    select.add(option);
    select.disabled = true;
    renderModelPicker([]);
    updateModelRoutingUI();
    return;
  }
  select.disabled = false;
  for (const model of orderedModels) select.add(new Option(model.name, model.id));
  if (automaticCodexModel && !automaticDefault) {
    state.modelId = '';
    localStorage.removeItem('forge.model');
  }
  if (current) {
    state.modelId = current.id;
    select.value = current.id;
    localStorage.setItem('forge.model', current.id);
  }
  renderModelPicker(orderedModels);
  updateModelRoutingUI();
  renderEfforts();
  renderModelNotice();
}

function modelFamilyLabel(model) {
  if (model.providerId === 'forge-free') return 'AUTO · OPENROUTER FREE → NVIDIA NIM';
  if (model.providerId === 'anthropic') return 'ANTHROPIC · CLAUDE CODE';
  if (model.providerId) return state.providers.find((provider) => provider.id === model.providerId)?.name?.toUpperCase() || 'CUSTOM PROVIDER';
  const family = String(model.id || '').split('-').slice(0, 2).join('-').toUpperCase();
  return family + ' · Codex';
}

function normalizeModelCatalog(models) {
  const previousSol = models.find((model) => model.id === 'gpt-6-sol');
  const releasedSol = models.find((model) => model.id === 'gpt-6.1-sol');
  if (!previousSol && !releasedSol && !models.some((model) => /^gpt-6(?:\.1)?-/.test(model.id))) return models;
  const newSol = {
    ...(previousSol || {}),
    ...(releasedSol || {}),
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    description: releasedSol?.description || 'Near-Astra performance for complex work at a lower cost.',
    reasoningEfforts: releasedSol?.reasoningEfforts?.length ? releasedSol.reasoningEfforts : ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: releasedSol?.defaultEffort || previousSol?.defaultEffort || 'medium',
    isDefault: releasedSol?.isDefault ?? previousSol?.isDefault ?? false,
  };
  const next = models.filter((model) => model.id !== 'gpt-6-sol' && model.id !== 'gpt-6.1-sol');
  const astraIndex = next.findIndex((model) => model.id === 'gpt-6-astra');
  const insertAt = astraIndex >= 0 ? astraIndex + 1 : Math.min(models.findIndex((model) => model.id === 'gpt-6-sol'), next.length);
  next.splice(Math.max(0, insertAt), 0, newSol);
  return next;
}

function findGpt6Model(tier) {
  const family = state.models.filter((model) => (!model.providerId || model.providerId === 'openai') && /^gpt-6(?:\.1)?-/i.test(model.id));
  const pattern = new RegExp(tier, 'i');
  return family.find((model) => pattern.test(model.id)) || family.find((model) => pattern.test(model.name));
}

function classifyTaskComplexity(prompt, isFirstPrompt) {
  const text = String(prompt || '').toLowerCase();
  const words = text.match(/[\p{L}\p{N}_'-]+/gu) || [];
  const actions = text.match(/\b(?:build|create|implement|add|fix|refactor|migrate|redesign|update|integrate|wire|replace|remove|document|test|optimize|secure|deploy|convert|generate|support|connect|upgrade|audit|rewrite)\b/g) || [];
  const listItems = text.split('\n').filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line)).length;
  const connectors = text.match(/\b(?:also|additionally|plus|then|and then|as well as|while|finally|in addition)\b/g) || [];
  const broadScope = /\b(?:entire|whole|from scratch|end.to.end|large.scale|full rewrite|codebase.wide|across (?:the )?(?:whole|entire) (?:app|application|project|codebase)|architecture)\b/.test(text);
  const subsystems = [
    /\b(?:ui|front.?end|interface|design system)\b/,
    /\b(?:api|back.?end|server|service)\b/,
    /\b(?:database|storage|schema)\b/,
    /\b(?:auth|login|identity|permissions?)\b/,
    /\b(?:tests?|coverage|quality)\b/,
    /\b(?:deploy|deployment|ci\/cd|pipeline)\b/,
    /\b(?:migration|performance|security|integration)\b/,
  ].filter((pattern) => pattern.test(text)).length;
  const wordCount = words.length;
  const exceptionallyBroad = isFirstPrompt && wordCount >= 240 && broadScope && subsystems >= 3 && actions.length >= 6 && (listItems >= 4 || connectors.length >= 5);
  if (exceptionallyBroad) return { tier: 'astra', reason: 'exceptionally broad first task' };
  const substantial = (isFirstPrompt && (actions.length >= 4 || listItems >= 3 || (actions.length >= 3 && wordCount >= 55) || (listItems >= 2 && actions.length >= 2 && wordCount >= 38)))
    || (actions.length >= 4 && wordCount >= 75)
    || (listItems >= 3 && wordCount >= 55)
    || (broadScope && actions.length >= 2 && wordCount >= 45);
  return substantial ? { tier: 'sol', reason: 'multi-part or broad task' } : { tier: 'luna', reason: 'standard task' };
}

function chooseAutomaticModel(prompt, isFirstPrompt) {
  const complexity = classifyTaskComplexity(prompt, isFirstPrompt);
  const fallbackOrder = { luna: ['luna', 'sol', 'astra'], sol: ['sol', 'luna', 'astra'], astra: ['astra', 'sol', 'luna'] }[complexity.tier];
  const model = fallbackOrder.map(findGpt6Model).find(Boolean);
  return model ? { model, ...complexity } : null;
}

function updateModelRoutingUI() {
  const toggle = $('#auto-model-routing');
  const note = $('#model-routing-note');
  const mode = $('#model-picker-mode');
  if (toggle) toggle.checked = state.autoModelRouting;
  const hasGpt6 = state.models.some((model) => (!model.providerId || model.providerId === 'openai') && /^gpt-6(?:\.1)?-/i.test(model.id));
  if (note) note.textContent = state.autoModelRouting
    ? state.models.length && !hasGpt6
      ? 'On · this Codex account has no GPT-6 models available right now, so automatic routing will pause instead of falling back to GPT-5.6.'
      : 'On · GPT-6 Luna handles most tasks; GPT-6.1 Sol steps up for substantial multi-part work; GPT-6 Astra is reserved for rare, exceptionally broad first prompts. GPT-5.6 is never selected.'
    : 'Off · your selected model is used as-is. When on, automatic choices never use GPT-5.6. Claude and custom provider selections remain manual.';
  const current = state.models.find((model) => model.id === state.modelId);
  const isCodexModel = !current?.providerId || current.providerId === 'openai';
  if (mode) {
    mode.textContent = state.autoModelRouting && isCodexModel ? 'AUTO · GPT-6' : 'MODEL';
    mode.classList.toggle('is-auto', state.autoModelRouting && isCodexModel);
  }
}

function renderModelPicker(orderedModels = state.models) {
  const trigger = $('#model-picker-trigger');
  const optionsHost = $('#model-options');
  const triggerMark = $('#model-picker-mark');
  const models = orderedModels || [];
  const current = models.find((model) => model.id === state.modelId);
  trigger.disabled = !models.length;
  $('#model-picker-label').textContent = current?.name || (state.autoModelRouting ? 'GPT-6 unavailable' : state.account?.connected ? 'Models unavailable' : 'Connect Codex');
  trigger.title = current ? (current.id === current.name ? current.name : `${current.name} · ${current.id}`) : state.autoModelRouting ? 'No GPT-6 model is available in this Codex account' : 'Choose a model';
  triggerMark.className = `model-picker-mark tier-${getModelTier(current?.id, current?.providerId)}`;
  triggerMark.replaceChildren(current ? createModelIcon(current.id, current.providerId) : createOpenAIMark());
  $('#model-picker-count').textContent = models.length ? models.length + ' models' : '';
  optionsHost.replaceChildren();
  if (!models.length) {
    setModelPickerOpen(false);
    return;
  }
  for (const model of models) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'model-option' + (model.id === state.modelId ? ' selected' : '');
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(model.id === state.modelId));
    option.dataset.modelId = model.id;
    const providerName = model.providerId ? state.providers.find((provider) => provider.id === model.providerId)?.name || model.providerId : 'Codex';
    option.dataset.searchText = `${model.name} ${model.id} ${model.description || ''} ${providerName}`.toLocaleLowerCase();
    option.title = model.id === model.name ? model.name : `${model.name} · ${model.id}`;
    const glyph = document.createElement('span');
    glyph.className = `model-option-mark tier-${getModelTier(model.id, model.providerId)}`;
    glyph.setAttribute('aria-hidden', 'true');
    glyph.append(createModelIcon(model.id, model.providerId));
    const copy = document.createElement('span');
    copy.className = 'model-option-copy';
    const name = document.createElement('strong');
    name.textContent = model.name;
    const family = document.createElement('small');
    family.textContent = modelFamilyLabel(model);
    copy.append(name, family);
    const check = document.createElement('span');
    check.className = 'model-option-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = model.id === state.modelId ? '✓' : '';
    option.append(glyph, copy, check);
    optionsHost.append(option);
  }
  filterModelOptions();
}

function filterModelOptions() {
  const query = $('#model-search').value.trim().toLocaleLowerCase();
  const options = [...$('#model-options').querySelectorAll('[role="option"]')];
  let visible = 0;
  for (const option of options) {
    const matches = !query || option.dataset.searchText.includes(query);
    option.hidden = !matches;
    if (matches) visible += 1;
  }
  const empty = $('#model-options').querySelector('.model-search-empty');
  if (!visible && options.length) {
    if (!empty) {
      const message = document.createElement('div');
      message.className = 'model-search-empty';
      message.setAttribute('role', 'status');
      message.textContent = 'No models match that search';
      $('#model-options').append(message);
    }
  } else empty?.remove();
  $('#model-picker-count').textContent = query ? `${visible} of ${options.length}` : `${options.length} models`;
}

function setModelPickerOpen(open, restoreFocus = false) {
  const menu = $('#model-picker-menu');
  const trigger = $('#model-picker-trigger');
  const shouldOpen = Boolean(open && !trigger.disabled);
  menu.hidden = !shouldOpen;
  trigger.setAttribute('aria-expanded', String(shouldOpen));
  if (shouldOpen) {
    $('#model-search').value = '';
    filterModelOptions();
    $('#model-search').focus({ preventScroll: true });
  } else if (restoreFocus) trigger.focus({ preventScroll: true });
}

let effortCloseTimer;
function positionEffortPopover() {
  const popover = $('#effort-popover');
  popover.style.setProperty('--effort-offset', '0px');
  const anchor = $('#effort-control').getBoundingClientRect();
  const bounds = { left: anchor.right - popover.offsetWidth, right: anchor.right };
  const offset = bounds.left < 12 ? 12 - bounds.left : bounds.right > window.innerWidth - 12 ? window.innerWidth - 12 - bounds.right : 0;
  popover.style.setProperty('--effort-offset', `${offset}px`);
}
function setEffortPopoverOpen(open, restoreFocus = false) {
  const popover = $('#effort-popover');
  const trigger = $('#effort-trigger');
  clearTimeout(effortCloseTimer);
  popover.classList.remove('closing');
  if (open) popover.hidden = false;
  else if (!popover.hidden) {
    popover.classList.add('closing');
    effortCloseTimer = setTimeout(() => { popover.hidden = true; popover.classList.remove('closing'); }, 140);
  }
  popover.inert = !open;
  trigger.setAttribute('aria-expanded', String(Boolean(open)));
  if (open) { positionEffortPopover(); $('#effort-select').focus({ preventScroll: true }); }
  else if (restoreFocus) trigger.focus({ preventScroll: true });
}
window.addEventListener('resize', () => { if ($('#effort-trigger').getAttribute('aria-expanded') === 'true') positionEffortPopover(); });

function renderEffortDetail(options, index) {
  const blocks = $('#effort-blocks');
  if (blocks.children.length !== options.length) blocks.replaceChildren(...options.map(() => document.createElement('span')));
  [...blocks.children].forEach((block, position) => block.classList.toggle('active', position <= index));
  const descriptions = { low: 'Quick answers and small, focused edits.', medium: 'Balanced depth for everyday tasks.', high: 'More depth for complex changes.', xhigh: 'Careful reasoning across larger tasks.', max: 'Thorough analysis for demanding work.', ultra: 'Maximum depth for the hardest coding tasks.', ultracode: 'Maximum depth for the hardest coding tasks.' };
  $('#effort-description').textContent = descriptions[options[index]] || 'Choose the depth of reasoning for this task.';
}

function formatEffortLabel(effort) {
  const labels = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max', ultra: 'Ultracode', ultracode: 'Ultracode' };
  return labels[effort] || String(effort || '').replace(/^./, (letter) => letter.toUpperCase());
}

function renderEfforts() {
  const model = state.models.find((item) => item.id === state.modelId);
  const effortOrder = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode'];
  const available = model?.reasoningEfforts?.filter((effort) => effort !== 'none' && effort !== 'minimal');
  const options = (available?.length ? [...available] : ['low', 'medium', 'high'])
    .sort((left, right) => effortOrder.indexOf(left) - effortOrder.indexOf(right));
  const select = $('#effort-select');
  if (!options.includes(state.effort)) state.effort = options.includes(model?.defaultEffort) ? model.defaultEffort : options[Math.min(1, options.length - 1)];
  const index = Math.max(0, options.indexOf(state.effort));
  select.min = '0';
  select.max = String(Math.max(0, options.length - 1));
  select.step = '1';
  select.value = String(index);
  select.dataset.efforts = JSON.stringify(options);
  select.style.setProperty('--effort-progress', (options.length > 1 ? index / (options.length - 1) * 100 : 0) + '%');
  $('#effort-min-label').textContent = formatEffortLabel(options[0]);
  $('#effort-max-label').textContent = formatEffortLabel(options[options.length - 1]);
  $('#effort-current-label').textContent = formatEffortLabel(state.effort);
  $('#effort-popover-value').textContent = formatEffortLabel(state.effort);
  select.setAttribute('aria-valuetext', formatEffortLabel(state.effort));
  renderEffortDetail(options, index);
  localStorage.setItem('forge.effort', state.effort);
}

function updateEffortFromSlider() {
  const slider = $('#effort-select');
  let options = [];
  try { options = JSON.parse(slider.dataset.efforts || '[]'); } catch { options = []; }
  const effort = options[Number(slider.value)];
  if (!effort) return;
  state.effort = effort;
  const label = formatEffortLabel(effort);
  $('#effort-current-label').textContent = label;
  $('#effort-popover-value').textContent = label;
  slider.setAttribute('aria-valuetext', label);
  renderEffortDetail(options, Number(slider.value));
  slider.style.setProperty('--effort-progress', (options.length > 1 ? Number(slider.value) / (options.length - 1) * 100 : 0) + '%');
  localStorage.setItem('forge.effort', effort);
}

function renderThreads() {
  const list = $('#session-list');
  list.replaceChildren();
  if (!state.workspace) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = 'No sessions found';
    list.append(empty);
    return;
  }
  if (!state.threads?.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = 'No sessions found';
    list.append(empty);
    return;
  }
  const query = $('#session-filter')?.value.trim().toLocaleLowerCase() || '';
  const threads = state.threads.filter((thread) => !query || (thread.name || '').toLocaleLowerCase().includes(query));
  if (!threads.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = 'No matching sessions';
    list.append(empty);
    return;
  }
  for (const thread of threads) {
    const row = document.createElement('div');
    row.className = 'session-row';
    const button = document.createElement('button');
    button.type = 'button';
    const isLoading = state.threadLoading && thread.id === state.threadId;
    const isDeleting = state.deletingThreads.has(thread.id);
    button.className = `session-button ${thread.id === state.threadId ? 'active' : ''} ${isLoading ? 'loading' : ''}`;
    button.disabled = isDeleting;
    button.dataset.threadId = thread.id;
    button.setAttribute('aria-busy', String(isLoading));
    button.setAttribute('aria-current', thread.id === state.threadId ? 'page' : 'false');
    let pointerActivated = false;
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      pointerActivated = true;
      void openThread(thread.id);
    });
    button.addEventListener('click', () => {
      if (pointerActivated) { pointerActivated = false; return; }
      void openThread(thread.id);
    });
    const glyph = document.createElement('span');
    glyph.className = 'session-glyph';
    glyph.textContent = isLoading ? '' : '◌';
    const copy = document.createElement('span');
    copy.className = 'session-copy';
    const title = document.createElement('strong');
    title.textContent = thread.name || 'Untitled task';
    const updated = document.createElement('small');
    updated.textContent = formatRelativeTime(thread.updatedAt);
    copy.append(title, updated);
    button.append(glyph, copy);
    row.append(button);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'session-delete-button';
    const currentSessionUnavailable = thread.id === state.threadId && (state.isBusy || state.threadLoading);
    remove.disabled = isDeleting || currentSessionUnavailable;
    remove.setAttribute('aria-label', `Delete session: ${thread.name || 'Untitled task'}`);
    remove.title = currentSessionUnavailable ? 'Wait for this session to finish opening or stop its task before deleting' : 'Delete session';
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9 7V4.8h6V7m2.3 0-.8 12H7.5l-.8-12m4.1 3.2v5.5m4.4-5.5v5.5"/></svg>';
    remove.addEventListener('click', () => { void deleteThread(thread); });
    row.append(remove);
    list.append(row);
  }
}

async function deleteThread(thread) {
  if (state.deletingThreads.has(thread.id)) return;
  if (state.threadId === thread.id && (state.isBusy || state.threadLoading)) {
    showToast(state.threadLoading ? 'Wait for this session to finish opening before deleting it.' : 'Stop the active task before deleting its session.');
    return;
  }
  const name = thread.name || 'Untitled session';
  if (!window.confirm(`Delete “${name}”? This permanently removes the session from Codex.`)) return;
  state.deletingThreads.add(thread.id);
  renderThreads();
  try {
    await api('/api/threads/delete', { method: 'POST', body: { threadId: thread.id } });
    state.threads = (state.threads || []).filter((item) => item.id !== thread.id);
    state.threadHistoryCache.delete(thread.id);
    if (state.threadId === thread.id) {
      state.threadId = null;
      state.threadProviderId = null;
      state.threadName = '';
      state.messages = [];
      state.approvals = [];
      state.activeTurnId = null;
      state.isBusy = false;
      state.pendingSend = false;
      state.threadLoading = false;
      state.diff = '';
      renderSurface();
    } else renderThreads();
    showToast('Session deleted.');
    void refreshState({ quiet: true });
  } catch (error) {
    showToast(error.message || 'Could not delete this session.', 'error');
  } finally {
    state.deletingThreads.delete(thread.id);
    renderThreads();
  }
}

function renderSurface() {
  const active = Boolean(state.threadId || state.messages.length || state.isBusy);
  $('.workspace-surface').classList.toggle('has-conversation', active);
  const enteringConversation = active && $('#conversation-view').hidden;
  $('#welcome-view').hidden = active;
  $('#conversation-view').hidden = !active;
  if (active) {
    $('#conversation-title').textContent = state.threadName || (state.messages.find((message) => message.role === 'user')?.text.slice(0, 72) || 'New task');
    $('#conversation-subtitle').textContent = state.workspace?.path || '';
    $('#thread-loading-note').hidden = !state.threadLoading;
    renderMessages(enteringConversation);
  }
  renderThreads();
  updateComposerState();
}

function renderGitOrWorkspace() {
  renderWorkspace();
}

function renderAll() {
  renderAccount();
  renderWorkspace();
  renderModels();
  renderThreads();
  renderContext();
  renderSurface();
  renderFreeRoutingSettings();
}

async function refreshState({ quiet = false } = {}) {
  try {
    const snapshot = await api('/api/state');
    state.account = snapshot.account;
    state.codexCli = snapshot.codexCli || null;
    state.providers = snapshot.providers || [];
    state.freeRouting = snapshot.freeRouting || { enabled: false, codexFallback: false };
    state.anthropic = snapshot.anthropic || { available: false, connected: false };
    state.models = buildModelCatalog(snapshot.models || [], state.providers, state.anthropic);
    state.limits = snapshot.limits;
    state.workspace = snapshot.workspace;
    state.recentWorkspaces = snapshot.recentWorkspaces || [];
    state.threads = snapshot.threads || [];
    state.git = snapshot.git || { branch: null, changedFiles: 0, entries: [] };
    renderAnthropicAccount();
    renderAll();
    if (state.workspace && !state.treeCache.has('')) await loadTree('');
  } catch (error) {
    state.account = { connected: false, connectionError: true, error: error.message };
    renderAccount();
    if (!quiet) showToast(error.message, 'error');
  }
}

async function openWorkspace(pathValue) {
  if (state.isBusy) {
    showToast('Stop the active task before switching workspaces.');
    return;
  }
  try {
    const result = await api('/api/workspaces/open', { method: 'POST', body: { path: pathValue } });
    state.workspace = result.workspace;
    state.threadId = null;
    state.threadProviderId = null;
    state.threadName = '';
    state.messages = [];
    state.activeTurnId = null;
    state.isBusy = false;
    state.approvals = [];
    state.diff = '';
    state.selectedFile = null;
    state.treeCache.clear();
    state.expandedDirs.clear();
    state.activeContextTab = 'files';
    $('#file-search').value = '';
    setModal('workspace-modal', false);
    $('#workspace-path').value = '';
    $('#workspace-modal-path').value = '';
    $('#prompt-input').value = '';
    renderAll();
    await refreshState({ quiet: true });
    await loadTree('');
    $('#prompt-input').focus();
  } catch (error) {
    const errorBox = $('#workspace-modal').hidden ? null : $('#workspace-error');
    if (errorBox) { errorBox.textContent = error.message; errorBox.hidden = false; }
    else showToast(error.message, 'error');
  }
}

function newTask() {
  if (!state.workspace) {
    showToast('Open a project folder first.');
    openWorkspaceDialog();
    return;
  }
  if (state.isBusy) {
    showToast('Stop the active task before starting a new one.');
    return;
  }
  state.threadId = null;
  state.threadProviderId = null;
  state.threadName = '';
  state.messages = [];
  state.activeTurnId = null;
  state.approvals = [];
  state.diff = '';
  renderContext();
  renderSurface();
  $('#prompt-input').value = '';
  $('#prompt-input').focus();
}

function openWorkspaceDialog() {
  $('#workspace-error').hidden = true;
  $('#workspace-modal-path').value = state.workspace?.path || $('#workspace-path').value || '';
  setModal('workspace-modal', true);
}

async function chooseWorkspaceFolder() {
  if (!window.ForgeDesktop?.chooseFolder) return openWorkspaceDialog();
  try {
    const folder = await window.ForgeDesktop.chooseFolder();
    if (folder) await openWorkspace(folder);
  } catch (error) {
    showToast(error.message || 'Could not open the folder picker.', 'error');
  }
}

async function loadTree(directory) {
  if (!state.workspace) return;
  const workspacePath = state.workspace.path;
  try {
    const result = await api(`/api/tree?dir=${encodeURIComponent(directory)}`);
    if (state.workspace?.path !== workspacePath) return;
    state.treeCache.set(directory, result.entries || []);
    renderContext();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function treeRow(entry, depth) {
  const row = document.createElement('button');
  row.type = 'button';
  const expanded = state.expandedDirs.has(entry.path);
  row.className = `tree-row ${entry.kind === 'directory' ? 'directory' : ''} ${entry.path === state.selectedFile ? 'selected' : ''}`;
  row.dataset.path = entry.path;
  row.dataset.kind = entry.kind;
  const indent = document.createElement('span');
  indent.className = 'tree-indent';
  indent.style.width = `${depth * 14}px`;
  const caret = document.createElement('span');
  caret.className = `tree-caret ${expanded ? 'open' : ''}`;
  caret.textContent = entry.kind === 'directory' ? '›' : '';
  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = entry.kind === 'directory' ? (expanded ? '▾' : '▸') : fileGlyph(entry.extension);
  const name = document.createElement('span');
  name.className = 'tree-name';
  name.textContent = entry.name;
  row.append(indent, caret, icon, name);
  return row;
}

function fileGlyph(extension) {
  const glyphs = { js: 'JS', jsx: 'JS', mjs: 'JS', cjs: 'JS', ts: 'TS', tsx: 'TS', json: '{}', md: 'M', css: '#', html: '◫', py: 'PY', rs: 'R', go: 'G', yml: 'Y', yaml: 'Y', toml: 'T', ps1: 'PS' };
  return glyphs[extension] || '·';
}

function appendTree(parent, directory, depth, filter) {
  const entries = state.treeCache.get(directory) || [];
  for (const entry of entries) {
    if (filter && !entry.name.toLowerCase().includes(filter) && entry.kind !== 'directory') continue;
    if (filter && !entry.name.toLowerCase().includes(filter) && entry.kind === 'directory' && !state.expandedDirs.has(entry.path)) continue;
    parent.append(treeRow(entry, depth));
    if (entry.kind === 'directory' && state.expandedDirs.has(entry.path)) appendTree(parent, entry.path, depth + 1, filter);
  }
}

async function openFile(relativePath) {
  try {
    const result = await api(`/api/file?path=${encodeURIComponent(relativePath)}`);
    state.selectedFile = relativePath;
    state.activeContextTab = 'preview';
    const preview = $('#file-preview');
    preview.replaceChildren();
    const toolbar = document.createElement('div');
    toolbar.className = 'preview-toolbar';
    const filePath = document.createElement('span');
    filePath.className = 'preview-path';
    filePath.textContent = result.path;
    const back = document.createElement('button');
    back.className = 'preview-back';
    back.type = 'button';
    back.textContent = '‹ Files';
    back.addEventListener('click', () => { state.activeContextTab = 'files'; renderContext(); });
    toolbar.append(filePath, back);
    preview.append(toolbar);
    if (!result.isText) {
      const note = document.createElement('div');
      note.className = 'preview-binary';
      note.textContent = 'This file contains binary data and cannot be previewed as text.';
      preview.append(note);
    } else {
      const code = document.createElement('pre');
      code.textContent = result.content || ' '; 
      preview.append(code);
    }
    renderContext();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function diffMarkup(diff) {
  return String(diff || '').split('\n').map((line) => {
    const escaped = escapeHTML(line);
    if (line.startsWith('+') && !line.startsWith('+++')) return `<span class="diff-add">${escaped}</span>`;
    if (line.startsWith('-') && !line.startsWith('---')) return `<span class="diff-remove">${escaped}</span>`;
    if (line.startsWith('@@')) return `<span class="diff-hunk">${escaped}</span>`;
    if (line.startsWith('diff --git') || line.startsWith('+++') || line.startsWith('---')) return `<span class="diff-file">${escaped}</span>`;
    return escaped;
  }).join('\n');
}

function renderContext() {
  if (state.changePreview && state.changePreview.workspacePath !== state.workspace?.path) {
    state.changePreview = null;
    state.changePreviewVersion += 1;
  }
  const shell = $('.app-shell');
  const panel = $('#context-panel');
  const isMobile = window.matchMedia('(max-width: 980px)').matches;
  const isOpen = !shell.classList.contains('context-hidden');
  panel.inert = !isOpen;
  panel.setAttribute('aria-hidden', String(!isOpen));
  $('.main-column').inert = isMobile && isOpen;
  $('.sidebar').inert = shell.classList.contains('sidebar-hidden') || (isMobile && isOpen);
  panel.classList.toggle('mobile-open', isMobile && isOpen);
  $('#files-toggle').setAttribute('aria-pressed', String(isOpen && (state.activeContextTab === 'files' || state.activeContextTab === 'preview')));
  $('#changes-toggle').setAttribute('aria-pressed', String(isOpen && state.activeContextTab === 'changes'));
  $('#agents-toggle').setAttribute('aria-pressed', String(isOpen && state.activeContextTab === 'agents'));
  $('#changes-toggle').setAttribute('aria-controls', 'context-panel');
  $('#agents-toggle').setAttribute('aria-controls', 'context-panel');
  $$('.context-tab').forEach((button) => button.setAttribute('aria-pressed', String(state.activeContextTab === button.dataset.contextTab || (button.dataset.contextTab === 'files' && state.activeContextTab === 'preview'))));
  $('#tree-toolbar').hidden = state.activeContextTab !== 'files';
  $('#file-tree').hidden = state.activeContextTab !== 'files';
  $('#file-preview').hidden = state.activeContextTab !== 'preview';
  $('#change-preview').hidden = state.activeContextTab !== 'changes';
  $('#agent-organizer').hidden = state.activeContextTab !== 'agents';
  $('#context-kicker').textContent = state.activeContextTab === 'changes' ? 'WORKING TREE' : state.activeContextTab === 'agents' ? 'DELEGATED WORK' : 'PROJECT';
  $('#context-title').textContent = state.activeContextTab === 'changes' ? 'Changes' : state.activeContextTab === 'preview' ? 'Preview' : state.activeContextTab === 'agents' ? 'Subagents' : 'Files';
  $('#context-footer-label').textContent = state.activeContextTab === 'changes' ? 'GIT WORKING TREE' : state.activeContextTab === 'agents' ? 'CURRENT SESSION' : 'LOCAL WORKSPACE';
  $('#context-footer-status').textContent = state.workspace?.name || 'Not open';
  renderAgentOrganizer();
  if (state.activeContextTab === 'files') {
    const tree = $('#file-tree');
    tree.replaceChildren();
    if (!state.workspace) {
      const empty = document.createElement('div');
      empty.className = 'context-empty';
      empty.textContent = 'Open a workspace to see its files.';
      tree.append(empty);
    } else if (!state.treeCache.has('')) {
      const loading = document.createElement('div');
      loading.className = 'context-empty';
      loading.textContent = 'Loading workspace files…';
      tree.append(loading);
    } else {
      appendTree(tree, '', 0, $('#file-search').value.trim().toLowerCase());
      if (!tree.children.length) {
        const empty = document.createElement('div');
        empty.className = 'context-empty';
        empty.textContent = 'No visible files match that filter.';
        tree.append(empty);
      }
    }
  }
  const fallback = state.git?.entries?.length
    ? state.git.entries.map((item) => `${item.status.padEnd(2, ' ')}  ${item.path}`).join('\n')
    : '';
  renderChangeSummary(fallback);
}

function formatLineCount(value) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function renderChangeSummary(fallback) {
  const entries = state.git?.entries || [];
  const added = entries.reduce((sum, entry) => sum + formatLineCount(entry.added), 0);
  const removed = entries.reduce((sum, entry) => sum + formatLineCount(entry.removed), 0);
  const summary = $('#change-summary');
  summary.replaceChildren();
  if (!entries.length) {
    summary.className = 'change-summary change-summary-empty';
    summary.textContent = state.diff ? 'Latest changes from this session.' : 'No file changes in the working tree.';
    $('#diff-content').innerHTML = diffMarkup(state.diff || fallback || '');
    return;
  }
  summary.className = 'change-summary';
  const overview = document.createElement('div');
  overview.className = 'change-overview';
  const title = document.createElement('div');
  title.className = 'change-overview-title';
  title.innerHTML = `<strong>${entries.length} ${entries.length === 1 ? 'file' : 'files'} changed</strong><span>${escapeHTML(state.git?.branch || 'Working tree')}</span>`;
  const stats = document.createElement('div');
  stats.className = 'change-overview-stats';
  stats.innerHTML = `<span class="change-added">+${added}</span><span class="change-removed">-${removed}</span>`;
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'change-refresh';
  refresh.textContent = '↻';
  refresh.title = 'Refresh the working tree';
  refresh.setAttribute('aria-label', 'Refresh working tree changes');
  refresh.addEventListener('click', () => {
    state.changePreview = null;
    state.changePreviewVersion += 1;
    void refreshState({ quiet: true });
  });
  stats.append(refresh);
  overview.append(title, stats);
  const list = document.createElement('div');
  list.className = 'change-file-list';
  for (const entry of entries) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'change-file-row';
    row.title = `Review changes in ${entry.path}`;
    row.classList.toggle('selected', state.changePreview?.path === entry.path);
    row.addEventListener('click', () => void loadChangeDiff(entry));
    const icon = document.createElement('span');
    icon.className = `change-file-status ${entry.status === '??' ? 'untracked' : ''}`;
    icon.textContent = entry.status || 'M';
    const pathLabel = document.createElement('span');
    pathLabel.className = 'change-file-path';
    pathLabel.textContent = entry.path;
    pathLabel.title = entry.path;
    const lineStats = document.createElement('span');
    lineStats.className = 'change-file-stats';
    lineStats.innerHTML = `<span class="change-added">+${formatLineCount(entry.added)}</span><span class="change-removed">-${formatLineCount(entry.removed)}</span>`;
    row.append(icon, pathLabel, lineStats);
    list.append(row);
  }
  summary.append(overview, list);
  const preview = state.changePreview;
  if (preview) {
    const header = document.createElement('div');
    header.className = 'change-diff-heading';
    const pathLabel = document.createElement('strong');
    pathLabel.textContent = preview.path;
    pathLabel.title = preview.path;
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Open file ↗';
    open.disabled = preview.deleted;
    open.addEventListener('click', () => void openFile(preview.path));
    header.append(pathLabel, open);
    summary.append(header);
    if (preview.loading || preview.error || preview.binary || !preview.diff) {
      const note = document.createElement('p');
      note.className = 'change-diff-note';
      note.textContent = preview.loading ? 'Loading file changes…' : preview.error || (preview.binary ? 'Binary file changed. A text diff is unavailable.' : 'No text changes in this file.');
      summary.append(note);
    }
  }
  $('#diff-content').innerHTML = diffMarkup(preview ? preview.diff || '' : state.diff || '');
}

async function loadChangeDiff(entry) {
  const version = ++state.changePreviewVersion;
  const workspacePath = state.workspace?.path;
  state.changePreview = { path: entry.path, workspacePath, deleted: entry.status.includes('D'), loading: true, diff: '' };
  renderContext();
  try {
    const result = await api(`/api/changes/file?path=${encodeURIComponent(entry.path)}`);
    if (version !== state.changePreviewVersion || workspacePath !== state.workspace?.path) return;
    state.changePreview = { ...state.changePreview, ...result, loading: false };
  } catch (error) {
    if (version !== state.changePreviewVersion || workspacePath !== state.workspace?.path) return;
    state.changePreview = { ...state.changePreview, loading: false, error: error.message };
  }
  if (state.activeContextTab === 'changes') renderContext();
}

function markdownInline(text) {
  const fragments = [];
  const stash = (html) => `\u0001${fragments.push(html) - 1}\u0001`;
  let source = String(text || '');
  source = source.replace(/`([^`]+)`/g, (_, code) => stash(`<code>${escapeHTML(code)}</code>`));
  source = source.replace(/\[([^\]\n]+)\]\s*\\?\(\s*(?:\\?<([^>\n]+)>\\?|([^\s)]+))\s*\\?\)/g, (whole, label, angleTarget, plainTarget) => {
    const target = String(angleTarget || plainTarget || '').trim().replace(/\\([()<>])/g, '$1');
    const escapedLabel = escapeHTML(label.trim());
    if (/^https?:\/\//i.test(target)) return stash(`<a href="${escapeHTML(target)}" target="_blank" rel="noopener noreferrer">${escapedLabel}</a>`);
    const isLocalPath = /^[a-z]:[\\/]/i.test(target) || /^(?:\\\\|\/|\.\.?[\\/])/.test(target) || !/^[a-z][a-z\d+.-]*:/i.test(target);
    if (isLocalPath && target && target.length <= 2048 && !/[<>\u0000-\u001f]/.test(target)) {
      const icon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.75h5l3 3v9.5H4zM9 1.9v3h3M6 8h4M6 10.5h4"/></svg>';
      return stash(`<a class="file-link-chip" href="#" data-file-path="${escapeHTML(target)}" title="${escapeHTML(target)}"><span class="file-link-icon">${icon}</span><span>${escapedLabel}</span></a>`);
    }
    return whole;
  });
  let safe = escapeHTML(source);
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return safe.replace(/\u0001(\d+)\u0001/g, (_, index) => fragments[Number(index)] || '');
}

function renderMarkdown(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const html = [];
  let paragraph = [];
  let listType = '';
  let inCode = false;
  let codeLines = [];
  const flushParagraph = () => {
    if (paragraph.length) { html.push(`<p>${paragraph.map(markdownInline).join('<br>')}</p>`); paragraph = []; }
  };
  const closeList = () => { if (listType) { html.push(`</${listType}>`); listType = ''; } };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushParagraph(); closeList();
      if (inCode) { html.push(`<pre><code>${escapeHTML(codeLines.join('\n'))}</code></pre>`); codeLines = []; inCode = false; }
      else inCode = true;
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { flushParagraph(); closeList(); const level = heading[1].length; html.push(`<h${level}>${markdownInline(heading[2])}</h${level}>`); continue; }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { flushParagraph(); closeList(); html.push(`<blockquote>${markdownInline(quote[1])}</blockquote>`); continue; }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? 'ul' : 'ol';
      if (listType && listType !== nextType) closeList();
      if (!listType) { html.push(`<${nextType}>`); listType = nextType; }
      html.push(`<li>${markdownInline((unordered || ordered)[1])}</li>`);
      continue;
    }
    closeList();
    paragraph.push(line);
  }
  flushParagraph(); closeList();
  if (inCode) html.push(`<pre><code>${escapeHTML(codeLines.join('\n'))}</code></pre>`);
  return html.join('');
}

function itemStatus(item) {
  if (typeof item?.status === 'string') return item.status;
  return item?.status?.type || '';
}

function statusLabel(status) {
  const labels = { inProgress: 'Running', in_progress: 'Running', running: 'Running', pendingInit: 'Starting', pending_init: 'Starting', completed: 'Complete', failed: 'Failed', errored: 'Failed', declined: 'Declined', interrupted: 'Stopped', shutdown: 'Stopped', notFound: 'Unavailable', not_found: 'Unavailable', pending: 'Waiting' };
  return labels[status] || status || 'Complete';
}

function renderAgentActivity(message) {
  const status = message.status || 'running';
  const normalized = String(status).toLowerCase();
  const card = document.createElement('article');
  card.dataset.agentId = String(message.agentId || '');
  card.id = `agent-activity-${String(message.agentId || message.id || '').replace(/[^a-z\d_-]/gi, '-')}`;
  card.className = `agent-card ${/complete/.test(normalized) ? 'complete' : /fail|error|notfound/.test(normalized) ? 'failed' : /interrupt|shutdown/.test(normalized) ? 'stopped' : 'running'}`;
  const avatar = document.createElement('span');
  avatar.className = 'agent-avatar';
  avatar.textContent = (message.name || 'A').trim().slice(0, 1).toUpperCase();
  const content = document.createElement('div');
  content.className = 'agent-content';
  const heading = document.createElement('div');
  heading.className = 'agent-heading';
  const name = document.createElement('strong');
  name.textContent = message.name || 'Codex agent';
  if (message.roleName) {
    const role = document.createElement('span');
    role.className = 'agent-role';
    role.textContent = message.roleName;
    heading.append(name, role);
  } else heading.append(name);
  const badge = document.createElement('span');
  badge.className = 'agent-status';
  badge.textContent = statusLabel(status);
  heading.append(badge);
  content.append(heading);
  const task = document.createElement('p');
  task.className = 'agent-task';
  task.textContent = message.statusMessage || message.task || 'Working on a delegated task';
  content.append(task);
  if (message.task && message.statusMessage && message.task !== message.statusMessage) {
    const scope = document.createElement('p');
    scope.className = 'agent-scope';
    scope.textContent = message.task;
    content.append(scope);
  }
  const meta = document.createElement('span');
  meta.className = 'agent-meta';
  meta.textContent = message.activityKind ? `Live task update · ${message.activityKind}` : 'Live task update';
  content.append(meta);
  card.append(avatar, content);
  return card;
}

function agentGroupFor(message) {
  const status = String(message.status || '').replace(/[_-]/g, '').toLowerCase();
  if (/fail|error|declin|notfound/.test(status)) return 'attention';
  if (/complete|interrupt|shutdown|stopped|finished/.test(status)) return 'complete';
  return 'active';
}

function renderAgentOrganizer() {
  const agents = state.messages.filter((message) => message.role === 'activity' && message.activityType === 'agent');
  const groupsRoot = $('#agent-groups');
  const summary = $('#agent-organizer-summary');
  const search = ($('#agent-search').value || '').trim().toLocaleLowerCase();
  const runningCount = agents.filter((agent) => agentGroupFor(agent) === 'active').length;
  const count = $('#agents-count');
  count.textContent = String(runningCount || agents.length);
  count.hidden = agents.length === 0;
  count.classList.toggle('agents-running', runningCount > 0);
  $('#agents-toggle').title = `${runningCount} active · ${agents.length} total agents · Ctrl+Shift+3`;
  const assign = $('#agent-assign');
  assign.disabled = !state.workspace || state.isBusy || state.threadLoading;
  assign.title = !state.workspace ? 'Open a project to delegate work' : state.isBusy ? 'Wait for the current task to finish before assigning more work' : 'Assign a focused task to a subagent';
  const signature = JSON.stringify([state.threadId, search, state.agentFilter, state.selectedAgentId, [...state.pinnedAgentIds], [...state.collapsedAgentGroups], agents]);
  if (signature === state.agentRosterSignature) return;
  state.agentRosterSignature = signature;
  const attentionCount = agents.filter((agent) => agentGroupFor(agent) === 'attention').length;
  const completeCount = agents.length - runningCount - attentionCount;
  summary.innerHTML = `<div><strong>${runningCount}</strong><span>Active</span></div><div><strong>${completeCount}</strong><span>Finished</span></div><div><strong>${attentionCount}</strong><span>Attention</span></div>`;
  $$('#agent-status-filters button').forEach((button) => button.setAttribute('aria-pressed', String(state.agentFilter === button.dataset.agentFilter)));
  const selected = agents.find((agent) => String(agent.agentId) === state.selectedAgentId);
  renderAgentDetail(selected);
  const definitions = [
    { key: 'pinned', label: 'Pinned' },
    { key: 'active', label: 'In progress' },
    { key: 'attention', label: 'Needs attention' },
    { key: 'complete', label: 'Finished' },
  ];
  const filtered = agents.filter((agent) => (state.agentFilter === 'all' || agentGroupFor(agent) === state.agentFilter) && (!search || [agent.name, agent.roleName, agent.task, agent.statusMessage].some((value) => String(value || '').toLocaleLowerCase().includes(search))));
  groupsRoot.replaceChildren();
  if (!agents.length) {
    const empty = document.createElement('div');
    empty.className = 'agent-organizer-empty';
    empty.innerHTML = '<span class="agent-empty-mark" aria-hidden="true">◇</span><strong>Build your task team</strong><span>Assign a focused task above. Follow each subagent’s work here as the lead agent delegates it.</span>';
    groupsRoot.append(empty);
    return;
  }
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'context-empty';
    empty.textContent = search ? 'No agents match this search.' : 'No agents with this status.';
    groupsRoot.append(empty);
    return;
  }
  for (const group of definitions) {
    const groupAgents = filtered.filter((agent) => group.key === 'pinned' ? state.pinnedAgentIds.has(String(agent.agentId)) : !state.pinnedAgentIds.has(String(agent.agentId)) && agentGroupFor(agent) === group.key);
    if (!groupAgents.length) continue;
    const section = document.createElement('details');
    section.className = `agent-group agent-group-${group.key}`;
    section.open = search || state.agentFilter !== 'all' ? true : !state.collapsedAgentGroups.has(group.key);
    section.addEventListener('toggle', () => {
      if (search || !section.isConnected) return;
      if (section.open) state.collapsedAgentGroups.delete(group.key);
      else state.collapsedAgentGroups.add(group.key);
    });
    const header = document.createElement('summary');
    header.className = 'agent-group-heading';
    const label = document.createElement('span');
    label.textContent = group.label;
    const groupCount = document.createElement('span');
    groupCount.className = 'agent-group-count';
    groupCount.textContent = String(groupAgents.length);
    header.append(label, groupCount);
    const list = document.createElement('div');
    list.className = 'agent-organizer-list';
    for (const agent of groupAgents) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `agent-organizer-row agent-organizer-${agentGroupFor(agent)}`;
      button.classList.toggle('selected', String(agent.agentId) === state.selectedAgentId);
      button.setAttribute('aria-pressed', String(String(agent.agentId) === state.selectedAgentId));
      button.dataset.agentId = String(agent.agentId || '');
      const avatar = document.createElement('span');
      avatar.className = 'agent-organizer-avatar';
      avatar.textContent = String(agent.name || 'A').trim().slice(0, 1).toUpperCase();
      const copy = document.createElement('span');
      copy.className = 'agent-organizer-copy';
      const name = document.createElement('strong');
      name.textContent = agent.name || 'Codex agent';
      name.title = name.textContent;
      const task = document.createElement('small');
      task.textContent = agent.statusMessage || agent.task || 'Working on a delegated task';
      task.title = task.textContent;
      copy.append(name, task);
      if (agent.roleName) {
        const role = document.createElement('span');
        role.className = 'agent-organizer-role';
        role.textContent = agent.roleName;
        copy.append(role);
      }
      const status = document.createElement('span');
      status.className = 'agent-organizer-status';
      status.textContent = statusLabel(agent.status);
      button.append(avatar, copy, status);
      button.addEventListener('click', () => {
        state.selectedAgentId = String(agent.agentId);
        renderAgentOrganizer();
        $('#agent-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        $('#agent-detail-heading')?.focus({ preventScroll: true });
      });
      list.append(button);
    }
    section.append(header, list);
    groupsRoot.append(section);
  }
}

function renderAgentDetail(agent) {
  const detail = $('#agent-detail');
  detail.hidden = !agent;
  detail.replaceChildren();
  if (!agent) return;
  const header = document.createElement('div');
  header.className = 'agent-detail-header';
  const heading = document.createElement('strong');
  heading.id = 'agent-detail-heading';
  heading.tabIndex = -1;
  heading.textContent = agent.name || 'Codex agent';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'agent-detail-close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close agent details');
  close.addEventListener('click', () => { state.selectedAgentId = null; renderAgentOrganizer(); });
  header.append(heading, close);
  const meta = document.createElement('div');
  meta.className = `agent-detail-meta agent-detail-${agentGroupFor(agent)}`;
  meta.textContent = [statusLabel(agent.status), agent.roleName].filter(Boolean).join(' · ');
  detail.append(header, meta);
  for (const [label, text] of [['Assigned task', agent.task], ['Latest update', agent.statusMessage]]) {
    if (!text) continue;
    const section = document.createElement('div');
    section.className = 'agent-detail-section';
    const title = document.createElement('span');
    title.textContent = label;
    const copy = document.createElement('p');
    copy.textContent = text;
    section.append(title, copy);
    detail.append(section);
  }
  const actions = document.createElement('div');
  actions.className = 'agent-detail-actions';
  const pin = document.createElement('button');
  pin.type = 'button';
  pin.textContent = state.pinnedAgentIds.has(String(agent.agentId)) ? 'Unpin agent' : 'Pin agent';
  pin.addEventListener('click', () => {
    const id = String(agent.agentId);
    if (state.pinnedAgentIds.has(id)) state.pinnedAgentIds.delete(id);
    else state.pinnedAgentIds.add(id);
    localStorage.setItem('forge.pinned-agents', JSON.stringify([...state.pinnedAgentIds].slice(-200)));
    renderAgentOrganizer();
  });
  const activity = document.createElement('button');
  activity.type = 'button';
  activity.textContent = 'View in session ↗';
  activity.addEventListener('click', () => jumpToAgentActivity(agent));
  actions.append(pin, activity);
  detail.append(actions);
}

function jumpToAgentActivity(agent) {
  const index = state.messages.findIndex((message) => message.role === 'activity' && message.activityType === 'agent' && String(message.agentId) === String(agent.agentId));
  if (index >= 0 && index < state.messages.length - state.historyVisibleCount) {
    state.historyVisibleCount = state.messages.length - index;
    renderMessages();
  }
  if (window.matchMedia('(max-width: 980px)').matches) { $('.app-shell').classList.add('context-hidden'); renderContext(); }
  requestAnimationFrame(() => {
    const card = $$('.agent-card').find((item) => item.dataset.agentId === String(agent.agentId));
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card?.classList.add('agent-card-focused');
    setTimeout(() => card?.classList.remove('agent-card-focused'), 1500);
  });
}

function renderActivity(message) {
  if (message.activityType === 'agent') return renderAgentActivity(message);
  const status = message.status || '';
  const failed = /fail|error/i.test(status) || (Number.isInteger(message.exitCode) && message.exitCode !== 0);
  const pending = /progress|running|pending|working/i.test(status);
  const stopped = /interrupt|stop|declin/i.test(status);
  const stateClass = failed ? 'failed' : pending ? 'running' : stopped ? 'stopped' : 'complete';
  const details = document.createElement('details');
  details.className = `activity-card activity-type-${message.activityType || 'task'} ${stateClass}`;
  if (message.activityType === 'files') details.classList.add('activity-files-card');
  if (pending) details.open = true;
  const summary = document.createElement('summary');
  summary.className = 'activity-summary';
  const leading = document.createElement('span');
  leading.className = 'activity-leading';
  const icon = document.createElement('span');
  icon.className = 'activity-icon';
  icon.setAttribute('aria-hidden', 'true');
  const glyphs = { command: '>_', files: '↳', search: '⌕', tool: '◇' };
  icon.textContent = glyphs[message.activityType] || '·';
  const heading = document.createElement('span');
  heading.className = 'activity-heading';
  heading.textContent = message.activityType === 'command'
    ? 'Command'
    : message.activityType === 'files'
      ? (pending ? 'Writing files' : 'File changes')
      : message.activityType === 'search' ? 'Searching'
        : message.activityType === 'tool' ? (message.toolName || 'Project tool')
          : 'Task activity';
  const detail = document.createElement('span');
  detail.className = 'activity-detail';
  detail.textContent = message.activityType === 'command'
    ? 'Terminal'
    : message.activityType === 'files'
      ? formatActivityFileSummary(message.changes || [])
        : message.activityType === 'tool' ? (message.statusMessage || message.toolName || 'Project tool')
          : message.query || '';
  leading.append(icon, heading, detail);
  const trailing = document.createElement('span');
  trailing.className = 'activity-trailing';
  const statusText = document.createElement('span');
  statusText.className = 'activity-status';
  statusText.textContent = statusLabel(status);
  const chevron = document.createElement('span');
  chevron.className = 'activity-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  trailing.append(statusText, chevron);
  summary.append(leading, trailing);
  details.append(summary);
  if (message.activityType === 'command' && message.command) {
    const terminal = document.createElement('div');
    terminal.className = 'activity-terminal';
    const prompt = document.createElement('span');
    prompt.className = 'activity-terminal-prompt';
    prompt.setAttribute('aria-hidden', 'true');
    prompt.textContent = '›';
    const command = document.createElement('code');
    command.className = 'activity-command';
    command.textContent = message.command;
    terminal.append(prompt, command);
    details.append(terminal);
  }
  if (message.output) {
    const output = document.createElement('pre');
    output.className = 'activity-output';
    output.textContent = message.output;
    details.append(output);
  }
  if (message.activityType === 'files' && message.changes?.length) {
    const list = document.createElement('div');
    list.className = 'activity-files';
    for (const change of message.changes) {
      const row = document.createElement('div');
      row.className = 'activity-file-row';
      const prefix = document.createElement('span');
      prefix.className = 'file-status';
      const kind = typeof change.kind === 'string' ? change.kind : change.kind?.type || change.type || 'M';
      prefix.textContent = ({ add: 'A', added: 'A', delete: 'D', deleted: 'D', update: 'M', modified: 'M' })[String(kind).toLowerCase()] || String(kind).slice(0, 2);
      const label = document.createElement('span');
      label.className = 'activity-file-name';
      label.textContent = change.path || change.filePath || change.displayPath || 'Updated file';
      const stats = getFileLineStats(label.textContent);
      row.append(prefix, label);
      if (stats) {
        const lineStats = document.createElement('span');
        lineStats.className = 'change-file-stats';
        lineStats.innerHTML = `<span class="change-added">+${stats.added}</span><span class="change-removed">-${stats.removed}</span>`;
        row.append(lineStats);
      }
      list.append(row);
    }
    details.append(list);
  }
  return details;
}

function getFileLineStats(filePath) {
  const normalize = (value) => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').toLocaleLowerCase();
  let target = normalize(filePath);
  const root = normalize(state.workspace?.path || '').replace(/\/$/, '');
  if (root && target.startsWith(root + '/')) target = target.slice(root.length + 1);
  return (state.git?.entries || []).find((entry) => normalize(entry.path) === target) || null;
}

function formatActivityFileSummary(changes) {
  const paths = changes.map((change) => change.path || change.filePath || change.displayPath).filter(Boolean);
  const stats = paths.map(getFileLineStats).filter(Boolean);
  const added = stats.reduce((sum, entry) => sum + formatLineCount(entry.added), 0);
  const removed = stats.reduce((sum, entry) => sum + formatLineCount(entry.removed), 0);
  const uniqueFiles = new Set(paths).size;
  const fileLabel = `${uniqueFiles} ${uniqueFiles === 1 ? 'file' : 'files'}`;
  return stats.length ? `${fileLabel} · +${added} -${removed}` : fileLabel;
}

function renderMessage(message) {
  if (message.role === 'routing') {
    const note = document.createElement('div');
    note.className = 'routing-message';
    note.append(createModelIcon('auto-free', 'forge-free'));
    const copy = document.createElement('span');
    copy.textContent = message.text;
    note.append(copy);
    return note;
  }
  if (message.role === 'user') {
    const user = document.createElement('article');
    user.className = 'message user-message';
    const delegation = parseAgentAssignment(message.text);
    if (delegation) {
      user.classList.add('user-delegation-message');
      const kicker = document.createElement('span');
      kicker.className = 'delegation-kicker';
      kicker.textContent = 'Delegation requested';
      const heading = document.createElement('div');
      heading.className = 'delegation-heading';
      const name = document.createElement('strong');
      name.textContent = delegation.name;
      const role = document.createElement('span');
      role.textContent = delegation.role;
      heading.append(name, role);
      const task = document.createElement('p');
      task.textContent = delegation.task;
      const access = document.createElement('small');
      access.textContent = delegation.readOnly ? 'Read only' : 'Workspace permissions';
      user.append(kicker, heading, task, access);
    } else user.textContent = message.text;
    return user;
  }
  if (message.role === 'activity') return renderActivity(message);
  if (message.role === 'error') {
    const error = document.createElement('div');
    error.className = 'turn-error';
    error.textContent = message.text;
    return error;
  }
  if (message.role === 'plan') {
    const plan = document.createElement('div');
    plan.className = 'plan-message';
    plan.textContent = message.text;
    return plan;
  }
  const wrapper = document.createElement('article');
  wrapper.className = 'message assistant-wrap';
  const content = document.createElement('div');
  content.className = 'assistant-message';
  const proposedPlan = /<proposed_plan>/.test(message.text || '');
  if (proposedPlan) {
    content.classList.add('proposed-plan');
    const label = document.createElement('span');
    label.className = 'plan-kicker';
    label.textContent = 'Implementation plan';
    content.append(label);
    const body = document.createElement('div');
    body.innerHTML = renderMarkdown(message.text.replace(/<\/?proposed_plan>/g, ''));
    content.append(body);
  } else content.innerHTML = message.text ? renderMarkdown(message.text) : '';
  wrapper.append(content);
  return wrapper;
}

function parseAgentAssignment(text) {
  const lines = String(text || '').split('\n', 3);
  if (!lines[0]?.startsWith('Delegate task: ') || !lines[1]?.startsWith('{')) return null;
  try {
    const data = JSON.parse(lines[1]);
    if (!data || typeof data.name !== 'string' || typeof data.role !== 'string' || typeof data.task !== 'string' || typeof data.readOnly !== 'boolean') return null;
    return data;
  } catch { return null; }
}

function renderLiveProgress() {
  const status = document.createElement('div');
  status.className = 'assistant-progress';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const mark = createOpenAIMark();
  mark.classList.add('assistant-progress-mark');
  mark.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('span');
  copy.className = 'assistant-progress-copy';
  copy.textContent = state.activityStatus || 'Starting task';
  const live = document.createElement('span');
  live.className = 'assistant-progress-live';
  live.textContent = 'LIVE';
  status.append(mark, copy, live);
  return status;
}

function setActivityStatus(label) {
  if (label) state.activityStatus = label;
}

function activityText(value, maximum = 74) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maximum ? text.slice(0, maximum - 1) + '…' : text;
}

function activityStatusForItem(item) {
  if (item?.statusMessage) return item.statusMessage;
  switch (item?.type) {
    case 'commandExecution': {
      const command = Array.isArray(item.command) ? item.command.join(' ') : item.command;
      return command ? 'Running ' + activityText(command, 82) : 'Running a terminal command';
    }
    case 'fileChange': {
      const files = (item.changes || []).map((change) => change.path || change.filePath || change.displayPath).filter(Boolean);
      return files.length ? 'Editing ' + activityText(files.join(', '), 78) : 'Applying file changes';
    }
    case 'webSearch': return item.query ? 'Searching the web for ' + activityText(item.query, 62) : 'Searching the web';
    case 'anthropicTool': return 'Using ' + (item.toolName || 'a project tool');
    case 'anthropicAgentActivity': return 'Starting ' + (item.name || 'a Claude') + ' agent';
    case 'collabAgentToolCall':
    case 'collab_tool_call':
    case 'collabToolCall': {
      const task = item.prompt || item.task || item.description;
      return task ? 'Delegating · ' + activityText(task, 72) : 'Starting a helper agent';
    }
    case 'subAgentActivity':
    case 'sub_agent_activity': return 'Agent · ' + activityText(item.kind || 'working');
    case 'agentMessage': return 'Writing the response';
    case 'reasoning':
    case 'reasoningSummary': return 'Reviewing the task context';
    default: return 'Inspecting the project';
  }
}

function completedActivityStatus(item) {
  if (item?.type === 'agentMessage') return 'Response complete';
  if (item?.type === 'commandExecution') {
    const command = Array.isArray(item.command) ? item.command.join(' ') : item.command;
    const status = item.exitCode === 0 ? ' · exited successfully' : Number.isInteger(item.exitCode) ? ' · exit ' + item.exitCode : '';
    return 'Finished ' + (activityText(command, 64) || 'terminal command') + status;
  }
  if (item?.type === 'fileChange') {
    const files = (item.changes || []).map((change) => change.path || change.filePath || change.displayPath).filter(Boolean);
    return files.length ? 'Updated ' + activityText(files.join(', '), 80) : 'File changes applied';
  }
  if (item?.type === 'webSearch') return 'Finished web search' + (item.query ? ' · ' + activityText(item.query, 62) : '');
  if (item?.type === 'anthropicTool') return 'Finished ' + (item.toolName || 'project tool');
  if (item?.type === 'anthropicAgentActivity') return (item.name || 'Agent') + ' finished its task';
  return 'Finished the current action';
}

function renderMessages(forceTop = false) {
  const list = $('#message-list');
  const scroll = $('#conversation-scroll');
  const wasNearBottom = !forceTop && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 180;
  const agents = state.messages.filter((message) => message.role === 'activity' && message.activityType === 'agent');
  const activeAgents = agents.filter((message) => agentGroupFor(message) === 'active').length;
  const agentCount = $('#agent-live-count');
  if (agentCount) {
    agentCount.hidden = agents.length === 0;
    agentCount.textContent = `${activeAgents} ${activeAgents === 1 ? 'agent' : 'agents'} active`;
    agentCount.classList.toggle('idle', activeAgents === 0);
  }
  renderAgentOrganizer();
  const firstVisibleMessage = Math.max(0, state.messages.length - state.historyVisibleCount);
  const visibleMessages = state.messages.slice(firstVisibleMessage).map(renderMessage);
  if (state.isBusy || state.pendingSend) visibleMessages.push(renderLiveProgress());
  if (firstVisibleMessage > 0) {
    const earlier = document.createElement('button');
    earlier.type = 'button';
    earlier.className = 'load-older-messages';
    earlier.textContent = `Load ${Math.min(60, firstVisibleMessage)} earlier messages`;
    earlier.addEventListener('click', () => {
      const previousHeight = scroll.scrollHeight;
      const previousTop = scroll.scrollTop;
      state.historyVisibleCount += 60;
      renderMessages();
      requestAnimationFrame(() => { scroll.scrollTop = previousTop + scroll.scrollHeight - previousHeight; });
    });
    visibleMessages.unshift(earlier);
  }
  list.replaceChildren(...visibleMessages);
  const slot = $('#approval-slot');
  slot.replaceChildren(...state.approvals.map(renderApproval));
  if (forceTop) requestAnimationFrame(() => { scroll.scrollTop = 0; });
  else if (wasNearBottom) requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
}

function addOrUpdateAssistant(params, delta) {
  if (state.threadId && params.threadId && params.threadId !== state.threadId) return;
  if (!state.threadId && state.pendingSend && params.threadId) state.threadId = params.threadId;
  if (!state.threadId && params.threadId) return;
  let message = state.messages.find((item) => item.role === 'assistant' && item.turnId === params.turnId && item.id === params.itemId);
  if (!message) {
    message = state.messages.find((item) => item.role === 'assistant' && !item.turnId && item.pending);
    if (message) { message.id = params.itemId || message.id; message.turnId = params.turnId; }
    else {
      message = { id: params.itemId || `assistant-${params.turnId}`, turnId: params.turnId, role: 'assistant', text: '', pending: true };
      state.messages.push(message);
    }
  }
  message.text += delta;
  message.pending = true;
  renderSurface();
}

function upsertActivity(item, turnId) {
  if (!item?.id) return;
  let activityType = 'activity';
  if (item.type === 'commandExecution') activityType = 'command';
  else if (item.type === 'fileChange') activityType = 'files';
  else if (item.type === 'webSearch') activityType = 'search';
  else if (item.type === 'anthropicTool') activityType = 'tool';
  else return;
  const existing = state.messages.find((message) => message.role === 'activity' && message.id === item.id);
  const next = {
    id: item.id,
    turnId,
    role: 'activity',
    activityType,
    command: item.command || '',
    output: item.aggregatedOutput || '',
    changes: item.changes || [],
    query: item.query || '',
    toolName: item.toolName || '',
    input: item.input || null,
    statusMessage: item.statusMessage || '',
    status: itemStatus(item),
    exitCode: item.exitCode,
  };
  if (existing) Object.assign(existing, next);
  else state.messages.push(next);
}

function agentStateLabel(value) {
  const raw = typeof value === 'string' ? value : value?.status || value?.type || '';
  const normalized = String(raw).replace(/[_-]/g, '').toLowerCase();
  return ({ pendinginit: 'pendingInit', running: 'running', completed: 'completed', errored: 'errored', failed: 'errored', interrupted: 'interrupted', shutdown: 'shutdown', notfound: 'notFound', inprogress: 'running' })[normalized] || raw || 'running';
}

function upsertAgent(message) {
  const existing = state.messages.find((candidate) => candidate.role === 'activity' && candidate.activityType === 'agent' && candidate.agentId === message.agentId);
  if (existing) Object.assign(existing, message);
  else state.messages.push({ role: 'activity', activityType: 'agent', ...message });
}

function upsertAgentCall(item, turnId) {
  const callId = item.id || `agent-call-${turnId || Date.now()}`;
  const states = item.agents_states || item.agentsStates || {};
  const refs = Array.isArray(item.receiver_agents) ? item.receiver_agents : Array.isArray(item.receiverAgents) ? item.receiverAgents : [];
  const ids = item.receiver_thread_ids || item.receiverThreadIds || [];
  const recipients = refs.map((ref, index) => ({
    ref,
    id: ref.thread_id || ref.threadId || ref.id || ids[index] || '',
  }));
  for (const id of ids) if (id && !recipients.some((recipient) => recipient.id === id)) recipients.push({ id, ref: {} });
  const callStatus = agentStateLabel(item.status);
  if (!recipients.length) {
    if (item.tool === 'spawnAgent' || item.tool === 'spawn_agent') {
      upsertAgent({
        id: `agent-pending-${callId}`,
        callId,
        agentId: `pending-${callId}`,
        name: 'Starting agent',
        task: item.prompt || 'Preparing a delegated task',
        status: callStatus,
      });
    }
    for (const message of state.messages.filter((candidate) => candidate.role === 'activity' && candidate.activityType === 'agent' && candidate.callId === callId)) {
      message.status = callStatus;
    }
    return;
  }
  state.messages = state.messages.filter((message) => !(message.role === 'activity' && message.activityType === 'agent' && message.callId === callId && String(message.agentId).startsWith('pending-')));
  recipients.forEach(({ id, ref }, index) => {
    const lookupId = id || `agent-${index + 1}-${callId}`;
    const agentState = states[lookupId] || states[id] || {};
    const nestedStatus = agentStateLabel(agentState);
    const status = nestedStatus === 'running' && callStatus !== 'running' ? callStatus : nestedStatus;
    const fallbackName = refs.length > 1 ? `Agent ${index + 1}` : 'Codex agent';
    upsertAgent({
      id: `agent-${lookupId}`,
      callId,
      agentId: lookupId,
      name: ref.nickname || ref.name || ref.agent_name || ref.agentName || fallbackName,
      roleName: ref.role || ref.agent_role || ref.agentRole || '',
      task: item.prompt || '',
      status,
      statusMessage: agentState.message || '',
    });
  });
}

function upsertSubAgentActivity(item, turnId) {
  const agentId = item.agent_thread_id || item.agentThreadId;
  if (!agentId) return;
  const kind = String(item.kind || 'working').replaceAll('_', ' ');
  const key = String(item.kind || '').toLowerCase();
  const status = /complete|finish|ended/.test(key) ? 'completed' : /fail|error/.test(key) ? 'errored' : /interrupt|stop/.test(key) ? 'interrupted' : 'running';
  const path = item.agent_path || item.agentPath || '';
  const name = Array.isArray(path) ? path.at(-1) : String(path).split(/[/.]/).filter(Boolean).at(-1);
  const prior = state.messages.find((message) => message.role === 'activity' && message.activityType === 'agent' && message.agentId === agentId);
  upsertAgent({
    id: item.id || `agent-${agentId}-${turnId || ''}`,
    callId: prior?.callId || '',
    agentId,
    name: name || prior?.name || 'Codex agent',
    roleName: prior?.roleName || '',
    task: prior?.task || '',
    status,
    statusMessage: status === 'running' ? `Active · ${kind}` : `Agent ${kind}`,
    activityKind: kind,
  });
}

function upsertAgentItem(item, turnId) {
  if (item?.type === 'collabAgentToolCall' || item?.type === 'collab_tool_call' || item?.type === 'collabToolCall') upsertAgentCall(item, turnId);
  else if (item?.type === 'subAgentActivity' || item?.type === 'sub_agent_activity') upsertSubAgentActivity(item, turnId);
  else if (item?.type === 'anthropicAgentActivity') upsertAgent({
    id: item.id || ('agent-' + item.agentId),
    callId: item.callId || item.id || '',
    agentId: item.agentId || item.id,
    name: item.name || 'Claude agent',
    roleName: item.roleName || '',
    task: item.task || '',
    status: agentStateLabel(item.status || 'running'),
    statusMessage: item.statusMessage || '',
  });
}

function handleCodexEvent(event) {
  if (event.type === 'connection') {
    if (!event.connected) {
      const retryOnce = !state.account?.connectionError;
      state.account = { ...(state.account || {}), connected: false, connectionError: true };
      renderAccount();
      if (retryOnce) setTimeout(() => refreshState({ quiet: true }), 1000);
    }
    return;
  }
  if (event.type === 'diagnostic') {
    showToast(event.message || 'Codex reported a startup issue.', 'error');
    return;
  }
  if (event.type === 'server-request') {
    if (state.threadId && event.params?.threadId && event.params.threadId !== state.threadId) return;
    if (!state.threadId && state.pendingSend && event.params?.threadId) state.threadId = event.params.threadId;
    setActivityStatus('Waiting for your approval');
    state.approvals.push(event);
    renderSurface();
    $('#conversation-scroll').scrollTop = $('#conversation-scroll').scrollHeight;
    return;
  }
  if (event.type !== 'notification') return;
  const params = event.params || {};
  const method = event.method;
  if (method === 'routing/model/selected') {
    state.freeRouting.lastRoute = params.route;
    if (state.threadProviderId === 'forge-free') {
      const label = `${params.route.provider === 'nvidia' ? 'NVIDIA NIM' : 'OpenRouter free'} · ${params.route.name}`;
      const previous = state.messages.at(-1);
      if (previous?.role !== 'routing' || previous.text !== label) state.messages.push({ role: 'routing', text: label });
      setActivityStatus(`Using ${params.route.name}`);
      renderAccount();
      renderSurface();
    }
    renderFreeRoutingSettings();
    return;
  }
  if (method === 'routing/fallback/starting') {
    if (params.threadId !== state.threadId) return;
    state.fallbackSourceThreadId = params.threadId;
    state.messages.push({ role: 'routing', text: params.reason });
    state.isBusy = true;
    setActivityStatus('Preparing a continuation with Free Auto Route');
    renderSurface();
    return;
  }
  if (method === 'routing/fallback/started') {
    if (params.threadId !== state.threadId && params.threadId !== state.fallbackSourceThreadId) return;
    state.fallbackSourceThreadId = params.threadId;
    state.threadId = params.newThreadId;
    state.threadProviderId = 'forge-free';
    state.activeTurnId = null;
    state.approvals = [];
    selectFreeRouteModel();
    state.messages.push({ role: 'routing', text: 'Continued in a Free Auto Route session with the previous conversation and completed work as context.' });
    renderSurface();
    return;
  }
  if (method === 'routing/fallback/failed') {
    if (params.threadId !== state.threadId && params.threadId !== state.fallbackSourceThreadId) return;
    state.isBusy = false;
    state.pendingSend = false;
    state.activeTurnId = null;
    state.fallbackSourceThreadId = null;
    for (const message of state.messages) if (message.role === 'assistant') message.pending = false;
    state.messages.push({ role: 'error', text: params.message });
    renderSurface();
    return;
  }
  if (params.threadId && (/^item\//.test(method || '') || /^turn\//.test(method || ''))) state.threadHistoryCache.delete(params.threadId);
  if (method === 'account/updated' || method === 'account/rateLimits/updated') {
    refreshState({ quiet: true });
    return;
  }
  if (method === 'thread/started' && params.thread?.id && state.pendingSend && !state.threadId) {
    state.threadId = params.thread.id;
    state.threadProviderId = params.thread.modelProvider || 'openai';
    setTimeout(() => refreshState({ quiet: true }), 250);
    return;
  }
  if (method === 'thread/name/updated' || method === 'thread/nameUpdated') {
    if (!params.threadId || params.threadId === state.threadId) {
      state.threadName = params.name || params.thread?.name || state.threadName;
      renderSurface();
    }
    return;
  }
  if (method === 'turn/diff/updated') {
    if (!state.threadId || params.threadId === state.threadId) {
      state.diff = params.diff || '';
      renderContext();
    }
    return;
  }
  if (method === 'activity/status') {
    if (state.threadId && params.threadId !== state.threadId) return;
    setActivityStatus(params.status);
    renderSurface();
    return;
  }
  if (method === 'agent/status/updated') {
    if (state.threadId && params.threadId !== state.threadId) return;
    const agent = state.messages.find((message) => message.role === 'activity' && message.activityType === 'agent' && message.agentId === params.agentId);
    if (agent) {
      if (params.statusMessage) agent.statusMessage = params.statusMessage;
      if (params.status) agent.status = agentStateLabel(params.status);
      renderSurface();
    }
    return;
  }
  if (method === 'turn/plan/updated') {
    if (state.threadId && params.threadId !== state.threadId) return;
    const planText = params.explanation || (params.plan || []).map((step) => `${step.status === 'completed' ? '✓' : '○'} ${step.step}`).join('\n');
    if (planText) {
      const activeStep = (params.plan || []).find((step) => !/completed|done/i.test(String(step.status || '')));
      setActivityStatus(activeStep?.step ? 'Working on · ' + activityText(activeStep.step, 82) : 'Updating the task plan');
      const existing = state.messages.find((message) => message.role === 'plan' && message.turnId === params.turnId);
      if (existing) existing.text = planText;
      else state.messages.push({ id: `plan-${params.turnId}`, turnId: params.turnId, role: 'plan', text: planText });
      renderSurface();
    }
    return;
  }
  if (method === 'item/agentMessage/delta') {
    setActivityStatus('Writing a response');
    addOrUpdateAssistant(params, params.delta || '');
    return;
  }
  if (method === 'commandExecution/outputDelta' || method === 'commandExecution/terminalInteraction') {
    if (state.threadId && params.threadId !== state.threadId) return;
    let activity = state.messages.find((message) => message.role === 'activity' && message.id === params.itemId);
    const command = params.command || activity?.command || '';
    setActivityStatus(command ? 'Running ' + activityText(Array.isArray(command) ? command.join(' ') : command, 82) : 'Reading command output');
    if (!activity) { activity = { id: params.itemId, role: 'activity', activityType: 'command', command: params.command || '', output: '', status: 'inProgress' }; state.messages.push(activity); }
    activity.output = `${activity.output || ''}${params.delta || params.text || ''}`;
    renderSurface();
    return;
  }
  if (method === 'item/started') {
    if (state.threadId && params.threadId !== state.threadId) return;
    setActivityStatus(activityStatusForItem(params.item));
    if (params.item?.type === 'commandExecution' || params.item?.type === 'fileChange' || params.item?.type === 'anthropicTool') upsertActivity(params.item, params.turnId);
    upsertAgentItem(params.item, params.turnId);
    if (params.item?.type === 'agentMessage') {
      let message = state.messages.find((candidate) => candidate.role === 'assistant' && candidate.turnId === params.turnId && candidate.id === params.item.id);
      if (!message) {
        message = state.messages.find((candidate) => candidate.role === 'assistant' && !candidate.turnId && candidate.pending);
        if (message) { message.id = params.item.id; message.turnId = params.turnId; }
        else { message = { id: params.item.id, turnId: params.turnId, role: 'assistant', text: '', pending: true }; state.messages.push(message); }
      }
    }
    renderSurface();
    return;
  }
  if (method === 'item/completed') {
    if (state.threadId && params.threadId !== state.threadId) return;
    const item = params.item || {};
    setActivityStatus(completedActivityStatus(item));
    if (item.type === 'agentMessage') {
      let message = state.messages.find((candidate) => candidate.role === 'assistant' && candidate.turnId === params.turnId && candidate.id === item.id);
      if (!message) { message = { id: item.id, turnId: params.turnId, role: 'assistant', text: '' }; state.messages.push(message); }
      if (item.text) message.text = item.text;
      message.pending = false;
    } else if (item.type === 'commandExecution' || item.type === 'fileChange' || item.type === 'webSearch' || item.type === 'anthropicTool') upsertActivity(item, params.turnId);
    upsertAgentItem(item, params.turnId);
    renderSurface();
    return;
  }
  if (method === 'turn/started') {
    if (!state.threadId && state.pendingSend) state.threadId = params.threadId;
    if (state.threadId && params.threadId !== state.threadId) return;
    state.activeTurnId = params.turn?.id || params.turnId || state.activeTurnId;
    const latestPrompt = [...state.messages].reverse().find((message) => message.role === 'user')?.text;
    setActivityStatus(latestPrompt ? 'Starting · ' + activityText(latestPrompt, 76) : 'Inspecting the project');
    state.isBusy = true;
    renderSurface();
    return;
  }
  if (method === 'turn/completed' || method === 'turn/failed' || method === 'turn/interrupted') {
    if (state.threadId && params.threadId !== state.threadId) return;
    state.isBusy = false;
    state.pendingSend = false;
    state.activeTurnId = null;
    state.activityStatus = 'Ready for your next task';
    state.approvals = state.approvals.filter((request) => request.params?.threadId !== state.threadId);
    for (const message of state.messages) if (message.role === 'assistant' && message.turnId === params.turn?.id) message.pending = false;
    const turnError = params.turn?.error || params.error;
    if (turnError) {
      const errorText = turnError.message || turnError.codexErrorInfo || 'Codex could not complete this task.';
      state.messages.push({ role: 'error', text: typeof errorText === 'string' ? errorText : JSON.stringify(errorText) });
    } else if (method === 'turn/failed') {
      state.messages.push({ role: 'error', text: 'Codex could not complete this task.' });
    }
    renderSurface();
    state.treeCache.clear();
    if (state.workspace) void loadTree('');
    refreshState({ quiet: true });
  }
}

function renderApproval(event) {
  const card = document.createElement('section');
  card.className = 'approval-card';
  const method = event.method || '';
  const params = event.params || {};
  const isCommand = method === 'commandExecution/requestApproval';
  const isFile = method === 'fileChange/requestApproval';
  const isQuestion = method === 'tool/requestUserInput';
  const isAnthropic = method === 'anthropic/tool/requestApproval';
  const title = document.createElement('div');
  title.className = 'approval-topline';
  const mark = document.createElement('span');
  mark.textContent = isAnthropic ? 'A' : '◈';
  const titleText = isAnthropic
    ? 'Claude wants permission · ' + (params.toolName || 'project tool')
    : isCommand ? 'Codex wants to run a command' : isFile ? 'Codex needs approval for file changes' : isQuestion ? 'Codex has a question' : 'Codex is requesting extra access';
  title.append(mark, document.createTextNode(titleText));
  card.append(title);
  if (isCommand) {
    const command = document.createElement('pre');
    command.className = 'approval-command';
    command.textContent = Array.isArray(params.command) ? params.command.join(' ') : params.command || 'Review the requested command in Codex.';
    card.append(command);
    if (params.cwd) {
      const cwd = document.createElement('p');
      cwd.textContent = `Working directory · ${params.cwd}`;
      card.append(cwd);
    }
  } else if (isFile) {
    const note = document.createElement('p');
    note.textContent = params.reason || 'Review and approve the proposed change before it is applied.';
    card.append(note);
  } else if (isAnthropic) {
    const note = document.createElement('p');
    note.textContent = params.title || 'Review Claude’s requested action before it runs.';
    card.append(note);
    const input = document.createElement('pre');
    input.className = 'approval-command';
    input.textContent = JSON.stringify(params.input || {}, null, 2).slice(0, 6000);
    card.append(input);
    if (params.blockedPath) {
      const pathNote = document.createElement('p');
      pathNote.textContent = 'Requested path · ' + params.blockedPath;
      card.append(pathNote);
    }
  } else if (isQuestion) {
    for (const question of params.questions || []) {
      const wrap = document.createElement('div');
      wrap.className = 'approval-question';
      wrap.dataset.questionId = question.id;
      const label = document.createElement('strong');
      label.textContent = question.question;
      wrap.append(label);
      if (question.options?.length) {
        question.options.forEach((option, index) => {
          const choice = document.createElement('label');
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = `question-${event.id}-${question.id}`;
          radio.value = option.label;
          radio.checked = index === 0;
          const optionLabel = document.createElement('span');
          optionLabel.textContent = option.label;
          choice.append(radio, optionLabel);
          wrap.append(choice);
        });
      }
      if (!question.options?.length || question.options.some((option) => option.label.toLowerCase() === 'other')) {
        const other = document.createElement('input');
        other.type = question.isSecret ? 'password' : 'text';
        other.className = 'answer-other';
        other.placeholder = 'Write another answer…';
        wrap.append(other);
      }
      card.append(wrap);
    }
  } else {
    const note = document.createElement('p');
    note.className = 'approval-unhandled';
    note.textContent = params.reason || 'This permission request is not supported by Forge yet. You can decline it here.';
    card.append(note);
  }
  const actions = document.createElement('div');
  actions.className = 'approval-actions';
  const addButton = (label, className, decision) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = className;
    button.dataset.approvalId = String(event.id);
    button.dataset.decision = decision;
    actions.append(button);
  };
  if (isAnthropic) {
    addButton('Allow once', 'approval-allow', 'accept');
    if (params.suggestions?.length) addButton('Allow for this session', '', 'acceptForSession');
    addButton('Decline', 'approval-deny', 'decline');
  } else if (isQuestion) addButton('Send answer', 'approval-allow', 'answer');
  else if (isCommand || isFile) {
    addButton('Allow once', 'approval-allow', 'accept');
    addButton('Allow for this session', '', 'acceptForSession');
    addButton('Decline', 'approval-deny', 'decline');
  } else addButton('Decline request', 'approval-deny', 'decline');
  card.append(actions);
  return card;
}

async function answerApproval(id, decision) {
  const event = state.approvals.find((request) => String(request.id) === String(id));
  if (!event) return;
  try {
    let body = { id, decision };
    if (decision === 'answer') {
      const answers = {};
      for (const question of event.params?.questions || []) {
        const wrap = $(`.approval-question[data-question-id="${CSS.escape(question.id)}"]`);
        const selected = wrap?.querySelector('input[type="radio"]:checked')?.value;
        const other = wrap?.querySelector('.answer-other')?.value.trim();
        answers[question.id] = { answers: [other || selected || ''] };
      }
      body = { id, answers };
    }
    await api('/api/approval', { method: 'POST', body });
    state.approvals = state.approvals.filter((request) => String(request.id) !== String(id));
    renderMessages();
  } catch (error) { showToast(error.message, 'error'); }
}

function cacheThreadHistory(threadId, result) {
  state.threadHistoryCache.delete(threadId);
  state.threadHistoryCache.set(threadId, { result, cachedAt: Date.now() });
  while (state.threadHistoryCache.size > 12) state.threadHistoryCache.delete(state.threadHistoryCache.keys().next().value);
}

function captureThreadView() {
  return {
    threadId: state.threadId,
    threadProviderId: state.threadProviderId,
    threadName: state.threadName,
    messages: state.messages,
    historyVisibleCount: state.historyVisibleCount,
    workspace: state.workspace,
    approvals: state.approvals,
    activeTurnId: state.activeTurnId,
    isBusy: state.isBusy,
    pendingSend: state.pendingSend,
    selectedFile: state.selectedFile,
    activeContextTab: state.activeContextTab,
    diff: state.diff,
  };
}

function applyThreadResult(result, { keepScroll = false } = {}) {
  const previousPath = state.workspace?.path || '';
  const nextWorkspace = result.workspace || state.workspace;
  const nextPath = nextWorkspace?.path || '';
  const workspaceChanged = previousPath.toLowerCase() !== nextPath.toLowerCase();
  state.threadId = result.thread.id;
  state.threadProviderId = result.thread.modelProvider || 'openai';
  const selectedModel = state.models.find((model) => model.id === state.modelId);
  const selectedProviderId = selectedModel?.providerId || 'openai';
  if (selectedProviderId !== state.threadProviderId) {
    const sameProviderModel = state.models.find((model) => (model.providerId || 'openai') === state.threadProviderId && (model.isDefault || !model.providerId));
    const nextModel = sameProviderModel || state.models.find((model) => model.providerId === state.threadProviderId);
    if (nextModel) {
      state.modelId = nextModel.id;
      localStorage.setItem('forge.model', nextModel.id);
    }
  }
  state.threadName = result.thread.name || 'Untitled session';
  state.workspace = nextWorkspace;
  state.messages = (result.messages || []).filter((message) => message.role !== 'agent-event');
  state.historyVisibleCount = 60;
  for (const event of (result.messages || []).filter((message) => message.role === 'agent-event')) upsertAgentItem(event.item, event.turnId);
  state.approvals = [];
  state.activeTurnId = null;
  state.isBusy = false;
  state.pendingSend = false;
  state.diff = '';
  state.threadLoading = false;
  state.threadLoadOrigin = null;
  if (workspaceChanged) {
    state.selectedFile = null;
    state.treeCache.clear();
    state.expandedDirs.clear();
    state.activeContextTab = 'files';
  }
  if (!keepScroll) $('#conversation-scroll').scrollTop = 0;
  renderAll();
  if (state.workspace) void loadTree('');
}

async function refreshThreadInBackground(threadId, version) {
  try {
    const result = await api('/api/threads/open', { method: 'POST', body: { threadId } });
    cacheThreadHistory(threadId, result);
    if (state.threadOpenVersion === version && state.threadId === threadId && !state.isBusy && !state.pendingSend) applyThreadResult(result, { keepScroll: true });
  } catch { /* Keep the cached conversation visible when background refresh is unavailable. */ }
}

async function openThread(threadId) {
  if (state.isBusy) { showToast('Stop the active task before switching sessions.'); return; }
  if (threadId === state.threadId && !state.threadLoading) return;
  const version = ++state.threadOpenVersion;
  const cached = state.threadHistoryCache.get(threadId);
  const origin = state.threadLoading && state.threadLoadOrigin ? state.threadLoadOrigin : captureThreadView();
  state.threadLoadOrigin = origin;
  state.threadId = threadId;
  state.threadProviderId = state.threads?.find((thread) => thread.id === threadId)?.modelProvider || null;
  state.threadName = state.threads?.find((thread) => thread.id === threadId)?.name || 'Opening session';
  state.threadLoading = true;
  state.messages = [];
  state.historyVisibleCount = 60;
  state.approvals = [];
  state.activeTurnId = null;
  state.pendingSend = false;
  state.diff = '';
  renderAll();

  if (cached) {
    state.threadHistoryCache.delete(threadId);
    state.threadHistoryCache.set(threadId, cached);
    applyThreadResult(cached.result);
    if (Date.now() - cached.cachedAt > 15000) void refreshThreadInBackground(threadId, version);
    return;
  }

  try {
    const result = await api('/api/threads/open', { method: 'POST', body: { threadId } });
    cacheThreadHistory(threadId, result);
    if (state.threadOpenVersion !== version || state.threadId !== threadId) return;
    applyThreadResult(result);
  } catch (error) {
    if (state.threadOpenVersion !== version || state.threadId !== threadId) return;
    const previous = state.threadLoadOrigin;
    state.threadId = previous.threadId;
    state.threadProviderId = previous.threadProviderId;
    state.threadName = previous.threadName;
    state.messages = previous.messages;
    state.historyVisibleCount = previous.historyVisibleCount;
    state.workspace = previous.workspace;
    state.approvals = previous.approvals;
    state.activeTurnId = previous.activeTurnId;
    state.isBusy = previous.isBusy;
    state.pendingSend = previous.pendingSend;
    state.selectedFile = previous.selectedFile;
    state.activeContextTab = previous.activeContextTab;
    state.diff = previous.diff;
    state.threadLoading = false;
    state.threadLoadOrigin = null;
    renderAll();
    showToast(error.message, 'error');
  }
}

async function sendMessage(textOverride, { readOnlyOverride, routingText } = {}) {
  if (state.isBusy) return;
  if (state.threadLoading) { showToast('Wait for the selected session to finish opening.'); return; }
  if (!state.workspace) { openWorkspaceDialog(); return; }
  let selectedModel = state.models.find((model) => model.id === state.modelId);
  const textarea = $('#prompt-input');
  const text = String(textOverride ?? textarea.value).trim();
  if (!text) return;
  if (!selectedModel) {
    showToast(state.autoModelRouting ? 'Automatic routing needs a GPT-6 model in your Codex account. No GPT-5.6 fallback was used.' : 'Choose an available model before sending.', 'error');
    return;
  }
  let automaticRoute = null;
  if (state.autoModelRouting && (!selectedModel.providerId || selectedModel.providerId === 'openai')) {
    automaticRoute = chooseAutomaticModel(routingText ?? text, !state.threadId);
    if (!automaticRoute) {
      showToast('Automatic routing needs a GPT-6 model in your Codex account. No GPT-5.6 fallback was used.', 'error');
      return;
    }
    selectedModel = automaticRoute.model;
    state.modelId = selectedModel.id;
    localStorage.setItem('forge.model', selectedModel.id);
    renderModelPicker();
    renderEfforts();
    updateModelRoutingUI();
  }
  const usesAnthropic = selectedModel.providerId === 'anthropic';
  if (!usesAnthropic && !selectedModel.providerId && !state.account?.connected) { showToast('Connect your ChatGPT account before sending a Codex task.'); setModal('login-modal', true); return; }
  if (selectedModel.providerId === 'forge-free' && (!state.freeRouting.openrouterConfigured || !state.freeRouting.nvidiaConfigured)) { showToast('Save both routing API keys in Settings first.'); window.ForgeTheme.open(); return; }
  if (usesAnthropic && !state.anthropic?.available) { showToast('Install Claude Code, then reopen Model providers to connect your Claude subscription.'); setModal('providers-modal', true); return; }
  state.pendingSend = true;
  state.isBusy = true;
  state.activityStatus = automaticRoute ? `Auto · ${selectedModel.name} · ${automaticRoute.reason}` : 'Starting task';
  state.messages.push({ id: `user-${Date.now()}`, role: 'user', text });
  state.messages.push({ id: `pending-${Date.now()}`, role: 'assistant', turnId: null, text: '', pending: true });
  textarea.value = '';
  resizeComposer();
  const assignment = parseAgentAssignment(text);
  state.threadName ||= (assignment ? `Delegate ${assignment.name}` : text.replace(/\s+/g, ' ')).slice(0, 64);
  renderSurface();
  try {
    const result = await api('/api/messages', { method: 'POST', body: {
      threadId: state.threadId,
      text,
      model: selectedModel.providerModel || state.modelId,
      providerId: selectedModel.providerId || 'openai',
      providerModel: selectedModel.providerModel || '',
      effort: state.effort,
      readOnly: $('#access-select').value === 'plan' || (readOnlyOverride ?? ($('#access-select').value === 'read')),
      planningMode: $('#access-select').value === 'plan',
    } });
    state.threadId = result.threadId;
    state.threadProviderId = result.providerId || 'openai';
    if (result.providerId === 'forge-free') {
      selectFreeRouteModel();
      if (selectedModel.providerId !== 'forge-free') state.messages.push({ role: 'routing', text: 'Codex limit reached. This task is continuing with Free Auto Route.' });
    }
    state.activeTurnId = result.turnId;
    for (const message of state.messages) if (message.role === 'assistant' && !message.turnId) message.turnId = result.turnId;
    renderSurface();
    $('#prompt-input').focus();
    return true;
  } catch (error) {
    state.isBusy = false;
    state.pendingSend = false;
    state.activeTurnId = null;
    state.messages = state.messages.filter((message) => message.role !== 'assistant' || message.turnId || message.text);
    state.messages.push({ role: 'error', text: error.message });
    renderSurface();
    showToast(error.message, 'error');
    return false;
  }
}

async function interruptTurn() {
  if (state.fallbackSourceThreadId && !state.activeTurnId) {
    try { await api('/api/interrupt', { method: 'POST', body: { threadId: state.fallbackSourceThreadId } }); }
    catch (error) { showToast(error.message, 'error'); }
    return;
  }
  if (!state.threadId || !state.activeTurnId) { showToast('The current task is still starting.'); return; }
  try {
    await api('/api/interrupt', { method: 'POST', body: { threadId: state.threadId, turnId: state.activeTurnId } });
    showToast('Stop requested.');
  } catch (error) { showToast(error.message, 'error'); }
}

function updateComposerState() {
  const selectedModel = state.models.find((model) => model.id === state.modelId);
  const canUseSelectedProvider = Boolean(selectedModel?.providerId || state.account?.connected);
  $('#send-button').disabled = !state.workspace || !canUseSelectedProvider || state.isBusy || state.threadLoading;
  $('#stop-turn').hidden = !state.isBusy;
  $('#prompt-input').disabled = state.isBusy || state.threadLoading;
  $('#plan-build').disabled = state.isBusy || state.threadLoading;
}

function resizeComposer() {
  const textarea = $('#prompt-input');
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
}

function setContextTab(tab, { toggle = false } = {}) {
  if (!['files', 'changes', 'agents'].includes(tab)) return;
  const shell = $('.app-shell');
  const selected = state.activeContextTab === tab || (tab === 'files' && state.activeContextTab === 'preview');
  if (toggle && selected && !shell.classList.contains('context-hidden')) {
    shell.classList.add('context-hidden');
    renderContext();
    return;
  }
  state.activeContextTab = tab;
  shell.classList.remove('context-hidden');
  renderContext();
}

function openAgentAssignment() {
  if (!state.workspace) { openWorkspaceDialog(); return; }
  if (state.isBusy || state.threadLoading) { showToast('Wait for this task to finish before delegating more work.'); return; }
  $('#agent-assign-error').hidden = true;
  syncAgentAssignmentAccess();
  setModal('agent-assign-modal', true);
}

function syncAgentAssignmentAccess() {
  const readOnly = $('#access-select').value === 'read' || $('#agent-assign-role').value !== 'Developer';
  $('#agent-assign-access').textContent = readOnly ? 'Read only · This task can inspect files and report findings.' : 'Code mode · This task can edit files within your workspace permissions.';
}

async function assignSubagent(event) {
  event.preventDefault();
  const name = $('#agent-assign-name').value.trim();
  const task = $('#agent-assign-task').value.trim();
  const role = $('#agent-assign-role').value;
  const error = $('#agent-assign-error');
  if (!name || !task) return;
  if (state.isBusy || state.threadLoading) { error.textContent = 'Wait for the current task to finish, then delegate this task.'; error.hidden = false; return; }
  const readOnly = $('#access-select').value === 'read' || role !== 'Developer';
  const text = `Delegate task: ${name}\n${JSON.stringify({ name, role, task, readOnly })}\n\nUse the available subagent tools to delegate this focused task to a real subagent with the specified name and role. ${readOnly ? 'The subagent should inspect and report without editing files.' : 'The subagent may implement this task within the selected workspace and current permissions.'} Give it clear ownership and avoid overlapping edits. Monitor its actual progress, collect its result, and report the outcome here. If subagent tools are unavailable, explain that limitation before doing the work yourself. Do not claim to have spawned a subagent unless delegation actually succeeds.`;
  const submit = $('#agent-assign-submit');
  const draft = $('#prompt-input').value;
  submit.disabled = true;
  submit.textContent = 'Requesting…';
  error.hidden = true;
  try {
    const accepted = await sendMessage(text, { readOnlyOverride: readOnly, routingText: task });
    if (accepted) {
      setModal('agent-assign-modal', false);
      $('#agent-assign-form').reset();
      setContextTab('agents');
      showToast('Delegation requested. Subagents appear as they start.');
    } else {
      error.textContent = 'Delegation could not start. Check the session error or your selected model and connection.';
      error.hidden = false;
    }
  } finally {
    $('#prompt-input').value = draft;
    resizeComposer();
    submit.disabled = false;
    submit.textContent = 'Delegate task';
  }
}

async function startLogin() {
  $('#login-error').hidden = true;
  $('#login-link').hidden = true;
  setModal('login-modal', true);
  try {
    const result = await api('/api/login/start', { method: 'POST', body: {} });
    const link = $('#login-link');
    if (result.authUrl) {
      link.href = result.authUrl;
      link.hidden = false;
    }
    $('#login-waiting').textContent = result.authUrl ? 'Continue in your browser, then return here and refresh your connection.' : 'Complete sign-in in the browser window opened by Codex, then return here.';
  } catch (error) {
    $('#login-error').textContent = error.message;
    $('#login-error').hidden = false;
    $('#login-waiting').textContent = 'Check that the Codex CLI is installed, then try again.';
  }
}

function connectEvents() {
  const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  source.onmessage = (message) => {
    try { handleCodexEvent(JSON.parse(message.data)); } catch { /* Ignore malformed event frames. */ }
  };
  source.onerror = () => {
    $('#connection-dot').className = 'connection-dot disconnected';
    $('#connection-label').textContent = 'Reconnecting to Codex';
  };
}

$('#new-task').addEventListener('click', newTask);
$('#open-workspace').addEventListener('click', chooseWorkspaceFolder);
$('#workspace-card').addEventListener('click', chooseWorkspaceFolder);
$('#settings-button').setAttribute('aria-label', 'Settings');
$('#settings-button').title = 'Settings';
$('#settings-button').addEventListener('click', () => window.ForgeTheme.open());
$('#routing-save').addEventListener('click', saveFreeRouting);
$('#routing-discover').addEventListener('click', discoverFreeRouting);
for (const id of ['free-routing-enabled', 'codex-free-fallback', 'routing-openrouter-key', 'routing-nvidia-key']) {
  $('#' + id).addEventListener('input', () => { state.routingDraftDirty = true; $('#routing-status').classList.remove('is-error'); $('#routing-status').textContent = 'Unsaved changes · Save routing to apply.'; renderFreeRoutingSettings(); });
}
$('#routing-use').addEventListener('click', () => {
  if (state.isBusy || state.threadLoading) { showToast('Wait for this task to finish before switching providers.'); return; }
  if (state.threadId && state.threadProviderId !== 'forge-free') newTask();
  selectFreeRouteModel();
  window.ForgeTheme.close?.();
  $('#settings-modal').hidden = true;
  $('#prompt-input').focus();
});
updateModelRoutingUI();
$('#auto-model-routing').addEventListener('change', (event) => {
  state.autoModelRouting = event.currentTarget.checked;
  localStorage.setItem('forge.auto-model-routing', String(state.autoModelRouting));
  if (state.autoModelRouting) {
    const current = state.models.find((model) => model.id === state.modelId);
    if (!current?.providerId || current.providerId === 'openai') {
      const preferred = findGpt6Model('luna') || findGpt6Model('sol') || findGpt6Model('astra');
      if (preferred) {
        state.modelId = preferred.id;
        localStorage.setItem('forge.model', preferred.id);
        renderModels();
      } else if (state.models.length) {
        state.modelId = '';
        localStorage.removeItem('forge.model');
        renderModels();
      }
    }
  }
  updateModelRoutingUI();
});
$('#workspace-modal-open').addEventListener('click', () => openWorkspace($('#workspace-modal-path').value));
$('#open-project-submit').addEventListener('click', () => {
  const value = $('#workspace-path').value.trim();
  if (value) openWorkspace(value); else chooseWorkspaceFolder();
});
$('#workspace-path').addEventListener('keydown', (event) => { if (event.key === 'Enter') openWorkspace($('#workspace-path').value); });
$('#workspace-modal-path').addEventListener('keydown', (event) => { if (event.key === 'Enter') openWorkspace($('#workspace-modal-path').value); });
$('#recent-workspaces').addEventListener('click', (event) => { const button = event.target.closest('[data-path]'); if (button) openWorkspace(button.dataset.path); });
$$('[data-close-modal]').forEach((button) => button.addEventListener('click', () => setModal(button.dataset.closeModal, false)));
$$('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) setModal(backdrop.id, false); }));
$$('.idea-card').forEach((button) => button.addEventListener('click', () => {
  if (!state.workspace) { openWorkspaceDialog(); return; }
  if (state.threadId) { $('#prompt-input').value = button.dataset.prompt; resizeComposer(); $('#prompt-input').focus(); }
  else sendMessage(button.dataset.prompt);
}));
$('#send-button').addEventListener('click', () => sendMessage());
$('#prompt-input').addEventListener('input', resizeComposer);
$('#prompt-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage(); }
});
$('#stop-turn').addEventListener('click', interruptTurn);
$('#model-picker-trigger').addEventListener('click', () => setModelPickerOpen($('#model-picker-menu').hidden));
$('#model-search').addEventListener('input', filterModelOptions);
$('#model-search').addEventListener('keydown', (event) => {
  const options = [...$('#model-options').querySelectorAll('[role="option"]:not([hidden])')];
  if (event.key === 'Escape') {
    event.preventDefault();
    setModelPickerOpen(false, true);
  } else if (event.key === 'ArrowDown' && options.length) {
    event.preventDefault();
    options[0].focus();
  } else if (event.key === 'ArrowUp' && options.length) {
    event.preventDefault();
    options.at(-1).focus();
  } else if (event.key === 'Enter' && options.length) {
    event.preventDefault();
    options[0].click();
  }
});
$('#manage-providers').addEventListener('click', openProvidersDialog);
$('#anthropic-connect').addEventListener('click', () => { void connectAnthropic(); });
$$('.provider-preset').forEach((button) => button.addEventListener('click', () => selectProviderPreset(button.dataset.providerPreset)));
$('#provider-discover').addEventListener('click', discoverProviderModels);
$('#provider-save').addEventListener('click', saveProvider);
$('#provider-cancel-edit').addEventListener('click', resetProviderForm);
$('#provider-list').addEventListener('click', (event) => {
  const edit = event.target.closest('[data-provider-edit]');
  const remove = event.target.closest('[data-provider-remove]');
  if (edit) editProvider(edit.dataset.providerEdit);
  else if (remove) void removeProvider(remove.dataset.providerRemove);
});
$('#effort-trigger').addEventListener('click', () => setEffortPopoverOpen($('#effort-trigger').getAttribute('aria-expanded') !== 'true'));
$('#model-options').addEventListener('click', (event) => {
  const option = event.target.closest('[data-model-id]');
  if (!option) return;
  const model = state.models.find((item) => item.id === option.dataset.modelId);
  if (!model) return;
  const targetProviderId = model.providerId || 'openai';
  const currentProviderId = state.threadProviderId || 'openai';
  if (state.threadId && targetProviderId !== currentProviderId) {
    if (state.isBusy) { showToast('Stop the active task before changing providers.'); return; }
    newTask();
    showToast('Provider changed. Your next message will start a new session.');
  }
  state.modelId = model.id;
  $('#model-select').value = model.id;
  localStorage.setItem('forge.model', model.id);
  setModelPickerOpen(false, true);
  renderModelPicker();
  renderEfforts();
  updateModelRoutingUI();
  renderAccount();
});
$('#model-options').addEventListener('keydown', (event) => {
  const options = [...$('#model-options').querySelectorAll('[role="option"]:not([hidden])')];
  const index = options.indexOf(document.activeElement);
  let next = null;
  if (event.key === 'ArrowDown') next = options[(index + 1 + options.length) % options.length];
  if (event.key === 'ArrowUp') next = index <= 0 ? $('#model-search') : options[index - 1];
  if (event.key === 'Home') next = options[0];
  if (event.key === 'End') next = options.at(-1);
  if (event.key === 'Escape') { event.preventDefault(); setModelPickerOpen(false, true); }
  else if (next) { event.preventDefault(); next.focus(); }
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('#model-picker')) setModelPickerOpen(false);
  if (!event.target.closest('#effort-control')) setEffortPopoverOpen(false);
});
$('#effort-popover').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); setEffortPopoverOpen(false, true); }
});
$('#effort-select').addEventListener('input', updateEffortFromSlider);
$('#effort-select').addEventListener('change', updateEffortFromSlider);
function syncAskModeButton() {
  const access = $('#access-select').value;
  const label = { read: 'Ask', plan: 'Plan', write: 'Code' }[access] || 'Code';
  $('#ask-mode-label').textContent = label;
  $('#ask-mode').setAttribute('aria-label', `${label} mode; change work mode`);
  $('#ask-mode').classList.toggle('is-planning', access === 'plan');
  $('#planning-note').hidden = access !== 'plan';
  for (const option of $$('#ask-mode-menu [data-access-mode]')) {
    const selected = option.dataset.accessMode === access;
    option.setAttribute('aria-checked', String(selected));
    option.classList.toggle('selected', selected);
    option.querySelector('.ask-mode-check').textContent = selected ? '✓' : '';
  }
}
function setAskMode(access) {
  if (!['read', 'write', 'plan'].includes(access)) return;
  $('#access-select').value = access;
  state.preferredAccess = access;
  localStorage.setItem('forge.access', access);
  syncAskModeButton();
  $('#ask-mode-menu').hidden = true;
  $('#ask-mode').setAttribute('aria-expanded', 'false');
  $('#ask-mode').focus({ preventScroll: true });
}
$('#ask-mode').addEventListener('click', () => {
  const menu = $('#ask-mode-menu');
  menu.hidden = !menu.hidden;
  $('#ask-mode').setAttribute('aria-expanded', String(!menu.hidden));
  if (!menu.hidden) menu.querySelector(`[data-access-mode="${$('#access-select').value}"]`)?.focus();
});
$('#ask-mode-menu').addEventListener('click', (event) => {
  const option = event.target.closest('[data-access-mode]');
  if (option) setAskMode(option.dataset.accessMode);
});
$('#ask-mode-menu').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    $('#ask-mode-menu').hidden = true;
    $('#ask-mode').setAttribute('aria-expanded', 'false');
    $('#ask-mode').focus({ preventScroll: true });
    return;
  }
  const options = [...$('#ask-mode-menu').querySelectorAll('[role="menuitemradio"]')];
  const current = options.indexOf(document.activeElement);
  let next = null;
  if (event.key === 'ArrowDown') next = options[(current + 1 + options.length) % options.length];
  if (event.key === 'ArrowUp') next = options[(current - 1 + options.length) % options.length];
  if (event.key === 'Home') next = options[0];
  if (event.key === 'End') next = options.at(-1);
  if (next) { event.preventDefault(); next.focus(); }
});
$('#access-select').addEventListener('change', (event) => {
  state.preferredAccess = event.target.value;
  localStorage.setItem('forge.access', state.preferredAccess);
  syncAskModeButton();
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('#ask-mode-wrap')) {
    $('#ask-mode-menu').hidden = true;
    $('#ask-mode').setAttribute('aria-expanded', 'false');
  }
});
syncAskModeButton();
$('#plan-build').addEventListener('click', () => { setAskMode('write'); $('#prompt-input').value = 'Implement the plan we agreed on. Inspect the current files first, then make the changes.'; resizeComposer(); $('#prompt-input').focus(); });
$('#refresh-sessions').addEventListener('click', () => refreshState({ quiet: true }));
$('#filter-sessions').addEventListener('click', () => {
  const wrap = $('#session-filter-wrap');
  wrap.hidden = !wrap.hidden;
  $('#filter-sessions').setAttribute('aria-expanded', String(!wrap.hidden));
  if (!wrap.hidden) $('#session-filter').focus();
  else { $('#session-filter').value = ''; renderThreads(); }
});
$('#session-filter').addEventListener('input', renderThreads);
function setMode(mode) {
  state.mode = mode;
  $('#mode-chat').setAttribute('aria-selected', String(mode === 'chat'));
  $('#mode-code').setAttribute('aria-selected', String(mode === 'code'));
  document.documentElement.classList.toggle('chat-mode', mode === 'chat');
  $('#prompt-input').placeholder = mode === 'chat' ? 'Ask about this project…' : 'Find a small todo in the codebase and do it';
  $('#access-select').value = mode === 'chat' ? 'read' : state.preferredAccess;
  syncAskModeButton();
  if (mode === 'chat') $('.app-shell').classList.add('context-hidden');
  renderContext();
}
$('#mode-chat').addEventListener('click', () => setMode('chat'));
$('#mode-code').addEventListener('click', () => setMode('code'));
$('#refresh-tree').addEventListener('click', () => { state.treeCache.clear(); loadTree(''); });
$('#file-search').addEventListener('input', renderContext);
$('#conversation-scroll').addEventListener('click', (event) => {
  const link = event.target.closest('a.file-link-chip');
  if (!link) return;
  event.preventDefault();
  if (!state.workspace?.path) { showToast('Open a workspace folder to preview this file.'); return; }
  const normalize = (value) => String(value || '').replace(/[\\/]+/g, '/').replace(/\/$/, '');
  const root = normalize(state.workspace.path);
  const target = normalize(link.dataset.filePath);
  const isAbsolute = /^[a-z]:\//i.test(target) || target.startsWith('//');
  let relativePath = target.replace(/^\.\//, '');
  if (isAbsolute) {
    if (!target.toLocaleLowerCase().startsWith(root.toLocaleLowerCase() + '/')) {
      showToast('This file is outside the open workspace.');
      return;
    }
    relativePath = target.slice(root.length + 1);
  }
  if (!relativePath || relativePath === '..' || relativePath.startsWith('../')) {
    showToast('This link does not point to a file in the open workspace.');
    return;
  }
  void openFile(relativePath);
});
$('#file-tree').addEventListener('click', async (event) => {
  const row = event.target.closest('[data-path]');
  if (!row) return;
  const relativePath = row.dataset.path;
  if (row.dataset.kind === 'directory') {
    if (state.expandedDirs.has(relativePath)) state.expandedDirs.delete(relativePath);
    else {
      state.expandedDirs.add(relativePath);
      if (!state.treeCache.has(relativePath)) await loadTree(relativePath);
    }
    renderContext();
  } else openFile(relativePath);
});
$('#files-toggle').addEventListener('click', () => setContextTab('files', { toggle: true }));
$('#changes-toggle').addEventListener('click', () => setContextTab('changes', { toggle: true }));
$('#agents-toggle').addEventListener('click', () => setContextTab('agents', { toggle: true }));
$('#context-tabs').addEventListener('click', (event) => { const button = event.target.closest('[data-context-tab]'); if (button) setContextTab(button.dataset.contextTab); });
$('#agent-search').addEventListener('input', renderAgentOrganizer);
$('#agent-status-filters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-agent-filter]');
  if (!button) return;
  state.agentFilter = button.dataset.agentFilter;
  renderAgentOrganizer();
});
$('#agent-assign').addEventListener('click', openAgentAssignment);
$('#agent-live-count').addEventListener('click', () => setContextTab('agents'));
$('#agent-assign-form').addEventListener('submit', assignSubagent);
$('#agent-assign-role').addEventListener('change', syncAgentAssignmentAccess);
$('#agent-assign-form').addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const controls = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled), input, select, textarea'));
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
$('.workspace-tool-tabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
  const index = buttons.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
});
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return;
  const index = ['Digit1', 'Digit2', 'Digit3'].indexOf(event.code);
  if (index < 0 || !state.workspace || $$('.modal-backdrop').some((modal) => !modal.hidden)) return;
  event.preventDefault();
  setContextTab(['files', 'changes', 'agents'][index], { toggle: true });
});
$('#context-close').addEventListener('click', () => { $('.app-shell').classList.add('context-hidden'); renderContext(); });
$('#account-menu').addEventListener('click', () => {
  if (!state.account?.connected && state.account?.connectionError) refreshState({ quiet: true });
  else if (!state.account?.connected) startLogin();
  else showToast(`Signed in with ChatGPT ${state.account.planType || ''}. Codex usage is metered by your plan.`);
});
$('#model-update-notice').addEventListener('click', () => showToast($('#model-update-copy').textContent));
$('#account-card').addEventListener('click', (event) => {
  if (event.target.id === 'account-menu' || state.account?.connected) return;
  if (state.account?.connectionError) refreshState({ quiet: true }); else startLogin();
});
$('#login-refresh').addEventListener('click', async () => {
  await refreshState({ quiet: true });
  if (state.account?.connected) { setModal('login-modal', false); showToast('ChatGPT account connected.'); }
  else showToast('No signed-in Codex account was found yet.');
});
$('#quit-app').addEventListener('click', async () => {
  if (!confirm('Quit Forge and close its Codex connection?')) return;
  try { await api('/api/shutdown', { method: 'POST', body: {} }); } catch { /* The server may close before the response reaches the browser. */ }
  document.body.innerHTML = '<main style="display:grid;place-items:center;width:100vw;height:100vh;background:#111110;color:#d9d6ce;font:12px Inter,Segoe UI,sans-serif"><div style="text-align:center"><div style="font-size:23px;color:#edaa77;margin-bottom:8px">✳</div><strong>Forge is closed</strong><p style="color:#828178">You can close this browser tab.</p></div></main>';
});
$('#approval-slot').addEventListener('click', (event) => {
  const button = event.target.closest('[data-approval-id]');
  if (button) answerApproval(button.dataset.approvalId, button.dataset.decision);
});
const sidebarMedia = window.matchMedia('(max-width: 760px)');
const sidebarHandle = $('#sidebar-resize-handle');
const sidebarShell = $('.app-shell');
const storedSidebarWidth = Number(localStorage.getItem('forge.sidebarWidth'));
let sidebarWidth = Number.isFinite(storedSidebarWidth) && storedSidebarWidth > 0 ? storedSidebarWidth : 248;
let sidebarDrag = null;

function sidebarWidthMax() { return Math.max(260, Math.min(420, Math.floor(window.innerWidth * 0.42))); }
function setSidebarWidth(width, persist = false) {
  const maximum = sidebarWidthMax();
  sidebarWidth = Math.round(Math.max(216, Math.min(maximum, width)));
  if (sidebarMedia.matches) document.documentElement.style.removeProperty('--sidebar-open-width');
  else document.documentElement.style.setProperty('--sidebar-open-width', sidebarWidth + 'px');
  sidebarHandle.setAttribute('aria-valuemin', '216');
  sidebarHandle.setAttribute('aria-valuemax', String(maximum));
  sidebarHandle.setAttribute('aria-valuenow', String(sidebarWidth));
  sidebarHandle.setAttribute('aria-valuetext', sidebarWidth + ' pixels');
  if (persist) localStorage.setItem('forge.sidebarWidth', String(sidebarWidth));
}

function refreshSidebarSizing() {
  if (sidebarMedia.matches) {
    document.documentElement.style.removeProperty('--sidebar-open-width');
    sidebarHandle.hidden = true;
    return;
  }
  setSidebarWidth(sidebarWidth);
  sidebarHandle.hidden = sidebarShell.classList.contains('sidebar-hidden');
}

function setSidebarHidden(hidden, moveFocus = false) {
  sidebarShell.classList.toggle('sidebar-hidden', hidden);
  $('.sidebar').inert = hidden;
  $('.sidebar').setAttribute('aria-hidden', String(hidden));
  $('#sidebar-collapse').setAttribute('aria-expanded', String(!hidden));
  $('#sidebar-collapse').setAttribute('aria-label', hidden ? 'Sidebar hidden' : 'Hide sidebar');
  $('#sidebar-collapse').title = hidden ? 'Sidebar hidden' : 'Hide sidebar';
  $('#sidebar-reopen').hidden = !hidden;
  sidebarHandle.hidden = hidden || sidebarMedia.matches;
  localStorage.setItem('forge.sidebarHidden', String(hidden));
  if (moveFocus) (hidden ? $('#sidebar-reopen') : $('#sidebar-collapse')).focus({ preventScroll: true });
}

$('#sidebar-collapse').addEventListener('click', () => setSidebarHidden(true, true));
$('#sidebar-reopen').addEventListener('click', () => setSidebarHidden(false, true));
sidebarHandle.addEventListener('pointerdown', (event) => {
  if (sidebarMedia.matches || sidebarShell.classList.contains('sidebar-hidden')) return;
  event.preventDefault();
  sidebarDrag = { pointerId: event.pointerId, startX: event.clientX, startWidth: sidebarWidth };
  sidebarHandle.setPointerCapture(event.pointerId);
  document.documentElement.classList.add('sidebar-resizing');
});
sidebarHandle.addEventListener('pointermove', (event) => {
  if (!sidebarDrag || event.pointerId !== sidebarDrag.pointerId) return;
  setSidebarWidth(sidebarDrag.startWidth + event.clientX - sidebarDrag.startX);
});
function finishSidebarResize(event) {
  if (!sidebarDrag || (event && event.pointerId !== sidebarDrag.pointerId)) return;
  sidebarDrag = null;
  document.documentElement.classList.remove('sidebar-resizing');
  localStorage.setItem('forge.sidebarWidth', String(sidebarWidth));
}
sidebarHandle.addEventListener('pointerup', finishSidebarResize);
sidebarHandle.addEventListener('pointercancel', finishSidebarResize);
sidebarHandle.addEventListener('lostpointercapture', finishSidebarResize);
sidebarHandle.addEventListener('dblclick', () => setSidebarWidth(248, true));
sidebarHandle.addEventListener('keydown', (event) => {
  const step = event.shiftKey ? 32 : 12;
  if (event.key === 'ArrowLeft') setSidebarWidth(sidebarWidth - step, true);
  else if (event.key === 'ArrowRight') setSidebarWidth(sidebarWidth + step, true);
  else if (event.key === 'Home') setSidebarWidth(216, true);
  else if (event.key === 'End') setSidebarWidth(sidebarWidthMax(), true);
  else return;
  event.preventDefault();
});
refreshSidebarSizing();
setSidebarHidden(localStorage.getItem('forge.sidebarHidden') === 'true');
window.addEventListener('resize', () => { refreshSidebarSizing(); renderContext(); });
window.addEventListener('keydown', (event) => {
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === 'o') { event.preventDefault(); openWorkspaceDialog(); }
  if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); newTask(); }
  if (event.key === 'Escape') for (const modal of $$('.modal-backdrop')) if (!modal.hidden) setModal(modal.id, false);
});

connectEvents();
if (!/Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '')) {
  const newTaskShortcut = $('.new-task-button kbd');
  const openFolderShortcut = $('.kbd-hint');
  if (newTaskShortcut) newTaskShortcut.textContent = 'Ctrl K';
  if (openFolderShortcut) openFolderShortcut.textContent = 'Ctrl O';
}
if (window.matchMedia('(max-width: 980px)').matches) $('.app-shell').classList.add('context-hidden');
renderAll();
refreshState({ quiet: false });
