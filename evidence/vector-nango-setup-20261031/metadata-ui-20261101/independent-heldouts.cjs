'use strict';

// Reviewer-authored authority/lifecycle cases. The author's fake DOM is reused
// only as an execution fixture; none of the author's registered tests run here.
// This is a synthetic client check, not native-browser or live-session proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');

const root = path.resolve(process.argv[2] || process.cwd());
const sourcePath = path.join(root, 'ux-overlay/vector-shell.js');
const fixturePath = path.join(root, 'ux-overlay/vector-provider-metadata.test.cjs');
const source = fs.readFileSync(sourcePath, 'utf8');
const fixture = fs.readFileSync(fixturePath, 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
const req = createRequire(fixturePath);
const fsShim = {
  ...fs,
  readFileSync(file, ...args) {
    return path.resolve(String(file)) === sourcePath ? source : fs.readFileSync(file, ...args);
  }
};
const box = {
  require: name => name === 'node:test' ? () => {} : name === 'node:fs' ? fsShim : req(name),
  __dirname: path.dirname(fixturePath), process, Buffer, console,
  AbortController, URL, Intl, Date, setImmediate, setTimeout, clearTimeout, queueMicrotask
};
vm.runInNewContext(fixture + '\nglobalThis.reviewerFixture = { harness, preview, status, profile, flush };', box, { filename: fixturePath });
const { harness, preview, status, profile, flush } = box.reviewerFixture;
const STATUS = '/api/integrations';
const second = { id: 'sf-heldout-b', provider: 'successfactors', system: 'SAP SuccessFactors' };
const { statusForActor } = require(path.join(root, 'integration/runtime/provider-metadata-review.cjs'));

console.log(JSON.stringify({
  verification: 'independent-review-heldouts',
  node: process.version,
  shellSha256: sha(source),
  fixtureSha256: sha(fixture),
  fixtureBoundary: 'author fake-DOM fixture only; author tests suppressed; no native browser, real authentication, or provider I/O'
}));

function resultFor(p, name) {
  const value = preview(p);
  value.draft.fields = [{ name, readable: true, writable: false }];
  return value;
}

test('tenant projection does not inspect secret fields and an unconfigured tenant cannot distinguish foreign profiles', () => {
  const actor = { tenant: 'tenant-a', permissions: ['company.configure'] };
  const own = { tenant: 'tenant-a', id: 'profile-owned', provider: 'netsuite', system: 'NetSuite', activationAuthority: false };
  const foreign = { tenant: 'tenant-b' };
  for (const key of ['id', 'system', 'provider', 'credentialEnv', 'allowedOrigin']) {
    Object.defineProperty(foreign, key, { get() { throw Error('Foreign configuration must not be read: ' + key); } });
  }
  for (const key of ['credentialEnv', 'accountId', 'query', 'accessToken']) {
    Object.defineProperty(own, key, { get() { throw Error('Unused private configuration must not be read: ' + key); } });
  }
  const projected = statusForActor({ profiles: [foreign, own], configured: true }, actor);
  assert.deepEqual(projected.profiles, [{ id: 'profile-owned', provider: 'netsuite', system: 'NetSuite' }]);
  const empty = statusForActor({ profiles: [], configured: false }, actor);
  const onlyForeign = statusForActor({ profiles: [foreign], configured: true, credentialMode: 'private' }, actor);
  assert.deepEqual(onlyForeign, empty);
  own.id = 'source-mutated-after-projection';
  assert.equal(projected.profiles[0].id, 'profile-owned');
});

test('current 401 and 403 clear every cached profile result and require explicit authorized status before another preview', async () => {
  for (const code of [401, 403]) {
    let denied = false;
    const h = harness(request => {
      if (request.path === STATUS) return status([profile, second]);
      if (denied) return { status: code, body: { error: 'PRIVATE DENIAL DETAIL' } };
      const p = request.body.profileId === profile.id ? profile : second;
      return resultFor(p, p === profile ? 'PRIVATE_A_FIELD' : 'PRIVATE_B_FIELD');
    });
    await h.mount();
    await h.click(profile.id);
    assert.equal(h.previews().length, 1);
    assert.match(h.text(), /PRIVATE_A_FIELD/);
    denied = true;
    await h.click(second.id);
    assert.equal(h.previews().length, 2);
    assert.doesNotMatch(h.text(), /PRIVATE_A_FIELD|PRIVATE_B_FIELD|PRIVATE DENIAL DETAIL|data-vector-metadata-check|Fields available/);
    await flush();
    assert.equal(h.previews().length, 2, 'Denial must not auto-repeat provider collection');
    denied = false;
    await h.refresh();
    assert.equal(h.previews().length, 2, 'Restoring status must not collect metadata');
    await h.click(profile.id);
    assert.equal(h.previews().length, 3);
    assert.match(h.text(), /PRIVATE_A_FIELD/);
  }
});

test('transport rejection after tenant or readiness change removes the stale card and aborts its request', async () => {
  for (const change of [h => { h.F.actor = { ...h.identity, tenant: 'tenant-b' }; }, h => { h.F.ready = false; }]) {
    let reject;
    const pending = new Promise((_resolve, rejecter) => { reject = rejecter; });
    const h = harness(request => request.path === STATUS ? status() : pending);
    await h.mount();
    await h.click();
    assert.equal(h.previews().length, 1);
    change(h);
    reject(Error('Synthetic transport failure'));
    await flush();
    assert.equal(h.card(), undefined);
    assert.equal(h.previews()[0].options.signal.aborted, true);
  }
});

test('JSON consumption rejection after current actor changes also removes and aborts the stale panel', async () => {
  let h;
  const badBody = { toJSON() {
    h.F.actor = { ...h.identity, tenant: 'tenant-b' };
    throw Error('Synthetic JSON consumption failure');
  } };
  h = harness(request => request.path === STATUS ? status() : { status: 200, body: badBody });
  await h.mount();
  await h.click();
  assert.equal(h.previews().length, 1);
  assert.equal(h.card(), undefined);
  assert.equal(h.previews()[0].options.signal.aborted, true);
});

test('an obsolete authorization failure cannot clear or downgrade the newly mounted tenant panel', async () => {
  let finishOld, newContext = false;
  const pending = new Promise(resolve => { finishOld = resolve; });
  const newProfile = { id: 'profile-tenant-b', provider: 'successfactors', system: 'SAP SuccessFactors' };
  const h = harness(request => {
    if (request.path === STATUS) return status(newContext ? [newProfile] : [profile]);
    if (!newContext) return pending;
    return resultFor(newProfile, 'TENANT_B_CURRENT_FIELD');
  });
  await h.mount();
  await h.click();
  assert.equal(h.previews().length, 1);
  newContext = true;
  h.F.actor = { ...h.identity, tenant: 'tenant-b', email: 'other@example.test' };
  await h.render();
  assert.ok(h.card());
  await h.click(newProfile.id);
  assert.match(h.text(), /TENANT_B_CURRENT_FIELD/);
  finishOld({ status: 403, body: { error: 'OLD PRIVATE DENIAL' } });
  await flush();
  assert.ok(h.card());
  assert.match(h.text(), /TENANT_B_CURRENT_FIELD/);
  assert.doesNotMatch(h.text(), /OLD PRIVATE DENIAL|not available for your account/);
  assert.equal(h.previews()[0].options.signal.aborted, true);
});
