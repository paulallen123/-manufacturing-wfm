import assert from 'node:assert/strict';
import test from 'node:test';
import { assessRestoreFreshness } from '../scripts/restore-freshness-proof-oracle.mjs';

const witness = () => ({ witnessId: 'external-witness-1', tenantId: 'synthetic-tenant',
  storeId: 'synthetic-store', epochId: 'epoch-1', sequence: 10,
  stateDigest: 'b'.repeat(64), candidateSha: 'a'.repeat(40) });
const receipt = () => ({ executed: true, id: 'synthetic-restore-1',
  sourceBackupId: 'synthetic-backup-1', targetStoreId: 'synthetic-store', witnessId: 'external-witness-1' });

test('exact external watermark and restored readback compare cleanly', () => {
  assert.deepEqual(assessRestoreFreshness({ witness: witness(), restored: witness(), restoreReceipt: receipt() }),
    { verified: true, blockers: [] });
});

for (const [name, change, blocker] of [
  ['older sequence', v => { v.restored.sequence = 9; }, 'stale-restore'],
  ['unwitnessed later sequence', v => { v.restored.sequence = 11; }, 'unwitnessed-restored-state'],
  ['same sequence different state', v => { v.restored.stateDigest = 'c'.repeat(64); }, 'same-sequence-state-mismatch'],
  ['different epoch', v => { v.restored.epochId = 'epoch-2'; }, 'epoch-drift'],
  ['different tenant', v => { v.restored.tenantId = 'other'; }, 'scope-drift'],
  ['different candidate', v => { v.restored.candidateSha = 'c'.repeat(40); }, 'candidate-drift'],
  ['unbound receipt', v => { v.restoreReceipt.witnessId = 'other'; }, 'restore-receipt-unbound'],
  ['invalid digest', v => { v.restored.stateDigest = 'invalid'; }, 'missing-or-invalid-watermark']
]) {
  test(`rejects ${name}`, () => {
    const v = { witness: witness(), restored: witness(), restoreReceipt: receipt() };
    change(v);
    const result = assessRestoreFreshness(v);
    assert.equal(result.verified, false);
    assert.ok(result.blockers.includes(blocker));
  });
}
