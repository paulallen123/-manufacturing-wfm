const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadVectorHelpers() {
  const source = fs.readFileSync(path.join(__dirname, 'vector-shell.js'), 'utf8');
  const classList = { add() {}, remove() {}, toggle() {} };
  const sandbox = {
    window: { render: undefined, location: { href: 'https://example.test/' } },
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
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    URL,
    Intl,
    Date,
    console
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'vector-shell.js' });
  return sandbox.window.VectorWorkforceOperations;
}

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
  assert.deepEqual(groups.needs.map(row => row.id), ['a', 'b', 'c']);
  assert.deepEqual(groups.awaiting.map(row => row.id), ['d', 'e']);
});
