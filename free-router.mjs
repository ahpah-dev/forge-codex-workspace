import { createChatProviderRouter } from './responses-bridge.mjs';

const OPENROUTER = 'https://openrouter.ai/api/v1';
const NVIDIA = 'https://integrate.api.nvidia.com/v1';
export const FREE_PROVIDER_ID = 'forge-free';
export const FREE_KEY_IDS = { openrouter: 'forge-route-openrouter', nvidia: 'forge-route-nvidia' };

export function isFreeModel(model) {
  const prices = model?.pricing;
  return Boolean(prices && prices.prompt != null && prices.completion != null
    && Object.values(prices).every((price) => price == null || (String(price).trim() !== '' && Number(price) === 0))
    && (!model.expiration_date || Date.parse(model.expiration_date) > Date.now())
    && model.supported_parameters?.includes('tools')
    && (!model.architecture?.output_modalities || model.architecture.output_modalities.includes('text')));
}

export function isCodexLimitError(error) {
  const info = JSON.stringify(error?.codexErrorInfo || error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return /usage.?limit.?exceeded|rate.?limit.?exceeded/.test(info)
    || /"httpstatuscode":429/.test(info)
    || /usage limit|rate limit|quota exceeded|too many requests/.test(message);
}

export function exhaustedCodexLimit(limits, now = Date.now()) {
  // Other buckets may belong to review or a different model family. Unknown
  // buckets wait for a real UsageLimitExceeded error instead of guessing.
  const buckets = limits?.primary || limits?.secondary ? [limits] : limits?.codex ? [limits.codex] : [];
  return buckets.some((bucket) => [bucket?.primary, bucket?.secondary].some((window) => window
    && Number(window.usedPercent) >= 100 && (!window.resetsAt || Number(window.resetsAt) * 1000 > now)));
}

export function rankNimModels(rows) {
  return rows.filter((model) => /^[\w./:@+-]+$/.test(model.id || '')
    && /deepseek|qwen.*(?:coder|instruct|thinking)|gpt-oss|nemotron.*(?:ultra|super|instruct)|llama.*instruct|step.*flash/i.test(model.id))
    .sort((a, b) => nimScore(b) - nimScore(a) || Number(b.created || 0) - Number(a.created || 0) || a.id.localeCompare(b.id));
}
function nimScore(model) {
  const id = model.id.toLowerCase();
  const family = /deepseek.*(?:pro|r1|v4)/.test(id) ? 100 : /qwen.*coder/.test(id) ? 95
    : /gpt-oss-120b|nemotron.*ultra/.test(id) ? 90 : /deepseek/.test(id) ? 85 : /qwen/.test(id) ? 80 : 60;
  const version = Number(id.match(/(?:v|qwen|llama-?|nemotron-?)(\d+(?:\.\d+)?)/)?.[1] || 0);
  return family + Math.min(version, 10);
}

export function createFreeRouter({ getKey, fetchImpl = fetch, onRoute = () => {} }) {
  const cache = new Map();
  const cooldowns = new Map();
  let openrouterBlockedUntil = 0;
  let lastRoute = null;
  async function catalog(provider, { force = false, signal } = {}) {
    const saved = cache.get(provider);
    if (!force && saved && saved.expires > Date.now()) return saved.models;
    const key = await getKey(provider);
    if (!key) throw new Error(`Add your ${provider === 'openrouter' ? 'OpenRouter' : 'NVIDIA NIM'} API key in Settings → Free Auto Route.`);
    const base = provider === 'openrouter' ? OPENROUTER : NVIDIA;
    const query = provider === 'openrouter' ? '?sort=coding-high-to-low&max_price=0&max_output_price=0&supported_parameters=tools' : '';
    const response = await fetchImpl(`${base}/models${query}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Object.assign(new Error(`${provider === 'openrouter' ? 'OpenRouter' : 'NVIDIA NIM'} model discovery returned HTTP ${response.status}. Check your key and provider access.`), { status: response.status });
    const payload = await response.json();
    const rows = Array.isArray(payload.data) ? payload.data : [];
    // OpenRouter's coding benchmark order is authoritative. New releases are
    // discovered at every refresh; we never claim recency alone proves quality.
    const models = provider === 'openrouter' ? rows.filter(isFreeModel) : rankNimModels(rows);
    if (!models.length) throw new Error(`No ${provider === 'openrouter' ? 'free tool-capable OpenRouter' : 'supported NVIDIA NIM coding'} models are available right now.`);
    cache.set(provider, { models, expires: Date.now() + 10 * 60 * 1000 });
    return models;
  }
  async function openCompletion(request, signal, { maxTokens = 16384, route: previousRoute } = {}) {
    const failures = [];
    for (const provider of ['openrouter', 'nvidia']) {
      if (previousRoute && provider !== previousRoute.provider) continue;
      if (provider === 'openrouter' && openrouterBlockedUntil > Date.now()) continue;
      let models;
      try { models = await catalog(provider, { signal }); }
      catch (error) {
        if (signal?.aborted) throw error;
        failures.push(error.message);
        if ([401, 403].includes(error.status)) throw error;
        continue;
      }
      let tried = 0;
      for (const model of models) {
        if (previousRoute && model.id !== previousRoute.model) continue;
        if ((cooldowns.get(`${provider}:${model.id}`) || 0) > Date.now()) continue;
        if (provider === 'openrouter' && Number(model.context_length || Infinity) < JSON.stringify(request.messages).length / 3 + 4096) continue;
        if (++tried > 3) break;
        const key = await getKey(provider);
        const base = provider === 'openrouter' ? OPENROUTER : NVIDIA;
        const body = { ...request, model: model.id, stream: true, max_tokens: Math.min(maxTokens, Number(model.top_provider?.max_completion_tokens || 32768)) };
        if (provider === 'nvidia') delete body.parallel_tool_calls;
        if (provider === 'openrouter') body.provider = { max_price: { prompt: 0, completion: 0 }, require_parameters: true, allow_fallbacks: true };
        let response;
        try {
          response = provider === 'nvidia'
            ? (await createChatProviderRouter({ provider: { id: 'nvidia', name: 'NVIDIA NIM', baseUrl: base }, model: model.id, key, fetchImpl }).openCompletion(request, signal, { maxTokens })).response
            : await fetchImpl(`${base}/chat/completions`, {
            method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(provider === 'openrouter' ? { 'X-OpenRouter-Title': 'Forge' } : {}) },
            body: JSON.stringify(body), signal,
          });
        } catch (error) {
          if (signal?.aborted) throw error;
          if ([401, 403, 402, 429].includes(error.status)) throw error;
          failures.push(error.status ? error.message : `${provider}: connection unavailable`);
          cooldowns.set(`${provider}:${model.id}`, Date.now() + 60000);
          continue;
        }
        if (response.ok) {
          lastRoute = { provider, model: model.id, name: model.name || model.id, selectedAt: Date.now() };
          onRoute(lastRoute);
          return { response, route: lastRoute };
        }
        const detail = await response.json().catch(() => ({}));
        const message = String(detail.error?.message || detail.message || '');
        failures.push(`${provider}: HTTP ${response.status}`);
        if ([401, 403].includes(response.status)) throw new Error(`${provider === 'openrouter' ? 'OpenRouter' : 'NVIDIA NIM'} rejected your API key or access (HTTP ${response.status}). Update it in Settings.`);
        if (provider === 'openrouter' && [402, 429].includes(response.status)) {
          const retry = Number(response.headers.get('retry-after'));
          const daily = /daily|per.day|free.*limit|quota/.test(message.toLowerCase());
          openrouterBlockedUntil = Date.now() + (retry > 0 ? Math.min(retry, 86400) * 1000 : daily ? 60 * 60 * 1000 : 60000);
          break; // Account limits are shared by free models; don't burn quota retrying them.
        }
        if (provider === 'nvidia' && [402, 429].includes(response.status)) throw new Error(`NVIDIA NIM also reached its usage or rate limit (HTTP ${response.status}). Wait for its reset or check your NVIDIA account.`);
        if (![400, 404, 408, 422, 500, 502, 503, 504].includes(response.status)) throw new Error(`${provider} request failed (HTTP ${response.status}).`);
        cooldowns.set(`${provider}:${model.id}`, Date.now() + 10 * 60 * 1000);
      }
    }
    throw new Error(`Free Auto Route could not find an available model. ${failures.join(' · ') || 'All candidates are temporarily unavailable.'}`);
  }
  return {
    catalog, openCompletion,
    rejectRoute(route, error) {
      const code = Number(error?.code || error?.status || 0);
      if ([401, 403].includes(code)) throw new Error(`${route.provider} rejected your API key or access (HTTP ${code}).`);
      if (route.provider === 'openrouter' && [402, 429].includes(code)) openrouterBlockedUntil = Date.now() + 60000;
      else cooldowns.set(`${route.provider}:${route.model}`, Date.now() + 600000);
    },
    reset() { cache.clear(); cooldowns.clear(); openrouterBlockedUntil = 0; },
    status() { return { lastRoute, openrouterBlockedUntil }; },
  };
}
