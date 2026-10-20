// Read-only control-plane preflight. A matching patch is evidence for review,
// never authority to accept it or deploy a release.
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 160;

export function assessStagedSource(snapshot, options) {
  const blocked = reason => Object.freeze({ status: 'BLOCKED', reason, releaseAuthorized: false });
  if (!options || !id(options.serviceId) || !id(options.environmentId) ||
      !sha(options.servingCommitSha) || !sha(options.candidateCommitSha)) {
    return blocked('INVALID_EXPECTATION');
  }
  if (!snapshot || snapshot.service?.id !== options.serviceId ||
      snapshot.environment?.id !== options.environmentId) return blocked('SERVICE_SCOPE_MISMATCH');
  if (snapshot.latestDeployment?.status !== 'SUCCESS' || !id(snapshot.latestDeployment.id)) {
    return blocked('NO_SUCCESSFUL_SERVING_DEPLOYMENT');
  }
  if (!Array.isArray(snapshot.stagedChanges)) return blocked('MISSING_CHANGE_LIST');
  if (snapshot.staged === null && snapshot.service.state === 'live' && snapshot.stagedChanges.length === 0) {
    return Object.freeze({ status: 'NO_STAGED_PATCH', releaseAuthorized: false,
      serviceId: options.serviceId, environmentId: options.environmentId,
      servingCommitSha: options.servingCommitSha, deploymentId: snapshot.latestDeployment.id });
  }
  if (snapshot.service.state !== 'live-with-staged-changes' || snapshot.staged?.status !== 'STAGED' ||
      !id(snapshot.staged.patchId) || snapshot.staged.changeCount !== 1 || snapshot.stagedChanges.length !== 1) {
    return blocked('PATCH_STATE_MISMATCH');
  }
  const change = snapshot.stagedChanges[0];
  if (change?.path !== `services.${options.serviceId}.source.commitSha` ||
      change.type !== 'updated' || change.destructive !== false) return blocked('UNRELATED_OR_DESTRUCTIVE_CHANGE');
  if (change.from !== options.servingCommitSha) return blocked('SERVING_SOURCE_DRIFT');
  if (change.to !== options.candidateCommitSha) return blocked('STAGED_TARGET_MISMATCH');
  return Object.freeze({ status: 'EXACT_PATCH', releaseAuthorized: false,
    serviceId: options.serviceId, environmentId: options.environmentId,
    deploymentId: snapshot.latestDeployment.id, patchId: snapshot.staged.patchId,
    servingCommitSha: options.servingCommitSha, candidateCommitSha: options.candidateCommitSha });
}
