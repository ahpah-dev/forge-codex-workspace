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
  codePreviewViews: new Map(),
  pendingImages: [],
  messageEditTarget: null,
  activeTurnId: null,
  turnStartedAt: null,
  activityStatus: 'Starting task',
  isBusy: false,
  pendingSend: false,
  approvals: [],
  questionDrafts: new Map(),
  questionSending: new Set(),
  approvalRenderSignature: '',
  treeCache: new Map(),
  expandedDirs: new Set(),
  selectedFile: null,
  activeContextTab: 'files',
  plugins: { view: 'installed', installed: [], installedLoaded: false, available: [], marketplaces: [], query: '', total: 0, offset: 0, loading: false, busyKey: '', error: '', loaded: false, sourceFormOpen: false, requestId: 0, searchTimer: null, mentionLoading: false, mentionContext: null, mentionRows: [], mentionSelectedIndex: 0 },
  composerPluginMentions: [],
  browser: { active: false, expanded: false, url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: '', activity: '', actionActive: false },
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
  askExternalApprovals: true,
  permissionSettingsBusy: false,
  routingDraftDirty: false,
  routingBusy: false,
  fallbackSourceThreadId: null,
  mode: 'code',
  preferredAccess: localStorage.getItem('forge.access') || 'write',
};

const liveActivities = createLiveActivityTracker();

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

document.querySelector('.welcome-mark')?.append(createOpenAIMark());

function getModelTier(modelId = '', providerId = '') {
  if (providerId) return providerId.toLowerCase().includes('kilo') ? 'kilo' : providerId.toLowerCase().includes('groq') ? 'groq' : providerId.toLowerCase().includes('nvidia') ? 'nvidia' : 'provider';
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
  } else if (tier === 'kilo') {
    appendPath('M6 4v16M18 4l-8 8 8 8', 'none');
    svg.lastChild.setAttribute('stroke', 'currentColor');
    svg.lastChild.setAttribute('stroke-width', '2');
    svg.lastChild.setAttribute('stroke-linecap', 'round');
    svg.lastChild.setAttribute('stroke-linejoin', 'round');
  } else if (tier === 'groq') {
    appendPath('M18.7 7a8 8 0 1 0 1 9.4V12h-7', 'none');
    svg.lastChild.setAttribute('stroke', 'currentColor');
    svg.lastChild.setAttribute('stroke-width', '1.8');
    svg.lastChild.setAttribute('stroke-linecap', 'round');
    svg.lastChild.setAttribute('stroke-linejoin', 'round');
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

const inAppBrowserAvailable = Boolean(window.ForgeDesktop?.computerUse);
$('#browser-toggle').hidden = !inAppBrowserAvailable;
let lastBrowserLayout = '';
let browserModeRevision = 0;
let browserCloseTimer;

function clearBrowserCloseAnimation() {
  clearTimeout(browserCloseTimer);
  $('.main-column').classList.remove('browser-closing');
  $('.main-column').style.removeProperty('--browser-close-width');
  $('.main-column').style.removeProperty('--browser-close-top');
  $('#browser-workspace').inert = false;
  $('#browser-page-slot').querySelector('.browser-transition-frame')?.remove();
}

function updateBrowserLayout() {
  if (!inAppBrowserAvailable) return;
  const slot = $('#browser-page-slot');
  const column = $('.main-column');
  column.classList.toggle('browser-compact', column.clientWidth < 760);
  const bounds = slot.getBoundingClientRect();
  const layout = {
    active: state.browser.active && !column.inert && !$('#browser-workspace').hidden && !$$('.modal-backdrop').some((modal) => !modal.hidden),
    x: Math.round(bounds.left), y: Math.round(bounds.top), width: Math.round(bounds.width), height: Math.round(bounds.height),
  };
  const signature = JSON.stringify(layout);
  if (signature === lastBrowserLayout) return;
  lastBrowserLayout = signature;
  window.ForgeDesktop.setBrowserLayout(layout);
}

function renderBrowserState() {
  const browser = state.browser;
  const address = $('#browser-address');
  if (document.activeElement !== address) address.value = browser.url;
  $('#browser-back').disabled = !browser.canGoBack;
  $('#browser-forward').disabled = !browser.canGoForward;
  $('#browser-security-note').textContent = browser.error || (browser.loading ? 'Loading page…' : 'Private to Forge');
  $('#browser-security-note').classList.toggle('is-loading', browser.loading);
  $('#browser-security-note').classList.toggle('is-error', Boolean(browser.error));
  $('#browser-action-status').textContent = browser.error || browser.activity || (browser.loading ? 'Loading page' : 'Ready for you or your agent');
  $('#browser-live-dot').classList.toggle('is-active', browser.actionActive || browser.loading);
  $('#browser-page-title').textContent = browser.title;
  $('#browser-page-title').title = browser.title;
  $('#browser-toggle').classList.toggle('is-working', browser.actionActive);
  $('#browser-reload').classList.toggle('is-loading', browser.loading);
  $('#browser-reload').title = browser.loading ? 'Stop loading' : 'Reload';
  $('#browser-expand').setAttribute('aria-pressed', String(browser.expanded));
  $('#browser-expand').title = browser.expanded ? 'Show chat alongside browser' : 'Expand browser';
  $('#browser-expand').setAttribute('aria-label', $('#browser-expand').title);
  $('#browser-security-note').title = browser.error || browser.title || '';
  $('#browser-workspace').classList.toggle('has-browser-page', Boolean(browser.url));
  $('#browser-toggle').setAttribute('aria-pressed', String(browser.active));
  $('#browser-toggle').setAttribute('aria-label', browser.active ? 'Return to the Forge conversation' : "Open Forge's in-app browser");
  $('#browser-toggle').title = browser.active ? 'Return to chat · Ctrl+Shift+5' : 'In-app browser · Ctrl+Shift+5';
}

async function setBrowserMode(active) {
  if (!inAppBrowserAvailable) return;
  const revision = ++browserModeRevision;
  const column = $('.main-column');
  const panel = $('#browser-workspace');
  const wasVisible = !panel.hidden;
  state.browser.active = Boolean(active);
  renderBrowserState();
  clearBrowserCloseAnimation();
  if (!active && wasVisible && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // Native WebContentsView pixels cannot animate with DOM CSS. Freeze a
    // temporary frame, then hide the native view while the panel closes.
    const frame = await Promise.race([
      window.ForgeDesktop.captureBrowserTransition?.().catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 180)),
    ]);
    if (revision !== browserModeRevision) return;
    if (frame?.image) {
      const image = new Image();
      image.className = 'browser-transition-frame';
      image.alt = ''; image.setAttribute('aria-hidden', 'true');
      image.src = frame.image;
      image.style.width = `${frame.width}px`; image.style.height = `${frame.height}px`;
      $('#browser-page-slot').append(image);
      await Promise.race([image.decode().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 80))]);
      if (revision !== browserModeRevision) return;
    }
    column.style.setProperty('--browser-close-width', `${panel.getBoundingClientRect().width + 12}px`);
    column.style.setProperty('--browser-close-top', `${panel.getBoundingClientRect().top - column.getBoundingClientRect().top}px`);
    if (panel.contains(document.activeElement)) $('#browser-toggle').focus({ preventScroll: true });
    panel.inert = true;
    updateBrowserLayout();
    // Establish the current pixel track before transitioning it to zero.
    void column.offsetWidth;
    column.classList.add('browser-closing');
    column.style.setProperty('--browser-close-width', '0px');
    browserCloseTimer = setTimeout(() => {
      if (revision !== browserModeRevision) return;
      panel.hidden = true;
      column.classList.remove('browser-mode', 'browser-closing', 'browser-expanded');
      clearBrowserCloseAnimation();
      requestAnimationFrame(() => { updateBrowserLayout(); positionWelcomeSuggestions(); });
    }, 280);
    return;
  }
  column.classList.toggle('browser-mode', state.browser.active);
  column.classList.toggle('browser-expanded', state.browser.active && state.browser.expanded);
  panel.hidden = !state.browser.active;
  requestAnimationFrame(() => { updateBrowserLayout(); positionWelcomeSuggestions(); });
}

async function runBrowserCommand(action, params = {}) {
  if (!inAppBrowserAvailable) return;
  try {
    const result = await window.ForgeDesktop.browserCommand(action, params);
    if (result && typeof result === 'object') {
      state.browser = { ...state.browser, ...result };
      renderBrowserState();
    }
    return result;
  } catch (error) {
    state.browser.error = error.message || 'The in-app browser action failed.';
    renderBrowserState();
    showToast(state.browser.error, 'error');
    return null;
  }
}

if (inAppBrowserAvailable) {
  window.ForgeDesktop.onBrowserOpen(() => { lastBrowserLayout = ''; setBrowserMode(true); });
  window.ForgeDesktop.onBrowserState((browser) => {
    state.browser = { ...state.browser, ...browser };
    renderBrowserState();
    if (state.browser.active) requestAnimationFrame(updateBrowserLayout);
  });
  $('#browser-toggle').addEventListener('click', () => setBrowserMode(!state.browser.active));
  $('#browser-return').addEventListener('click', () => setBrowserMode(false));
  $('#browser-navigation-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const url = $('#browser-address').value.trim();
    if (url) void runBrowserCommand('navigate', { url });
  });
  $('#browser-address').addEventListener('focus', (event) => event.currentTarget.select());
  $('#browser-back').addEventListener('click', () => void runBrowserCommand('back'));
  $('#browser-forward').addEventListener('click', () => void runBrowserCommand('forward'));
  $('#browser-reload').addEventListener('click', () => void runBrowserCommand(state.browser.loading ? 'stop' : 'reload'));
  $('#browser-expand').addEventListener('click', () => { state.browser.expanded = !state.browser.expanded; setBrowserMode(true); });
  const setBrowserWidth = (width) => {
    const column = $('.main-column');
    const value = Math.round(Math.max(320, Math.min(column.clientWidth - 320, width)));
    column.style.setProperty('--browser-width', value + 'px');
    $('#browser-resize').setAttribute('aria-valuenow', String(value));
    $('#browser-resize').setAttribute('aria-valuemax', String(Math.max(320, column.clientWidth - 320)));
    requestAnimationFrame(updateBrowserLayout);
  };
  $('#browser-resize').addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-browser');
    const move = (pointer) => setBrowserWidth($('.main-column').getBoundingClientRect().right - pointer.clientX - 12);
    const finish = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      document.body.classList.remove('resizing-browser');
      requestAnimationFrame(updateBrowserLayout);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  });
  $('#browser-resize').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setBrowserWidth($('#browser-workspace').getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 24 : -24));
  });
  $('#browser-open-external').addEventListener('click', async () => {
    try { await window.ForgeDesktop.openBrowserExternal(); }
    catch (error) { showToast(error.message || 'Could not open the page in your default browser.', 'error'); }
  });
  const browserSlotObserver = new ResizeObserver(() => { if (state.browser.active) updateBrowserLayout(); });
  browserSlotObserver.observe($('#browser-page-slot'));
  browserSlotObserver.observe($('.main-column'));
  renderBrowserState();
}

function setModal(id, open) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = !open;
  if (inAppBrowserAvailable) requestAnimationFrame(updateBrowserLayout);
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
  $('#omniroute-setup').hidden = true;
  $('#provider-id').value = '';
  $('#provider-native-preset').value = '';
  $('#provider-models').readOnly = false;
  $('#provider-base-url').readOnly = false;
  $('#provider-api-format').disabled = false;
  $('#kilo-setup-note').hidden = true;
  $('#provider-name').value = '';
  $('#provider-base-url').value = '';
  $('#provider-api-format').value = 'auto';
  $('#provider-api-key').value = '';
  $('#provider-api-key').placeholder = 'Paste provider API key';
  $('#provider-key-hint').textContent = 'Stored encrypted on this Windows account';
  $('#provider-models').value = '';
  $('#groq-setup-note').hidden = true;
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
    const isFreeRoute = provider.id === 'forge-free';
    const baseUrl = String(provider.baseUrl || '');
    const modelCount = Array.isArray(provider.models) ? provider.models.length : 0;
    const row = document.createElement('div');
    row.className = 'provider-entry';
    const mark = document.createElement('span');
    mark.className = `provider-entry-mark ${provider.id.includes('nvidia') ? 'nvidia' : ''}`.trim();
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = provider.nativePreset === 'omniroute' ? 'O' : provider.nativePreset === 'kilo-free' ? 'K' : provider.id.includes('nvidia') ? 'N' : provider.id.includes('openrouter') ? '◈' : baseUrl.includes('api.groq.com') ? 'G' : '◇';
    const copy = document.createElement('span');
    copy.className = 'provider-entry-copy';
    const name = document.createElement('strong');
    name.textContent = provider.name;
    const endpoint = document.createElement('small');
    endpoint.textContent = isFreeRoute ? 'OpenRouter → NVIDIA NIM · Managed in Settings' : `${baseUrl} · ${modelCount} model${modelCount === 1 ? '' : 's'}`;
    copy.append(name, endpoint);
    const status = document.createElement('span');
    status.className = 'provider-entry-state';
    status.textContent = provider.nativePreset === 'omniroute' ? 'Local gateway' : isFreeRoute ? (provider.authConfigured ? 'Keys saved' : 'Add routing keys') : provider.authConfigured ? 'Key saved' : 'Add API key';
    if (!provider.authConfigured) status.style.color = '#a15e49';
    const actions = document.createElement('span');
    actions.className = 'provider-entry-actions';
    if (isFreeRoute) {
      const configure = document.createElement('button');
      configure.type = 'button'; configure.textContent = 'Configure'; configure.dataset.providerRouting = 'true';
      actions.append(configure);
    } else {
      const edit = document.createElement('button');
      edit.type = 'button'; edit.textContent = 'Edit'; edit.dataset.providerEdit = provider.id;
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'provider-remove'; remove.textContent = 'Remove'; remove.dataset.providerRemove = provider.id;
      actions.append(edit, remove);
    }
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

function openFreeRoutingSettings() {
  setModal('providers-modal', false);
  window.ForgeTheme.open();
  $('#free-routing-enabled').focus();
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
    nvidia: { name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', placeholder: 'nvapi-…', models: ['openai/gpt-oss-20b'] },
    groq: { name: 'Groq Free', baseUrl: 'https://api.groq.com/openai/v1', placeholder: 'gsk_…', models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'] },
    'kilo-free': { name: 'Kilo Free Router', baseUrl: 'https://api.kilo.ai/api/gateway', placeholder: 'Paste your Kilo profile API key', models: ['kilo-auto/free'] },
    omniroute: { name: 'OmniRoute Local', baseUrl: 'http://127.0.0.1:20128/v1', placeholder: 'Optional · key from your OmniRoute dashboard', models: ['auto/coding:free', 'auto/fast:free'] },
    custom: { name: '', baseUrl: '', placeholder: 'Paste provider API key' },
  };
  const value = presets[preset];
  if (!value) return;
  if (!$('#provider-id').value || preset === 'custom') $('#provider-name').value = value.name;
  $('#provider-base-url').value = value.baseUrl;
  const kiloFree = preset === 'kilo-free';
  $('#provider-native-preset').value = kiloFree ? 'kilo-free' : preset === 'omniroute' ? 'omniroute' : '';
  $('#omniroute-setup').hidden = preset !== 'omniroute';
  if (preset === 'omniroute') void refreshOmniRoute();
  $('#provider-key-hint').textContent = preset === 'omniroute' ? 'Optional for a local gateway without key authentication' : 'Stored encrypted on this Windows account';
  $('#provider-models').readOnly = kiloFree;
  $('#provider-base-url').readOnly = kiloFree;
  $('#provider-api-format').disabled = kiloFree || preset === 'omniroute';
  $('#kilo-setup-note').hidden = !kiloFree;
  $('#provider-api-format').value = preset === 'groq' || kiloFree || preset === 'omniroute' ? 'chat' : 'auto';
  $('#groq-setup-note').hidden = preset !== 'groq';
  if (value.models) $('#provider-models').value = value.models.join('\n');
  else if (!$('#provider-id').value) $('#provider-models').value = '';
  $('#provider-api-key').placeholder = value.placeholder;
  showProviderError('');
}

function editProvider(providerId) {
  if (providerId === 'forge-free') { openFreeRoutingSettings(); return; }
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider) return;
  $('#provider-id').value = provider.id;
  const kiloFree = provider.nativePreset === 'kilo-free';
  $('#provider-native-preset').value = provider.nativePreset || '';
  $('#omniroute-setup').hidden = provider.nativePreset !== 'omniroute';
  if (provider.nativePreset === 'omniroute') void refreshOmniRoute();
  $('#provider-models').readOnly = kiloFree;
  $('#provider-base-url').readOnly = kiloFree;
  $('#provider-api-format').disabled = kiloFree || provider.nativePreset === 'omniroute';
  $('#kilo-setup-note').hidden = !kiloFree;
  $('#provider-name').value = provider.name;
  $('#provider-base-url').value = provider.baseUrl;
  $('#provider-api-format').value = provider.apiFormat || 'auto';
  $('#provider-api-key').value = '';
  $('#provider-api-key').placeholder = provider.nativePreset === 'omniroute' ? 'Optional · leave blank to keep any saved key' : 'Leave blank to keep the saved key';
  $('#provider-key-hint').textContent = provider.nativePreset === 'omniroute' ? 'Optional for a local gateway without key authentication' : provider.authConfigured ? 'A saved key is already encrypted locally' : 'Stored encrypted on this Windows account';
  $('#provider-models').value = provider.models.map((model) => model.id).join('\n');
  $('#provider-form-title').textContent = `Edit ${provider.name}`;
  $('#provider-save').textContent = 'Save provider';
  $('#provider-cancel-edit').hidden = false;
  const preset = provider.nativePreset === 'omniroute' ? 'omniroute' : kiloFree ? 'kilo-free' : provider.baseUrl.includes('api.groq.com') ? 'groq' : provider.id.includes('nvidia') ? 'nvidia' : provider.id.includes('openrouter') ? 'openrouter' : 'custom';
  $('#groq-setup-note').hidden = preset !== 'groq';
  $$('.provider-preset').forEach((button) => button.classList.toggle('selected', button.dataset.providerPreset === preset));
  showProviderError('');
  $('#provider-name').focus();
}

let omniRoutePoll;
async function refreshOmniRoute() {
  clearTimeout(omniRoutePoll);
  if ($('#omniroute-setup').hidden || $('#providers-modal').hidden) return;
  const button = $('#omniroute-start');
  try {
    const status = await api('/api/omniroute');
    const busy = ['installing', 'starting'].includes(status.phase);
    $('#omniroute-status').textContent = status.running ? 'Connected · local gateway ready' : status.error || (status.phase === 'installing' ? 'Downloading and installing the router…' : status.phase === 'starting' ? 'Starting your local gateway…' : status.installed ? 'Installed · ready to start' : 'Not installed yet');
    $('#omniroute-setup').dataset.busy = String(busy);
    button.disabled = busy || status.running;
    button.textContent = status.running ? 'Running' : busy ? status.phase === 'installing' ? 'Installing…' : 'Starting…' : status.installed ? 'Start router' : 'Install & start';
    if (busy) omniRoutePoll = setTimeout(refreshOmniRoute, 2000);
  } catch (error) { $('#omniroute-status').textContent = error.message; button.disabled = false; }
}
async function startOmniRoute() {
  $('#omniroute-start').disabled = true;
  $('#omniroute-status').textContent = 'Preparing your local router…';
  try { await api('/api/omniroute/start', { method: 'POST', body: {} }); await refreshOmniRoute(); }
  catch (error) { $('#omniroute-status').textContent = error.message; $('#omniroute-start').disabled = false; }
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
      nativePreset: $('#provider-native-preset').value,
    } });
    const current = $('#provider-models').value.split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean);
    $('#provider-models').value = (result.codingOnly ? result.modelIds : [...new Set([...current, ...result.modelIds])]).join('\n');
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
      nativePreset: $('#provider-native-preset').value,
      baseUrl: $('#provider-base-url').value,
      apiKey: $('#provider-api-key').value,
      models: $('#provider-models').value,
      apiFormat: $('#provider-api-format').value,
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

function renderPermissionSettings() {
  const toggle = $('#external-approval-requests');
  if (!toggle) return;
  toggle.checked = state.askExternalApprovals;
  toggle.disabled = state.permissionSettingsBusy;
  $('#external-approval-status').textContent = state.permissionSettingsBusy
    ? 'Saving permission setting…'
    : state.askExternalApprovals ? 'Permission prompts are on for external models.' : 'Permission prompts are off for external models.';
}

async function saveExternalApprovalSetting() {
  if (state.permissionSettingsBusy) return;
  const previous = state.askExternalApprovals;
  const next = $('#external-approval-requests').checked;
  state.permissionSettingsBusy = true;
  renderPermissionSettings();
  try {
    const result = await api('/api/permissions/settings', { method: 'POST', body: { askExternalApprovals: next } });
    state.askExternalApprovals = result.askExternalApprovals !== false;
    showToast(state.askExternalApprovals ? 'External model permission prompts enabled.' : 'External models can now run without Forge approval prompts.');
  } catch (error) {
    state.askExternalApprovals = previous;
    showToast(error.message || 'Could not save permission settings.', 'error');
  } finally {
    state.permissionSettingsBusy = false;
    renderPermissionSettings();
  }
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
  // Provider setup must remain available before any account has loaded models.
  trigger.disabled = false;
  $('#model-picker-label').textContent = current?.name || (state.autoModelRouting ? 'GPT-6 unavailable' : state.account?.connected ? 'Models unavailable' : 'Connect Codex');
  trigger.title = current ? (current.id === current.name ? current.name : `${current.name} · ${current.id}`) : state.autoModelRouting ? 'No GPT-6 model is available in this Codex account' : 'Choose a model';
  triggerMark.className = `model-picker-mark tier-${getModelTier(current?.id, current?.providerId)}`;
  triggerMark.replaceChildren(current ? createModelIcon(current.id, current.providerId) : createOpenAIMark());
  $('#model-picker-count').textContent = models.length ? models.length + ' models' : '';
  optionsHost.replaceChildren();
  if (!models.length) {
    const empty = document.createElement('div');
    empty.className = 'model-search-empty';
    empty.textContent = 'Connect an account or add a provider to choose a model.';
    optionsHost.append(empty);
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
  if (!options.length) {
    $('#model-picker-count').textContent = '0 models';
    positionModelPickerMenu();
    return;
  }
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
  positionModelPickerMenu();
}

function positionModelPickerMenu() {
  const menu = $('#model-picker-menu');
  if (menu.hidden) return;
  const anchor = $('#model-picker-trigger').getBoundingClientRect();
  const margin = 12, gap = 9;
  const above = anchor.top - margin - gap;
  const below = window.innerHeight - anchor.bottom - margin - gap;
  const useAbove = above >= below;
  menu.style.maxHeight = `${Math.max(0, useAbove ? above : below)}px`;
  menu.style.left = `${Math.max(margin, Math.min(anchor.left, window.innerWidth - menu.offsetWidth - margin))}px`;
  menu.style.top = `${useAbove ? Math.max(margin, anchor.top - gap - menu.offsetHeight) : anchor.bottom + gap}px`;
}

function setModelPickerOpen(open, restoreFocus = false) {
  const menu = $('#model-picker-menu');
  const trigger = $('#model-picker-trigger');
  const shouldOpen = Boolean(open && !trigger.disabled);
  menu.hidden = !shouldOpen;
  trigger.setAttribute('aria-expanded', String(shouldOpen));
  if (shouldOpen) {
    // Escape the composer's transformed and clipped ancestors.
    if (menu.parentElement !== document.body) document.body.append(menu);
    $('#model-search').value = '';
    filterModelOptions();
    positionModelPickerMenu();
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
  const wasConversation = !$('#conversation-view').hidden;
  $('.workspace-surface').classList.toggle('has-conversation', active);
  const enteringConversation = active && $('#conversation-view').hidden;
  $('#welcome-view').hidden = active;
  $('#conversation-view').hidden = !active;
  if (wasConversation !== active) resizeComposer();
  if (active) {
    $('#conversation-title').textContent = state.threadName || (state.messages.find((message) => message.role === 'user')?.text.slice(0, 72) || 'Image request');
    $('#conversation-subtitle').textContent = state.workspace?.path || '';
    $('#thread-loading-note').hidden = !state.threadLoading;
    renderMessages(enteringConversation);
  }
  renderThreads();
  updateComposerState();
  renderMessageEditBanner();
}

function renderMessageEditBanner() {
  const banner = $('#message-edit-banner');
  if (!banner) return;
  banner.hidden = !state.messageEditTarget;
  if (state.messageEditTarget) banner.querySelector('span').textContent = state.messageEditTarget.turnId
    ? 'Editing a previous message · sending creates a branch'
    : 'Editing a message that did not start · sending retries it';
}

function beginMessageEdit(message) {
  if (state.isBusy || state.threadLoading) return;
  state.messageEditTarget = { id: message.id, turnId: message.turnId || null, text: message.text };
  setPendingImages(message.images || []);
  $('#prompt-input').value = message.text;
  resizeComposer();
  renderMessageEditBanner();
  $('#prompt-input').focus();
  showToast(message.turnId ? 'Edit the prompt, then send to rerun it in a new branch.' : 'Edit the prompt, then send to retry it.');
}

function cancelMessageEdit() {
  state.messageEditTarget = null;
  $('#prompt-input').value = '';
  setPendingImages([]);
  resizeComposer();
  renderMessageEditBanner();
}

async function openBranchBeforeMessage(message) {
  const sourceThreadId = message.threadId || state.threadId;
  if (!sourceThreadId || !message.turnId) throw new Error('This message cannot be used as a branch point.');
  const result = await api('/api/threads/fork-before-message', { method: 'POST', body: { threadId: sourceThreadId, turnId: message.turnId } });
  const history = await api('/api/threads/open', { method: 'POST', body: { threadId: result.threadId } });
  applyThreadResult(history);
  void refreshState({ quiet: true });
}

const IMAGE_FILE_LIMIT = 5 * 1024 * 1024;
const IMAGE_TOTAL_LIMIT = 9 * 1024 * 1024;
const IMAGE_COUNT_LIMIT = 4;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result || '')));
    reader.addEventListener('error', () => reject(new Error(`Could not read ${file.name || 'that image'}.`)));
    reader.readAsDataURL(file);
  });
}

function renderImageAttachmentTray() {
  const tray = $('#image-attachment-tray');
  tray.replaceChildren();
  tray.hidden = state.pendingImages.length === 0;
  for (const image of state.pendingImages) {
    const item = document.createElement('div');
    item.className = 'image-attachment';
    const preview = document.createElement('img');
    preview.src = imageDataUrl(image);
    preview.alt = '';
    const name = document.createElement('span');
    name.className = 'image-attachment-name';
    name.textContent = image.name;
    const remove = document.createElement('button');
    remove.className = 'image-attachment-remove';
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${image.name}`);
    remove.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg>';
    remove.addEventListener('click', () => {
      state.pendingImages = state.pendingImages.filter((entry) => entry.id !== image.id);
      renderImageAttachmentTray();
    });
    item.append(preview, name, remove);
    tray.append(item);
  }
}

function setPendingImages(images = []) {
  state.pendingImages = (Array.isArray(images) ? images : []).map((image) => ({
    id: image.id || crypto.randomUUID(),
    name: String(image.name || 'image'),
    mediaType: imageMediaType(image),
    size: Number(image.size || 0),
    dataUrl: imageDataUrl(image),
  })).filter((image) => image.dataUrl);
  renderImageAttachmentTray();
}

async function addImageFiles(files) {
  const candidates = Array.from(files || []);
  if (!candidates.length) return;
  for (const file of candidates) {
    if (!IMAGE_TYPES.has(file.type)) { showToast('Choose a PNG, JPEG, WebP, or GIF image.', 'error'); continue; }
    if (file.size > IMAGE_FILE_LIMIT) { showToast(`${file.name} is over the 5 MB image limit.`, 'error'); continue; }
    if (state.pendingImages.length >= IMAGE_COUNT_LIMIT) { showToast('Attach up to four images per message.', 'error'); break; }
    const total = state.pendingImages.reduce((sum, image) => sum + image.size, 0);
    if (total + file.size > IMAGE_TOTAL_LIMIT) { showToast('Keep attached images under 9 MB total.', 'error'); break; }
    try {
      const dataUrl = await imageFileToDataUrl(file);
      state.pendingImages.push({ id: crypto.randomUUID(), name: file.name || 'image', mediaType: file.type, size: file.size, dataUrl });
      renderImageAttachmentTray();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }
}

async function retryUserMessage(message) {
  if (state.isBusy || state.threadLoading) return;
  if (!message.turnId) {
    await sendMessage(message.text, { replaceMessageId: message.id, imagesOverride: message.images || [] });
    return;
  }
  try {
    state.threadLoading = true;
    renderSurface();
    await openBranchBeforeMessage(message);
    await sendMessage(message.text, { imagesOverride: message.images || [] });
  } catch (error) {
    state.threadLoading = false;
    renderSurface();
    showToast(error.message || 'Could not retry this message.', 'error');
  }
}

async function revertToUserMessage(message) {
  if (state.isBusy || state.threadLoading) return;
  try {
    state.threadLoading = true;
    renderSurface();
    await openBranchBeforeMessage(message);
    showToast('Opened a branch before that message. Existing workspace file changes were left as they are.');
  } catch (error) {
    state.threadLoading = false;
    renderSurface();
    showToast(error.message || 'Could not branch from this message.', 'error');
  }
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
  renderPermissionSettings();
}

async function refreshState({ quiet = false } = {}) {
  try {
    const snapshot = await api('/api/state');
    state.account = snapshot.account;
    state.codexCli = snapshot.codexCli || null;
    state.providers = snapshot.providers || [];
    state.askExternalApprovals = snapshot.askExternalApprovals !== false;
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
    state.messageEditTarget = null;
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
  state.messageEditTarget = null;
  renderMessageEditBanner();
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

async function openLinkedFile(filePath) {
  try {
    if (!state.workspace?.path) throw new Error('Open a workspace folder to access this file.');
    const relativePath = ForgeFilePaths.relativeToWorkspace(state.workspace.path, filePath);
    if (!ForgeFilePaths.opensNatively(relativePath)) return openFile(relativePath);
    const result = await api('/api/file/open', { method: 'POST', body: { path: relativePath } });
    if (result.download) {
      const response = await fetch(`/api/file/download?path=${encodeURIComponent(relativePath)}`, { headers: { 'X-Forge-Session': token } });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Could not download this file.'); }
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = result.filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    }
  } catch (error) { showToast(error.message, 'error'); }
}

async function openFile(relativePath) {
  try {
    const result = await api(`/api/file?path=${encodeURIComponent(relativePath)}`);
    state.selectedFile = relativePath;
    state.activeContextTab = 'preview';
    $('.app-shell').classList.remove('context-hidden');
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
  $('#plugins-toggle').setAttribute('aria-pressed', String(isOpen && state.activeContextTab === 'plugins'));
  $('#changes-toggle').setAttribute('aria-controls', 'context-panel');
  $('#agents-toggle').setAttribute('aria-controls', 'context-panel');
  $('#plugins-toggle').setAttribute('aria-controls', 'context-panel');
  $$('.context-tab').forEach((button) => button.setAttribute('aria-pressed', String(state.activeContextTab === button.dataset.contextTab || (button.dataset.contextTab === 'files' && state.activeContextTab === 'preview'))));
  $('#tree-toolbar').hidden = state.activeContextTab !== 'files';
  $('#file-tree').hidden = state.activeContextTab !== 'files';
  $('#file-preview').hidden = state.activeContextTab !== 'preview';
  $('#change-preview').hidden = state.activeContextTab !== 'changes';
  $('#agent-organizer').hidden = state.activeContextTab !== 'agents';
  $('#plugin-manager').hidden = state.activeContextTab !== 'plugins';
  $('#context-kicker').textContent = state.activeContextTab === 'changes' ? 'WORKING TREE' : state.activeContextTab === 'agents' ? 'DELEGATED WORK' : state.activeContextTab === 'plugins' ? 'CODEX ACCOUNT' : 'PROJECT';
  $('#context-title').textContent = state.activeContextTab === 'changes' ? 'Changes' : state.activeContextTab === 'preview' ? 'Preview' : state.activeContextTab === 'agents' ? 'Subagents' : state.activeContextTab === 'plugins' ? 'Plugins' : 'Files';
  $('#context-footer-label').textContent = state.activeContextTab === 'changes' ? 'GIT WORKING TREE' : state.activeContextTab === 'agents' ? 'CURRENT SESSION' : state.activeContextTab === 'plugins' ? 'SYNCED WITH CODEX' : 'LOCAL WORKSPACE';
  $('#context-footer-status').textContent = state.activeContextTab === 'plugins' ? (state.account?.connected ? `ChatGPT ${state.account.planType || 'connected'}` : 'Codex profile') : state.workspace?.name || 'Not open';
  renderAgentOrganizer();
  if (state.activeContextTab === 'plugins') renderPluginManager();
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
  if (inAppBrowserAvailable) requestAnimationFrame(updateBrowserLayout);
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
    let target = String(angleTarget || plainTarget || '').trim().replace(/\\([()<>])/g, '$1');
    const escapedLabel = escapeHTML(label.trim());
    if (/^https?:\/\//i.test(target)) return stash(`<a href="${escapeHTML(target)}" target="_blank" rel="noopener noreferrer">${escapedLabel}</a>`);
    const isLocalPath = /^file:/i.test(target) || /^[a-z]:[\\/]/i.test(target) || /^(?:\\\\|\/|\.\.?[\\/])/.test(target) || !/^[a-z][a-z\d+.-]*:/i.test(target);
    if (isLocalPath && target && target.length <= 2048 && !/[<>\u0000-\u001f]/.test(target)) {
      try { target = ForgeFilePaths.normalize(target); } catch { return whole; }
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
      const stats = typeof change.diff === 'string' ? filePatchStats(change.diff) : getFileLineStats(label.textContent);
      row.append(prefix, label);
      if (stats) {
        const lineStats = document.createElement('span');
        lineStats.className = 'change-file-stats';
        lineStats.innerHTML = `<span class="change-added">+${stats.added}</span><span class="change-removed">-${stats.removed}</span>`;
        row.append(lineStats);
      }
      const file = document.createElement('section');
      file.className = 'activity-file-edit';
      file.append(row);
      if (change.diff) file.append(renderCodePreview(change, message, pending));
      list.append(file);
    }
    details.append(list);
  }
  return details;
}

function filePatchStats(diff) {
  const lines = String(diff || '').split('\n');
  return {
    added: lines.filter((line) => line.startsWith('+') && !line.startsWith('+++ ')).length,
    removed: lines.filter((line) => line.startsWith('-') && !line.startsWith('--- ')).length,
  };
}

function renderCodePreview(change, message, pending) {
  const preview = document.createElement('div');
  preview.className = 'live-code-preview';
  const toolbar = document.createElement('div');
  toolbar.className = 'live-code-toolbar';
  const label = document.createElement('span');
  label.className = 'live-code-label';
  label.textContent = pending ? 'Live · proposed edit' : /fail|declin|interrupt|stop/i.test(message.status || '') ? 'Proposed edit · not applied' : 'Edit patch';
  const key = `${state.threadId}:${message.id}:${change.path || change.filePath || ''}`;
  let view = state.codePreviewViews.get(key);
  if (!view) {
    view = { follow: true, top: 0, left: 0 };
    state.codePreviewViews.set(key, view);
    if (state.codePreviewViews.size > 250) state.codePreviewViews.delete(state.codePreviewViews.keys().next().value);
  }
  const follow = document.createElement('button');
  follow.type = 'button';
  follow.className = 'live-code-follow';
  follow.textContent = view.follow ? 'Following' : 'Follow code';
  follow.setAttribute('aria-pressed', String(view.follow));
  follow.title = 'Keep the newest code visible';
  follow.hidden = !pending;
  const code = document.createElement('pre');
  code.className = 'live-code-content';
  code.tabIndex = 0;
  code.setAttribute('aria-label', `Code changes for ${change.path || 'file'}`);
  let oldLine = 1;
  let newLine = 1;
  const lines = String(change.diff).split('\n');
  const firstLine = Math.max(0, lines.length - 600);
  const markup = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    let kind = 'context', before = '', after = '';
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); kind = 'hunk'; }
    else if (/^(diff --git|index |--- |\+\+\+ |\\ No newline)/.test(line)) kind = 'meta';
    else if (line.startsWith('+')) { kind = 'add'; after = newLine++; }
    else if (line.startsWith('-')) { kind = 'remove'; before = oldLine++; }
    else { before = oldLine++; after = newLine++; }
    if (index >= firstLine) markup.push(`<span class="live-code-line ${kind}"><span class="live-code-number">${before}</span><span class="live-code-number">${after}</span><code>${escapeHTML(line) || ' '}</code></span>`);
  }
  code.innerHTML = markup.join('');
  toolbar.append(label, follow);
  preview.append(toolbar, code);
  if (firstLine) {
    const note = document.createElement('div');
    note.className = 'live-code-note';
    note.textContent = `Showing the latest 600 of ${lines.length} patch lines.`;
    preview.append(note);
  }
  follow.addEventListener('click', () => {
    view.follow = !view.follow;
    follow.textContent = view.follow ? 'Following' : 'Follow code';
    follow.setAttribute('aria-pressed', String(view.follow));
    if (view.follow) code.scrollTop = code.scrollHeight;
  });
  code.addEventListener('scroll', () => {
    view.top = code.scrollTop;
    view.left = code.scrollLeft;
    if (code.scrollTop + code.clientHeight < code.scrollHeight - 24 && view.follow) {
      view.follow = false;
      follow.textContent = 'Follow code';
      follow.setAttribute('aria-pressed', 'false');
    }
  });
  requestAnimationFrame(() => {
    if (!code.isConnected) return;
    code.scrollTop = pending && view.follow ? code.scrollHeight : view.top;
    code.scrollLeft = view.left;
  });
  return preview;
}

let liveCodeRenderTimer;
function scheduleLiveCodeRender() {
  if (liveCodeRenderTimer) return;
  liveCodeRenderTimer = setTimeout(() => {
    liveCodeRenderTimer = null;
    renderSurface();
  }, 80);
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
  const stats = changes.map((change) => typeof change.diff === 'string' ? filePatchStats(change.diff) : getFileLineStats(change.path || change.filePath || change.displayPath)).filter(Boolean);
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
    } else {
      if (message.text) {
        const body = document.createElement('div');
        body.className = 'user-message-content';
        body.textContent = message.text;
        user.append(body);
      }
    }
    appendMessageImages(user, message.images);
    if (!state.threadLoading) {
      const actions = document.createElement('div');
      actions.className = 'user-message-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.title = message.turnId ? 'Edit and rerun from this message in a new branch' : 'Edit this message';
      edit.disabled = state.isBusy || state.threadLoading;
      edit.addEventListener('click', () => beginMessageEdit(message));
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.title = message.turnId ? 'Retry from this message in a new branch' : 'Retry this message';
      retry.disabled = state.isBusy || state.threadLoading;
      retry.addEventListener('click', () => { void retryUserMessage(message); });
      actions.append(edit, retry);
      if (message.turnId) {
        const revert = document.createElement('button');
        revert.type = 'button';
        revert.textContent = 'Revert to here';
        revert.title = 'Create a branch before this message. Workspace files are not reverted.';
        revert.disabled = state.isBusy || state.threadLoading;
        revert.addEventListener('click', () => { void revertToUserMessage(message); });
        actions.append(revert);
      }
      user.append(actions);
    }
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
  if (message.completionFinished) {
    const completion = document.createElement('div');
    completion.className = `turn-completion${message.animateCompletion ? ' just-finished' : ''}`;
    completion.setAttribute('role', 'status');
    const durationMs = message.completionDurationMs;
    const totalSeconds = durationMs === null ? 0 : Math.round(durationMs / 1000);
    const durationText = durationMs === null ? '' : durationMs < 1000 ? 'under 1s' : totalSeconds < 60
      ? `${totalSeconds}s`
      : `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
    const label = durationMs === null ? 'Finished' : `Finished in ${durationText}`;
    completion.setAttribute('aria-label', `Task completed. ${label}.`);
    const mark = createOpenAIMark();
    mark.classList.add('turn-completion-mark');
    mark.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.textContent = label;
    completion.append(mark, copy);
    wrapper.append(completion);
    message.animateCompletion = false;
  }
  return wrapper;
}

function imageDataUrl(image) {
  if (typeof image?.dataUrl === 'string' && image.dataUrl.startsWith('data:image/')) return image.dataUrl;
  const mediaType = String(image?.mediaType || image?.mimeType || 'image/png');
  const base64 = String(image?.base64 || image?.data || '');
  return base64 ? `data:${mediaType};base64,${base64}` : '';
}

function imageMediaType(image, dataUrl = imageDataUrl(image)) {
  return String(image?.mediaType || image?.mimeType || dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,/i)?.[1] || 'image/png');
}

function appendMessageImages(container, images = []) {
  const usable = (Array.isArray(images) ? images : []).map((image) => ({ ...image, dataUrl: imageDataUrl(image) })).filter((image) => image.dataUrl);
  if (!usable.length) return;
  const grid = document.createElement('div');
  grid.className = 'message-image-grid';
  for (const image of usable) {
    const preview = document.createElement('img');
    preview.src = image.dataUrl;
    preview.alt = image.name || 'Attached image';
    preview.title = image.name || 'Attached image';
    grid.append(preview);
  }
  container.append(grid);
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
  if (state.approvals.some((request) => ForgeQuestions.isRequest(request.method))) state.activityStatus = 'Waiting for your answer';
  else if (label) state.activityStatus = label;
}

function createLiveActivityTracker() {
  const items = new Map();
  const finished = new Set();
  let sequence = 0;
  let lastConcrete = 0;
  let displayedKey = null;
  const keyFor = (item) => item?.id || item?.type || 'activity';
  const isReasoning = (item) => ['reasoning', 'reasoningSummary'].includes(item?.type);
  function current() {
    const active = [...items.values()].filter((entry) => entry.observed);
    // A reasoning item can span an entire inference. Its lifecycle alone does
    // not establish that the model is still thinking while output is arriving.
    const concrete = active.filter((entry) => !isReasoning(entry.item));
    const candidates = concrete.length ? concrete : active.filter((entry) => entry.sequence > lastConcrete);
    const latest = candidates.sort((a, b) => b.sequence - a.sequence)[0];
    if (latest) displayedKey = latest.key;
    return latest?.label || null;
  }
  function update(item, label, streaming = false) {
    const key = keyFor(item);
    if (finished.has(key)) return current();
    const previous = items.get(key);
    const observed = streaming || item?.type !== 'agentMessage' || previous?.observed || false;
    const entry = { key, item: { ...previous?.item, ...item }, label, observed, sequence: ++sequence };
    items.set(key, entry);
    if (observed && !isReasoning(entry.item)) lastConcrete = sequence;
    return current();
  }
  return {
    start: (item, label) => update(item, label),
    progress: (item, label) => update(item, label, true),
    complete(item, fallback) {
      const key = keyFor(item);
      const wasDisplayed = displayedKey === key;
      items.delete(key);
      finished.add(key);
      const running = current();
      if (running) return running;
      // Delayed completions must not replace a newer operation's status.
      if (displayedKey && !wasDisplayed) return null;
      return isReasoning(item) ? 'Waiting for the next model activity' : fallback;
    },
    current,
    reset() { items.clear(); finished.clear(); sequence = 0; lastConcrete = 0; displayedKey = null; },
  };
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
      const changes = item.changes || [];
      const files = changes.map((change) => change.path || change.filePath || change.displayPath).filter(Boolean);
      const kinds = changes.map((change) => String(typeof change.kind === 'string' ? change.kind : change.kind?.type || change.type || '').toLowerCase());
      const verb = kinds.length && kinds.every((kind) => /^(add|added|create|created|write)$/.test(kind)) ? 'Writing' : kinds.length && kinds.every((kind) => /^(delete|deleted|remove)$/.test(kind)) ? 'Removing' : 'Editing';
      return files.length ? verb + ' ' + activityText(files.join(', '), 78) : 'Preparing file changes';
    }
    case 'webSearch': return item.query ? 'Searching the web for ' + activityText(item.query, 62) : 'Searching the web';
    case 'mcpToolCall': return browserActivityLabel(item.tool, item.arguments || {});
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
    case 'reasoningSummary': return 'Thinking';
    case 'plan': return 'Writing the task plan';
    case 'dynamicToolCall': return 'Using ' + (item.tool || item.toolName || 'a workspace tool');
    default: return item?.type ? 'Processing ' + activityText(String(item.type).replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' '), 68) : 'Waiting for model activity';
  }
}

function browserActivityLabel(tool, args = {}, completed = false) {
  const name = String(tool || '').split('__').at(-1);
  const labels = {
    browser_navigate: ['Opening browser page', 'Opened browser page'],
    browser_snapshot: ['Inspecting browser page', 'Inspected browser page'],
    browser_take_screenshot: ['Taking browser screenshot', 'Captured browser screenshot'],
    browser_click: ['Clicking', 'Clicked'],
    browser_type: ['Typing into', 'Typed into'],
    browser_drag: ['Dragging', 'Dragged'],
    browser_mouse_drag_xy: ['Dragging in the browser', 'Dragged in the browser'],
    browser_console_messages: ['Checking browser console', 'Checked browser console'],
    browser_network_requests: ['Checking browser requests', 'Checked browser requests'],
    browser_run_code: ['Verifying browser behavior', 'Verified browser behavior'],
    browser_evaluate: ['Inspecting browser state', 'Inspected browser state'],
    browser_resize: ['Resizing browser viewport', 'Resized browser viewport'],
    browser_tabs: ['Managing browser tabs', 'Managed browser tabs'],
    browser_wait_for: ['Waiting for browser update', 'Waited for browser update'],
    browser_close: ['Closing browser page', 'Closed browser page'],
  };
  const action = labels[name]?.[completed ? 1 : 0] || String(name || 'browser action').replace(/^browser_/, '').replaceAll('_', ' ');
  const target = args.url || args.element || args.startElement || args.selector;
  return action + (target ? ' · ' + activityText(target, 65) : '');
}

function activityOutcome(item) {
  const status = typeof item?.status === 'string' ? item.status : item?.status?.type || '';
  if (item?.error || Number.isInteger(item?.exitCode) && item.exitCode !== 0 || /fail|error/i.test(status)) return 'Failed';
  if (/interrupt|declin|cancel|stop/i.test(status)) return 'Stopped';
  return '';
}

function fileChangeCompletion(changes = []) {
  const files = changes.map((change) => ({
    path: change.path || change.filePath || change.displayPath,
    kind: String(typeof change.kind === 'string' ? change.kind : change.kind?.type || change.type || '').toLowerCase(),
  })).filter((change) => change.path);
  if (!files.length) return 'Applied file changes';
  const kinds = new Set(files.map(({ kind }) => kind));
  const verb = kinds.size !== 1 ? 'Changed' : ({
    add: 'Added', added: 'Added', create: 'Created', created: 'Created',
    delete: 'Deleted', deleted: 'Deleted', remove: 'Deleted',
    write: 'Wrote', edit: 'Edited', update: 'Updated', updated: 'Updated', modified: 'Edited',
    rename: 'Renamed', renamed: 'Renamed',
  })[files[0].kind] || 'Updated';
  return verb + ' ' + activityText(files.map(({ path }) => path).join(', '), 80);
}

function anthropicToolCompletion(item) {
  const name = String(item.toolName || 'project tool');
  const input = item.input || {};
  const file = String(input.file_path || input.path || input.filePath || '').split(/[\\/]/).filter(Boolean).slice(-2).join('/');
  const path = file ? activityText(file, 66) : '';
  const query = input.query || input.pattern;
  switch (name) {
    case 'Bash': {
      const command = Array.isArray(input.command) ? input.command.join(' ') : input.command;
      return 'Ran ' + (activityText(command, 70) || 'terminal command') + (Number.isInteger(item.exitCode) ? ' · exit ' + item.exitCode : '');
    }
    case 'Read': return 'Read ' + (path || 'project file');
    case 'Write': return 'Wrote ' + (path || 'project file');
    case 'Edit': return 'Edited ' + (path || 'project file');
    case 'NotebookEdit': return 'Updated notebook ' + (path || 'in the project');
    case 'Glob': return 'Found files matching ' + activityText(input.pattern || 'the requested pattern', 64);
    case 'Grep': return 'Searched project files for ' + activityText(query || 'matching text', 64);
    case 'WebSearch': return 'Searched the web for ' + activityText(input.query || 'relevant references', 64);
    case 'WebFetch': return 'Read web page ' + activityText(input.url || 'from the requested address', 72);
    case 'TodoWrite': return 'Updated the task checklist';
    case 'Agent':
    case 'Task': return 'Delegated ' + activityText(input.description || input.prompt || 'the requested task', 70);
    default: {
      const detail = path || (query ? activityText(query, 58) : '');
      return 'Completed ' + name + ' tool call' + (detail ? ' · ' + detail : '');
    }
  }
}

function completedActivityStatus(item) {
  const outcome = activityOutcome(item);
  let action = '';
  switch (item?.type) {
    case 'agentMessage': return 'Response ready';
    case 'commandExecution': {
      const command = Array.isArray(item.command) ? item.command.join(' ') : item.command;
      action = 'Ran ' + (activityText(command, 70) || 'terminal command') + (Number.isInteger(item.exitCode) ? ' · exit ' + item.exitCode : '');
      break;
    }
    case 'fileChange': action = fileChangeCompletion(item.changes || []); break;
    case 'webSearch': action = 'Searched the web' + (item.query ? ' for ' + activityText(item.query, 62) : ''); break;
    case 'mcpToolCall': {
      const label = browserActivityLabel(item.tool, item.arguments || {}, !outcome);
      action = item.server && item.server !== 'forge_browser' ? (outcome ? item.server + ' · ' + label : 'Completed ' + item.server + ' · ' + label) : label;
      break;
    }
    case 'anthropicTool': action = anthropicToolCompletion(item); break;
    case 'anthropicAgentActivity': {
      const name = item.name || 'Agent';
      const task = item.task ? ' · ' + activityText(item.task, 62) : '';
      action = outcome ? name + ' task' + task : name + ' completed its delegated task' + task;
      break;
    }
    case 'collabAgentToolCall':
    case 'collab_tool_call':
    case 'collabToolCall': {
      const agents = Object.keys(item.agents_states || item.agentsStates || {}).length;
      action = agents ? 'Coordinated ' + agents + (agents === 1 ? ' helper agent' : ' helper agents') : 'Updated delegated agent work';
      break;
    }
    case 'subAgentActivity':
    case 'sub_agent_activity': {
      const kind = String(item.kind || '').replaceAll('_', ' ').trim();
      action = /complete|finish|ended/i.test(kind) ? 'Agent completed its task' : kind ? 'Agent update · ' + activityText(kind, 58) : 'Updated delegated agent work';
      break;
    }
    case 'reasoning':
    case 'reasoningSummary': action = 'Waiting for the next model activity'; break;
    case 'plan': action = 'Updated the task plan'; break;
    default: {
      const detail = item?.summary || item?.title || item?.name || item?.toolName || item?.tool || item?.kind;
      const liveDescription = item?.statusMessage;
      const type = String(item?.type || '').replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').trim();
      const label = activityText(detail || type || 'task step', 76);
      action = liveDescription ? activityText(liveDescription, 76) : outcome ? label : 'Completed ' + label;
    }
  }
  return outcome ? outcome + ' · ' + action : action;
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
  renderApprovalSlot();
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
  else if (item.type === 'anthropicTool' || item.type === 'mcpToolCall') activityType = 'tool';
  else return;
  const existing = state.messages.find((message) => message.role === 'activity' && message.id === item.id);
  const next = {
    id: item.id,
    turnId,
    role: 'activity',
    activityType,
    command: item.command || '',
    output: item.aggregatedOutput || (item.type === 'mcpToolCall' ? (item.result?.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n').slice(0, 24000) || item.error?.message || '' : ''),
    changes: item.changes?.length ? item.changes : existing?.changes || [],
    query: item.query || '',
    toolName: item.toolName || (item.type === 'mcpToolCall' ? (item.server === 'forge_browser' ? 'Browser' : item.server) + ' · ' + String(item.tool || '').replace(/^browser_/, '').replaceAll('_', ' ') : ''),
    input: item.input || item.arguments || null,
    statusMessage: item.statusMessage || (item.type === 'mcpToolCall' ? browserActivityLabel(item.tool, item.arguments || {}) : ''),
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
    if (state.activeTurnId && event.params?.turnId && event.params.turnId !== state.activeTurnId) return;
    if (!state.threadId && state.pendingSend && event.params?.threadId) state.threadId = event.params.threadId;
    if (state.browser.active && (state.browser.expanded || $('.main-column').classList.contains('browser-compact'))) setBrowserMode(false);
    const prior = state.approvals.findIndex((request) => String(request.id) === String(event.id));
    if (prior >= 0) state.approvals[prior] = event;
    else state.approvals.push(event);
    setActivityStatus(ForgeQuestions.isRequest(event.method) ? 'Waiting for your answer' : 'Waiting for your approval');
    renderSurface();
    $('#conversation-scroll').scrollTop = $('#conversation-scroll').scrollHeight;
    return;
  }
  if (event.type !== 'notification') return;
  const params = event.params || {};
  const method = event.method;
  if (method === 'serverRequest/resolved') {
    if (state.threadId && params.threadId && params.threadId !== state.threadId) return;
    if (!state.approvals.some((request) => String(request.id) === String(params.requestId))) return;
    state.approvals = state.approvals.filter((request) => String(request.id) !== String(params.requestId));
    state.questionDrafts.delete(String(params.requestId));
    setActivityStatus(state.isBusy ? liveActivities.current() || 'Continuing the task' : 'Ready for your next task');
    renderApprovalSlot();
    return;
  }
  if (/^item\//.test(method || '')) {
    if (state.threadId && params.threadId && params.threadId !== state.threadId) return;
    if (state.activeTurnId && params.turnId && params.turnId !== state.activeTurnId) return;
  }
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
    liveActivities.reset();
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
    setActivityStatus(liveActivities.current() || params.status);
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
      setActivityStatus(liveActivities.current() || (activeStep?.step ? 'Working on · ' + activityText(activeStep.step, 82) : 'Updated the task plan'));
      const existing = state.messages.find((message) => message.role === 'plan' && message.turnId === params.turnId);
      if (existing) existing.text = planText;
      else state.messages.push({ id: `plan-${params.turnId}`, turnId: params.turnId, role: 'plan', text: planText });
      renderSurface();
    }
    return;
  }
  if (method === 'item/agentMessage/delta') {
    if (params.delta) setActivityStatus(liveActivities.progress({ id: params.itemId, type: 'agentMessage' }, 'Writing the response'));
    addOrUpdateAssistant(params, params.delta || '');
    return;
  }
  if (method === 'item/plan/delta') {
    if (params.delta) setActivityStatus(liveActivities.progress({ id: params.itemId, type: 'plan' }, 'Writing the task plan'));
    renderSurface();
    return;
  }
  if (['item/reasoning/summaryTextDelta', 'item/reasoning/textDelta', 'item/reasoning/summaryPartAdded'].includes(method)) {
    setActivityStatus(liveActivities.progress({ id: params.itemId, type: 'reasoning' }, 'Thinking'));
    renderSurface();
    return;
  }
  if (method === 'item/mcpToolCall/progress') {
    if (params.message) setActivityStatus(liveActivities.progress({ id: params.itemId, type: 'mcpToolCall' }, activityText(params.message, 90)));
    renderSurface();
    return;
  }
  if (method === 'item/fileChange/outputDelta') {
    const activity = state.messages.find((message) => message.role === 'activity' && message.id === params.itemId);
    const item = { id: params.itemId, type: 'fileChange', changes: activity?.changes || [] };
    setActivityStatus(liveActivities.progress(item, activityStatusForItem(item)));
    renderSurface();
    return;
  }
  if (method === 'item/fileChange/patchUpdated') {
    if (state.threadId && params.threadId !== state.threadId) return;
    const existing = state.messages.find((message) => message.role === 'activity' && message.id === params.itemId);
    upsertActivity({ id: params.itemId, type: 'fileChange', changes: params.changes || [], status: existing?.status || 'inProgress' }, params.turnId);
    const item = { id: params.itemId, type: 'fileChange', changes: params.changes?.length ? params.changes : existing?.changes || [] };
    setActivityStatus(liveActivities.progress(item, activityStatusForItem(item)));
    scheduleLiveCodeRender();
    return;
  }
  if (['item/commandExecution/outputDelta', 'commandExecution/outputDelta', 'commandExecution/terminalInteraction', 'item/commandExecution/terminalInteraction'].includes(method)) {
    if (state.threadId && params.threadId !== state.threadId) return;
    let activity = state.messages.find((message) => message.role === 'activity' && message.id === params.itemId);
    const command = params.command || activity?.command || '';
    setActivityStatus(liveActivities.progress({ id: params.itemId, type: 'commandExecution', command }, command ? 'Running ' + activityText(Array.isArray(command) ? command.join(' ') : command, 82) : 'Reading command output'));
    if (!activity) { activity = { id: params.itemId, role: 'activity', activityType: 'command', command: params.command || '', output: '', status: 'inProgress' }; state.messages.push(activity); }
    activity.output = `${activity.output || ''}${params.delta || params.text || ''}`;
    renderSurface();
    return;
  }
  if (method === 'item/started') {
    if (state.threadId && params.threadId !== state.threadId) return;
    setActivityStatus(liveActivities.start(params.item, activityStatusForItem(params.item)));
    if (['commandExecution', 'fileChange', 'anthropicTool', 'mcpToolCall'].includes(params.item?.type)) upsertActivity(params.item, params.turnId);
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
    setActivityStatus(liveActivities.complete(item, completedActivityStatus(item)));
    if (item.type === 'agentMessage') {
      let message = state.messages.find((candidate) => candidate.role === 'assistant' && candidate.turnId === params.turnId && candidate.id === item.id);
      if (!message) { message = { id: item.id, turnId: params.turnId, role: 'assistant', text: '' }; state.messages.push(message); }
      if (item.text) message.text = item.text;
      message.pending = false;
    } else if (['commandExecution', 'fileChange', 'webSearch', 'anthropicTool', 'mcpToolCall'].includes(item.type)) upsertActivity(item, params.turnId);
    upsertAgentItem(item, params.turnId);
    renderSurface();
    return;
  }
  if (method === 'turn/started') {
    if (!state.threadId && state.pendingSend) state.threadId = params.threadId;
    if (state.threadId && params.threadId !== state.threadId) return;
    const nextTurnId = params.turn?.id || params.turnId || state.activeTurnId;
    if (nextTurnId !== state.activeTurnId) liveActivities.reset();
    state.activeTurnId = nextTurnId;
    state.turnStartedAt ??= Date.now();
    const latestPrompt = [...state.messages].reverse().find((message) => message.role === 'user')?.text;
    setActivityStatus(latestPrompt ? 'Starting · ' + activityText(latestPrompt, 76) : 'Waiting for model activity');
    state.isBusy = true;
    renderSurface();
    return;
  }
  if (method === 'turn/completed' || method === 'turn/failed' || method === 'turn/interrupted') {
    if (state.threadId && params.threadId !== state.threadId) return;
    const turnId = params.turn?.id || state.activeTurnId;
    const startedAt = state.turnStartedAt;
    state.isBusy = false;
    state.pendingSend = false;
    state.activeTurnId = null;
    state.turnStartedAt = null;
    liveActivities.reset();
    state.activityStatus = 'Ready for your next task';
    state.approvals = state.approvals.filter((request) => request.params?.threadId !== state.threadId);
    for (const message of state.messages) if (message.role === 'assistant' && message.turnId === params.turn?.id) message.pending = false;
    const turnError = params.turn?.error || params.error;
    if (turnError) {
      const errorText = turnError.message || turnError.codexErrorInfo || 'Codex could not complete this task.';
      state.messages.push({ role: 'error', text: typeof errorText === 'string' ? errorText : JSON.stringify(errorText) });
    } else if (method === 'turn/failed') {
      state.messages.push({ role: 'error', text: 'Codex could not complete this task.' });
    } else {
      const finalMessage = [...state.messages].reverse().find((message) => message.role === 'assistant' && (!turnId || !message.turnId || message.turnId === turnId));
      if (finalMessage && !finalMessage.completionFinished) {
        finalMessage.completionFinished = true;
        finalMessage.completionDurationMs = startedAt ? Math.max(0, Date.now() - startedAt) : null;
        finalMessage.animateCompletion = true;
      }
    }
    renderSurface();
    state.treeCache.clear();
    if (state.workspace) void loadTree('');
    refreshState({ quiet: true });
  }
}

function renderApprovalSlot() {
  const pendingIds = new Set(state.approvals.map((request) => String(request.id)));
  for (const id of state.questionDrafts.keys()) if (!pendingIds.has(id)) state.questionDrafts.delete(id);
  const signature = JSON.stringify(state.approvals.map((request) => [request.id, request.method, request.params, state.questionSending.has(String(request.id))]));
  if (signature === state.approvalRenderSignature) return;
  state.approvalRenderSignature = signature;
  $('#approval-slot').replaceChildren(...state.approvals.map(renderApproval));
}

function renderQuestionRequest(event, actor) {
  const requestId = String(event.id);
  const questions = event.params?.questions || [];
  const drafts = state.questionDrafts.get(requestId) || Object.create(null);
  state.questionDrafts.set(requestId, drafts);
  const sending = state.questionSending.has(requestId);
  const card = document.createElement('section');
  card.className = 'approval-card question-card';
  card.dataset.requestId = requestId;
  card.setAttribute('aria-label', actor + ' has a question');
  const header = document.createElement('div');
  header.className = 'question-card-header';
  const title = document.createElement('strong');
  title.textContent = actor + ' has ' + (questions.length > 1 ? 'a few questions' : 'a question');
  const hint = document.createElement('span');
  hint.textContent = 'YOUR INPUT';
  header.append(title, hint);
  card.append(header);
  questions.forEach((question, questionIndex) => {
    const draft = drafts[question.id] || (drafts[question.id] = { selected: [], custom: '', useCustom: !question.options?.length });
    const group = document.createElement('fieldset');
    group.className = 'question-section';
    group.disabled = sending;
    const legend = document.createElement('legend');
    legend.textContent = question.header || 'Question ' + (questionIndex + 1);
    const prompt = document.createElement('p');
    prompt.className = 'question-prompt';
    prompt.textContent = question.question;
    group.append(legend, prompt);
    if (question.multiSelect) {
      const instruction = document.createElement('small');
      instruction.className = 'question-instruction';
      instruction.textContent = 'Select all that apply';
      group.append(instruction);
    }
    const choices = [];
    const name = 'question-' + requestId + '-' + questionIndex;
    for (const option of question.options || []) {
      const label = document.createElement('label');
      label.className = 'question-choice';
      const input = document.createElement('input');
      input.type = question.multiSelect ? 'checkbox' : 'radio';
      input.name = name;
      input.value = option.label;
      input.checked = draft.selected.includes(option.label) && (question.multiSelect || !draft.useCustom);
      const copy = document.createElement('span');
      copy.className = 'question-option-copy';
      const optionTitle = document.createElement('strong');
      optionTitle.textContent = option.label;
      copy.append(optionTitle);
      if (option.description) {
        const description = document.createElement('span');
        description.textContent = option.description;
        copy.append(description);
      }
      label.append(input, copy);
      group.append(label);
      choices.push(input);
    }
    let customToggle = null;
    let custom = null;
    if (!question.options?.length || question.isOther) {
      if (question.options?.length) {
        const label = document.createElement('label');
        label.className = 'question-choice question-custom-choice';
        customToggle = document.createElement('input');
        customToggle.type = question.multiSelect ? 'checkbox' : 'radio';
        customToggle.name = name;
        customToggle.checked = draft.useCustom;
        const caption = document.createElement('span');
        caption.textContent = 'Something else';
        label.append(customToggle, caption);
        group.append(label);
      }
      custom = document.createElement('input');
      custom.type = question.isSecret ? 'password' : 'text';
      custom.className = 'question-custom-input';
      custom.placeholder = 'Write your answer…';
      custom.setAttribute('aria-label', 'Your answer to ' + question.question);
      custom.autocomplete = 'off';
      custom.value = draft.custom;
      group.append(custom);
    }
    group.addEventListener('input', (inputEvent) => {
      if (inputEvent.target === custom) {
        if (customToggle) customToggle.checked = true;
        if (!question.multiSelect) choices.forEach((choice) => { choice.checked = false; });
      }
      draft.selected = choices.filter((choice) => choice.checked).map((choice) => choice.value);
      draft.useCustom = customToggle ? customToggle.checked : !question.options?.length;
      draft.custom = custom?.value || '';
      updateSubmit();
    });
    card.append(group);
  });
  const actions = document.createElement('div');
  actions.className = 'approval-actions question-actions';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.textContent = 'Skip for now';
  skip.dataset.approvalId = requestId;
  skip.dataset.decision = 'skip';
  skip.disabled = sending;
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'question-submit';
  submit.textContent = sending ? 'Sending…' : questions.length > 1 ? 'Send answers' : 'Send answer';
  submit.dataset.approvalId = requestId;
  submit.dataset.decision = 'answer';
  function updateSubmit() {
    try { ForgeQuestions.fromDraft(questions, drafts); submit.disabled = sending; }
    catch { submit.disabled = true; }
  }
  updateSubmit();
  actions.append(skip, submit);
  card.append(actions);
  return card;
}

function renderPluginRequest(event) {
  const params = event.params || {};
  const card = document.createElement('section'); card.className = 'approval-card plugin-request-card'; card.id = 'plugin-request-' + event.id;
  const title = document.createElement('div'); title.className = 'approval-topline'; title.textContent = (params.serverName || 'Plugin') + ' needs your input';
  const message = document.createElement('p'); message.textContent = params.message || params.description || 'Complete this step to continue.';
  card.append(title, message);
  let supported = true;
  if (params.mode === 'url') {
    if (/^https:\/\//i.test(params.url || '')) {
      const link = document.createElement('a'); link.className = 'plugin-signin-link'; link.href = params.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open sign-in page ↗';
      const hint = document.createElement('small'); hint.textContent = 'Complete the sign-in, then click Continue below.'; card.append(link, hint);
    } else { supported = false; const note = document.createElement('p'); note.textContent = 'This plugin returned an unsupported sign-in address.'; card.append(note); }
  } else if (['form', 'openai/form', 'openaiForm'].includes(params.mode)) {
    try {
      for (const field of ForgePluginForms.fields(params.requestedSchema)) {
        const label = document.createElement('label'); label.className = 'plugin-request-field';
        const name = document.createElement('span'); name.textContent = field.title + (field.required ? ' *' : ''); label.append(name);
        let control;
        if (field.options?.length || field.type === 'boolean') {
          control = document.createElement('select');
          if (field.type === 'array') control.multiple = true;
          else { const blank = document.createElement('option'); blank.value = ''; blank.textContent = 'Choose an option'; control.append(blank); }
          const options = field.type === 'boolean' ? [{ value: true, label: 'Yes' }, { value: false, label: 'No' }] : field.options;
          options.forEach((option, index) => {
            const node = document.createElement('option'); node.value = field.type === 'boolean' ? String(option.value) : String(index); node.textContent = option.label;
            node.selected = field.type === 'array' ? (field.default || []).includes(option.value) : field.default === option.value;
            control.append(node);
          });
        } else {
          control = document.createElement('input'); control.type = ['number', 'integer'].includes(field.type) ? 'number' : field.format === 'email' ? 'email' : field.format === 'uri' ? 'url' : field.format === 'date' ? 'date' : 'text';
          if (['number', 'integer'].includes(field.type)) { control.step = field.type === 'integer' ? '1' : 'any'; if (field.minimum != null) control.min = String(field.minimum); if (field.maximum != null) control.max = String(field.maximum); }
          else { control.maxLength = Math.min(field.maxLength ?? 10000, 10000); if (field.minLength) control.minLength = field.minLength; }
          if (field.default !== undefined) control.value = String(field.default);
        }
        control.dataset.pluginField = field.key; control.required = field.required; label.append(control);
        if (field.description) { const description = document.createElement('small'); description.textContent = field.description; label.append(description); }
        card.append(label);
      }
    } catch (error) { supported = false; const note = document.createElement('p'); note.textContent = error.message; card.append(note); }
  } else { supported = false; const note = document.createElement('p'); note.textContent = 'This verification requires the Codex app. Open the plugin there to finish connecting.'; card.append(note); }
  const actions = document.createElement('div'); actions.className = 'approval-actions';
  for (const [decision, text] of [['decline', 'Decline'], ['accept', 'Continue']]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.dataset.approvalId = String(event.id); button.dataset.decision = decision;
    button.className = decision === 'accept' ? 'approval-allow' : 'approval-deny'; button.disabled = decision === 'accept' && !supported; actions.append(button);
  }
  card.append(actions); return card;
}

function renderApproval(event) {
  if (event.method === 'mcpServer/elicitation/request') return renderPluginRequest(event);
  const card = document.createElement('section');
  card.className = 'approval-card';
  const method = event.method || '';
  const params = event.params || {};
  const isCommand = ['commandExecution/requestApproval', 'item/commandExecution/requestApproval', 'execCommandApproval'].includes(method);
  const isFile = ['fileChange/requestApproval', 'item/fileChange/requestApproval', 'applyPatchApproval'].includes(method);
  const isPermissions = method === 'item/permissions/requestApproval';
  const isQuestion = ForgeQuestions.isRequest(method);
  const isAnthropic = method === 'anthropic/tool/requestApproval';
  const actor = state.threadProviderId === 'openai' ? 'Codex' : state.threadProviderId === 'anthropic' ? 'Claude' : state.providers.find((provider) => provider.id === state.threadProviderId)?.name || 'This model';
  if (isQuestion) return renderQuestionRequest(event, actor);
  const title = document.createElement('div');
  title.className = 'approval-topline';
  const mark = document.createElement('span');
  mark.textContent = isAnthropic ? 'A' : '◈';
  const titleText = isAnthropic
    ? 'Claude wants permission · ' + (params.toolName || 'project tool')
    : isPermissions ? `${actor} requests extra access` : isCommand ? `${actor} wants to run a command` : isFile ? `${actor} needs approval for file changes` : isQuestion ? `${actor} has a question` : 'Codex is requesting extra access';
  title.append(mark, document.createTextNode(titleText));
  card.append(title);
  if (isCommand) {
    const command = document.createElement('pre');
    command.className = 'approval-command';
    command.textContent = Array.isArray(params.command) ? params.command.join(' ') : params.command || (params.commandActions || []).map((action) => action.cmd || action.name).filter(Boolean).join('\n') || 'Review the requested command.';
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
    if (method === 'applyPatchApproval' && params.fileChanges) {
      const changes = document.createElement('pre');
      changes.className = 'approval-command';
      changes.textContent = Object.keys(params.fileChanges).join('\n') || 'File changes requested';
      card.append(changes);
    }
  } else if (isPermissions) {
    const note = document.createElement('p');
    note.textContent = params.reason || `${actor} needs additional workspace or network permissions to continue.`;
    card.append(note);
    const requested = document.createElement('pre');
    requested.className = 'approval-command';
    requested.textContent = JSON.stringify(params.permissions || {}, null, 2);
    card.append(requested);
    if (params.cwd) {
      const cwd = document.createElement('p');
      cwd.textContent = `Working directory · ${params.cwd}`;
      card.append(cwd);
    }
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
  } else if (isPermissions) {
    addButton('Accept', 'approval-allow', 'accept');
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
  const isQuestion = ForgeQuestions.isRequest(event.method);
  let pluginButtonStates = [];
  if (state.questionSending.has(String(id))) return;
  try {
    let body = { id, decision };
    if (event.method === 'mcpServer/elicitation/request' && decision === 'accept' && event.params.mode !== 'url') {
      const form = document.getElementById('plugin-request-' + id);
      const content = Object.create(null);
      for (const field of ForgePluginForms.fields(event.params.requestedSchema)) {
        const control = Array.from(form.querySelectorAll('[data-plugin-field]')).find((input) => input.dataset.pluginField === field.key);
        if (!control || !control.reportValidity()) return;
        if (field.type === 'array') content[field.key] = Array.from(control.selectedOptions).map((option) => field.options[Number(option.value)].value);
        else if (control.value !== '') content[field.key] = field.options?.length ? field.options[Number(control.value)].value : field.type === 'boolean' ? control.value === 'true' : ['number', 'integer'].includes(field.type) ? Number(control.value) : control.value;
      }
      body.content = ForgePluginForms.validate(event.params.requestedSchema, content);
    }
    if (decision === 'answer') {
      body.answers = ForgeQuestions.fromDraft(event.params?.questions || [], state.questionDrafts.get(String(id)));
    }
    if (isQuestion) { state.questionSending.add(String(id)); renderApprovalSlot(); }
    else if (event.method === 'mcpServer/elicitation/request') {
      state.questionSending.add(String(id));
      pluginButtonStates = Array.from(document.getElementById('plugin-request-' + id)?.querySelectorAll('button') || []).map((button) => [button, button.disabled]);
      pluginButtonStates.forEach(([button]) => { button.disabled = true; });
    }
    await api('/api/approval', { method: 'POST', body });
    state.approvals = state.approvals.filter((request) => String(request.id) !== String(id));
    if (isQuestion) setActivityStatus(liveActivities.current() || 'Continuing with your answer');
  } catch (error) { showToast(error.message, 'error'); }
  finally {
    state.questionSending.delete(String(id));
    pluginButtonStates.forEach(([button, disabled]) => { button.disabled = disabled; });
    renderMessages();
  }
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
  liveActivities.reset();
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
  state.messages = (result.messages || []).filter((message) => message.role !== 'agent-event').map((message) => ({ ...message, threadId: result.thread.id }));
  state.historyVisibleCount = 60;
  for (const event of (result.messages || []).filter((message) => message.role === 'agent-event')) upsertAgentItem(event.item, event.turnId);
  state.approvals = [];
  state.activeTurnId = null;
  state.turnStartedAt = null;
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
  state.messageEditTarget = null;
  state.historyVisibleCount = 60;
  state.approvals = [];
  state.activeTurnId = null;
  state.pendingSend = false;
  state.diff = '';
  renderAll();

  if (cached) {
    state.threadHistoryCache.delete(threadId);
    state.threadHistoryCache.set(threadId, cached);
    // Reopen on the server even when the UI has cached history: the server also
    // owns activeWorkspace, which must follow this thread before file actions run.
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

async function sendMessage(textOverride, { readOnlyOverride, routingText, replaceMessageId, imagesOverride } = {}) {
  if (state.isBusy) return;
  if (state.threadLoading) { showToast('Wait for the selected session to finish opening.'); return; }
  if (!state.workspace) { openWorkspaceDialog(); return; }
  let selectedModel = state.models.find((model) => model.id === state.modelId);
  const textarea = $('#prompt-input');
  const text = String(textOverride ?? textarea.value).trim();
  const pluginMentions = textOverride === undefined && selectedModel?.providerId !== 'anthropic'
    ? state.composerPluginMentions.filter((mention) => text.includes(mention.token)).map((mention) => ({ pluginId: mention.pluginId }))
    : [];
  const selectedImages = (imagesOverride ?? state.pendingImages).map((image) => {
    const dataUrl = imageDataUrl(image);
    return { ...image, dataUrl, mediaType: imageMediaType(image, dataUrl) };
  }).filter((image) => image.dataUrl);
  if (!text && !selectedImages.length) return;
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
  const editTarget = state.messageEditTarget;
  if (editTarget?.turnId) {
    try {
      state.threadLoading = true;
      renderSurface();
      await openBranchBeforeMessage(editTarget);
      state.messageEditTarget = null;
      renderMessageEditBanner();
    } catch (error) {
      state.threadLoading = false;
      renderSurface();
      showToast(error.message || 'Could not branch this conversation for editing.', 'error');
      return false;
    }
  }
  const replacedMessageId = replaceMessageId || (editTarget && !editTarget.turnId ? editTarget.id : null);
  if (replacedMessageId) {
    let removedError = false;
    state.messages = state.messages.filter((message) => {
      if (message.id === replacedMessageId) return false;
      if (message.role === 'error' && !removedError) { removedError = true; return false; }
      return true;
    });
    state.messageEditTarget = null;
    renderMessageEditBanner();
  }
  state.pendingSend = true;
  state.isBusy = true;
  state.turnStartedAt = Date.now();
  liveActivities.reset();
  state.activityStatus = automaticRoute ? `Auto · ${selectedModel.name} · ${automaticRoute.reason}` : 'Starting task';
  const userMessage = { id: `user-${Date.now()}`, role: 'user', text, images: selectedImages, threadId: state.threadId };
  state.messages.push(userMessage);
  state.messages.push({ id: `pending-${Date.now()}`, role: 'assistant', turnId: null, text: '', pending: true });
  textarea.value = '';
  state.composerPluginMentions = [];
  closePluginMentionMenu();
  setPendingImages([]);
  resizeComposer();
  const assignment = parseAgentAssignment(text);
  state.threadName ||= (assignment ? `Delegate ${assignment.name}` : (text || 'Review attached image')).replace(/\s+/g, ' ').slice(0, 64);
  renderSurface();
  try {
    const result = await api('/api/messages', { method: 'POST', body: {
      threadId: state.threadId,
      text,
      pluginMentions,
      model: selectedModel.providerModel || state.modelId,
      providerId: selectedModel.providerId || 'openai',
      providerModel: selectedModel.providerModel || '',
      images: selectedImages.map((image) => ({
        name: image.name,
        mediaType: image.mediaType,
        base64: image.dataUrl.slice(image.dataUrl.indexOf(',') + 1),
      })),
      effort: state.effort,
      readOnly: $('#access-select').value === 'plan' || (readOnlyOverride ?? ($('#access-select').value === 'read')),
      planningMode: $('#access-select').value === 'plan',
    } });
    state.threadId = result.threadId;
    userMessage.threadId = result.threadId;
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
    state.turnStartedAt = null;
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
  $('#attach-image').disabled = !state.workspace || state.isBusy || state.threadLoading;
  $('#stop-turn').hidden = !state.isBusy;
  $('#prompt-input').disabled = state.isBusy || state.threadLoading;
  $('#plan-build').disabled = state.isBusy || state.threadLoading;
}

function resizeComposer() {
  const textarea = $('#prompt-input');
  const manualHeight = window.ForgeTheme?.getComposerHeight() || 0;
  if (manualHeight) textarea.style.height = `${Math.min(manualHeight, Math.max(64, innerHeight * .4))}px`;
  else {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }
  const grip = $('#composer-resize-grip');
  grip.setAttribute('aria-valuemin', '64');
  grip.setAttribute('aria-valuemax', '360');
  grip.setAttribute('aria-valuenow', String(Math.round(textarea.getBoundingClientRect().height)));
}

function pluginDisplayName(plugin) {
  if (/^app-[a-f0-9]{24,}$/i.test(plugin.name)) return 'Connected app';
  return String(plugin.name || plugin.pluginId).replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function renderPluginManager() {
  const plugins = state.plugins;
  $('#plugin-account-title').textContent = state.account?.connected ? 'Synced with Codex' : 'Codex profile';
  $('#plugin-account-description').textContent = state.account?.connected
    ? 'Same ChatGPT sign-in, plugin installs, and marketplace sources.'
    : 'Sign in to Codex to sync installs and marketplace sources.';
  $$('.plugin-view-tabs [data-plugin-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.pluginView === plugins.view)));
  $('#plugin-search-toolbar').hidden = plugins.view === 'marketplaces';
  $('#plugin-source-actions').hidden = plugins.view !== 'marketplaces';
  $('#plugin-source-form').hidden = plugins.view !== 'marketplaces' || !plugins.sourceFormOpen;
  $('#plugin-refresh').disabled = Boolean(plugins.busyKey);
  $('#plugin-marketplaces-refresh').disabled = Boolean(plugins.busyKey);
  $('#plugin-add-source').disabled = Boolean(plugins.busyKey);
  $('#plugin-load-more').hidden = plugins.view !== 'discover' || plugins.available.length >= plugins.total || !plugins.available.length;
  $('#plugin-load-more').disabled = plugins.loading || Boolean(plugins.busyKey);
  $('#plugin-search-input').value = plugins.query;
  const status = $('#plugin-status');
  status.classList.toggle('is-error', Boolean(plugins.error));
  if (plugins.error) status.textContent = plugins.error;
  else if (plugins.loading) status.textContent = plugins.view === 'discover' ? 'Searching Codex plugin directory…' : 'Syncing with Codex…';
  else if (plugins.view === 'installed') status.textContent = `${plugins.installed.length} installed · Shared with your Codex account`;
  else if (plugins.view === 'discover') status.textContent = `${plugins.total.toLocaleString()} plugins available from your Codex sources`;
  else status.textContent = `${plugins.marketplaces.length} marketplace ${plugins.marketplaces.length === 1 ? 'source' : 'sources'} configured in Codex`;
  const list = $('#plugin-list');
  list.replaceChildren();
  if (plugins.view === 'marketplaces') {
    if (!plugins.marketplaces.length) {
      const empty = document.createElement('div');
      empty.className = 'context-empty';
      empty.textContent = 'Codex has no marketplace sources configured yet. Add a GitHub repository, Git URL, or local marketplace folder.';
      list.append(empty);
    }
    for (const marketplace of plugins.marketplaces) {
      const card = document.createElement('article');
      card.className = 'plugin-card plugin-marketplace-card';
      const mark = document.createElement('span');
      mark.className = 'plugin-card-mark';
      mark.textContent = '⌘';
      const copy = document.createElement('span');
      copy.className = 'plugin-card-copy';
      const name = document.createElement('strong');
      name.textContent = marketplace.name;
      const path = document.createElement('small');
      path.textContent = marketplace.root;
      path.title = marketplace.root;
      copy.append(name, path);
      card.append(mark, copy);
      if (!marketplace.name.toLowerCase().startsWith('openai-')) {
        const remove = document.createElement('button');
        remove.className = 'plugin-action quiet';
        remove.type = 'button';
        remove.textContent = plugins.busyKey === `marketplace:${marketplace.name}` ? 'Removing…' : 'Remove';
        remove.dataset.pluginAction = 'marketplace-remove';
        remove.dataset.marketplaceName = marketplace.name;
        remove.disabled = Boolean(plugins.busyKey);
        card.append(remove);
      }
      list.append(card);
    }
    return;
  }
  let rows = plugins.view === 'installed' ? plugins.installed : plugins.available;
  if (plugins.view === 'installed' && plugins.query) {
    const query = plugins.query.toLocaleLowerCase();
    rows = rows.filter((plugin) => `${plugin.name} ${plugin.pluginId} ${plugin.marketplaceName}`.toLocaleLowerCase().includes(query));
  }
  if (plugins.loading && !rows.length) {
    const loading = document.createElement('div');
    loading.className = 'context-empty';
    loading.textContent = 'Loading plugins from Codex…';
    list.append(loading);
    return;
  }
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'context-empty';
    empty.textContent = plugins.view === 'installed'
      ? 'No installed plugins match that search.'
      : plugins.query ? 'No Codex plugins match that search.' : 'No plugins are available from the configured Codex marketplaces.';
    list.append(empty);
  }
  for (const plugin of rows) {
    const card = document.createElement('article');
    card.className = 'plugin-card';
    const mark = document.createElement('span');
    mark.className = 'plugin-card-mark';
    mark.textContent = '✳';
    const copy = document.createElement('span');
    copy.className = 'plugin-card-copy';
    const name = document.createElement('strong');
    name.textContent = pluginDisplayName(plugin);
    name.title = plugin.pluginId;
    const meta = document.createElement('small');
    meta.textContent = `${plugin.marketplaceName || 'Codex'}${plugin.version ? ` · v${plugin.version}` : ''}`;
    copy.append(name, meta);
    card.append(mark, copy);
    if (plugins.view === 'installed') {
      const setup = document.createElement('button');
      setup.className = 'plugin-action'; setup.type = 'button'; setup.textContent = plugins.setupOpen === plugin.pluginId ? 'Hide' : 'Setup';
      setup.dataset.pluginAction = 'setup'; setup.dataset.pluginId = plugin.pluginId;
      setup.setAttribute('aria-expanded', String(plugins.setupOpen === plugin.pluginId));
      const toggle = document.createElement('button');
      toggle.className = `plugin-enable${plugin.enabled ? ' enabled' : ''}`;
      toggle.type = 'button';
      toggle.textContent = plugins.busyKey === plugin.pluginId ? 'Saving…' : plugin.enabled ? 'On' : 'Off';
      toggle.setAttribute('aria-label', `${plugin.enabled ? 'Disable' : 'Enable'} ${pluginDisplayName(plugin)}`);
      toggle.setAttribute('aria-pressed', String(plugin.enabled));
      toggle.dataset.pluginAction = 'toggle';
      toggle.dataset.pluginId = plugin.pluginId;
      toggle.dataset.enabled = String(!plugin.enabled);
      const remove = document.createElement('button');
      remove.className = 'plugin-action quiet';
      remove.type = 'button';
      remove.textContent = plugins.busyKey === `remove:${plugin.pluginId}` ? 'Removing…' : 'Uninstall';
      remove.dataset.pluginAction = 'remove';
      remove.dataset.pluginId = plugin.pluginId;
      remove.disabled = Boolean(plugins.busyKey);
      toggle.disabled = Boolean(plugins.busyKey);
      card.append(setup, toggle, remove);
    } else {
      const install = document.createElement('button');
      install.className = 'plugin-action install';
      install.type = 'button';
      install.textContent = plugins.busyKey === `install:${plugin.pluginId}` ? 'Installing…' : 'Install';
      install.dataset.pluginAction = 'install';
      install.dataset.pluginId = plugin.pluginId;
      install.disabled = Boolean(plugins.busyKey);
      card.append(install);
    }
    list.append(card);
    if (plugins.setupOpen === plugin.pluginId && plugins.view === 'installed') list.append(renderPluginSetup(plugin));
  }
  $('#plugin-load-more').hidden = plugins.view !== 'discover' || plugins.available.length >= plugins.total || !plugins.available.length;
  $('#plugin-load-more').disabled = plugins.loading || Boolean(plugins.busyKey);
}

function renderPluginSetup(plugin) {
  const panel = document.createElement('section'); panel.className = 'plugin-setup-panel';
  const setup = state.plugins.setupDetails?.get(plugin.pluginId);
  const note = document.createElement('p');
  note.textContent = setup?.description || (setup ? 'Plugin capabilities and account connections' : 'Checking plugin connections…');
  panel.append(note);
  if (!setup) return panel;
  if (setup.error) { note.textContent = setup.error; return panel; }
  for (const app of setup.apps) {
    const row = document.createElement('div'); row.className = 'plugin-connection-row';
    const label = document.createElement('span'); label.textContent = app.name;
    const status = document.createElement('small'); status.className = app.callable ? 'is-ready' : ''; status.textContent = app.callable ? 'Connected · Ready' : app.available && !app.enabled ? 'Disabled in Codex' : 'Connection needed';
    row.append(label, status);
    if (app.available && !app.enabled) {
      const enable = document.createElement('button'); enable.type = 'button'; enable.className = 'plugin-action'; enable.textContent = 'Enable';
      enable.addEventListener('click', async () => {
        enable.disabled = true;
        try { await api('/api/plugins/app/enable', { method: 'POST', body: { pluginId: plugin.pluginId, appId: app.id } }); await openPluginSetup(plugin.pluginId, true); }
        catch (error) { showToast(error.message, 'error'); enable.disabled = false; }
      }); row.append(enable);
    } else if (!app.callable && /^https:\/\//i.test(app.installUrl || '')) {
      const connect = document.createElement('a'); connect.className = 'plugin-action'; connect.href = app.installUrl; connect.target = '_blank'; connect.rel = 'noopener noreferrer'; connect.textContent = 'Connect'; row.append(connect);
    }
    panel.append(row);
  }
  for (const server of setup.servers) {
    const row = document.createElement('div'); row.className = 'plugin-connection-row';
    const label = document.createElement('span'); label.textContent = server.name;
    const status = document.createElement('small'); status.textContent = server.error || `${server.toolCount} tools · ${server.authStatus === 'notLoggedIn' ? 'Sign-in needed' : 'Available'}`; status.title = status.textContent;
    row.append(label, status);
    if (server.authStatus === 'notLoggedIn') {
      const connect = document.createElement('button'); connect.type = 'button'; connect.className = 'plugin-action'; connect.textContent = 'Sign in';
      connect.addEventListener('click', async () => {
        connect.disabled = true;
        try { const result = await api('/api/plugins/connect', { method: 'POST', body: { pluginId: plugin.pluginId, serverName: server.name } }); if (!/^https:\/\//i.test(result.authorizationUrl || '')) throw new Error('This provider returned an unsupported sign-in URL.'); window.open(result.authorizationUrl, '_blank', 'noopener'); }
        catch (error) { showToast(error.message, 'error'); } finally { connect.disabled = false; }
      }); row.append(connect);
    }
    panel.append(row);
  }
  const summary = document.createElement('small'); summary.textContent = `${setup.skills.length} skills${!setup.apps.length && !setup.servers.length ? ' · No additional account connection required' : ''}`; panel.append(summary);
  const actions = document.createElement('div'); actions.className = 'plugin-setup-actions';
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'plugin-action'; refresh.textContent = 'Refresh connections'; refresh.addEventListener('click', () => void openPluginSetup(plugin.pluginId, true));
  const use = document.createElement('button'); use.type = 'button'; use.className = 'plugin-action'; use.textContent = 'Use in chat'; use.disabled = !plugin.enabled || state.models.find((model) => model.id === state.modelId)?.providerId === 'anthropic';
  if (use.disabled) use.title = 'Enable the plugin and choose a Codex-backed model to use it.';
  use.addEventListener('click', () => {
    const token = '@' + plugin.name;
    const input = $('#prompt-input'); input.value = (input.value ? input.value.trimEnd() + ' ' : '') + token + ' ';
    if (!state.composerPluginMentions.some((entry) => entry.pluginId === plugin.pluginId)) state.composerPluginMentions.push({ pluginId: plugin.pluginId, token });
    input.focus(); resizeComposer();
  }); actions.append(refresh, use); panel.append(actions);
  return panel;
}

async function openPluginSetup(pluginId, refresh = false) {
  state.plugins.setupOpen = pluginId;
  state.plugins.setupDetails ||= new Map();
  state.plugins.setupDetails.delete(pluginId);
  renderPluginManager();
  try {
    const result = await api(`/api/plugins/setup?pluginId=${encodeURIComponent(pluginId)}${refresh ? '&refresh=1' : ''}`);
    state.plugins.setupDetails.set(pluginId, result);
  } catch (error) { state.plugins.setupDetails.set(pluginId, { error: error.message }); }
  renderPluginManager();
}

async function loadPluginView({ append = false, force = false } = {}) {
  const plugins = state.plugins;
  const view = plugins.view;
  const requestId = ++plugins.requestId;
  const offset = view === 'discover' && append ? plugins.available.length : 0;
  plugins.loading = true;
  plugins.error = '';
  if (!append && view === 'discover') plugins.available = [];
  renderPluginManager();
  const params = new URLSearchParams({ view });
  if (view === 'discover') {
    params.set('q', plugins.query);
    params.set('offset', String(offset));
    params.set('limit', '36');
  }
  if (force) params.set('refresh', '1');
  try {
    const result = await api(`/api/plugins?${params}`);
    if (requestId !== plugins.requestId) return;
    if (view === 'installed') { plugins.installed = result.plugins || []; plugins.installedLoaded = true; }
    else if (view === 'discover') {
      plugins.available = append ? [...plugins.available, ...(result.plugins || [])] : (result.plugins || []);
      plugins.total = result.total || 0;
      plugins.offset = offset;
    } else plugins.marketplaces = result.marketplaces || [];
    plugins.loaded = true;
  } catch (error) {
    if (requestId === plugins.requestId) plugins.error = error.message || 'Could not sync plugins with Codex.';
  } finally {
    if (requestId === plugins.requestId) {
      plugins.loading = false;
      renderPluginManager();
    }
  }
}

async function runPluginAction(action, pluginId, extra = {}) {
  const plugins = state.plugins;
  if (plugins.busyKey) return;
  const key = action === 'remove' ? `remove:${pluginId}` : action === 'install' ? `install:${pluginId}` : action === 'marketplace-remove' ? `marketplace:${extra.name}` : pluginId || action;
  plugins.busyKey = key;
  plugins.error = '';
  renderPluginManager();
  try {
    if (action === 'install') await api('/api/plugins/install', { method: 'POST', body: { pluginId } });
    else if (action === 'remove') await api('/api/plugins/remove', { method: 'POST', body: { pluginId } });
    else if (action === 'toggle') await api('/api/plugins/enabled', { method: 'POST', body: { pluginId, enabled: extra.enabled } });
    else if (action === 'marketplace-remove') await api('/api/plugins/marketplaces/remove', { method: 'POST', body: { name: extra.name } });
    plugins.loaded = false;
    plugins.installedLoaded = false;
    await loadPluginView({ force: true });
    showToast(action === 'install' ? 'Plugin installed in your Codex account. Start a new session to use it.' : action === 'remove' ? 'Plugin removed from your Codex account.' : action === 'toggle' ? 'Plugin setting synced with Codex. Start a new session to apply it.' : 'Marketplace removed from your Codex account.');
  } catch (error) {
    plugins.error = error.message || 'Could not update Codex plugins.';
    showToast(plugins.error, 'error');
  } finally {
    plugins.busyKey = '';
    renderPluginManager();
  }
}

async function syncPluginSources() {
  const plugins = state.plugins;
  if (plugins.busyKey) return;
  plugins.busyKey = 'sync';
  plugins.error = '';
  renderPluginManager();
  try {
    await api('/api/plugins/marketplaces/refresh', { method: 'POST', body: {} });
    plugins.loaded = false;
    await loadPluginView({ force: true });
    showToast('Forge is synced with your Codex plugin sources.');
  } catch (error) {
    plugins.error = error.message || 'Could not sync Codex plugin sources.';
    showToast(plugins.error, 'error');
  } finally {
    plugins.busyKey = '';
    renderPluginManager();
  }
}

async function addPluginMarketplace(event) {
  event.preventDefault();
  const input = $('#plugin-source-input');
  const source = input.value.trim();
  if (!source || state.plugins.busyKey) return;
  state.plugins.busyKey = 'marketplace-add';
  state.plugins.error = '';
  renderPluginManager();
  try {
    const result = await api('/api/plugins/marketplaces/add', { method: 'POST', body: { source } });
    state.plugins.marketplaces = result.marketplaces || [];
    input.value = '';
    state.plugins.sourceFormOpen = false;
    state.plugins.loaded = true;
    showToast('Marketplace added to your Codex account.');
  } catch (error) {
    state.plugins.error = error.message || 'Could not add this marketplace.';
    showToast(state.plugins.error, 'error');
  } finally {
    state.plugins.busyKey = '';
    renderPluginManager();
  }
}

function getPluginMentionContext() {
  const textarea = $('#prompt-input');
  const model = state.models.find((item) => item.id === state.modelId);
  if (model?.providerId === 'anthropic') return null;
  const beforeCursor = textarea.value.slice(0, textarea.selectionStart);
  const match = /(?:^|\s)@([\w.-]*)$/.exec(beforeCursor);
  if (!match) return null;
  return { start: textarea.selectionStart - match[1].length - 1, end: textarea.selectionStart, query: match[1].toLocaleLowerCase() };
}

function closePluginMentionMenu() {
  const menu = $('#plugin-mention-menu');
  menu.hidden = true;
  $('#prompt-input').setAttribute('aria-expanded', 'false');
  state.plugins.mentionContext = null;
  state.plugins.mentionRows = [];
  state.plugins.mentionSelectedIndex = 0;
}

function renderPluginMentionMenu() {
  const list = $('#plugin-mention-options');
  const plugins = state.plugins;
  list.replaceChildren();
  if (plugins.mentionLoading && !plugins.installedLoaded) {
    const loading = document.createElement('div');
    loading.className = 'plugin-mention-empty';
    loading.textContent = 'Loading installed plugins…';
    list.append(loading);
    return;
  }
  const query = plugins.mentionContext?.query || '';
  const rows = plugins.installed.filter((plugin) => plugin.enabled && (!query || `${plugin.name} ${plugin.marketplaceName}`.toLocaleLowerCase().includes(query))).slice(0, 10);
  plugins.mentionRows = rows;
  plugins.mentionSelectedIndex = Math.min(plugins.mentionSelectedIndex, Math.max(0, rows.length - 1));
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'plugin-mention-empty';
    empty.textContent = query ? 'No enabled plugins match that name.' : 'No enabled plugins are available to mention.';
    list.append(empty);
    return;
  }
  rows.forEach((plugin, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'plugin-mention-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(index === plugins.mentionSelectedIndex));
    option.dataset.pluginIndex = String(index);
    const mark = document.createElement('span');
    mark.className = 'plugin-mention-mark';
    mark.textContent = '✳';
    const copy = document.createElement('span');
    copy.className = 'plugin-mention-copy';
    const name = document.createElement('strong');
    name.textContent = pluginDisplayName(plugin);
    const source = document.createElement('small');
    source.textContent = plugin.marketplaceName || 'Codex';
    copy.append(name, source);
    const hint = document.createElement('span');
    hint.className = 'plugin-mention-insert-hint';
    hint.textContent = 'Enter';
    option.append(mark, copy, hint);
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', () => selectPluginMention(plugin));
    list.append(option);
  });
}

async function updatePluginMentionMenu() {
  const context = getPluginMentionContext();
  const menu = $('#plugin-mention-menu');
  if (!context) { closePluginMentionMenu(); return; }
  state.plugins.mentionContext = context;
  state.plugins.mentionSelectedIndex = 0;
  menu.hidden = false;
  $('#prompt-input').setAttribute('aria-expanded', 'true');
  if (!state.plugins.installedLoaded && !state.plugins.mentionLoading) {
    state.plugins.mentionLoading = true;
    renderPluginMentionMenu();
    try {
      const result = await api('/api/plugins?view=installed');
      state.plugins.installed = result.plugins || [];
      state.plugins.installedLoaded = true;
    } catch (error) {
      state.plugins.mentionRows = [];
      state.plugins.mentionSelectedIndex = 0;
      const list = $('#plugin-mention-options');
      const note = document.createElement('div');
      note.className = 'plugin-mention-empty';
      note.textContent = error.message || 'Could not load installed Codex plugins.';
      list.replaceChildren(note);
      return;
    } finally {
      state.plugins.mentionLoading = false;
    }
    const latest = getPluginMentionContext();
    if (!latest) { closePluginMentionMenu(); return; }
    state.plugins.mentionContext = latest;
  }
  renderPluginMentionMenu();
}

function selectPluginMention(plugin) {
  const textarea = $('#prompt-input');
  const context = state.plugins.mentionContext;
  if (!context || textarea.value.slice(context.start, context.end).charAt(0) !== '@') return;
  const token = `@${plugin.name}`;
  textarea.setRangeText(`${token} `, context.start, context.end, 'end');
  if (!state.composerPluginMentions.some((mention) => mention.pluginId === plugin.pluginId)) {
    state.composerPluginMentions.push({ pluginId: plugin.pluginId, token });
  }
  closePluginMentionMenu();
  textarea.focus();
  resizeComposer();
}

function movePluginMentionSelection(delta) {
  const rows = state.plugins.mentionRows;
  if (!rows.length) return false;
  state.plugins.mentionSelectedIndex = (state.plugins.mentionSelectedIndex + delta + rows.length) % rows.length;
  renderPluginMentionMenu();
  return true;
}

function positionWelcomeSuggestions() {
  const surface = $('.workspace-surface');
  if (surface.classList.contains('has-conversation')) return;
  const dock = $('#composer-dock');
  const surfaceRect = surface.getBoundingClientRect();
  const dockRect = dock.getBoundingClientRect();
  const dockBottom = dockRect.bottom - surfaceRect.top;
  $('.idea-divider').style.top = `${Math.ceil(dockBottom + 12)}px`;
  $('.idea-grid').style.top = `${Math.ceil(dockBottom + 38)}px`;
}

function setContextTab(tab, { toggle = false } = {}) {
  if (!['files', 'changes', 'agents', 'plugins'].includes(tab)) return;
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
$('#external-approval-requests').addEventListener('change', saveExternalApprovalSetting);
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
$('#attach-image').addEventListener('click', () => $('#image-input').click());
$('#image-input').addEventListener('change', (event) => {
  void addImageFiles(event.currentTarget.files);
  event.currentTarget.value = '';
});
$('#cancel-message-edit').addEventListener('click', cancelMessageEdit);
$('#prompt-input').addEventListener('input', () => { resizeComposer(); void updatePluginMentionMenu(); });
window.addEventListener('forge:appearance', resizeComposer);
window.addEventListener('resize', resizeComposer);
const composerGrip = $('#composer-resize-grip');
let composerDrag = null;
composerGrip.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  composerDrag = { pointerId: event.pointerId, y: event.clientY, height: $('#prompt-input').getBoundingClientRect().height };
  composerGrip.setPointerCapture(event.pointerId);
  document.documentElement.classList.add('resizing-composer');
});
composerGrip.addEventListener('pointermove', (event) => {
  if (!composerDrag || composerDrag.pointerId !== event.pointerId) return;
  window.ForgeTheme.setComposerHeight(Math.round(composerDrag.height + composerDrag.y - event.clientY));
});
function endComposerResize() {
  composerDrag = null;
  document.documentElement.classList.remove('resizing-composer');
}
composerGrip.addEventListener('pointerup', endComposerResize);
composerGrip.addEventListener('pointercancel', endComposerResize);
composerGrip.addEventListener('lostpointercapture', endComposerResize);
composerGrip.addEventListener('dblclick', () => window.ForgeTheme.setComposerHeight(0));
composerGrip.addEventListener('keydown', (event) => {
  if (event.key === 'Home' || event.key === 'Enter') {
    event.preventDefault(); window.ForgeTheme.setComposerHeight(0);
  } else if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const height = window.ForgeTheme.getComposerHeight() || $('#prompt-input').getBoundingClientRect().height;
    window.ForgeTheme.setComposerHeight(height + (event.key === 'ArrowUp' ? 12 : -12));
  }
});
const welcomeSuggestionResizeObserver = new ResizeObserver(() => requestAnimationFrame(positionWelcomeSuggestions));
welcomeSuggestionResizeObserver.observe($('#composer-dock'));
window.addEventListener('resize', () => requestAnimationFrame(positionWelcomeSuggestions));
document.addEventListener('fullscreenchange', () => requestAnimationFrame(positionWelcomeSuggestions));
positionWelcomeSuggestions();
resizeComposer();
$('#prompt-input').addEventListener('paste', (event) => {
  const images = [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (images.length) {
    event.preventDefault();
    void addImageFiles(images);
  }
});
$('#prompt-input').addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#plugin-mention-menu').hidden) { event.preventDefault(); closePluginMentionMenu(); return; }
  if (!$('#plugin-mention-menu').hidden && event.key === 'ArrowDown' && movePluginMentionSelection(1)) { event.preventDefault(); return; }
  if (!$('#plugin-mention-menu').hidden && event.key === 'ArrowUp' && movePluginMentionSelection(-1)) { event.preventDefault(); return; }
  if (!$('#plugin-mention-menu').hidden && event.key === 'Enter' && state.plugins.mentionRows[state.plugins.mentionSelectedIndex]) {
    event.preventDefault();
    selectPluginMention(state.plugins.mentionRows[state.plugins.mentionSelectedIndex]);
    return;
  }
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
$('#omniroute-start').addEventListener('click', startOmniRoute);
$('#provider-discover').addEventListener('click', discoverProviderModels);
$('#provider-save').addEventListener('click', saveProvider);
$('#provider-cancel-edit').addEventListener('click', resetProviderForm);
$('#provider-list').addEventListener('click', (event) => {
  if (event.target.closest('[data-provider-routing]')) { openFreeRoutingSettings(); return; }
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
  if (!event.target.closest('#model-picker, #model-picker-menu')) setModelPickerOpen(false);
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
  void openLinkedFile(link.dataset.filePath);
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
  } else void openLinkedFile(relativePath);
});
$('#files-toggle').addEventListener('click', () => setContextTab('files', { toggle: true }));
$('#changes-toggle').addEventListener('click', () => setContextTab('changes', { toggle: true }));
$('#agents-toggle').addEventListener('click', () => setContextTab('agents', { toggle: true }));
$('#plugins-toggle').addEventListener('click', () => {
  const wasClosed = $('.app-shell').classList.contains('context-hidden') || state.activeContextTab !== 'plugins';
  setContextTab('plugins', { toggle: true });
  if (wasClosed && !state.plugins.loaded) void loadPluginView();
});
$('#context-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-context-tab]');
  if (!button) return;
  setContextTab(button.dataset.contextTab);
  if (button.dataset.contextTab === 'plugins' && !state.plugins.loaded) void loadPluginView();
});
$$('[data-plugin-view]').forEach((button) => button.addEventListener('click', () => {
  const view = button.dataset.pluginView;
  if (state.plugins.view === view) return;
  state.plugins.view = view;
  state.plugins.error = '';
  state.plugins.loaded = false;
  if (view === 'discover') { state.plugins.query = ''; $('#plugin-search-input').value = ''; }
  if (view === 'marketplaces') state.plugins.sourceFormOpen = false;
  void loadPluginView();
}));
$('#plugin-search-input').addEventListener('input', (event) => {
  const plugins = state.plugins;
  plugins.query = event.currentTarget.value.trim();
  plugins.available = [];
  plugins.offset = 0;
  plugins.loaded = false;
  clearTimeout(plugins.searchTimer);
  plugins.searchTimer = setTimeout(() => void loadPluginView(), 240);
});
$('#plugin-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-plugin-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.pluginAction;
  if (action === 'setup') {
    if (state.plugins.setupOpen === button.dataset.pluginId) { state.plugins.setupOpen = ''; renderPluginManager(); }
    else void openPluginSetup(button.dataset.pluginId);
    return;
  }
  if (action === 'marketplace-remove') void runPluginAction(action, '', { name: button.dataset.marketplaceName });
  else void runPluginAction(action, button.dataset.pluginId, { enabled: button.dataset.enabled === 'true' });
});
$('#plugin-load-more').addEventListener('click', () => void loadPluginView({ append: true }));
$('#plugin-refresh').addEventListener('click', () => void syncPluginSources());
$('#plugin-marketplaces-refresh').addEventListener('click', () => void syncPluginSources());
$('#plugin-add-source').addEventListener('click', () => {
  state.plugins.sourceFormOpen = true;
  renderPluginManager();
  $('#plugin-source-input').focus();
});
$('#plugin-source-cancel').addEventListener('click', () => {
  state.plugins.sourceFormOpen = false;
  state.plugins.error = '';
  renderPluginManager();
});
$('#plugin-source-form').addEventListener('submit', addPluginMarketplace);
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
  const buttons = Array.from(event.currentTarget.querySelectorAll('button')).filter((button) => !button.hidden && !button.disabled);
  const index = buttons.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
});
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return;
  const index = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(event.code);
  if (index < 0 || (index < 3 && !state.workspace) || $$('.modal-backdrop').some((modal) => !modal.hidden)) return;
  event.preventDefault();
  if (index === 4) { setBrowserMode(!state.browser.active); return; }
  const tab = ['files', 'changes', 'agents', 'plugins'][index];
  const wasClosed = $('.app-shell').classList.contains('context-hidden') || state.activeContextTab !== tab;
  setContextTab(tab, { toggle: true });
  if (tab === 'plugins' && wasClosed && !state.plugins.loaded) void loadPluginView();
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
window.addEventListener('resize', () => { refreshSidebarSizing(); renderContext(); positionModelPickerMenu(); });
new ResizeObserver(positionModelPickerMenu).observe($('#model-picker-trigger'));
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
