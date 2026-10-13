import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPayrollRestartProof } from '../scripts/payroll-restart-proof-oracle.mjs';

const before = () => ({ candidateSha: 'a'.repeat(40), deploymentId: 'deploy-1', bootId: 'boot-1',
  tenantId: 'synthetic-tenant', period: 'synthetic-period', batchId: 'synthetic-batch', rowCount: 2,
  checksum: 'b'.repeat(64), exportChecksum: 'b'.repeat(64), status: 'released',
  auditBatchId: 'synthetic-batch', freshLoginBatchId: 'synthetic-batch' });
const after = () => ({ ...before(), deploymentId: 'deploy-2', bootId: 'boot-2' });
const restart = () => ({ executed: true, receiptId: 'synthetic-restart', observedAt: '2026-10-13T12:00:00Z', volumeMounted: true });

test('admits same exact candidate and readbacks across witnessed restart', () => {
  assert.deepEqual(assessPayrollRestartProof({ before: before(), after: after(), restart: restart() }),
    { verified: true, blockers: [] });
});

for (const [name, mutate, blocker] of [
  ['missing volume', value => { value.restart.volumeMounted = false; }, 'restart-and-durable-volume-unproven'],
  ['no process change', value => { value.after.bootId = value.before.bootId; }, 'process-restart-unproven'],
  ['candidate changed', value => { value.after.candidateSha = 'c'.repeat(40); }, 'candidate-drift'],
  ['tenant changed', value => { value.after.tenantId = 'other-tenant'; }, 'scope-drift'],
  ['batch changed', value => { value.after.batchId = 'new-batch'; value.after.auditBatchId = 'new-batch'; value.after.freshLoginBatchId = 'new-batch'; }, 'payroll-state-drift'],
  ['CSV changed', value => { value.after.checksum = 'c'.repeat(64); value.after.exportChecksum = 'c'.repeat(64); }, 'payroll-state-drift'],
  ['stale fresh login', value => { value.after.freshLoginBatchId = 'old-batch'; }, 'incomplete-payroll-observation'],
  ['audit missing', value => { value.after.auditBatchId = ''; }, 'incomplete-payroll-observation']
]) {
  test(`rejects ${name}`, () => {
    const value = { before: before(), after: after(), restart: restart() };
    mutate(value);
    assert.equal(assessPayrollRestartProof(value).verified, false);
    assert.ok(assessPayrollRestartProof(value).blockers.includes(blocker));
  });
}
