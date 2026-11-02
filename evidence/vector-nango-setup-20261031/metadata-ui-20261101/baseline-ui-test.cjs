'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = process.env.VECTOR_METADATA_UI_SOURCE || path.join(__dirname, 'vector-shell.js');
const STATUS = '/api/integrations';
const PREVIEW = '/api/integrations/discovery/broker-preview';
const clone = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const profile = { id: 'profile-ns-a', provider: 'netsuite', system: 'NetSuite' };
const status = (profiles = [profile]) => ({ providerMetadataBroker: {
  schemaVersion: 'vector-provider-metadata-review-v1', configured: profiles.length > 0,
  profiles, reviewOnly: true, liveSyncVerified: false
} });
function preview(p = profile) {
  return { authority: 'server-broker-read-review-only', networkFetchPerformed: true, activationAvailable: false,
    draft: { status: 'draft_review_required', provider: p.provider, system: p.system,
      metadataSource: 'server-broker:' + p.id, schemaDigest: 'a'.repeat(64),
      fields: [{ name: 'id', type: 'integer', key: true }, { name: 'companyName', type: 'string', key: false }],
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
    body: { classList, dataset: {} }, documentElement: {},
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
      return { ok: code >= 200 && code < 300, status: code, json: async () => clone(answer?.body ?? answer ?? {}) };
    }
  };
  window.window = window;
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), sandbox, { filename: sourcePath });
  const card = () => content.children.find(x => x.dataset.vectorMetadataCard != null);
  const fire = (name, target) => { const event = { target, preventDefault() {} }; for (const fn of listeners.get(name) || []) fn(event); };
  return { calls, identity, F, ui, window, card,
    async mount() { window.VectorWorkforceOperations.apply(); await flush(); },
    async click(id = profile.id) {
      assert.ok(card(), 'Provider metadata review card must be mounted');
      assert.match(card().innerHTML, /Check fields/, 'An actual labelled Check fields action is required');
      const button = new Element('button'); button.dataset.vectorMetadataCheck = id; button.parentElement = card(); fire('click', button); await flush();
    },
    async refresh() { assert.ok(card()); const button = new Element('button'); button.dataset.vectorMetadataRefresh = ''; button.parentElement = card(); fire('click', button); await flush(); },
    hide() { for (const fn of listeners.get('pagehide') || []) fn(); },
    async render() { await window.render(); await flush(); },
    text() { return card()?.innerHTML || ''; },
    previews() { return calls.filter(x => x.path === PREVIEW); }
  };
}

test('configured source has an explicit Check fields action that sends only the approved profileId', async () => {
  const h = harness(request => request.path === STATUS ? status() : preview());
  await h.mount(); assert.equal(h.previews().length, 0, 'Page entry must not fetch provider metadata');
  await h.click();
  assert.equal(h.previews().length, 1); assert.deepEqual(h.previews()[0].body, { profileId: profile.id });
  assert.equal(h.previews()[0].method, 'POST');
  assert.equal(h.previews()[0].options.credentials, 'same-origin'); assert.equal(h.previews()[0].options.cache, 'no-store');
  assert.match(h.text(), /Fields available/); assert.match(h.text(), /companyName/);
  assert.doesNotMatch(h.text(), /Connected|Live sync active|WFM_|api\.nango\.dev/);
});
