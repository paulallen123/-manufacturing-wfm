import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEngineeringMemory } from './engineering-memory.mjs';

const evidence = (ref) => ({ sourceType: 'synthetic', sourceRef: `fixture://${ref}`,
  observedAt: '2026-10-13T10:00:00.000Z' });
const record = (id, tenant, site, partId) => ({ id, tenant, site, partId,
  revision: '1', searchTokens: ['shaft'], material: 'steel', process: 'turned', evidence: evidence(id) });
const records = [
  record('a-query', 'tenant-a', 'site-1', 'part-a'),
  record('a-allowed', 'tenant-a', 'site-1', 'part-b'),
  record('a-private', 'tenant-a', 'site-1', 'part-c'),
  record('a-other-site', 'tenant-a', 'site-2', 'part-d'),
  record('b-other-tenant', 'tenant-b', 'site-1', 'part-e')
];
const memory = buildEngineeringMemory({ records });
const scope = { tenant: 'tenant-a', site: 'site-1', allowedRecordIds: new Set(['a-query', 'a-allowed']) };

test('scoped search emits only authorised same-tenant and site evidence', () => {
  const results = memory.scopedSimilarTo('a-query', scope);
  assert.deepEqual(results.map((item) => item.recordId), ['a-allowed']);
  assert.deepEqual(results[0].evidenceRefs, ['fixture://a-query', 'fixture://a-allowed']);
  assert(Object.isFrozen(results));
});

test('denies unapproved query and missing trusted scope', () => {
  assert.throws(() => memory.scopedSimilarTo('a-private', scope), /not accessible/);
  assert.throws(() => memory.scopedSimilarTo('b-other-tenant', scope), /not accessible/);
  assert.throws(() => memory.scopedSimilarTo('a-query', { tenant: 'tenant-a', site: 'site-1' }),
    /trusted tenant, site and allowedRecordIds/);
  assert.throws(() => memory.scopedSimilarTo('a-query', { ...scope, site: 'site-2' }), /not accessible/);
});

test('rejects cross-scope revision lineage and partial source scope', () => {
  assert.throws(() => buildEngineeringMemory({ records: [records[0],
    { ...record('child', 'tenant-b', 'site-1', 'part-a'), previousRevisionId: 'a-query' }] }),
  /revision lineage must stay in the same tenant and site/);
  assert.throws(() => buildEngineeringMemory({ records: [
    { ...records[0], site: undefined }] }), /needs both tenant and site/);
});

test('legacy unscoped search retains prototype behavior without granting scoped search', () => {
  const legacy = buildEngineeringMemory({ records: [
    { ...record('old-a', 'tenant-a', 'site-1', 'part-a'), tenant: undefined, site: undefined },
    { ...record('old-b', 'tenant-a', 'site-1', 'part-b'), tenant: undefined, site: undefined }
  ] });
  assert.equal(legacy.similarTo('old-a')[0].recordId, 'old-b');
  assert.throws(() => legacy.scopedSimilarTo('old-a', scope), /not accessible/);
});

test('published source references remain stable after caller input changes', () => {
  const inputs = [record('one', 'tenant-a', 'site-1', 'part-a'),
    record('two', 'tenant-a', 'site-1', 'part-b')];
  const retained = buildEngineeringMemory({ records: inputs });
  const permissions = { tenant: 'tenant-a', site: 'site-1', allowedRecordIds: new Set(['one', 'two']) };
  const original = retained.scopedSimilarTo('one', permissions)[0].evidenceRefs;
  inputs[1].evidence.sourceRef = 'fixture://repointed';
  assert.deepEqual(retained.scopedSimilarTo('one', permissions)[0].evidenceRefs, original);
});
