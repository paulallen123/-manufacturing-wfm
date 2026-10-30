'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createJurisdictionPolicyGraph} = require('./jurisdiction-policy-graph.cjs');
const {createGlobalSitePolicyPreflight} = require('./global-site-policy-preflight.cjs');

const at = {legalAt: '2026-06-01T00:00:00Z', knownAt: '2026-06-01T00:00:00Z'};
function node(id, scope, value = 44) {
  return {
    id, layer: 'SITE', scope, verified: true,
    effectiveFrom: '2026-01-01T00:00:00Z', recordedAt: '2025-12-01T00:00:00Z',
    sourceRefs: ['synthetic:tenant-policy'],
    rules: [{id: id + '-weekly-max', domain: 'working-time', key: 'weekly-hours',
      legalCharacter: 'MANDATORY_CEILING', operator: 'MAX', value, unit: 'hours'}]
  };
}
function resolve(graph, context) {return graph.resolve({...at, context});}
function preflight(graph, tenant) {
  return createGlobalSitePolicyPreflight({graph}).assess({
    ...at, tenant, site: {id: 'shared-site', country: 'GB', legalEntityId: 'shared-entity'},
    workers: [{id: 'worker-1', employmentCategory: 'employee'}]
  });
}

test('same site and legal entity IDs do not cross an explicit tenant scope', () => {
  const graph = createJurisdictionPolicyGraph([
    node('tenant-a', {tenant: 'tenant-a', country: 'GB', siteId: 'shared-site'}, 36),
    node('tenant-b', {tenant: 'tenant-b', country: 'GB', siteId: 'shared-site'}, 44)
  ]);
  for (const [tenant, value] of [['tenant-a', 36], ['tenant-b', 44]]) {
    const result = resolve(graph, {tenant, country: 'GB', siteId: 'shared-site'});
    assert.deepEqual(result.applicableNodes.map(x => x.id), [tenant]);
    assert.equal(result.constraints[0].value, value);
    assert.equal(result.executionAuthority, false);
  }
});

test('missing or malformed tenant context cannot match an explicitly scoped node', () => {
  const graph = createJurisdictionPolicyGraph([
    node('tenant-a', {tenant: 'tenant-a', country: 'GB', siteId: 'shared-site'})
  ]);
  for (const tenant of [undefined, null, '', ' ', ['tenant-a'], {toString: 'tenant-a'}, 1]) {
    const result = resolve(graph, {tenant, country: 'GB', siteId: 'shared-site'});
    assert.equal(result.verifiedCoverage, false);
    assert.deepEqual(result.constraints, []);
  }
});

test('an explicit list of tenant scopes admits only exact named tenants', () => {
  const graph = createJurisdictionPolicyGraph([
    node('shared-approved', {tenant: ['tenant-a', 'tenant-b'], country: 'GB'})
  ]);
  for (const tenant of ['tenant-a', 'tenant-b']) {
    assert.equal(resolve(graph, {tenant, country: 'GB'}).verifiedCoverage, true);
  }
  for (const tenant of ['tenant-c', 'tenant-a-suffix', 'TENANT-A', ['tenant-a', 'tenant-c']]) {
    assert.equal(resolve(graph, {tenant, country: 'GB'}).verifiedCoverage, false);
  }
});

test('explicitly malformed tenant scopes are rejected instead of becoming global', () => {
  for (const tenant of [null, '', ' ', [], ['tenant-a', ''], ['tenant-a', 1], {}, 1]) {
    assert.throws(() => createJurisdictionPolicyGraph([
      node('invalid', {tenant, country: 'GB'})
    ]), /tenant/i);
  }
});

test('an explicit tenant scope cannot disappear during JSON cloning', () => {
  for (const scope of [
    {tenant: undefined, country: 'GB'},
    Object.assign([], {tenant: 'tenant-a'}),
    {tenant: 'tenant-a', toJSON() {return {country: 'GB'};}},
    {tenant: 'tenant-a', toJSON() {return {tenant: null, country: 'GB'};}},
    {tenant: 'tenant-a', toJSON() {return {tenant: [], country: 'GB'};}}
  ]) {
    assert.throws(() => createJurisdictionPolicyGraph([node('invalid', scope)]), /tenant/i);
  }
});

test('unscoped public rules remain available with or without a tenant', () => {
  const graph = createJurisdictionPolicyGraph([
    node('public-country', {country: 'GB'}, 48),
    node('tenant-a', {tenant: 'tenant-a', country: 'GB'}, 36)
  ]);
  for (const context of [{country: 'GB'}, {country: 'GB', tenant: 'tenant-b'}]) {
    const result = resolve(graph, context);
    assert.deepEqual(result.applicableNodes.map(x => x.id), ['public-country']);
    assert.equal(result.constraints[0].value, 48);
  }
});

test('preflight forwards its tenant so only that tenant gains scoped coverage', () => {
  const graph = createJurisdictionPolicyGraph([
    node('tenant-a', {tenant: 'tenant-a', country: 'GB', siteId: 'shared-site'})
  ]);
  const own = preflight(graph, 'tenant-a');
  const other = preflight(graph, 'tenant-b');
  assert.equal(own.status, 'READY_ADVISORY');
  assert.equal(own.coverage.covered, 1);
  assert.equal(other.status, 'BLOCKED_POLICY_COVERAGE');
  assert.deepEqual(other.coverage.missing, ['worker-1']);
  assert.equal(own.automation.executionAuthority, false);
  assert.equal(other.automation.customerMutation, false);
});

test('preflight context digest binds exact tenant while leaving caller input unchanged', () => {
  const graph = createJurisdictionPolicyGraph([
    node('public-country', {country: 'GB'}, 48)
  ]);
  const before = JSON.stringify(graph.all());
  const a = preflight(graph, 'tenant-a');
  const b = preflight(graph, 'tenant-b');
  assert.notEqual(a.workers[0].contextDigest, b.workers[0].contextDigest);
  assert.equal(JSON.stringify(graph.all()), before);
});

test('preflight rejects tenant inputs that would coerce or truncate into another binding', () => {
  const graph = createJurisdictionPolicyGraph([
    node('tenant-a', {tenant: 'tenant-a', country: 'GB', siteId: 'shared-site'})
  ]);
  for (const tenant of [['tenant-a'], {id: 'tenant-a'}, 1, 'a'.repeat(121), 'tenant-a\u0000']) {
    assert.throws(() => preflight(graph, tenant), /tenant/i);
  }
});
