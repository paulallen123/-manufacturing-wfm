// Proof-runner unit regression, NOT a Vector application/customer-journey test.
// The real Chromium browser renders a small synthetic DOM. Only the retained
// overlap assertion is executed; no authentication, API or business-state proof
// is claimed by these tests, and the application entrypoint is never imported.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { chromium } from 'playwright';

const source = readFileSync(new URL('./current-candidate-role-browser-proof.mjs', import.meta.url), 'utf8');
const start = "  const overlapError = employeePage.locator('#formerror');";
const end = '  leaveJourney.overlapRefusedInUi = true;';
assert.equal(source.split(start).length, 2, 'Expected one overlap assertion entrypoint.');
assert.equal(source.split(end).length, 2, 'Expected one overlap acceptance flag.');
const snippet = source.slice(source.indexOf(start), source.indexOf(end));
assert.match(snippet, /assert\.match\(await overlapError\.innerText\(\)/, 'Final visible-text assertion must remain.');
assert.match(snippet, /timeout: 10000/, 'Do not mask the race by changing the production timeout.');
assert.doesNotMatch(snippet, /waitForTimeout|setTimeout|\.click\(|\.fill\(|\.evaluate\(/, 'The assertion must not replay a write, inject evidence or use fixed sleeps.');
const execute = new (Object.getPrototypeOf(async function () {}).constructor)('employeePage', 'assert', snippet);
const message = 'This leave request overlaps an existing request.';
const box = '<div id="formerror" style="min-height:24px;min-width:120px"></div>';

const cases = [
  { name: 'waits for delayed feedback in an already-visible empty error box', html: box, delay: 300 },
  { name: 'waits through a visible non-error placeholder', html: box.replace('></div>', '>Saving…</div>'), delay: 450 },
  { name: 'reacquires the error element after an asynchronous re-render', html: box, delay: 300, replace: true },
  { name: 'accepts immediately visible matching feedback', html: box.replace('></div>', `>${message}</div>`) },
  { name: 'rejects a permanently empty visible box', html: box, reject: true },
  { name: 'rejects unrelated error text', html: box.replace('></div>', '>Access denied.</div>'), reject: true },
  { name: 'rejects a missing error element', html: '<main>No feedback element.</main>', reject: true },
  { name: 'rejects matching text in a hidden error element', html: `<div id="formerror" hidden>${message}</div>`, reject: true },
  { name: 'rejects matching text only inside a hidden child', html: box.replace('></div>', `><span hidden>${message}</span></div>`), reject: true },
  { name: 'ignores matching text elsewhere on the page', html: box + `<p>${message}</p>`, reject: true }
];

test('retained overlap assertion waits for visible content and remains fail-closed', { concurrency: 4, timeout: 45000 }, async t => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined });
  t.diagnostic(JSON.stringify({
    scope: 'local synthetic-DOM proof-runner regression only',
    node: process.version,
    chromium: browser.version(),
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    snippetSha256: createHash('sha256').update(snippet).digest('hex')
  }));
  try {
    await Promise.all(cases.map(item => t.test(item.name, { timeout: 15000 }, async () => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.setContent(item.html);
        if (item.delay) {
          // Delayed test input, not a sleep or evidence injection in the verifier.
          await page.evaluate(({ delay, replace, message }) => {
            setTimeout(() => {
              let node = document.getElementById('formerror');
              if (replace) {
                const next = node.cloneNode(false);
                node.replaceWith(next);
                node = next;
              }
              node.textContent = message;
            }, delay);
          }, { delay: item.delay, replace: !!item.replace, message });
        }
        if (item.reject) {
          await assert.rejects(() => execute(page, assert), error => {
            assert.ok(error.name === 'TimeoutError' || error.code === 'ERR_ASSERTION', `Unexpected failure: ${error.name}`);
            return true;
          });
        } else {
          await execute(page, assert);
          assert.equal(await page.locator('#formerror').innerText(), message);
        }
      } finally { await context.close(); }
    })));
  } finally { await browser.close(); }
});
