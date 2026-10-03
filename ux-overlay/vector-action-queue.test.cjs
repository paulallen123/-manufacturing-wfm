const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadVectorHelpers() {
  const source = fs.readFileSync(path.join(__dirname, 'vector-shell.js'), 'utf8');
  const instrumented = source.replace(
    'window.VectorWorkforceOperations={marker:MARKER',
    'window.VectorWorkforceOperations={alertsMarkup,readActionContext,rememberActionContext,marker:MARKER'
  );
  assert.notEqual(instrumented, source, 'Vector action markup test hook could not be attached.');
  const classList = { add() {}, remove() {}, toggle() {} };
  const sandbox = {
    window: { render: undefined, addEventListener() {}, location: { href: 'https://example.test/' } },
    document: {
      addEventListener() {},
      documentElement: {},
      querySelectorAll() { return []; },
      querySelector() { return null; },
      body: { classList, dataset: {} }
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout() { return 0; },
    queueMicrotask() {},
    sessionStorage: (() => {
      const values = new Map();
      return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); }
      };
    })(),
    URL,
    Intl,
    Date,
    console
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(instrumented, sandbox, { filename: 'vector-shell.js' });
  return sandbox.window.VectorWorkforceOperations;
}

test('Time Review action context uses the canonical attendance route end to end', () => {
  const vector = loadVectorHelpers();
  assert.equal(vector.rememberActionContext({
    sourceId: 'issue-1',
    workflow: 'time-review',
    route: 'attendance',
    title: 'Missing clock-out'
  }), true);
  const context = vector.readActionContext();
  assert.equal(context?.workflow, 'time-review');
  assert.equal(context?.route, 'attendance');
  assert.equal(context?.sourceId, 'issue-1');
  assert.equal(vector.rememberActionContext({
    sourceId: 'issue-2',
    workflow: 'time-review',
    route: 'time-review',
    title: 'Legacy route'
  }), false);
  const source = fs.readFileSync(path.join(__dirname, 'vector-shell.js'), 'utf8');
  assert.match(source, /if\(page\(\)!=='attendance'\|\|!ctx\)/);
});

test('approved Improve navigation exposes payroll reports without reviving the retired Reports top-level nav', () => {
  const source = fs.readFileSync(path.join(__dirname, 'vector-shell.js'), 'utf8');
  assert.match(source, /label:'Improve',icon:'report',routes:\['insights','costs','recommendations','benchmarks','compliance','overtime-watch','reports'\]/);
  assert.match(source, /\['reports','Reports'\]/);
});

test('source lifecycle is partitioned without presentation-word inference', () => {
  const vector = loadVectorHelpers();
  assert.equal(vector.actionDisposition({ confirmationState: 'action_required' }), 'needs-action');
  assert.equal(vector.actionDisposition({ confirmationState: 'needs_verification' }), 'needs-action');
  assert.equal(vector.actionDisposition({ status: 'Urgent' }), 'needs-action');
  assert.equal(vector.actionDisposition({ confirmationState: 'decision_sent' }), 'awaiting-source');
  assert.equal(vector.actionDisposition({ confirmationState: 'confirming_source' }), 'awaiting-source');
  assert.equal(vector.actionDisposition({ confirmationState: 'resolved' }), 'resolved');
});

test('awaiting confirmation remains present but does not inflate action-needed count', () => {
  const vector = loadVectorHelpers();
  const rows = [
    { id: 'a', confirmationState: 'action_required' },
    { id: 'b', confirmationState: 'needs_verification' },
    { id: 'c', status: 'Needs review' },
    { id: 'd', confirmationState: 'decision_sent' },
    { id: 'e', confirmationState: 'confirming_source' },
    { id: 'f', confirmationState: 'resolved' }
  ];
  const groups = vector.actionQueueGroups(rows);
  assert.deepEqual(Array.from(groups.needs, row => row.id), ['a', 'b', 'c']);
  assert.deepEqual(Array.from(groups.awaiting, row => row.id), ['d', 'e']);
});

test('rendered action queue keeps source-confirming work collapsed, visible and passive without hiding actionable work', () => {
  const vector = loadVectorHelpers();
  const row = (id, title, status, confirmationState) => ({
    id,
    title,
    status,
    confirmationState,
    detail: 'Source-owned evidence',
    tone: 'blue',
    route: 'attendance',
    action: 'Review'
  });
  const html = vector.alertsMarkup([
    row('a', 'Action A', 'Action required', 'action_required'),
    row('b', 'Decision B', 'Decision sent', 'decision_sent'),
    row('c', 'Confirming C', 'Confirming source', 'confirming_source'),
    row('d', 'Verify D', 'Needs verification', 'needs_verification'),
    row('e', 'Resolved E', 'Resolved', 'resolved'),
    row('f', 'Loose wording F', 'Urgent', undefined)
  ]);

  assert.match(html, /Needs my action <em>3<\/em>/);
  assert.match(html, /<details data-vector-awaiting-confirmation>/);
  assert.match(html, /Awaiting source confirmation · 2/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(html, /Resolved E/);

  const [needsMarkup, awaitingMarkup = ''] = html.split('<details data-vector-awaiting-confirmation>');
  assert.match(needsMarkup, /Action A/);
  assert.match(needsMarkup, /Verify D/);
  assert.match(needsMarkup, /Loose wording F/);
  assert.doesNotMatch(needsMarkup, /Decision B|Confirming C/);
  assert.match(needsMarkup, /aria-label="Review Action A">Review<\/button>/);
  assert.match(needsMarkup, /aria-label="Review Verify D">Review<\/button>/);
  assert.match(needsMarkup, /aria-label="Review Loose wording F">Review<\/button>/);
  assert.doesNotMatch(needsMarkup, />View status<\/button>/);

  assert.match(awaitingMarkup, /Decision B/);
  assert.match(awaitingMarkup, /Confirming C/);
  assert.match(awaitingMarkup, /aria-label="View status Decision B">View status<\/button>/);
  assert.match(awaitingMarkup, /aria-label="View status Confirming C">View status<\/button>/);
  assert.doesNotMatch(awaitingMarkup, /aria-label="Review (?:Decision B|Confirming C)"/);
});

test('action ordering cannot create synthetic urgency styling', () => {
  const css = fs.readFileSync(path.join(__dirname, 'vector-shell.css'), 'utf8');
  assert.doesNotMatch(css, /\.vector-alert-row:first-child>button\s*\{/);
  assert.match(css, /\.vector-alert-row>button\{[^}]*background:#edf3fb;[^}]*color:#355375;/);
});


test('manager leave shortcut hands off to the governed Absence & Leave workflow instead of the retired approval controller', () => {
  const source = fs.readFileSync(path.join(__dirname, 'vector-shell.js'), 'utf8');
  assert.match(source, /data-vector-review-coverage/);
  assert.match(source, /document\.getElementById\('modal'\)\?\.close\(\);go\('leave'\)/);
  assert.doesNotMatch(source, /if\(review\)[^}]*approveRequest\(id\)/);
});
