'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { loadLibrary } = require('../test-support/sealed-nango-broker.cjs');
const sourcePath = process.env.VECTOR_METADATA_UI_SOURCE || 'composed-public/vector-ui.js';
const source = (() => {
  if (process.env.VECTOR_METADATA_UI_SOURCE) return fs.readFileSync(sourcePath, 'utf8');
  const root = path.resolve(__dirname, '..');
  const composer = fs.readFileSync(path.join(root, 'scripts/compose-vector-local-runtime.mjs'), 'utf8');
  const assembly = composer.match(/^const js = [^\r\n]+;/gm);
  assert.equal(assembly?.length, 1, 'Use the actual unique composer bundle expression');
  return vm.runInNewContext(assembly[0] + '\njs;', { read: file => fs.readFileSync(path.join(root, file), 'utf8') });
})();
const STATUS = '/api/integrations';
const PREVIEW = '/api/integrations/discovery/broker-preview';
const clone = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const profile = { id: 'profile-ns-a', provider: 'netsuite', system: 'NetSuite' };
const status = (profiles = [profile]) => ({ providerMetadataBroker: {
  schemaVersion: 'vector-provider-metadata-review-v1', configured: profiles.length > 0,
  profiles, reviewOnly: true, liveSyncVerified: false
} });
function preview(p = profile) {
  return { authority: 'server-broker-read-review-only', networkFetchPerformed: true, activationAvailable: false,
    draft: { status: 'draft_review_required', provider: p.provider, system: p.system,
      metadataSource: 'server-broker:' + p.id, schemaDigest: 'a'.repeat(64),
      fields: [{ name: 'id', type: 'integer', key: true, readable: true, writable: false }, { name: 'companyName', type: 'string', key: false, readable: true, writable: false }],
      activation: { allowed: false, requiresHumanReview: true } },
    brokerEvidence: { provider: p.provider, retrievedAt: new Date().toISOString(), metadataValidated: true,
      networkFetchPerformed: true, dnsPinned: true, redirectsAllowed: false, sourceArtifactSha256: 'a'.repeat(64),
      credentialExposed: false, rawMetadataReturned: false, collectionPermit: { verified: true } } };
}

function harness(respond, initial = {}) {
  const calls = [], listeners = new Map();
  const identity = { id: 'admin-a', email: 'admin@example.test', tenant: 'tenant-a', role: 'admin', permissions: ['company.configure'] };
  Object.assign(identity, initial);
  const F = { ready: true, actor: identity };
  const classList = { add() {}, remove() {}, toggle() {} };
  class Element {
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.dataset = {}; this.style = {}; this.classList = classList; this.children = []; this.attributes = {}; this.html = ''; }
    set innerHTML(value) { this.html = String(value); }
    get innerHTML() { return this.html; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    prepend(node) { node.parentElement = this; this.children.unshift(node); }
    append(node) { node.parentElement = this; this.children.push(node); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); this.parentElement = null; }
    contains(node) { return node === this || this.children.some(x => x.contains(node)); }
    get isConnected() { return content.contains(this); }
    querySelector(selector) {
      if (selector.includes('data-vector-metadata-card')) return this.children.find(x => x.dataset.vectorMetadataCard != null) || null;
      return null;
    }
    querySelectorAll() { return []; }
    closest(selector) {
      const keys = { '[data-vector-metadata-check]': 'vectorMetadataCheck', '[data-vector-metadata-refresh]': 'vectorMetadataRefresh', '[data-vector-metadata-card]': 'vectorMetadataCard' };
      if (keys[selector] && this.dataset[keys[selector]] != null) return this;
      return this.parentElement?.closest(selector) || null;
    }
    matches() { return false; }
    focus() {}
  }
  let content = new Element('main');
  const app = new Element(), sidebar = new Element(), topbar = new Element(), parent = new Element();
  content.parentElement = parent; parent.querySelector = () => topbar;
  app.querySelector = selector => selector.includes('vector-sidebar') ? sidebar : selector === '.content' ? content : null;
  const nav = ['integrations', 'overview'].map(route => ({ dataset: { page: route }, textContent: route }));
  const addListener = (name, fn) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); };
  const document = {
    body: new Element('body'), documentElement: {}, readyState: 'loading',
    querySelector(selector) { if (selector === '.app') return app; if (selector === '.content') return content; if (selector === '.vector-sidebar') return sidebar; return content.querySelector(selector); },
    querySelectorAll(selector) { return selector.includes('.navbtn[data-page]') ? nav : []; },
    createElement(tag) { return new Element(tag); }, getElementById() { return null; }, addEventListener: addListener
  };
  const location = { href: 'https://vector.example.test/#vector/integrations', origin: 'https://vector.example.test', hash: '#vector/integrations' };
  const ui = { page: 'integrations', root: null };
  const window = { document, location, addEventListener: addListener, scrollTo() {}, render: async () => { content = new Element('main'); content.parentElement = parent; } };
  const sandbox = { window, document, location, ui, F, me: () => identity, isEmployee: () => identity.role === 'employee',
    history: { pushState() {}, replaceState() {} }, sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() { throw Error('Metadata review must not persist browser state'); } },
    MutationObserver: class { observe() {} disconnect() {} }, setTimeout() { return 0; }, clearTimeout() {}, queueMicrotask,
    AbortController, URL, Intl, Date, console,
    fetch: async (url, options = {}) => {
      if (![STATUS, PREVIEW].includes(String(url))) return { ok: true, status: 200, json: async () => ({}) };
      const request = { path: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, options };
      calls.push(request); const answer = await respond(request, calls); const code = answer?.status || 200;
      return { ok: code >= 200 && code < 300, status: code, json: answer?.json || (async () => clone(answer?.body ?? answer ?? {})) };
    }
  };
  window.window = window;
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  const card = () => content.children.find(x => x.dataset.vectorMetadataCard != null);
  const fire = (name, target) => { const event = { target, preventDefault() {} }; for (const fn of listeners.get(name) || []) fn(event); };
  return { calls, identity, F, ui, window, card,
    async mount() { window.VectorWorkforceOperations.apply(); await flush(); },
    async click(id = profile.id) {
      assert.ok(card(), 'Provider metadata review card must be mounted');
      assert.match(card().innerHTML, /Check fields/, 'An actual labelled Check fields action is required');
      const button = new Element('button'); button.dataset.vectorMetadataCheck = id; card().append(button); fire('click', button); await flush();
    },
    async refresh() { assert.ok(card()); const button = new Element('button'); button.dataset.vectorMetadataRefresh = ''; card().append(button); fire('click', button); await flush(); },
    hide() { for (const fn of listeners.get('pagehide') || []) fn(); },
    async render() { await window.render(); await flush(); },
    text() { return card()?.innerHTML || ''; },
    previews() { return calls.filter(x => x.path === PREVIEW); }
  };
}

// Derive the positive response from the exact sealed controller and broker.
// Only provider I/O, credential/permit issuance and the controller's audit sink are fixtures.
function actualController() {
  const lib = loadLibrary(), PMB = require(path.join(lib, 'provider-metadata-broker.cjs'));
  const CD = require(path.join(lib, 'connector-discovery.cjs'));
  const review = require(path.join(process.env.VECTOR_NANGO_RUNTIME_ROOT || path.resolve(__dirname, '../integration/runtime'), 'provider-metadata-review.cjs'));
  const server = fs.readFileSync(path.join(path.dirname(lib), 'server.cjs'), 'utf8');
  const start = "if(url.pathname==='/api/integrations/discovery/broker-preview'&&req.method==='POST'){";
  const end = "if(url.pathname==='/api/integrations/discovery/preview'&&req.method==='POST'){";
  assert.equal(server.split(start).length, 2); assert.equal(server.split(end).length, 2);
  const block = server.slice(server.indexOf(start), server.indexOf(end));
  const actor = { tenant: 'tenant-a', email: 'admin@example.test', personId: 'admin-a', permissions: ['company.configure'] };
  const profiles = PMB.parseProfiles([{ id: profile.id, tenant: actor.tenant, provider: profile.provider, system: profile.system,
    credentialEnv: 'WFM_BROKER_TOKEN_FIXTURE', accountId: '1234567_SB1', query: 'SELECT id, companyName FROM customer ORDER BY id',
    uniqueOrderColumns: ['id'], methods: [{ method: 'rest' }], objectTypes: ['demand'] }]);
  let providerCalls = 0;
  const broker = PMB.createBroker({ profiles, lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
    credentialProvider: async () => ({ accessToken: 'fictional-provider-token-for-field-review', expiresAt: new Date(Date.now() + 3600000).toISOString() }),
    permitProvider: async () => 'fictional-collection-permit', permitVerifier: { verifyAndConsume() {
      return { keyId: 'fixture-key', permitSha256: 'b'.repeat(64), jtiSha256: 'c'.repeat(64), issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
    } }, transport: async request => {
      providerCalls++; assert.equal(request.url.origin, profiles[0].allowedOrigin); assert.equal(request.pinnedAddress.address, '8.8.8.8');
      return { status: 200, elapsedMs: 1, headers: {}, text: JSON.stringify({ properties: { id: { type: 'integer' }, companyName: { type: 'string' } } }) };
    } });
  // The request body is a boundary fixture; the controller source is executed byte-for-byte.
  const invoke = vm.compileFunction('return (async()=>{' + block + '})();', ['a', 'body'], {
    parsingContext: vm.createContext({ req: { method: 'POST' }, res: {}, url: { pathname: PREVIEW },
      E: { assert(value, message, code = 400) { if (!value) throw Object.assign(Error(message), { status: code }); } },
      providerMetadataBroker: broker, CD, connectorDiscoveryReviewKey: 'fictional-review-signing-key-1234567890',
      protection: { observe() {} }, tokenHash: value => createHash('sha256').update(value).digest('hex'),
      db: { prepare: () => ({ run() {} }) }, json: (_res, _status, result) => result }) });
  return { status: { providerMetadataBroker: review.statusForActor(broker.status(), actor) },
    collect: (input = { profileId: profile.id }, who = actor) => invoke(who, async () => input),
    calls: () => providerCalls, actor, controllerSha256: createHash('sha256').update(block).digest('hex') };
}

test('configured source has an explicit Check fields action that sends only the approved profileId', async () => {
  const controller = actualController();
  const h = harness(request => request.path === STATUS ? controller.status : controller.collect(request.body));
  await h.mount(); assert.equal(h.previews().length, 0, 'Page entry must not fetch provider metadata');
  await h.click();
  assert.equal(h.previews().length, 1); assert.deepEqual(h.previews()[0].body, { profileId: profile.id });
  assert.equal(h.previews()[0].method, 'POST');
  assert.equal(h.previews()[0].options.credentials, 'same-origin'); assert.equal(h.previews()[0].options.cache, 'no-store');
  assert.equal(controller.calls(), 1);
  assert.match(h.text(), /Fields available/); assert.match(h.text(), /companyname/);
  assert.doesNotMatch(h.text(), /Connected|Live sync active|WFM_|api\.nango\.dev/);
});

test('exact existing preview controller rejects extra inputs, another tenant and a worker without configure permission', async () => {
  const c = actualController();
  await assert.rejects(c.collect({ profileId: profile.id, tenant: 'tenant-a' }), error => error.status === 400);
  await assert.rejects(c.collect({ profileId: profile.id }, { ...c.actor, tenant: 'another-tenant' }), error => error.status === 404);
  await assert.rejects(c.collect({ profileId: profile.id }, { ...c.actor, role: 'worker', permissions: [] }), error => error.status === 403);
  assert.equal(c.calls(), 0);
});

test('missing setup, available options and successful metadata remain distinct from live sync', async () => {
  const empty = harness(() => status([])); await empty.mount();
  assert.match(empty.text(), /Account setup needed/); assert.doesNotMatch(empty.text(), /Check fields|Fields available|Connected/);
  const ready = harness(request => request.path === STATUS ? status() : preview()); await ready.mount();
  assert.match(ready.text(), /Ready to check/); assert.match(ready.text(), /Account access has not been confirmed/);
  for (let i = 0; i < 4; i++) await ready.mount();
  await ready.refresh(); assert.equal(ready.previews().length, 0);
  await ready.click(); assert.match(ready.text(), /Fields available/); assert.match(ready.text(), /does not import records or verify live data sync/);
  await ready.refresh(); assert.doesNotMatch(ready.text(), /companyName|Fields available/); assert.equal(ready.previews().length, 1);
});

test('only server-listed profiles can be checked; identifiers and configuration are not display copy', async () => {
  const profiles = [profile, { id: 'secret-profile-id-b', provider: 'netsuite', system: 'private-config-name' },
    { id: 'sf-profile', provider: 'successfactors', system: 'SAP SuccessFactors' }];
  const h = harness(request => request.path === STATUS ? status(profiles) : preview(profiles.find(p => p.id === request.body.profileId)));
  await h.mount(); assert.match(h.text(), /NetSuite · Source 1|NetSuite · Source 2/); assert.match(h.text(), /SAP SuccessFactors/);
  assert.doesNotMatch(h.text().replace(/data-vector-metadata-check="[^"]*"/g, ''), /secret-profile-id|private-config-name|tenant-a|credential|WFM_|<input|<select/);
  await h.click('unlisted-profile'); assert.equal(h.previews().length, 0);
  await h.click('sf-profile'); assert.deepEqual(h.previews()[0].body, { profileId: 'sf-profile' }); assert.match(h.text(), /Fields available/);
});

test('field names are escaped and only a bounded projection of metadata is rendered', async () => {
  const value = preview(); value.draft.fields = Array.from({ length: 55 }, (_, i) => ({ name: i === 0 ? '<img src=x onerror=bad()>' : 'field-' + i, readable: true, writable: false }));
  value.draft.raw = 'PRIVATE RAW'; value.reviewSeal = 'PRIVATE SEAL'; value.brokerEvidence.credential = 'PRIVATE TOKEN';
  const h = harness(request => request.path === STATUS ? status() : value); await h.mount(); await h.click();
  assert.match(h.text(), /55 fields/); assert.match(h.text(), /first 50/); assert.match(h.text(), /&lt;img/);
  assert.doesNotMatch(h.text(), /<img|PRIVATE RAW|PRIVATE SEAL|PRIVATE TOKEN|field-54/);
});

test('bad or mismatched metadata clears prior results and cannot claim fields are available', async () => {
  const changes = [v => { v.networkFetchPerformed = false; }, v => { v.draft.provider = 'successfactors'; },
    v => { v.draft.metadataSource = 'server-broker:someone-else'; }, v => { v.draft.activation.allowed = true; },
    v => { v.brokerEvidence.sourceArtifactSha256 = 'd'.repeat(64); }, v => { v.brokerEvidence.collectionPermit.verified = false; },
    v => { v.brokerEvidence.dnsPinned = false; }, v => { v.brokerEvidence.retrievedAt = 'bad-date'; },
    v => { v.draft.fields[0].writable = true; }, v => { v.draft.fields = []; }, v => { v.draft.fields.push(v.draft.fields[0]); }];
  for (const change of changes) {
    let count = 0;
    const h = harness(request => { if (request.path === STATUS) return status(); const value = preview(); if (++count > 1) change(value); return value; });
    await h.mount(); await h.click(); assert.match(h.text(), /Fields available/);
    await h.click(); assert.match(h.text(), /Fields could not be checked/); assert.doesNotMatch(h.text(), /Fields available|companyName/);
    assert.equal(h.previews().length, 2);
  }
});

test('backend failures never display raw errors, retry automatically or retain a successful result', async () => {
  for (const code of [401, 403, 404, 500, 503]) {
    let count = 0;
    const h = harness(request => request.path === STATUS ? status() : ++count === 1 ? preview() : { status: code, body: { error: 'WFM_SECRET=PRIVATE' } });
    await h.mount(); await h.click(); await h.click();
    assert.doesNotMatch(h.text(), /PRIVATE|WFM_|Fields available|companyName/);
    assert.match(h.text(), /Sign in|not available|could not be checked/); await flush(); assert.equal(h.previews().length, 2);
  }
});

test('malformed status and denied status do not masquerade as account setup missing', async () => {
  for (const answer of [{}, { status: 403, body: { error: 'PRIVATE' } }, status([{ ...profile, provider: 'constructor' }]),
    { providerMetadataBroker: { ...status().providerMetadataBroker, reviewOnly: false } }, status([profile, profile])]) {
    const h = harness(() => answer); await h.mount();
    assert.match(h.text(), /not available|could not be checked/); assert.doesNotMatch(h.text(), /Account setup needed|Check fields|PRIVATE/);
    assert.equal(h.previews().length, 0);
  }
});

test('current authenticated readiness and configure permission are required with no legacy identity fallback', async () => {
  for (const change of [h => { h.F.ready = false; }, h => { h.F.actor = null; },
    h => { h.F.actor = { ...h.identity, role: 'worker', permissions: [] }; }, h => { delete h.F.actor.permissions; }]) {
    const h = harness(() => status()); change(h); await h.mount(); assert.equal(h.card(), undefined); assert.equal(h.previews().length, 0);
  }
});

test('stale completion is discarded after tenant, actor, permission, readiness, root or route changes', async () => {
  const changes = [h => { h.F.actor = { ...h.identity, tenant: 'other-tenant' }; }, h => { h.F.actor = { ...h.identity, email: 'other@example.test' }; },
    h => { h.F.actor = { ...h.identity, role: 'worker', permissions: [] }; }, h => { h.F.ready = false; },
    h => { h.ui.root = {}; }, h => { h.ui.page = 'overview'; }];
  for (const change of changes) {
    const pending = deferred(), h = harness(request => request.path === STATUS ? status() : pending.promise);
    await h.mount(); await h.click(); change(h); pending.resolve(preview()); await flush();
    assert.equal(h.card(), undefined); assert.equal(h.previews()[0].options.signal.aborted, true);
  }
});

test('rerender and pagehide abort pending checks and concurrent clicks cannot duplicate collection', async () => {
  const pending = deferred(), h = harness(request => request.path === STATUS ? status() : pending.promise);
  await h.mount(); await h.click(); await h.click(); await h.refresh(); assert.equal(h.previews().length, 1);
  const rendering = h.window.render(); assert.equal(h.previews()[0].options.signal.aborted, true);
  await rendering; await flush(); pending.resolve(preview()); await flush(); assert.doesNotMatch(h.text(), /Fields available|companyName/);
  const second = harness(request => request.path === STATUS ? status() : deferred().promise); await second.mount(); await second.click();
  second.hide(); assert.equal(second.card(), undefined); assert.equal(second.previews()[0].options.signal.aborted, true);
});

test('a current authentication or permission denial clears every result and check action until explicit authorized refresh', async () => {
  const second = { ...profile, id: 'profile-ns-b' };
  for (const code of [401, 403]) {
    const h = harness(request => request.path === STATUS ? status([profile, second]) :
      request.body.profileId === second.id ? { status: code, body: { error: 'PRIVATE ERROR' } } : preview());
    await h.mount(); await h.click(); assert.match(h.text(), /companyName/);
    await h.click(second.id);
    assert.doesNotMatch(h.text(), /companyName|Fields available|Check fields|PRIVATE ERROR/);
    assert.match(h.text(), /Sign in|not available/);
    await h.mount(); assert.doesNotMatch(h.text(), /Check fields/); assert.equal(h.previews().length, 2);
    await h.refresh(); assert.match(h.text(), /Check fields/); assert.doesNotMatch(h.text(), /companyName/);
    assert.equal(h.previews().length, 2, 'Authorized status refresh must not retry collection');
  }
});

test('stale transport and JSON rejections remove and abort the old context for status and preview requests', async () => {
  for (const phase of ['status', 'preview']) for (const failure of ['transport', 'json']) {
    const pending = deferred();
    const h = harness(request => {
      if (request.path === STATUS && request.options.headers?.Accept !== 'application/json') return status(); // Existing Staffology status read.
      if (phase === 'preview' && request.path === STATUS) return status();
      return failure === 'transport' ? pending.promise : { json: () => pending.promise };
    });
    await h.mount(); if (phase === 'preview') await h.click();
    const request = phase === 'preview' ? h.previews()[0] : h.calls.find(x => x.options.headers?.Accept === 'application/json');
    h.F.actor = { ...h.identity, tenant: 'other-tenant' }; pending.reject(Error('PRIVATE TRANSPORT DETAIL')); await flush();
    assert.equal(h.card(), undefined, phase + '/' + failure);
    assert.equal(request.options.signal.aborted, true, phase + '/' + failure);
  }
});
