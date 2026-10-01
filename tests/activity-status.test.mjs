import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));

function session() {
  const state = {
    threadId: 'chat', activeTurnId: 'turn', messages: [], activityStatus: 'Starting task',
    threadHistoryCache: new Map(), approvals: [], treeCache: new Map(),
  };
  const context = vm.createContext({
    state, renderSurface() {}, upsertActivity() {}, upsertAgentItem() {},
    addOrUpdateAssistant() {}, scheduleLiveCodeRender() {}, refreshState() {},
    setActivityStatus(label) { if (label) state.activityStatus = label; },
  });
  vm.runInContext(section('function createLiveActivityTracker()', 'function activityText(')
    + section('function activityText(', 'function renderMessages(')
    + '\nconst liveActivities = createLiveActivityTracker();\n'
    + section('function handleCodexEvent(', 'function renderApproval('), context);
  return {
    state,
    event(method, params = {}) {
      context.handleCodexEvent({ type: 'notification', method, params: { threadId: 'chat', turnId: 'turn', ...params } });
      return state.activityStatus;
    },
    start(type, id, extra = {}) { return this.event('item/started', { item: { id, type, ...extra } }); },
    complete(type, id, extra = {}) { return this.event('item/completed', { item: { id, type, status: 'completed', ...extra } }); },
  };
}

test('reasoning lifecycle cannot overwrite a response that is streaming', () => {
  const s = session();
  assert.equal(s.start('reasoning', 'r'), 'Thinking');
  s.start('agentMessage', 'a');
  assert.equal(s.state.activityStatus, 'Thinking', 'an empty assistant item does not establish writing');
  assert.equal(s.event('item/agentMessage/delta', { itemId: 'a', delta: 'Here is the code' }), 'Writing the response');
  assert.equal(s.event('activity/status', { status: 'Reviewing the task content' }), 'Writing the response');
  s.start('reasoning', 'r2');
  assert.equal(s.complete('reasoning', 'r'), 'Writing the response');
  assert.equal(s.event('item/reasoning/textDelta', { itemId: 'r2', delta: 'analysis' }), 'Writing the response');
  assert.equal(s.complete('reasoning', 'r2'), 'Writing the response');
  assert.equal(s.complete('agentMessage', 'a', { text: 'Here is the code' }), 'Response ready');
});

test('patch streaming reports the file while an older reasoning item finishes', () => {
  const s = session();
  s.start('reasoning', 'r');
  s.start('fileChange', 'f', { changes: [{ path: 'src/app.js', kind: 'update' }] });
  const writing = s.event('item/fileChange/patchUpdated', { itemId: 'f', changes: [{ path: 'src/app.js', kind: 'update', diff: '+code' }] });
  assert.match(writing, /Editing.*src\/app.js/);
  assert.equal(s.complete('reasoning', 'r'), writing);
  assert.match(s.complete('fileChange', 'f', { changes: [{ path: 'src/app.js', kind: 'update' }] }), /Updated.*src\/app.js/);
  assert.doesNotMatch(s.state.activityStatus, /Thinking|Reviewing/);
});

test('an older command completion cannot replace a newer writing operation', () => {
  const s = session();
  s.start('commandExecution', 'c', { command: 'npm run build' });
  s.event('item/agentMessage/delta', { itemId: 'a', delta: 'Build results' });
  assert.equal(s.complete('commandExecution', 'c', { command: 'npm run build', exitCode: 0 }), 'Writing the response');
});

test('file writes, edits and deletes use the operation reported by the runtime', () => {
  for (const [kind, verb] of [['Write', 'Writing'], ['add', 'Writing'], ['update', 'Editing'], ['delete', 'Removing']]) {
    const s = session();
    assert.equal(s.start('fileChange', 'file', { changes: [{ path: 'page.html', kind }] }), verb + ' page.html');
  }
});

test('concurrent commands retain the running command and never resurrect stale analysis', () => {
  const s = session();
  s.start('reasoning', 'r');
  s.start('commandExecution', 'c1', { command: 'git status' });
  s.start('commandExecution', 'c2', { command: 'npm run build' });
  assert.equal(s.complete('commandExecution', 'c1', { command: 'git status', exitCode: 0 }), 'Running npm run build');
  const finished = s.complete('commandExecution', 'c2', { command: 'npm run build', exitCode: 0 });
  assert.match(finished, /npm run build.*exit 0/);
  assert.equal(s.complete('reasoning', 'r'), finished);
  assert.equal(s.event('item/commandExecution/outputDelta', { itemId: 'c1', delta: 'late output' }), finished);
});

test('foreign chats and previous turns cannot alter the visible activity', () => {
  const s = session();
  s.start('commandExecution', 'c', { command: 'git status' });
  for (const scope of [{ threadId: 'other-chat' }, { turnId: 'previous-turn' }]) {
    assert.equal(s.event('item/agentMessage/delta', { ...scope, itemId: 'foreign', delta: 'text' }), 'Running git status');
    assert.equal(s.event('item/completed', { ...scope, item: { id: 'c', type: 'commandExecution', exitCode: 0 } }), 'Running git status');
  }
});

test('planning, tool progress, and reasoning deltas each reflect their actual event', () => {
  const s = session();
  assert.equal(s.event('item/plan/delta', { itemId: 'p', delta: '1. Inspect files' }), 'Writing the task plan');
  s.complete('plan', 'p');
  s.start('mcpToolCall', 'm', { tool: 'browser_snapshot' });
  assert.equal(s.event('item/mcpToolCall/progress', { itemId: 'm', message: 'Inspecting the settings dialog' }), 'Inspecting the settings dialog');
  s.complete('mcpToolCall', 'm', { tool: 'browser_snapshot' });
  assert.equal(s.event('item/reasoning/summaryTextDelta', { itemId: 'new-reasoning', delta: 'summary' }), 'Thinking');
  assert.equal(s.complete('reasoning', 'new-reasoning'), 'Waiting for the next model activity');
});

test('a new turn resets running items from the previous turn', () => {
  const s = session();
  s.start('commandExecution', 'old', { command: 'old command' });
  s.event('turn/started', { turn: { id: 'next' }, turnId: 'next' });
  assert.equal(s.event('item/reasoning/textDelta', { turnId: 'next', itemId: 'r', delta: 'analysis' }), 'Thinking');
  assert.equal(s.event('item/agentMessage/delta', { turnId: 'next', itemId: 'a', delta: 'text' }), 'Writing the response');
});
