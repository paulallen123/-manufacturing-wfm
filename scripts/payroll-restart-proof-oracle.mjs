// Read-only comparison of two independently captured, synthetic or approved
// hosted payroll observations. This never performs a restart or grants release.
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

function validObservation(value) {
  return value && sha(value.candidateSha) && nonempty(value.deploymentId)
    && nonempty(value.bootId) && nonempty(value.tenantId)
    && nonempty(value.period) && nonempty(value.batchId)
    && Number.isInteger(value.rowCount) && value.rowCount > 0
    && digest(value.checksum) && value.status === 'released'
    && value.auditBatchId === value.batchId
    && value.freshLoginBatchId === value.batchId
    && value.exportChecksum === value.checksum;
}

export function assessPayrollRestartProof({ before, after, restart } = {}) {
  const blockers = [];
  if (!validObservation(before) || !validObservation(after)) blockers.push('incomplete-payroll-observation');
  if (!restart || restart.executed !== true || !nonempty(restart.receiptId)
      || !nonempty(restart.observedAt) || restart.volumeMounted !== true) {
    blockers.push('restart-and-durable-volume-unproven');
  }
  if (validObservation(before) && validObservation(after)) {
    if (before.candidateSha !== after.candidateSha) blockers.push('candidate-drift');
    if (before.bootId === after.bootId) blockers.push('process-restart-unproven');
    if (before.tenantId !== after.tenantId || before.period !== after.period) blockers.push('scope-drift');
    if (before.batchId !== after.batchId || before.rowCount !== after.rowCount
        || before.checksum !== after.checksum) blockers.push('payroll-state-drift');
  }
  return { verified: blockers.length === 0, blockers };
}
