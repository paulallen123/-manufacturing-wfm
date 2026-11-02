'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { statusForActor } = require(path.join(process.env.VECTOR_NANGO_RUNTIME_ROOT || __dirname, 'provider-metadata-review.cjs'));
const actor = { tenant: 'tenant-a', role: 'manager', permissions: ['company.configure'] };
const row = (tenant = 'tenant-a', id = 'profile-a', provider = 'netsuite') => ({
  tenant, id, provider, system: provider === 'netsuite' ? 'NetSuite' : 'SAP SuccessFactors',
  activationAuthority: false, credentialSource: 'short-lived-provider-callback', allowedOriginSha256: 'a'.repeat(64),
  credentialRef: 'DO_NOT_EXPOSE', tags: { secret: 'DO_NOT_EXPOSE' }, arbitrary: 'DO_NOT_EXPOSE'
});

test('projects only the current actor tenant and an explicit presentation allowlist', () => {
  const source = { configured: true, profiles: [row(), row('tenant-b', 'hidden-profile')],
    apiKey: 'DO_NOT_EXPOSE', credentialMode: 'short-lived-provider-callback', arbitrary: 'DO_NOT_EXPOSE' };
  const before = JSON.stringify(source), result = statusForActor(source, actor);
  assert.deepEqual(result, { schemaVersion: 'vector-provider-metadata-review-v1', configured: true,
    profiles: [{ id: 'profile-a', provider: 'netsuite', system: 'NetSuite' }], reviewOnly: true, liveSyncVerified: false });
  assert.equal(JSON.stringify(source), before);
  assert.doesNotMatch(JSON.stringify(result), /tenant-a|tenant-b|hidden-profile|DO_NOT_EXPOSE|credential|Origin|tags|arbitrary/);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.profiles) && Object.isFrozen(result.profiles[0]));
});

test('configured depends only on owned profiles and supports both existing broker provider keys', () => {
  assert.equal(statusForActor({ configured: true, profiles: [row('another-tenant')] }, actor).configured, false);
  const result = statusForActor({ configured: false, profiles: [row(), row('tenant-a', 'sf-profile', 'successfactors')] }, actor);
  assert.equal(result.configured, true); assert.equal(result.profiles.length, 2);
});

test('a role name, worker identity or caller-chosen tenant cannot substitute for configure permission', () => {
  for (const denied of [null, {}, { tenant: 'tenant-a', role: 'admin' }, { tenant: 'tenant-a', role: 'worker', permissions: [] },
    { tenant: 'tenant-a', permissions: 'company.configure' }, { tenant: '', permissions: ['company.configure'] }]) {
    assert.throws(() => statusForActor({ profiles: [row()] }, denied), error => error.status === 403 && error.code === 'WFM_METADATA_REVIEW_FORBIDDEN');
  }
});

test('rejects malformed owned status without reflecting source content or presenting empty success', () => {
  const invalid = [null, {}, { profiles: {} }, { profiles: [row(), row()] },
    { profiles: [{ ...row(), id: '../outside' }] }, { profiles: [{ ...row(), provider: 'constructor' }] },
    { profiles: [{ ...row(), provider: 'sap-s4hana' }] }, { profiles: [{ ...row(), system: 'PRIVATE\nDETAIL' }] },
    { profiles: [{ ...row(), activationAuthority: true }] },
    { profiles: Array.from({ length: 101 }, (_, i) => row('tenant-a', 'profile-' + i)) }];
  for (const value of invalid) assert.throws(() => statusForActor(value, actor), error =>
    error.status === 503 && error.code === 'WFM_METADATA_REVIEW_UNAVAILABLE' && !error.message.includes('PRIVATE'));
});

test('other tenants cannot affect the available profile count or expose malformed private details', () => {
  const result = statusForActor({ profiles: [null, { tenant: 'tenant-b', system: 'PRIVATE DETAILS', activationAuthority: true }, row()] }, actor);
  assert.equal(result.profiles.length, 1); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
