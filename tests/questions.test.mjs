import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../public/question-protocol.js';

const protocol = globalThis.ForgeQuestions;
const single = [{ id: 'theme', question: 'Which theme?', isOther: true, options: [{ label: 'Dark' }, { label: 'Light' }] }];

test('questions require deliberate answers and preserve custom answers', () => {
  assert.throws(() => protocol.fromDraft(single, {}), /Answer each question/);
  assert.deepEqual(protocol.fromDraft(single, { theme: { selected: ['Dark'] } }).theme.answers, ['Dark']);
  assert.deepEqual(protocol.fromDraft(single, { theme: { selected: ['Dark'], useCustom: true, custom: '  Sepia  ' } }).theme.answers, ['Sepia']);
  assert.throws(() => protocol.validate(single, { theme: { answers: ['Dark', 'Light'] } }), /Select one/);
  assert.throws(() => protocol.validate([{ ...single[0], isOther: false }], { theme: { answers: ['Sepia'] } }), /offered answers/);
});

test('Claude multi-selection is converted to the SDK question-text answer map', () => {
  const input = { questions: [{ header: 'Storage', question: 'Which stores?', multiSelect: true, options: [{ label: 'SQLite' }, { label: 'Redis' }] }] };
  const questions = protocol.normalizeClaude(input);
  const answers = protocol.fromDraft(questions, { 'claude-question-1': { selected: ['SQLite', 'Redis'], useCustom: true, custom: 'Postgres' } });
  const updated = protocol.claudeInput(input, questions, answers);
  assert.equal(updated.answers['Which stores?'], 'SQLite, Redis, Postgres');
  assert.equal(updated.questions, input.questions);
});

const providerSource = await readFile(new URL('../anthropic-provider.mjs', import.meta.url), 'utf8');
function claudeCallback() {
  const events = [];
  const context = vm.createContext({
    ForgeQuestions: protocol, pendingApprovals: new Map(),
    randomUUID: () => 'fixture-question', describeTool: () => 'Question',
    publish: (event) => events.push(event), send: (method, params) => events.push({ method, params }),
  });
  vm.runInContext(providerSource.slice(providerSource.indexOf('  function resolveApproval('), providerSource.indexOf('  async function runTurn(')), context);
  return { context, events };
}

test('Claude questions still pause for a real answer with permission prompts disabled', async () => {
  const { context, events } = claudeCallback();
  const input = { questions: [{ question: 'Which theme?', header: 'Theme', options: [{ label: 'Dark', description: 'Dim interface' }, { label: 'Light' }] }] };
  const promise = context.requestPermission({ id: 'chat', askBeforeExternalActions: false }, 'turn', 'AskUserQuestion', input, {});
  let completed = false;
  promise.then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(events[0].method, 'anthropic/tool/requestUserInput');
  const id = events[0].id;
  assert.throws(() => context.resolveApproval(id, 'accept'), /Answer Claude/);
  assert.throws(() => context.resolveQuestion(id, {}), /Answer each question/);
  context.resolveQuestion(id, { 'claude-question-1': { answers: ['Dark'] } });
  const result = await promise;
  assert.equal(result.behavior, 'allow');
  assert.equal(result.updatedInput.answers['Which theme?'], 'Dark');
  assert.equal(events.at(-1).method, 'serverRequest/resolved');
  assert.throws(() => context.resolveQuestion(id, {}), /already completed/);
});

test('stopping a task resolves and dismisses its pending Claude question', async () => {
  const { context, events } = claudeCallback();
  const controller = new AbortController();
  const promise = context.requestPermission({ id: 'chat', askBeforeExternalActions: false }, 'turn', 'AskUserQuestion', { questions: [{ question: 'Name?' }] }, { signal: controller.signal });
  controller.abort();
  assert.equal((await promise).behavior, 'deny');
  assert.equal(events.at(-1).method, 'serverRequest/resolved');
});
