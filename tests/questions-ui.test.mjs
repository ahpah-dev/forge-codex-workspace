import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const browsers = await readdir(path.join(root, 'build/browser'));
const headless = browsers.find((name) => name.startsWith('chromium_headless_shell-'));
const executablePath = path.join(root, 'build/browser', headless, 'chrome-headless-shell-win64/chrome-headless-shell.exe');
const source = await readFile(path.join(root, 'public/app.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('question cards submit selections, retain focus across updates, and support custom multi-select', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://**/*', (route) => route.abort());
    await page.setContent('<main id="approval-slot" class="approval-slot" style="width:620px;margin:30px auto"></main>');
    await page.addStyleTag({ path: path.join(root, 'public/styles.css') });
    await page.addScriptTag({ path: path.join(root, 'public/question-protocol.js') });
    await page.addScriptTag({ content: `
      const $ = (selector) => document.querySelector(selector);
      const state = { approvals: [], questionDrafts: new Map(), questionSending: new Set(), approvalRenderSignature: '' };
      const sent = [], failures = [];
      const liveActivities = { current: () => null };
      function setActivityStatus() {}
      function showToast(message) { failures.push(message); }
      async function api(url, options) { sent.push(options.body); await new Promise((resolve) => setTimeout(resolve, 50)); return { ok: true }; }
      function renderMessages() { renderApprovalSlot(); }
      function renderApproval(event) { return renderQuestionRequest(event, 'Codex'); }
      ${section('function renderApprovalSlot()', 'function renderApproval(event)')}
      ${section('async function answerApproval(', 'function cacheThreadHistory(')}
      $('#approval-slot').addEventListener('click', (event) => { const button = event.target.closest('[data-approval-id]'); if (button) answerApproval(button.dataset.approvalId, button.dataset.decision); });
      state.approvals = [{ id: 'request', method: 'item/tool/requestUserInput', params: { questions: [
        { id: 'theme', header: 'Theme', question: 'Which theme should I use?', isOther: true, options: [{ label: 'Dark (Recommended)', description: 'A quiet interface for evening work.' }, { label: 'Light', description: 'A bright, neutral workspace.' }] },
        { id: 'title', header: 'Name', question: 'What title should the app use?' }
      ] } }]; renderApprovalSlot();
    ` });
    assert.equal(await page.getByRole('button', { name: 'Send answers', exact: true }).isDisabled(), true);
    await page.getByText('Dark (Recommended)', { exact: true }).click();
    const titleInput = page.getByRole('textbox', { name: 'Your answer to What title should the app use?' });
    await titleInput.fill('Workshop');
    await page.evaluate(() => { globalThis.savedInput = document.activeElement; renderApprovalSlot(); });
    assert.equal(await page.evaluate(() => globalThis.savedInput === document.activeElement && document.activeElement.value === 'Workshop'), true);
    await mkdir(path.join(root, 'data/question-checks'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'data/question-checks/question-card.png'), fullPage: true });
    await page.getByRole('button', { name: 'Send answers', exact: true }).click();
    await page.locator('.question-card').waitFor({ state: 'detached' });
    const answer = await page.evaluate(() => sent[0]);
    assert.deepEqual(answer.answers.theme.answers, ['Dark (Recommended)']);
    assert.deepEqual(answer.answers.title.answers, ['Workshop']);

    await page.evaluate(() => {
      state.approvals = [{ id: 'multi', method: 'anthropic/tool/requestUserInput', params: { questions: [{ id: 'stores', header: 'Storage', question: 'Which stores?', isOther: true, multiSelect: true, options: [{ label: 'SQLite' }, { label: 'Redis' }] }] } }];
      renderApprovalSlot();
    });
    await page.getByText('SQLite', { exact: true }).click();
    await page.getByText('Redis', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Your answer to Which stores?' }).fill('Postgres');
    await page.getByRole('button', { name: 'Send answer', exact: true }).click();
    await page.locator('.question-card').waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => sent[1].answers.stores.answers), ['SQLite', 'Redis', 'Postgres']);
    assert.deepEqual(await page.evaluate(() => failures), []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
