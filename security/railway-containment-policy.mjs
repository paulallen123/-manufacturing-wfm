export function assessRailwayContainment(input = {}) {
  const credentialBearing = Boolean(input.credentialBearing);
  const sourceProtected = Boolean(input.sourceProtected);
  const sourceVerified = Boolean(input.sourceVerified);
  const sourceChecksRequired = Boolean(input.sourceChecksRequired);
  const watchHeld = Boolean(input.watchHeld);
  const immutableArtifact = Boolean(input.immutableArtifact);
  const redeployAuthorityIndependent = Boolean(input.redeployAuthorityIndependent);

  const sourceTrusted = sourceProtected && sourceVerified && sourceChecksRequired;
  const automaticSourceTriggerContained = !credentialBearing || sourceTrusted || watchHeld;
  const manualRedeployContained = !credentialBearing || (immutableArtifact && redeployAuthorityIndependent);
  const fullContainment = automaticSourceTriggerContained && manualRedeployContained;
  const promotionAllowed = !credentialBearing || (sourceTrusted && immutableArtifact && redeployAuthorityIndependent);

  const residualRisks = [];
  if (credentialBearing && !sourceProtected) residualRisks.push('unprotected_source');
  if (credentialBearing && !sourceVerified) residualRisks.push('unsigned_or_unverified_source');
  if (credentialBearing && !sourceChecksRequired) residualRisks.push('checks_not_required');
  if (credentialBearing && watchHeld && !manualRedeployContained) residualRisks.push('manual_redeploy_bypasses_watch_hold');
  if (credentialBearing && !immutableArtifact) residualRisks.push('artifact_not_immutably_bound');
  if (credentialBearing && !redeployAuthorityIndependent) residualRisks.push('redeploy_authority_not_independent');

  return {
    sourceTrusted,
    automaticSourceTriggerContained,
    manualRedeployContained,
    fullContainment,
    promotionAllowed,
    residualRisks
  };
}
