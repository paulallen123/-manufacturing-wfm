// Compares a restored state with an independently retained external watermark.
// This read-only oracle neither performs a restore nor grants deployment authority.
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);

function valid(value) {
  return value && nonempty(value.tenantId) && nonempty(value.storeId)
    && nonempty(value.epochId) && Number.isSafeInteger(value.sequence)
    && value.sequence >= 0 && digest(value.stateDigest) && sha(value.candidateSha);
}

export function assessRestoreFreshness({ witness, restored, restoreReceipt } = {}) {
  const blockers = [];
  if (!valid(witness) || !valid(restored)) blockers.push('missing-or-invalid-watermark');
  if (!restoreReceipt || restoreReceipt.executed !== true
      || !nonempty(restoreReceipt.id) || !nonempty(restoreReceipt.sourceBackupId)
      || !nonempty(restoreReceipt.targetStoreId) || !nonempty(restoreReceipt.witnessId)
      || restoreReceipt.witnessId !== witness?.witnessId
      || restoreReceipt.targetStoreId !== restored?.storeId) {
    blockers.push('restore-receipt-unbound');
  }
  if (valid(witness) && valid(restored)) {
    if (witness.candidateSha !== restored.candidateSha) blockers.push('candidate-drift');
    if (witness.tenantId !== restored.tenantId || witness.storeId !== restored.storeId)
      blockers.push('scope-drift');
    if (witness.epochId !== restored.epochId) blockers.push('epoch-drift');
    if (restored.sequence < witness.sequence) blockers.push('stale-restore');
    if (restored.sequence > witness.sequence) blockers.push('unwitnessed-restored-state');
    if (restored.sequence === witness.sequence && restored.stateDigest !== witness.stateDigest)
      blockers.push('same-sequence-state-mismatch');
  }
  return { verified: blockers.length === 0, blockers };
}
