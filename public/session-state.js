// Session ownership stays stable while a new thread is waiting for its ID.
globalThis.ForgeSessions = {
  createStore() {
    const records = new Map();
    const find = id => [...records.values()].find(record => record.key === id || record.threadIds.has(id));
    function save(view) {
      let record = records.get(view.sessionKey);
      if (!record) { record = { key: view.sessionKey, threadIds: new Set(), events: [], waiting: new Set() }; records.set(record.key, record); }
      record.view = view;
      if (!record.events.length) {
        record.running = Boolean(view.isBusy || view.pendingSend);
        record.waiting = new Set((view.approvals || []).map(request=>String(request.id)));
      }
      if (view.threadId) record.threadIds.add(view.threadId);
      if (records.size > 24) {
        for (const [key, older] of records) {
          if (records.size <= 24) break;
          if (key !== record.key && !older.running && !older.events.length && !older.waiting.size && !older.view.draftText && !older.view.pendingImages?.length) records.delete(key);
        }
      }
      return record;
    }
    function append(record, event) {
      const params = event.params || {}, method = event.method || '';
      const previous = record.events.at(-1);
      // Coalesce adjacent text chunks without moving lifecycle or tool events.
      if (/^item\/(agentMessage\/delta|commandExecution\/outputDelta|reasoning\/textDelta|reasoning\/summaryTextDelta)$/.test(method)
        && previous?.method === method && previous.params?.itemId === params.itemId && previous.params?.turnId === params.turnId && typeof params.delta === 'string' && typeof previous.params?.delta === 'string') previous.params.delta += params.delta;
      else record.events.push({ ...event, params: { ...params } });
      if (method === 'turn/started' || method === 'routing/fallback/starting') record.running = true;
      if (['turn/completed','turn/failed','turn/interrupted','routing/fallback/failed'].includes(method)) { record.running = false; record.waiting.clear(); }
      if (method === 'routing/fallback/started' && params.newThreadId) record.threadIds.add(params.newThreadId);
      if (method === 'thread/name/updated' || method === 'thread/nameUpdated') record.view.threadName=params.name || params.thread?.name || record.view.threadName;
      if (event.type === 'server-request') record.waiting.add(String(event.id));
      if (method === 'serverRequest/resolved') record.waiting.delete(String(params.requestId));
    }
    return { records, save, find, append, remove(id) { const record=find(id); if(record)records.delete(record.key); } };
  },
};
