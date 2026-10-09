// 9router emits combos and individual provider models in the same OpenAI list.
// Its empty-install static fallback must not look like connected models in Forge.
export function nineRouterCatalog(rows, { connected = true, managedRoute = '', previousDefault = '' } = {}) {
  const validId = (id) => /^[\w./:@+-]{1,180}$/.test(id);
  const entries = new Map();
  if (connected) for (const row of rows || []) {
    const id = String(row?.id || row?.name || '').trim();
    const kind = row?.kind || row?.type;
    if (!validId(id) || row.active === false || row.capabilities?.tools === false || row.supports_tools === false) continue;
    if (kind && !['llm', 'chat', 'text', 'model'].includes(kind)) continue;
    // Presence of a :free suffix is a route convention, not a billing guarantee.
    // Only the managed route and an explicit prior selection become defaults.
    entries.set(id, { id, name: String(row.name || row.display_name || id), combo: row.owned_by === 'combo' });
  }
  const models = [...entries.values()].sort((a, b) => Number(b.id === managedRoute) - Number(a.id === managedRoute) || Number(b.combo) - Number(a.combo) || a.name.localeCompare(b.name)).slice(0, 100);
  const ids = new Set(models.map((model) => model.id));
  const defaultFreeModel = ids.has(previousDefault) ? previousDefault : ids.has(managedRoute) ? managedRoute : '';
  return { models, modelIds: models.map((model) => model.id), defaultFreeModel };
}
