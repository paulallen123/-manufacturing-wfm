const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sourcePath = require('node:path').join(__dirname, 'vector-shell.js');
const PREFIX = '/api/integrations/autonomous';
const COMPANY = '11111111-2222-4333-8444-555555555555';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
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
      if (selector.includes('data-vector-gusto-card')) return this.children.find(x => x.dataset.vectorGustoCard != null) || null;
      if (selector.includes('data-vector-gusto-company') && this.html.includes('data-vector-gusto-company')) {
        if (!this.input) {
          this.input = new Element('input');
          this.input.dataset.vectorGustoCompany = '';
          this.input.value = this.html.match(/data-vector-gusto-company[^>]*value="([^"]*)"/)?.[1] || '';
          this.input.parentElement = this;
        }
        return this.input;
      }
      return null;
    }
    querySelectorAll() { return []; }
    closest(selector) {
      const mapping = { '[data-vector-gusto-connect]': 'vectorGustoConnect', '[data-vector-gusto-refresh]': 'vectorGustoRefresh', '[data-vector-gusto-company]': 'vectorGustoCompany', '[data-vector-gusto-card]': 'vectorGustoCard' };
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
  const window = { document, location, addEventListener() {}, scrollTo() {}, render: async () => { content = new Element('main'); content.parentElement = parent; } };
  const sandbox = { window, document, location, ui, me: () => identity, isEmployee: () => identity.role === 'EMPLOYEE',
    history: { pushState() {}, replaceState() {} }, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() { throw new Error('Gusto must not persist browser state'); } },
    MutationObserver: class { observe() {} disconnect() {} }, setTimeout() { return 0; }, clearTimeout() {}, queueMicrotask,
    AbortController, URL, Intl, Date, console,
    fetch: async (url, options = {}) => {
      const path = String(url).replace(PREFIX, '');
      if (!String(url).startsWith(PREFIX)) return { ok: true, status: 200, json: async () => ({}) };
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
  const card = () => content.children.find(x => x.dataset.vectorGustoCard != null);
  const fire = (name, target) => { const event = { target, preventDefault() {} }; for (const fn of listeners.get(name) || []) fn(event); };
  return { calls, redirects, identity, ui, window, card,
    async mount() { window.VectorWorkforceOperations.apply(); await flush(); },
    async click(action) {
      assert.ok(card(), 'Gusto connection card must be mounted');
      const button = new Element('button'); button.dataset[action === 'connect' ? 'vectorGustoConnect' : 'vectorGustoRefresh'] = ''; button.parentElement = card(); fire('click', button); await flush();
    },
    input(value) { const input = card()?.querySelector('[data-vector-gusto-company]'); assert.ok(input, 'Company UUID entry is required when no company is configured'); input.value = value; fire('input', input); },
    async render() { await window.render(); await flush(); },
    text() { return card()?.innerHTML || ''; }
  };
}
const configuration = (extra = {}) => ({ configured: true, environment: 'sandbox', missingConfiguration: [], expectedCompanyUuid: COMPANY, ...extra });
const connected = (extra = {}) => ({ id: 'connection-a', candidateId: 'candidate-a', productKey: 'gusto', state: 'VALIDATING', sourceInstanceId: COMPANY, canonicalImport: null,
  gusto: { companyUuid: COMPANY, companyName: 'Example Works', environment: 'sandbox', grantedScopes: ['companies:read'], verifiedAt: '2026-09-29T10:00:00.000Z' }, ...extra });
const status = (connections = [], candidates = []) => ({ connections, discovery: { candidates } });
const authorization = (url = 'https://api.gusto-demo.com/oauth/authorize?client_id=public-id&state=random-state', environment = 'sandbox') => ({ authorizationUrl: url, environment, expiresAt: '2099-01-01T00:00:00.000Z' });

test('missing configuration is actionable without exposing server configuration or polling on shell mutations', async () => {
  const h = harness(req => req.path === '/gusto/configuration' ? configuration({ configured: false, missingConfiguration: ['GUSTO_CLIENT_SECRET', 'internal-example'] }) : status());
  await h.mount();
  assert.ok(h.card(), 'Gusto connection card must be mounted');
  assert.match(h.text(), /Gusto setup required/);
  assert.doesNotMatch(h.text(), /GUSTO_CLIENT_SECRET|internal-example/);
  const count = h.calls.length;
  for (let i = 0; i < 8; i++) await h.mount();
  assert.equal(h.calls.length, count);
  assert.equal(h.calls.filter(x => x.method === 'POST').length, 0);
});

test('verified access is escaped and existing connections are reused for authorization', async () => {
  const h = harness(req => {
    if (req.path === '/gusto/configuration') return configuration();
    if (req.path === '/status') return status([connected({ gusto: { ...connected().gusto, companyName: '<img src=x onerror=alert(1)>' } })]);
    if (req.path === '/gusto/authorize') return authorization();
    throw new Error('Unexpected request: ' + req.path);
  });
  await h.mount();
  assert.match(h.text(), /Company access verified/);
  assert.match(h.text(), /Workforce data has not been imported/);
  assert.doesNotMatch(h.text(), /<img/);
  assert.match(h.text(), /&lt;img/);
  await h.click('connect');
  assert.deepEqual(h.calls.filter(x => x.method === 'POST').map(x => [x.path, x.body]), [['/gusto/authorize', { connectionId: 'connection-a', expectedCompanyUuid: COMPANY }]]);
  assert.deepEqual(h.redirects, ['https://api.gusto-demo.com/oauth/authorize?client_id=public-id&state=random-state']);
});

test('UUID selection is validated before writes and a new connection follows the existing hub workflow', async () => {
  let candidate = null, connection = null;
  const h = harness(req => {
    if (req.path === '/gusto/configuration') return configuration({ expectedCompanyUuid: null });
    if (req.path === '/status') return status(connection ? [connection] : [], candidate ? [candidate] : []);
    if (req.path === '/discover') { assert.deepEqual(req.body, { source: 'USER', apps: [{ productKey: 'gusto', name: 'Gusto' }] }); candidate = { id: 'candidate-new', productKey: 'gusto', status: 'IDENTIFIED' }; return { candidates: [candidate] }; }
    if (req.path === '/confirm') { assert.deepEqual(req.body, { candidateId: 'candidate-new', authoritativeFor: ['people', 'payroll'] }); candidate.status = 'CONFIRMED'; return { candidate }; }
    if (req.path === '/connect') { assert.deepEqual(req.body, { candidateId: 'candidate-new', authMethod: 'oauth2' }); connection = connected({ id: 'connection-new', gusto: null, state: 'AUTHORIZATION_REQUIRED' }); return { connection }; }
    if (req.path === '/gusto/authorize') return authorization();
    throw new Error('Unexpected request: ' + req.path);
  });
  await h.mount(); h.input('wrong-company'); await h.click('connect');
  assert.equal(h.calls.filter(x => x.method === 'POST').length, 0);
  h.input(OTHER); await h.click('connect');
  assert.deepEqual(h.calls.filter(x => x.method === 'POST').map(x => x.path), ['/discover', '/confirm', '/connect', '/gusto/authorize']);
  assert.deepEqual(h.calls.find(x => x.path === '/gusto/authorize').body, { connectionId: 'connection-new', expectedCompanyUuid: OTHER });
  assert.equal(h.redirects.length, 1);
});

test('authorization redirects reject foreign origins, wrong environments and userinfo URLs', async () => {
  for (const url of ['https://api.gusto-demo.com.attacker.test/oauth/authorize', 'https://api.gusto.com/oauth/authorize', 'https://user:password@api.gusto-demo.com/oauth/authorize', 'http://api.gusto-demo.com/oauth/authorize']) {
    const h = harness(req => req.path === '/gusto/configuration' ? configuration() : req.path === '/status' ? status([connected()]) : authorization(url));
    await h.mount(); await h.click('connect');
    assert.equal(h.redirects.length, 0, url);
    assert.doesNotMatch(h.text(), /attacker\.test|user:password/);
  }
});

test('a tenant switch during authorization prevents navigation and clears previous company information', async () => {
  const pending = deferred();
  const h = harness(req => req.path === '/gusto/configuration' ? configuration() : req.path === '/status' ? status(h.identity.tenant === 'tenant-a' ? [connected()] : []) : pending.promise);
  await h.mount(); await h.click('connect');
  h.identity.tenant = 'tenant-b'; await h.mount();
  pending.resolve(authorization()); await flush();
  assert.equal(h.redirects.length, 0);
  assert.doesNotMatch(h.text(), /Example Works/);
});

test('leaving the route or rerendering invalidates pending configuration responses', async () => {
  const pending = deferred();
  const h = harness(req => req.path === '/gusto/configuration' ? pending.promise : status([connected()]));
  await h.mount();
  assert.ok(h.card(), 'The pending Gusto card must exist before leaving');
  assert.equal(h.calls.length, 2);
  h.ui.page = 'overview'; await h.mount();
  pending.resolve(configuration()); await flush();
  assert.equal(h.calls[0].options.signal.aborted, true);
  assert.equal(h.redirects.length, 0);
  assert.doesNotMatch(h.text(), /Company access verified|Example Works/);
});

test('an asynchronous response clears stale company details even before the next tenant render', async () => {
  const pending = deferred();
  const h = harness(req => req.path === '/gusto/configuration' ? configuration() : req.path === '/status' ? status([connected()]) : pending.promise);
  await h.mount(); await h.click('connect');
  h.identity.tenant = 'tenant-b';
  pending.resolve(authorization()); await flush();
  assert.equal(h.redirects.length, 0);
  assert.equal(h.card(), undefined, 'A stale tenant must not retain the previous company card');
});

test('rerendering the same session discards the previous pending status response', async () => {
  const first = deferred(); let checks = 0;
  const h = harness(req => {
    if (req.path === '/gusto/configuration') return ++checks === 1 ? first.promise : configuration();
    return status(checks === 1 ? [connected()] : []);
  });
  await h.mount(); await h.render();
  first.resolve(configuration()); await flush();
  assert.equal(h.calls[0].options.signal.aborted, true);
  assert.doesNotMatch(h.text(), /Example Works|Company access verified/);
  assert.equal(h.redirects.length, 0);
});

test('verify checks actual access and an expired session removes previously verified details', async () => {
  let expired = false;
  const h = harness(req => {
    if (req.path === '/gusto/configuration') return configuration();
    if (req.path === '/status') return status([connected()]);
    if (req.path === '/gusto/verify') return expired ? { status: 401, body: { error: 'private internal error' } } : { connection: connected({ gusto: { ...connected().gusto, companyName: 'Checked Company' } }), dataSynced: false, payrollProof: false };
    throw new Error('Unexpected request: ' + req.path);
  });
  await h.mount(); await h.click('refresh');
  assert.deepEqual(h.calls.find(x => x.path === '/gusto/verify').body, { connectionId: 'connection-a' });
  assert.match(h.text(), /Checked Company/);
  expired = true; await h.click('refresh');
  assert.doesNotMatch(h.text(), /Company access verified|Checked Company|private internal error/);
});

test('provider authorization failures keep reconnect available and remove stale company verification', async () => {
  for (const [httpStatus, code] of [[401, 'GUSTO_REAUTHORIZATION_REQUIRED'], [401, 'GUSTO_UNAUTHORIZED'], [403, 'GUSTO_FORBIDDEN']]) {
    const h = harness(req => {
      if (req.path === '/gusto/configuration') return configuration();
      if (req.path === '/status') return status([connected()]);
      if (req.path === '/gusto/verify') return { status: httpStatus, body: { code, error: 'private provider text' } };
      if (req.path === '/gusto/authorize') return authorization();
      throw new Error('Unexpected request: ' + req.path);
    });
    await h.mount(); await h.click('refresh');
    assert.match(h.text(), /Reconnect Gusto/);
    assert.doesNotMatch(h.text(), /Company access verified|Example Works|administrator account|private provider text|GUSTO_/);
    await h.click('connect');
    assert.equal(h.redirects.length, 1, code + ' must allow reconnect');
    assert.deepEqual(h.calls.find(x => x.path === '/gusto/authorize').body, { connectionId: 'connection-a', expectedCompanyUuid: COMPANY });
  }
});

test('a saved company connection can be verified when previous provider metadata has been cleared', async () => {
  const h = harness(req => {
    if (req.path === '/gusto/configuration') return configuration();
    if (req.path === '/status') return status([connected({ gusto: null, state: 'REAUTH_REQUIRED' })]);
    if (req.path === '/gusto/verify') return { connection: connected(), dataSynced: false, payrollProof: false };
    throw new Error('Unexpected request: ' + req.path);
  });
  await h.mount();
  assert.doesNotMatch(h.text(), /Company access verified/);
  await h.click('refresh');
  assert.equal(h.calls.filter(x => x.path === '/gusto/verify').length, 1);
  assert.match(h.text(), /Company access verified|Example Works/);
  assert.equal(h.calls.filter(x => x.path === '/gusto/authorize').length, 0);
});

test('access verification does not deny a completed workforce import', async () => {
  const h = harness(req => req.path === '/gusto/configuration' ? configuration() : status([connected({ canonicalImport: { status: 'PASS', recordCount: 4 } })]));
  await h.mount();
  assert.match(h.text(), /Company access verified/);
  assert.match(h.text(), /This check verifies company access/);
  assert.doesNotMatch(h.text(), /Workforce data has not been imported/);
});

test('repeated connect clicks while authorization is pending do not create extra requests', async () => {
  const pending = deferred();
  const h = harness(req => req.path === '/gusto/configuration' ? configuration() : req.path === '/status' ? status([connected()]) : pending.promise);
  await h.mount(); await h.click('connect'); await h.click('connect');
  assert.equal(h.calls.filter(x => x.path === '/gusto/authorize').length, 1);
  pending.resolve(authorization()); await flush();
  assert.equal(h.redirects.length, 1);
});
