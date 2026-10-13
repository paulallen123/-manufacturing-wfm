import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateIntegrationReconnectProof } from '../scripts/integration-reconnect-proof-oracle.mjs';

const checksum = 'b'.repeat(64);
const nextChecksum = 'c'.repeat(64);
function connection(state, batchId, hash, failureClass = null) {
  return { id: 'connection-1', sourceInstanceId: 'source-1', mappingVersion: 2, state, failureClass,
    grantedScopes: ['people.read'], lastReconciliation: { status: 'PASS' },
    canonicalImport: { batchId, checksum: hash, status: 'PASS' } };
}
function fixture() {
  const base = { candidateSha: 'a'.repeat(64), deploymentId: 'deploy-1', tenant: 'synthetic-tenant' };
  const capture = (minute, conn, count, extra = {}) => ({ ...base, capturedAt: `2026-10-13T10:0${minute}:00Z`, connection: conn,
    batchWitness: { tenant: base.tenant, connectionId: conn.id, mappingVersion: conn.mappingVersion, count, latestBatchId: conn.canonicalImport.batchId, latestChecksum: conn.canonicalImport.checksum }, ...extra });
  const probe = (minute, status) => ({ tenant: base.tenant, connectionId: 'connection-1', sourceInstanceId: 'source-1', status, capturedAt: `2026-10-13T10:0${minute}:30Z` });
  const newSync = { status: 200, canonicalImport: { batchId: 'batch-8', checksum: nextChecksum, replayed: false } };
  return {
    before: capture(0, connection('ACTIVE', 'batch-7', checksum), 2),
    outage: capture(1, connection('DEGRADED', 'batch-7', checksum, 'SOURCE'), 2, { sourceProbe: probe(0, 'UNAVAILABLE') }),
    reconnect: capture(2, connection('ACTIVE', 'batch-7', checksum), 2, { sourceProbe: probe(1, 'AVAILABLE') }),
    after: capture(3, connection('ACTIVE', 'batch-8', nextChecksum), 3, { syncResponse: newSync }),
    replay: capture(4, connection('ACTIVE', 'batch-8', nextChecksum), 3, { syncResponse: { ...newSync, canonicalImport: { ...newSync.canonicalImport, replayed: true } } })
  };
}

test('accepts an exact source outage, reconnect, import and replay capture', () => {
  assert.deepEqual(evaluateIntegrationReconnectProof(fixture()), { status: 'PASS', failures: [] });
});
for (const [name, mutate] of [
  ['build drift', p => { p.after.candidateSha = 'd'.repeat(64); }],
  ['deployment drift', p => { p.replay.deploymentId = 'deploy-2'; }],
  ['tenant drift', p => { p.outage.tenant = 'other'; }],
  ['source drift', p => { p.reconnect.connection.sourceInstanceId = 'source-2'; }],
  ['mapping drift', p => { p.after.connection.mappingVersion = 3; }],
  ['ambiguous capture order', p => { p.after.capturedAt = p.reconnect.capturedAt; }],
  ['unobserved source outage', p => { p.outage.sourceProbe.status = 'HEALTHY'; }],
  ['wrong source outage probe', p => { p.outage.sourceProbe.sourceInstanceId = 'other'; }],
  ['missing recovered source probe', p => { delete p.reconnect.sourceProbe; }],
  ['stale recovered source probe', p => { p.reconnect.sourceProbe.capturedAt = p.outage.sourceProbe.capturedAt; }],
  ['recovery probe before observed outage', p => { p.reconnect.sourceProbe.capturedAt = '2026-10-13T10:00:45Z'; }],
  ['outage import', p => { p.outage.batchWitness.count = 3; }],
  ['unscoped batch witness', p => { p.after.batchWitness.tenant = 'other'; }],
  ['reauthorization missing', p => { p.reconnect.connection.grantedScopes = []; }],
  ['unchanged checksum', p => { p.after.connection.canonicalImport.checksum = checksum; p.after.syncResponse.canonicalImport.checksum = checksum; }],
  ['missing new import', p => { p.after.batchWitness.count = 2; }],
  ['duplicate import on replay', p => { p.replay.batchWitness.count = 4; }],
  ['missing replay flag', p => { p.replay.syncResponse.canonicalImport.replayed = false; }],
  ['hub and witness mismatch', p => { p.replay.batchWitness.latestBatchId = 'other'; }],
  ['response and hub mismatch', p => { p.after.syncResponse.canonicalImport.batchId = 'other'; }]
]) {
  test(`blocks ${name}`, () => { const proof = fixture(); mutate(proof); assert.equal(evaluateIntegrationReconnectProof(proof).status, 'BLOCKED'); });
}
