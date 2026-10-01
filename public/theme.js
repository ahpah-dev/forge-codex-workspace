(() => {
  'use strict';
  const storageKey = 'forge.appearance.v1';
  const colors = [
    ['page', '--page', 'Workspace', '#fafaf8'],
    ['sidebar', '--sidebar', 'Sidebar', '#f4f3f0'],
    ['paper', '--paper', 'Panels & cards', '#ffffff'],
    ['field', '--field', 'Input fields', '#ffffff'],
    ['ink', '--ink', 'Primary text', '#292d31'],
    ['muted', '--muted', 'Secondary text', '#747872'],
    ['line', '--line', 'Borders', '#e0e2dd'],
    ['accent', '--accent', 'Accent', '#b56c52'],
    ['hover', '--hover', 'Hover & selection', '#eeede9'],
    ['user', '--user-bg', 'Your messages', '#f0efeb'],
    ['code', '--code-bg', 'Code blocks', '#f4f5f2'],
    ['onAccent', '--on-accent', 'Button text', '#ffffff'],
    ['brand', '--brand', 'GPT mark', '#5d6ec1'],
    ['success', '--success', 'Success', '#578663'],
    ['danger', '--danger', 'Errors & deletion', '#b75650'],
    ['astra', '--astra', 'Astra stars', '#8671be'],
    ['sol', '--sol', 'Sol sun', '#bb862d'],
    ['luna', '--luna', 'Luna moon', '#647cbd'],
    ['provider', '--provider', 'Custom providers', '#8467b3'],
    ['nvidia', '--nvidia', 'NVIDIA', '#719346'],
  ];
  const baseColors = Object.fromEntries(colors.map(([key, , , value]) => [key, value]));
  const presets = {
    linen: { name: 'Linen', colors: baseColors },
    porcelain: { name: 'Porcelain', colors: { ...baseColors, page: '#f6f8fb', sidebar: '#edf1f6', hover: '#e7edf5', user: '#edf2fa', code: '#f1f4f8', ink: '#263246', muted: '#6b7990', line: '#dce3ed', accent: '#5c72b9', brand: '#5c72b9' } },
    graphite: { name: 'Graphite', colors: { ...baseColors, page: '#1a1c1f', sidebar: '#16181b', paper: '#23262b', field: '#1d2025', hover: '#2d3239', user: '#2b3037', code: '#191c21', ink: '#edf0f3', muted: '#a0a8b3', line: '#353b44', accent: '#d39b7e', onAccent: '#201813', brand: '#a5b1ed', success: '#8bbf9a', danger: '#eb9189', astra: '#bd9ce8', sol: '#e2b26b', luna: '#a2b7ee', provider: '#c09de5', nvidia: '#a5c775' } },
    midnight: { name: 'Midnight', colors: { ...baseColors, page: '#141b29', sidebar: '#101623', paper: '#1c2535', field: '#172031', hover: '#29354b', user: '#27344b', code: '#111a29', ink: '#e7edf9', muted: '#9eacc5', line: '#33425b', accent: '#9aaee8', onAccent: '#14213d', brand: '#9aaee8', success: '#8cc8b1', danger: '#ed9d9d', astra: '#c6abea', sol: '#e9bd77', luna: '#a4c5ff', provider: '#c6abea', nvidia: '#a8c786' } },
  };
  const defaults = { version: 1, preset: 'linen', colors: { ...baseColors }, fonts: { ui: 'system', chat: 'system', code: 'Consolas' }, customFonts: { ui: '', chat: '', code: '' }, uiScale: 100, chatSize: 15, codeSize: 12, lineHeight: 1.7, pattern: 'none', composerShape: 'rounded', composerHeight: 0 };
  const fontChoices = ['system', 'Segoe UI', 'Arial', 'Calibri', 'Verdana', 'Trebuchet MS', 'Georgia', 'Cambria', 'Times New Roman', 'Consolas', 'Cascadia Code', 'Courier New', 'custom', 'uploaded'];
  const fontSlots = [['ui', 'Interface font'], ['chat', 'Conversation font'], ['code', 'Code & terminal font']];
  const uploadedFonts = new Map();
  let settings = normalize(readSaved());
  let lastFocus = null;

  function readSaved() { try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; } }
  function normalize(input) {
    const result = JSON.parse(JSON.stringify(defaults));
    if (!input || typeof input !== 'object') return result;
    result.preset = Object.hasOwn(presets, input.preset) ? input.preset : 'custom';
    for (const [key] of colors) if (/^#[0-9a-f]{6}$/i.test(input.colors?.[key] || '')) result.colors[key] = input.colors[key].toLowerCase();
    for (const [slot] of fontSlots) {
      if (fontChoices.includes(input.fonts?.[slot])) result.fonts[slot] = input.fonts[slot];
      if (typeof input.customFonts?.[slot] === 'string') result.customFonts[slot] = input.customFonts[slot].trim().slice(0, 100);
    }
    for (const [key, min, max] of [['uiScale', 85, 125], ['chatSize', 12, 22], ['codeSize', 10, 18], ['lineHeight', 1.35, 2]]) {
      if (Number.isFinite(Number(input[key]))) result[key] = Math.max(min, Math.min(max, Number(input[key])));
    }
    if (['none', 'dots', 'grid'].includes(input.pattern)) result.pattern = input.pattern;
    if (['rounded', 'pill', 'square'].includes(input.composerShape)) result.composerShape = input.composerShape;
    if (Number.isFinite(Number(input.composerHeight)) && Number(input.composerHeight) > 0) result.composerHeight = Math.max(64, Math.min(360, Number(input.composerHeight)));
    return result;
  }
  function family(slot) {
    const selected = settings.fonts[slot];
    const fallback = slot === 'code' ? 'ui-monospace, Consolas, monospace' : 'system-ui, -apple-system, "Segoe UI", sans-serif';
    if (selected === 'system') return fallback;
    if (selected === 'uploaded') return `${JSON.stringify(`ForgeUploaded${slot}`)}, ${fallback}`;
    const name = selected === 'custom' ? settings.customFonts[slot] : selected;
    return name ? `${JSON.stringify(name)}, ${fallback}` : fallback;
  }
  function apply() {
    const root = document.documentElement;
    for (const [key, variable] of colors) root.style.setProperty(variable, settings.colors[key]);
    root.style.setProperty('--soft', settings.colors.muted);
    root.style.setProperty('--line-dark', 'color-mix(in srgb, var(--line) 85%, var(--ink))');
    root.style.setProperty('--accent-soft', 'color-mix(in srgb, var(--accent) 12%, var(--paper))');
    root.style.setProperty('--green', settings.colors.success);
    root.style.setProperty('--ui-scale', settings.uiScale / 100);
    root.style.setProperty('--code-scale', settings.codeSize / 12);
    root.style.setProperty('--chat-size', `${settings.chatSize}px`);
    root.style.setProperty('--code-size', `${settings.codeSize}px`);
    root.style.setProperty('--chat-line-height', settings.lineHeight);
    for (const [slot] of fontSlots) root.style.setProperty(`--font-${slot}`, family(slot));
    const rgb = settings.colors.page.match(/[a-f0-9]{2}/gi).map((part) => parseInt(part, 16));
    const dark = (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722) < 128;
    root.style.colorScheme = dark ? 'dark' : 'light';
    root.dataset.themeScheme = dark ? 'dark' : 'light';
    root.dataset.canvas = settings.pattern;
    root.dataset.composerShape = settings.composerShape;
    root.dataset.composerHeight = settings.composerHeight ? 'manual' : 'auto';
    root.style.setProperty('--composer-height', `${settings.composerHeight || 110}px`);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.colors.page);
    window.dispatchEvent(new Event('forge:appearance'));
  }
  function save() {
    apply();
    let message = 'Saved on this device';
    try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { message = 'Preview active · browser storage unavailable'; }
    const status = document.getElementById('appearance-save-status');
    if (status) status.textContent = message;
    syncPresetLabel();
  }
  function syncPresetLabel() {
    const label = document.getElementById('appearance-preset-label');
    if (label) label.textContent = presets[settings.preset]?.name || 'Custom';
    document.querySelectorAll('[data-theme-preset]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themePreset === settings.preset)));
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function renderControls() {
    const presetsHost = document.getElementById('theme-presets');
    presetsHost.replaceChildren();
    for (const [id, preset] of Object.entries(presets)) {
      const button = element('button', 'theme-preset');
      button.type = 'button'; button.dataset.themePreset = id;
      const swatch = element('span', 'theme-preset-swatch');
      swatch.style.backgroundColor = preset.colors.page;
      swatch.style.borderColor = preset.colors.line;
      swatch.setAttribute('aria-hidden', 'true');
      for (const key of ['sidebar', 'paper', 'ink', 'muted', 'line', 'accent']) swatch.style.setProperty(`--preview-${key}`, preset.colors[key]);
      const rail = element('span', 'theme-preview-rail');
      rail.append(element('span', 'theme-preview-brand'), element('span', 'theme-preview-session'), element('span', 'theme-preview-session'));
      const workspace = element('span', 'theme-preview-workspace');
      workspace.append(element('span', 'theme-preview-message'), element('span', 'theme-preview-message short'), element('span', 'theme-preview-composer'));
      swatch.append(rail, workspace);
      button.append(swatch, element('span', '', preset.name));
      button.addEventListener('click', () => { settings.colors = { ...preset.colors }; settings.preset = id; save(); syncControls(); });
      presetsHost.append(button);
    }
    for (const host of ['theme-colors', 'theme-colors-advanced']) document.getElementById(host).replaceChildren();
    colors.forEach(([key, , name], index) => {
      const row = element('div', 'theme-color');
      const swatch = element('input', 'theme-color-swatch');
      swatch.type = 'color'; swatch.dataset.colorKey = key; swatch.setAttribute('aria-label', name);
      const copy = element('label', 'theme-color-copy');
      const hex = element('input', 'theme-color-hex');
      hex.type = 'text'; hex.maxLength = 7; hex.spellcheck = false;
      hex.dataset.hexKey = key; hex.setAttribute('aria-label', `${name} hex code`);
      copy.append(element('span', '', name), hex); row.append(swatch, copy);
      const update = (value) => { settings.colors[key] = value.toLowerCase(); settings.preset = 'custom'; swatch.value = value; hex.value = value; hex.removeAttribute('aria-invalid'); save(); };
      swatch.addEventListener('input', () => update(swatch.value));
      hex.addEventListener('input', () => { const valid = /^#[0-9a-f]{6}$/i.test(hex.value); hex.setAttribute('aria-invalid', String(!valid)); if (valid) update(hex.value); });
      hex.addEventListener('blur', () => { hex.value = settings.colors[key]; hex.removeAttribute('aria-invalid'); });
      document.getElementById(index < 8 ? 'theme-colors' : 'theme-colors-advanced').append(row);
    });
    const fontsHost = document.getElementById('theme-fonts'); fontsHost.replaceChildren();
    for (const [slot, name] of fontSlots) {
      const block = element('div', 'theme-font-field');
      const label = element('label', 'appearance-select-field');
      const select = element('select'); select.id = `theme-font-${slot}`;
      for (const font of fontChoices) select.add(new Option(font === 'system' ? 'System default' : font === 'custom' ? 'Custom installed font…' : font === 'uploaded' ? 'Uploaded font' : font, font));
      label.append(element('span', '', name), select);
      const custom = element('input', 'theme-custom-font');
      custom.type = 'text'; custom.placeholder = 'Installed font family, e.g. Inter'; custom.maxLength = 100; custom.id = `theme-custom-${slot}`; custom.setAttribute('aria-label', `${name} custom family`);
      const upload = element('label', 'theme-font-upload'); upload.append(element('span', '', 'Upload a font'));
      const file = element('input'); file.type = 'file'; file.accept = '.woff2,.woff,.ttf,.otf'; file.setAttribute('aria-label', `Upload ${name.toLowerCase()}`); upload.append(file);
      select.addEventListener('change', () => { settings.fonts[slot] = select.value; custom.hidden = select.value !== 'custom'; save(); });
      custom.addEventListener('input', () => { settings.customFonts[slot] = custom.value.trim(); save(); });
      file.addEventListener('change', async () => {
        const chosen = file.files?.[0]; if (!chosen) return;
        const status = document.getElementById('appearance-save-status');
        try {
          if (chosen.size > 5 * 1024 * 1024) throw new Error('Choose a font smaller than 5 MB.');
          await loadFont(slot, chosen);
          settings.fonts[slot] = 'uploaded'; save(); syncControls();
          try { await storeFont(slot, chosen); } catch { status.textContent = 'Font applied · file could not be saved for next launch'; }
        } catch (error) { status.textContent = error.message || 'That font could not be loaded.'; }
        file.value = '';
      });
      block.append(label, custom, upload); fontsHost.append(block);
    }
    const rangeHost = document.getElementById('theme-ranges'); rangeHost.replaceChildren();
    for (const [key, name, min, max, step, unit] of [['uiScale', 'Interface scale', 85, 125, 5, '%'], ['chatSize', 'Conversation size', 12, 22, 1, 'px'], ['codeSize', 'Code size', 10, 18, 1, 'px'], ['lineHeight', 'Conversation spacing', 1.35, 2, .05, '×']]) {
      const label = element('label', 'theme-range-field');
      const heading = element('span'); const output = element('output'); output.dataset.rangeOutput = key;
      heading.append(element('span', '', name), output);
      const range = element('input'); range.type = 'range'; range.min = min; range.max = max; range.step = step; range.dataset.rangeKey = key; range.dataset.unit = unit;
      range.addEventListener('input', () => { settings[key] = Number(range.value); output.value = `${range.value}${unit}`; save(); });
      label.append(heading, range); rangeHost.append(label);
    }
    document.getElementById('theme-pattern').addEventListener('change', (event) => { settings.pattern = event.target.value; save(); });
    document.getElementById('composer-shape').addEventListener('change', (event) => { settings.composerShape = event.target.value; save(); });
    document.getElementById('composer-height').addEventListener('input', (event) => { settings.composerHeight = Number(event.target.value); save(); syncComposerControls(); });
    document.getElementById('composer-height-auto').addEventListener('click', () => { settings.composerHeight = 0; save(); syncComposerControls(); });
    syncControls();
  }
  function syncControls() {
    document.querySelectorAll('[data-color-key]').forEach((input) => { input.value = settings.colors[input.dataset.colorKey]; });
    document.querySelectorAll('[data-hex-key]').forEach((input) => { input.value = settings.colors[input.dataset.hexKey]; input.removeAttribute('aria-invalid'); });
    for (const [slot] of fontSlots) {
      const select = document.getElementById(`theme-font-${slot}`);
      select.value = settings.fonts[slot];
      select.querySelector('option[value="uploaded"]').disabled = !uploadedFonts.has(slot);
      const custom = document.getElementById(`theme-custom-${slot}`);
      custom.value = settings.customFonts[slot]; custom.hidden = settings.fonts[slot] !== 'custom';
    }
    document.querySelectorAll('[data-range-key]').forEach((input) => {
      input.value = settings[input.dataset.rangeKey];
      document.querySelector(`[data-range-output="${input.dataset.rangeKey}"]`).value = `${input.value}${input.dataset.unit}`;
    });
    document.getElementById('theme-pattern').value = settings.pattern;
    syncComposerControls();
    syncPresetLabel();
  }
  function syncComposerControls() {
    const shape = document.getElementById('composer-shape');
    if (!shape) return;
    shape.value = settings.composerShape;
    document.getElementById('composer-height').value = settings.composerHeight || 110;
    document.getElementById('composer-height-value').value = settings.composerHeight ? `${Math.round(settings.composerHeight)}px` : 'Automatic';
    document.getElementById('composer-height-auto').setAttribute('aria-pressed', String(!settings.composerHeight));
  }
  function fontDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('forge-appearance', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('fonts');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  async function storeFont(slot, blob) {
    const db = await fontDatabase();
    try { await new Promise((resolve, reject) => { const transaction = db.transaction('fonts', 'readwrite'); transaction.objectStore('fonts').put(blob, slot); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); }); } finally { db.close(); }
  }
  async function loadFont(slot, blob) {
    const font = new FontFace(`ForgeUploaded${slot}`, await blob.arrayBuffer());
    await font.load();
    const previous = uploadedFonts.get(slot); if (previous) document.fonts.delete(previous);
    document.fonts.add(font); uploadedFonts.set(slot, font);
  }
  async function restoreFonts() {
    let db;
    try {
      db = await fontDatabase();
      const entries = await Promise.all(fontSlots.map(([slot]) => new Promise((resolve) => { const request = db.transaction('fonts').objectStore('fonts').get(slot); request.onsuccess = () => resolve([slot, request.result]); request.onerror = () => resolve([slot, null]); })));
      for (const [slot, blob] of entries) if (blob) { try { await loadFont(slot, blob); } catch { /* The selected font falls back to a system face. */ } }
      apply(); syncControls();
    } catch { /* Appearance colors and installed fonts work without IndexedDB. */ } finally { db?.close(); }
  }
  function close() { document.getElementById('settings-modal').hidden = true; lastFocus?.focus({ preventScroll: true }); }
  window.ForgeTheme = {
    open() { lastFocus = document.activeElement; syncControls(); document.getElementById('settings-modal').hidden = false; document.getElementById('appearance-close').focus(); },
    getComposerHeight() { return settings.composerHeight; },
    setComposerHeight(height) { settings.composerHeight = height === 0 ? 0 : Math.max(64, Math.min(360, height)); save(); syncComposerControls(); },
  };
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    renderControls(); void restoreFonts();
    document.getElementById('appearance-close').addEventListener('click', close);
    document.getElementById('appearance-done').addEventListener('click', close);
    document.getElementById('theme-reset').addEventListener('click', () => { settings = normalize(defaults); save(); syncControls(); });
    const modal = document.getElementById('settings-modal');
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...modal.querySelectorAll('button, input, select, summary')].filter((node) => !node.disabled && node.getClientRects().length);
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    window.addEventListener('storage', (event) => { if (event.key === storageKey) { settings = normalize(readSaved()); apply(); syncControls(); } });
  });
})();
