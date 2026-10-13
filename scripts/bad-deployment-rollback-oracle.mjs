// Read-only issue #265 check. The canonical owner supplies independently held receipts.
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;

export function assessBadDeploymentRollback(proof) {
  const failures = [];
  const check = (ok, code) => { if (!ok) failures.push(code); };
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const id = x => typeof x === 'string' && x.trim() === x && x.length > 0;
  const seq = x => Number.isSafeInteger(x) && x > 0;
  const c = proof?.context;
  check(object(c) && SHA.test(c.goodSha || '') && SHA.test(c.badSha || '') &&
    c.goodSha !== c.badSha && id(c.environmentId) && id(c.serviceId) &&
    id(c.volumeId) && id(c.syntheticTenant) && id(c.sequenceDomain) &&
    c.environmentClass === 'DISPOSABLE_PROOF', 'INVALID_CONTEXT');
  const names = ['before', 'bad', 'decision', 'providerRollback', 'after', 'readback'];
  for (const name of names) {
    const r = proof?.[name];
    check(object(r), `MISSING_${name.toUpperCase()}`);
    if (!object(r) || !object(c)) continue;
    check(r.environmentId === c.environmentId && r.serviceId === c.serviceId &&
      r.volumeId === c.volumeId && r.syntheticTenant === c.syntheticTenant &&
      r.sequenceDomain === c.sequenceDomain, `SCOPE_${name.toUpperCase()}`);
    check(id(r.captureId), `CAPTURE_${name.toUpperCase()}`);
    check(seq(r.sequence), `SEQUENCE_${name.toUpperCase()}`);
  }
  if (failures.length) return { status: 'FAIL', failures };
  const { before, bad, decision, providerRollback, after, readback } = proof;
  check(new Set(names.map(name => proof[name].captureId)).size === names.length,
    'REUSED_CAPTURE');
  check(before.sequence < bad.sequence && bad.sequence < decision.sequence &&
    decision.sequence < providerRollback.sequence &&
    providerRollback.sequence < after.sequence && after.sequence < readback.sequence,
  'EVENT_ORDER');
  check(id(before.deploymentId) && before.deploymentId !== bad.deploymentId &&
    before.deploymentCommitSha === c.goodSha && before.observedSourceSha === c.goodSha &&
    before.platformStatus === 'SUCCESS' && before.healthStatus === 200 &&
    before.semanticHealth === 'PASS' && DIGEST.test(before.stateDigest || '') &&
    seq(before.stateEpoch), 'LAST_GOOD_NOT_PROVEN');
  check(id(bad.deploymentId) && bad.deploymentCommitSha === c.badSha &&
    bad.observedSourceSha === c.badSha && bad.becameServing === true &&
    bad.semanticHealth === 'FAIL' && bad.businessMutation === false,
  'BAD_BUILD_NOT_OBSERVED');
  check(decision.rejectedDeploymentId === bad.deploymentId &&
    decision.restoreDeploymentId === before.deploymentId &&
    decision.reason === 'SEMANTIC_HEALTH_REGRESSION' &&
    id(decision.approvalRef), 'ROLLBACK_NOT_AUTHORISED');
  check(providerRollback.fromDeploymentId === bad.deploymentId &&
    providerRollback.toDeploymentId === before.deploymentId &&
    providerRollback.status === 'SUCCESS' &&
    providerRollback.restoredCommitSha === c.goodSha,
  'PROVIDER_ROLLBACK_NOT_BOUND');
  check(after.deploymentId === before.deploymentId &&
    after.deploymentCommitSha === c.goodSha && after.observedSourceSha === c.goodSha &&
    after.healthStatus === 200 && after.semanticHealth === 'PASS' &&
    after.freshSessionProtectedRead === 200,
  'RESTORED_SERVICE_NOT_PROVEN');
  check(readback.deploymentId === before.deploymentId &&
    readback.stateDigest === before.stateDigest &&
    readback.stateEpoch === before.stateEpoch &&
    readback.freshSession === true && readback.auditRollbackRef === decision.approvalRef &&
    readback.businessMutation === false,
  'DURABLE_READBACK_NOT_PROVEN');
  return { status: failures.length ? 'FAIL' : 'PASS', failures };
}

