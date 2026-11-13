'use strict';
// Private source-level regression: no browser, service, persistence, or decision submission.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

function source(name, expected) {
  const bytes = fs.readFileSync(path.join(__dirname, name));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected, name + ' source drift');
  return bytes.toString('utf8');
}
function sealedCompanySource() {
  const archivePath = path.join(__dirname, '..', 'artifact', 'wfm-0.6.76-hosted-staging-rc1.tar.gz');
  const archive = fs.readFileSync(archivePath);
  assert.equal(crypto.createHash('sha256').update(archive).digest('hex'),
    '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d', 'sealed archive drift');
  const member = 'public/company-ui.js';
  // Every operation consumes the same verified bytes; tar never writes archive members.
  const tar = args => execFileSync('tar', args, {
    input: archive, shell: false, timeout: 3000, maxBuffer: 8 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const names = tar(['-tzf', '-']).toString('utf8').trimEnd().split('\n');
  assert.equal(names.filter(name => name === member).length, 1, 'exact archive member must be unique');
  const metadata = tar(['-tvzf', '-', '--', member]).toString('utf8').trimEnd().split('\n');
  assert.equal(metadata.length, 1, 'exact member must have one metadata record');
  assert.ok(metadata[0].startsWith('-'), 'company UI member must be a regular file');
  const bytes = tar(['-xOzf', '-', '--', member]);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),
    '5d2152d8aab79a58d2b562f9842142fe0324c2b284fc1979745e1c400d79615d', 'sealed company UI drift');
  return bytes.toString('utf8');
}
const company = sealedCompanySource();
const shell = source('vector-shell.js', '19ffa661133752a456a3d4b3a6d30c7113f7617394c5072eee53c5766b8df680');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
  const listeners = new Map(), reads = [], commands = [], forbidden = [], modals = [], toasts = [];
  const worker = { id: 'fictional-worker', name: 'Fictional worker' };
  const requestRow = { id: 'fictional-request', employee: worker.id, date: '2026-11-10', hours: 7.5, kind: 'Annual leave', status: 'pending' };
  const data = { version: 7, requests: [requestRow] };
  const initial = JSON.stringify(data);
  let inScope = true, resolveCapacity, rejectCapacity;
  const capacity = new Promise((resolve, reject) => { resolveCapacity = resolve; rejectCapacity = reject; });
  const classList = { add() {}, remove() {}, toggle() {} };
  const drawer = { innerHTML: '', opens: 0, closes: 0, classList,
    addEventListener() {}, showModal() { this.opens++; }, close() { this.closes++; },
    querySelector() { return { focus() {} }; } };
  const deny = label => (...args) => { forbidden.push({ label, args }); throw Error('Forbidden fixture operation: ' + label); };
  const context = vm.createContext({
    OFFLINE: false, identities: {}, WFMWorkRules: {}, PR: {},
    data, ui: { page: 'overview' }, F: { ready: false },
    people: () => inScope ? [worker] : [], person: id => id === worker.id ? worker : null,
    me: () => ({ id: 'fictional-manager', role: 'manager' }), isEmployee: () => false,
    shell: value => value, render() {}, esc: String,
    // Existing classic-script bindings only; the complete company source supplies implementations.
    payrollShell: undefined, footer: undefined, showLogin: undefined,
    approveRequest: undefined, openRequest: undefined, newLeave: undefined,
    request: (url, method, payload) => {
      reads.push({ url, method, payload });
      if (url !== '/api/leave-capacity' || method !== 'POST') return deny('unexpected request')(url, method);
      return capacity;
    },
    command: (...args) => { commands.push(args); throw Error('Decision command forbidden'); },
    modal: (title, html, submit) => { modals.push({ title, html, submit }); },
    modalActions: label => '<button type="submit">' + label + '</button>',
    toast: message => toasts.push(message),
    fetch: deny('fetch'), localStorage: { getItem: deny('storage read'), setItem: deny('storage write') },
    sessionStorage: { getItem: deny('session read'), setItem: deny('session write'), removeItem: deny('session remove') },
    document: {
      addEventListener(kind, callback) { if (!listeners.has(kind)) listeners.set(kind, []); listeners.get(kind).push(callback); },
      documentElement: {}, body: { classList, dataset: {} },
      querySelector() { return null; }, querySelectorAll() { return []; },
      getElementById(id) { assert.equal(id, 'modal'); return drawer; }
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout() { return 0; }, queueMicrotask() {}, addEventListener() {},
    location: { href: 'https://fictional.invalid/' }, URL, Intl, Date
  }, { codeGeneration: { strings: false, wasm: false } });
  // One global object, matching classic script globals. Neither source is rewritten.
  context.window = context;
  vm.runInContext(company, context, { filename: 'sealed/public/company-ui.js', timeout: 1000 });
  vm.runInContext(shell, context, { filename: 'ux-overlay/vector-shell.js', timeout: 1000 });
  assert.equal(vm.runInContext('typeof require + ":" + typeof process', context), 'undefined:undefined');
  async function click(selector, dataset) {
    const node = { dataset };
    const event = { target: { closest: candidate => candidate === selector ? node : null }, preventDefault() {} };
    for (const callback of listeners.get('click') || []) await callback(event);
    await tick();
  }
  async function open() {
    await click('[data-vector-source-id][data-vector-workflow][data-vector-route]', {
      vectorSourceId: requestRow.id, vectorWorkflow: 'leave', vectorRoute: 'leave'
    });
    assert.equal(drawer.opens, 1);
    const button = drawer.innerHTML.match(/<button\b[^>]*data-vector-review-coverage="([^"]+)"[^>]*>([^<]+)<\/button>/);
    assert.ok(button, 'actual shell drawer must render its coverage button');
    assert.equal(button[2], 'Review coverage');
    assert.equal(button[1], requestRow.id);
    assert.match(drawer.innerHTML, /A review does not approve the request/);
    return () => click('[data-vector-review-coverage]', { vectorReviewCoverage: button[1] });
  }
  t.after(() => {
    assert.equal(commands.length, 0, 'even a caught decision-command attempt fails this regression');
    assert.equal(forbidden.length, 0, 'no network or storage escape');
    assert.equal(requestRow.status, 'pending');
    assert.equal(data.version, 7);
  });
  return { open, reads, commands, modals, toasts, drawer, data, initial,
    resolve: () => resolveCapacity({ status: 'prechecks_clear', hours: 7.5, balanceBefore: 30, blocking: [], warnings: [], segments: [] }),
    reject: () => rejectCapacity(Error('Fictional capacity unavailable')),
    hide: () => { inScope = false; } };
}

test('labelled coverage click reads capacity, then opens an unsubmitted confirmation', async t => {
  const f = fixture(t), clickCoverage = await f.open();
  assert.equal(f.reads.length, 0);
  await clickCoverage();
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].payload.requestId, 'fictional-request');
  assert.equal(f.reads[0].payload.employee, 'fictional-worker');
  assert.equal(f.modals.length, 0, 'confirmation waits for capacity');
  assert.equal(JSON.stringify(f.data), f.initial);
  f.resolve(); await tick();
  assert.equal(f.modals.length, 1);
  assert.equal(f.modals[0].title, 'Review holiday coverage');
  assert.match(f.modals[0].html, /name="reviewed" required/);
  assert.match(f.modals[0].html, /Approve time off/);
  assert.equal(typeof f.modals[0].submit, 'function'); // Capture only; never call approval.
  assert.equal(f.commands.length, 0);
  assert.equal(JSON.stringify(f.data), f.initial);
});

test('capacity failure opens no confirmation and submits no decision', async t => {
  const f = fixture(t), clickCoverage = await f.open();
  await clickCoverage(); f.reject(); await tick();
  assert.equal(f.reads.length, 1);
  assert.equal(f.modals.length, 0);
  assert.deepEqual(f.toasts, ['Fictional capacity unavailable']);
  assert.equal(JSON.stringify(f.data), f.initial);
});

for (const change of ['missing', 'out-of-scope']) {
  test('rendered coverage button does nothing when its request becomes ' + change, async t => {
    const f = fixture(t), clickCoverage = await f.open();
    if (change === 'missing') f.data.requests = []; else f.hide();
    const before = JSON.stringify(f.data);
    await clickCoverage();
    assert.equal(f.reads.length, 0);
    assert.equal(f.modals.length, 0);
    assert.equal(JSON.stringify(f.data), before);
  });
}
