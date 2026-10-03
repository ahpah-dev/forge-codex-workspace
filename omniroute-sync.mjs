import { createHash } from 'node:crypto';
import { createChatProviderRouter } from './responses-bridge.mjs';

// OmniRoute owns selection and failover. These loopback upstreams expose only
// approved free routes; actual provider keys stay in Forge's encrypted store.
export function createOmniRouteSync({ manager, getCandidates, baseUrl, token }) {
  let operation, generation = 0, synced = -1;
  const upstreams = new Map();
  const identity = candidate => createHash('sha256').update(`${candidate.provider.id}:${candidate.model}`).digest('hex').slice(0, 16);
  return {
    reset() { generation++; synced = -1; upstreams.clear(); },
    async configure() {
      if (!(await manager.status()).managed) return null;
      if (synced === generation) return upstreams.size ? 'forge-free' : null;
      if (operation) return operation;
      const revision = generation;
      operation = (async () => {
        const candidates = (await getCandidates()).slice(0, 8);
        const nodes = (await manager.management('provider-nodes')).nodes || [];
        const connections = (await manager.management('providers')).connections || [];
        const models = [], current = new Map();
        for (const candidate of candidates) {
          const id = identity(candidate), prefix = `forge-${id}`;
          // Register before discovery probes. Never expose arbitrary endpoints.
          current.set(id, candidate); upstreams.set(id, candidate);
          const details = { name: `Forge · ${candidate.provider.name} · ${candidate.model}`, prefix,
            baseUrl: `${typeof baseUrl === 'function' ? baseUrl() : baseUrl}/internal/omni-upstreams/${id}/v1`, type: 'openai-compatible', apiType: 'chat' };
          let node = nodes.find(item => item.prefix === prefix);
          if (node) await manager.management(`provider-nodes/${node.id}`, 'PUT', details);
          else node = (await manager.management('provider-nodes', 'POST', details)).node;
          if (!node?.id) throw new Error('OmniRoute did not register the free upstream.');
          let connection = connections.find(item => item.provider === node.id);
          const credentials = { apiKey: token, name: details.name, defaultModel: 'free' };
          if (!connection) connection = await manager.management('providers', 'POST', { provider: node.id, ...credentials });
          connection = connection.connection || connection;
          if (!connection.id) throw new Error('OmniRoute did not register the free connection.');
          // Eligibility means a saved key, not proven quota: inference failure
          // is handled by OmniRoute's normal cooldown and fallback engine.
          await manager.management(`providers/${connection.id}`, 'PUT', { ...credentials, isActive: true });
          models.push(`${prefix}/free`);
        }
        if (revision !== generation) return null;
        upstreams.clear(); for (const [id, candidate] of current) upstreams.set(id, candidate);
        const combos = (await manager.management('combos')).combos || [];
        const combo = combos.find(item => item.name === 'forge-free');
        if (models.length) {
          const definition = { name: 'forge-free', description: 'Forge saved free coding providers. No paid destinations.', strategy: 'priority', models };
          await manager.management(combo ? `combos/${combo.id}` : 'combos', combo ? 'PUT' : 'POST', definition);
        } else if (combo) await manager.management(`combos/${combo.id}`, 'DELETE');
        synced = revision;
        return models.length ? 'forge-free' : null;
      })().finally(() => { operation = null; });
      return operation;
    },
    async open(id, request, signal) {
      const candidate = upstreams.get(id);
      if (!candidate || request.model !== 'free') throw new Error('This free upstream is no longer configured.');
      const router = candidate.router ? candidate.router() : createChatProviderRouter({ provider: candidate.provider, model: candidate.model, key: await candidate.getKey() });
      return router.openCompletion(request, signal, { maxTokens: request.max_tokens || 16384 });
    },
    has(id) { return upstreams.has(id); },
  };
}
