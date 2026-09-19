export function assessRailwayContainment(input = {}) {
  const credentialBearing = Boolean(input.credentialBearing);
  const sourceProtected = Boolean(input.sourceProtected);
  const sourceVerified = Boolean(input.sourceVerified);
  const sourceChecksRequired = Boolean(input.sourceChecksRequired);
  const watchHeld = Boolean(input.watchHeld);
  const immutableArtifact = Boolean(input.immutableArtifact);
  const redeployAuthorityIndependent = Boolean(input.redeployAuthorityIndependent);
  const preDeployCandidateBound = Boolean(input.preDeployCandidateBound);
  const manualRedeployRuntimeProbeBlocked = Boolean(input.manualRedeployRuntimeProbeBlocked);

  const sourceTrusted = sourceProtected && sourceVerified && sourceChecksRequired;
  const automaticSourceTriggerContained = !credentialBearing || sourceTrusted || watchHeld;

  // A manual redeploy may reuse a previously captured source snapshot and execute its build,
  // even when new source-triggered builds are held. Treat that build path as safe only when
  // it is bound to an immutable artifact and independently controlled redeploy authority.
  const manualRedeployBuildSafe = !credentialBearing || (immutableArtifact && redeployAuthorityIndependent);

  // A deterministic pre-deploy candidate check can still stop a stale/manual snapshot before
  // the application runtime starts, but only after that exact behaviour has been observed.
  const manualRedeployRuntimeContained = !credentialBearing ||
    (immutableArtifact && redeployAuthorityIndependent) ||
    (preDeployCandidateBound && manualRedeployRuntimeProbeBlocked);

  const boundedRuntimeContainment = automaticSourceTriggerContained && manualRedeployRuntimeContained;
  const fullContainment = boundedRuntimeContainment && manualRedeployBuildSafe;
  const promotionAllowed = !credentialBearing || (sourceTrusted && immutableArtifact && redeployAuthorityIndependent);

  const residualRisks = [];
  if (credentialBearing && !sourceProtected) residualRisks.push('unprotected_source');
  if (credentialBearing && !sourceVerified) residualRisks.push('unsigned_or_unverified_source');
  if (credentialBearing && !sourceChecksRequired) residualRisks.push('checks_not_required');
  if (credentialBearing && watchHeld && !manualRedeployBuildSafe) residualRisks.push('manual_redeploy_can_reuse_snapshot_build');
  if (credentialBearing && preDeployCandidateBound && !manualRedeployRuntimeProbeBlocked) residualRisks.push('manual_redeploy_runtime_guard_unproven');
  if (credentialBearing && manualRedeployRuntimeProbeBlocked && !manualRedeployBuildSafe) residualRisks.push('manual_build_executes_before_runtime_block');
  if (credentialBearing && !immutableArtifact) residualRisks.push('artifact_not_immutably_bound');
  if (credentialBearing && !redeployAuthorityIndependent) residualRisks.push('redeploy_authority_not_independent');

  return {
    sourceTrusted,
    automaticSourceTriggerContained,
    manualRedeployBuildSafe,
    manualRedeployRuntimeContained,
    boundedRuntimeContainment,
    fullContainment,
    promotionAllowed,
    residualRisks
  };
}
