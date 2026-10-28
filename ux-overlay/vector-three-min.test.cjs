const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sourcePath = require('node:path').join(__dirname, 'vector-shell.js');
const PREFIX = '/api/integrations/autonomous';
const clone = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness(respond, initial = {}) {
  const calls = [], redirects = [], listeners = new Map();
  const identity = { id: 'admin-a', email: 'admin@example.test', tenant: 'tenant-a', role: 'ADMIN' };
  const classList = { add() {}, remove() {}, toggle() {} };
  class Element {
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.dataset = {}; this.style = {}; this.classList = classList; this.children = []; this.attributes = {}; this.html = ''; }
    set innerHTML(value) { this.html = String(value); this.input = null; }
    get innerHTML() { return this.html; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    prepend(node) { node.parentElement = this; this.children.unshift(node); }
    append(node) { node.parentElement = this; this.children.push(node); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); this.parentElement = null; }
    contains(node) { return node === this || this.children.some(x => x.contains(node)); }
    get isConnected() { return content.contains(this); }
    querySelector(selector) {
      if (selector.includes('data-vector-three-min-card')) return this.children.find(x => x.dataset.vectorThreeMinCard != null) || null;
      return null;
    }
    querySelectorAll() { return []; }
    closest(selector) {
      const mapping = { '[data-vector-three-min-refresh]': 'vectorThreeMinRefresh', '[data-vector-three-min-card]': 'vectorThreeMinCard' };
      if (mapping[selector] && this.dataset[mapping[selector]] != null) return this;
      return this.parentElement?.closest(selector) || null;
    }
    matches() { return false; }
    focus() {}
  }
  let content = new Element('main');
  const app = new Element(), sidebar = new Element(), topbar = new Element(), parent = new Element();
  content.parentElement = parent;
  parent.querySelector = () => topbar;
  app.querySelector = selector => selector.includes('vector-sidebar') ? sidebar : selector === '.content' ? content : null;
  const nav = ['integrations', 'overview'].map(route => ({ dataset: { page: route }, textContent: route }));
  const document = {
    body: { classList, dataset: {} }, documentElement: {},
    querySelector(selector) { if (selector === '.app') return app; if (selector === '.content') return content; if (selector === '.vector-sidebar') return sidebar; return content.querySelector(selector); },
    querySelectorAll(selector) { return selector.includes('.navbtn[data-page]') ? nav : []; },
    createElement(tag) { return new Element(tag); },
    getElementById() { return null; },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); }
  };
  const location = { href: 'https://vector.example.test/#vector/integrations', origin: 'https://vector.example.test', hash: '#vector/integrations', assign(url) { redirects.push(String(url)); } };
  const ui = { page: 'integrations', root: null };
  const window = { document, location, addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); }, scrollTo() {}, render: async () => { content = new Element('main'); content.parentElement = parent; } };
  const sandbox = { window, document, location, ui, me: () => identity, isEmployee: () => identity.role === 'EMPLOYEE',
    history: { pushState() {}, replaceState() {} }, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() { throw new Error('3Min must not persist browser state'); } },
    MutationObserver: class { observe() {} disconnect() {} }, setTimeout() { return 0; }, clearTimeout() {}, queueMicrotask,
    AbortController, URL, Intl, Date, console,
    fetch: async (url, options = {}) => {
      const path = String(url).replace(PREFIX, '');
      if (String(url) !== PREFIX + '/feeds/3min') return { ok: true, status: 200, json: async () => ({}) };
      const request = { path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, options };
      calls.push(request);
      const answer = await respond(request, calls);
      const status = answer?.status || 200;
      return { ok: status >= 200 && status < 300, status, json: async () => clone(answer?.body ?? answer ?? {}) };
    }
  };
  window.window = window;
  Object.assign(identity, initial);
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), sandbox, { filename: sourcePath });
  const card = () => content.children.find(x => x.dataset.vectorThreeMinCard != null);
  const fire = (name, target) => { const event = { target, preventDefault() {} }; for (const fn of listeners.get(name) || []) fn(event); };
  return { calls, redirects, identity, ui, window, card,
    async mount() { window.VectorWorkforceOperations.apply(); await flush(); },
    async click(action) {
      assert.ok(card(), '3Min connection card must be mounted');
      const button = new Element('button'); button.dataset.vectorThreeMinRefresh = ''; button.parentElement = card(); fire('click', button); await flush();
    },
    hide() { for (const fn of listeners.get('pagehide') || []) fn(); },
    async render() { await window.render(); await flush(); },
    text() { return card()?.innerHTML || ''; }
  };
}
const empty = () => ({ transport: '3min-api', schemaVersion: 'vector-feed-v1', sourceAuthenticated: false, executionAuthority: false, bindings: [], receipts: [] });
const snapshot = () => ({ ...empty(), bindings: [{ id: 'feed-a', site: 'factory-a', source: 'provider-a', domain: 'people', environment: 'production', configured: true }], receipts: [
  { receiptId: 'receipt-a', bindingId: 'feed-a', site: 'factory-a', source: 'provider-a', domain: 'people', environment: 'production', eventId: 'event-a', recordCount: 2, receivedAt: '2026-10-23T20:00:00.000Z', status: 'RECEIVED_UNVALIDATED' },
  { receiptId: 'receipt-b', bindingId: 'feed-a', site: 'factory-a', source: 'provider-a', domain: 'people', environment: 'production', eventId: 'event-b', recordCount: 0, receivedAt: '2026-10-23T20:01:00.000Z', status: 'REJECTED_VALIDATION', validationError: 'UNSUPPORTED_WEBHOOK_RESULT' }
] });

test('unconfigured intake explains setup without claiming an import or polling on renders', async () => {
  const h = harness(() => empty()); await h.mount();
  assert.ok(h.card()); assert.match(h.text(), /No 3Min feeds configured/);
  assert.match(h.text(), /not been imported into workforce data/);
  for (let i = 0; i < 5; i++) await h.mount();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, 'GET');
  assert.equal(h.calls[0].options.credentials, 'same-origin');
  assert.equal(h.calls[0].options.cache, 'no-store');
});
test('receipts distinguish awaiting validation, rejected and unknown status, escaping metadata', async () => {
  const value = snapshot(); value.receipts.push({ ...value.receipts[0], receiptId: '<script>bad()</script>', status: 'constructor' });
  value.bindings[0].source = '<img src=x onerror=bad()>'; value.payload = 'PRIVATE PAYLOAD'; value.secret = 'PRIVATE SECRET';
  const h = harness(() => value); await h.mount();
  assert.match(h.text(), /Received — awaiting validation/); assert.match(h.text(), /Rejected/);
  assert.match(h.text(), /Status unavailable/); assert.match(h.text(), /receipt-a/);
  assert.match(h.text(), /&lt;script&gt;/); assert.match(h.text(), /&lt;img/);
  assert.doesNotMatch(h.text(), /<script>|<img|PRIVATE PAYLOAD|PRIVATE SECRET|Imported successfully/);
});
test('configured feed with no receipts and missing authentication remain distinct', async () => {
  const value = snapshot(); value.receipts = []; value.bindings[0].configured = false;
  const h = harness(() => value); await h.mount();
  assert.match(h.text(), /Authentication setup required/); assert.match(h.text(), /No delivery receipts yet/);
  assert.doesNotMatch(h.text(), /Ready for deliveries/);
});
test('refresh failure clears previous receipt details and permits manual retry', async () => {
  let count = 0;
  const h = harness(() => ++count === 2 ? { status: 503, body: { error: 'SECRET INTERNAL FAILURE' } } : snapshot());
  await h.mount(); assert.match(h.text(), /receipt-a/);
  await h.click('refresh'); assert.doesNotMatch(h.text(), /receipt-a|SECRET INTERNAL FAILURE/);
  assert.match(h.text(), /could not be checked/); await h.click('refresh'); assert.match(h.text(), /receipt-a/);
  assert.equal(h.calls.length, 3); assert.ok(h.calls.every(r => r.method === 'GET'));
});
test('authentication, unavailable receiver and malformed data do not become empty successful intake', async () => {
  for (const answer of [{ status: 401 }, { status: 403 }, { status: 404 }, { bindings: [], receipts: [] }, { ...empty(), executionAuthority: true }]) {
    const h = harness(() => answer); await h.mount();
    assert.match(h.text(), /could not be checked|Sign in|not available/);
    assert.doesNotMatch(h.text(), /No 3Min feeds configured|No delivery receipts yet/);
  }
});
test('tenant and account switches remove pending old receipts even before a new render', async () => {
  for (const field of ['tenant', 'id', 'role']) {
    const pending = deferred(), h = harness(() => pending.promise); await h.mount();
    h.identity[field] = field === 'role' ? 'EMPLOYEE' : 'other';
    pending.resolve(snapshot()); await flush();
    assert.equal(h.card(), undefined); assert.equal(h.calls[0].options.signal.aborted, true);
  }
});
test('route departure, rerender and pagehide abort old requests; employees never fetch receipts', async () => {
  const pending = deferred(), h = harness(() => pending.promise); await h.mount();
  h.ui.page = 'overview'; await h.mount(); pending.resolve(snapshot()); await flush();
  assert.equal(h.card(), undefined); assert.equal(h.calls[0].options.signal.aborted, true);
  const pending2 = deferred(); let count = 0;
  const second = harness(() => ++count === 1 ? pending2.promise : empty());
  await second.mount(); const rendering = second.window.render();
  assert.equal(second.calls[0].options.signal.aborted, true, 'rerender aborts before awaiting the previous renderer');
  await rendering; await flush(); pending2.resolve(snapshot()); await flush();
  assert.doesNotMatch(second.text(), /receipt-a/); assert.equal(second.calls[0].options.signal.aborted, true);
  second.hide(); assert.equal(second.card(), undefined);
  const employee = harness(() => snapshot(), { role: 'EMPLOYEE' }); await employee.mount();
  assert.equal(employee.calls.length, 0); assert.equal(employee.card(), undefined);
});
test('concurrent refresh clicks do not duplicate the request', async () => {
  const pending = deferred(), h = harness(() => pending.promise); await h.mount();
  await h.click('refresh'); await h.click('refresh'); assert.equal(h.calls.length, 1);
  pending.resolve(empty()); await flush();
});
