'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProofCarryingState,
  inspectProofCarryingState,
  assertProofCarryingState
} = require('./proof-carrying-state.cjs');

const releaseSha = '1234567890abcdef1234567890abcdef12345678';

function proof() {
  return createProofCarryingState({
    tenant: 'tenant-a',
    actorRef: 'manager-1',
    actorAuthority: 'manager',
    decisionRef: 'decision-1',
    sourceRevision: 'source-r1',
    releaseSha,
    scope: { site: 'S1', workflow: 'weekly-sign-off', team: 'T1' },
    evidenceRefs: ['weekly-review:T1:r1', 'payroll-period:2026-09-07'],
    createdAt: '2026-09-27T19:00:00Z'
  });
}

test('proof is bound to authority, evidence, scope, source revision and exact release', () => {
  const p = proof();
  assert.equal(p.actorAuthority, 'MANAGER');
  assert.equal(p.sourceRevision, 'source-r1');
  assert.equal(p.releaseSha, releaseSha);
  assert.equal(p.scope.team, 'T1');
  assert.match(p.scopeDigest, /^[0-9a-f]{64}$/);
  assert.match(p.proofDigest, /^[0-9a-f]{64}$/);
  assert.equal(inspectProofCarryingState(p, {
    tenant: 'tenant-a',
    sourceRevision: 'source-r1',
    releaseSha,
    scope: { site: 'S1', workflow: 'weekly-sign-off', team: 'T1' }
  }).current, true);
});

test('source revision, release or scope drift makes prior authority stale', () => {
  const p = proof();
  assert.deepEqual(
    inspectProofCarryingState(p, { tenant: 'tenant-a', sourceRevision: 'source-r2', releaseSha, scope: p.scope }).reasons,
    ['SOURCE_REVISION_CHANGED']
  );
  assert.ok(
    inspectProofCarryingState(p, { tenant: 'tenant-a', sourceRevision: 'source-r1', releaseSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd', scope: p.scope }).reasons.includes('RELEASE_SHA_CHANGED')
  );
  assert.ok(
    inspectProofCarryingState(p, { tenant: 'tenant-a', sourceRevision: 'source-r1', releaseSha, scope: { ...p.scope, team: 'T2' } }).reasons.includes('DECISION_SCOPE_CHANGED')
  );
});

test('tampered proof fails closed', () => {
  const p = proof();
  const tampered = { ...p, actorAuthority: 'DIRECTOR' };
  assert.throws(
    () => assertProofCarryingState(tampered, { tenant: 'tenant-a', sourceRevision: 'source-r1', releaseSha, scope: p.scope }),
    /PROOF_DIGEST_MISMATCH|stale or invalid/i
  );
});

test('missing current authority context cannot make an old proof current', () => {
  const p = proof();
  for (const current of [{}, {tenant:'tenant-a'}, {tenant:'tenant-a',sourceRevision:'source-r1',releaseSha}]) {
    assert.equal(inspectProofCarryingState(p,current).current,false);
    assert.throws(() => assertProofCarryingState(p,current), /stale or invalid/);
  }
});

test('a supplied current actor or decision mismatch invalidates proof', () => {
  const p=proof();
  const current={tenant:'tenant-a',sourceRevision:'source-r1',releaseSha,scope:p.scope};
  assert.equal(inspectProofCarryingState(p,{...current,actorRef:'manager-2'}).current,false);
  assert.equal(inspectProofCarryingState(p,{...current,actorAuthority:'ADMIN'}).current,false);
  assert.equal(inspectProofCarryingState(p,{...current,decisionRef:'decision-2'}).current,false);
});
