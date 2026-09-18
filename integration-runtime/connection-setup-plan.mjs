import { activationReadiness, isOpaqueReference, validateConnectionProfile } from './connection-contract.mjs';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

export function validateProviderManifest(manifest) {
  const errors = [];
  if (!isObject(manifest)) return { ok: false, errors: ['provider manifest must be an object'] };
  if (manifest.schemaVersion !== 1) errors.push('provider manifest schemaVersion must be 1');
  if (typeof manifest.providerKey !== 'string' || !manifest.providerKey.trim()) errors.push('providerKey is required');
  if (typeof manifest.displayName !== 'string' || !manifest.displayName.trim()) errors.push('displayName is required');
  if (!Array.isArray(manifest.connectionOptions) || manifest.connectionOptions.length === 0) {
    errors.push('at least one provider connection option is required');
  } else {
    for (const [index, option] of manifest.connectionOptions.entries()) {
      if (!isObject(option) || typeof option.transport !== 'string' || !option.transport) errors.push(`connectionOptions[${index}].transport is required`);
      if (!Array.isArray(option.authMethods) || option.authMethods.length === 0) errors.push(`connectionOptions[${index}].authMethods is required`);
      if (!Array.isArray(option.directions) || option.directions.length === 0) errors.push(`connectionOptions[${index}].directions is required`);
    }
  }
  if (!Array.isArray(manifest.requiredConfigRefs)) errors.push('requiredConfigRefs must be an array');
  if (cleanStrings(manifest.requiredConfigRefs).some((name) => !/^[a-z][A-Za-z0-9]*Ref$/.test(name))) {
    errors.push('requiredConfigRefs entries must use *Ref names');
  }
  return { ok: errors.length === 0, errors };
}

export function providerCompatibility(profile, manifest) {
  const manifestValidation = validateProviderManifest(manifest);
  const reasons = [...manifestValidation.errors];
  if (profile?.provider?.key !== manifest?.providerKey) reasons.push('profile provider does not match provider manifest');
  const direction = profile?.direction || 'inbound';
  const compatible = (manifest?.connectionOptions || []).some((option) =>
    option.transport === profile?.transport?.kind &&
    option.authMethods?.includes(profile?.authentication?.method) &&
    option.directions?.includes(direction)
  );
  if (!compatible) reasons.push('transport/authentication/direction combination is not supported by this provider manifest');
  return { compatible: reasons.length === 0, reasons };
}

export function missingProviderConfigRefs(profile, manifest) {
  const refs = profile?.provider?.configRefs || {};
  return cleanStrings(manifest?.requiredConfigRefs).filter((name) => !isOpaqueReference(refs[name]));
}

function step(id, title, owner, status, detail, blockers = []) {
  return { id, title, owner, status, detail, blockers };
}

export function planConnectionSetup(profile, manifest) {
  const profileValidation = validateConnectionProfile(profile);
  const compatibility = providerCompatibility(profile, manifest);
  const missingRefs = missingProviderConfigRefs(profile, manifest);
  const readiness = activationReadiness(profile);

  const steps = [];
  steps.push(step(
    'connection', 'Connection details', 'customer',
    profileValidation.ok && compatibility.compatible && missingRefs.length === 0 ? 'complete' : 'blocked',
    'Choose the approved transport and authentication method; store endpoints and credentials only as protected references.',
    [...profileValidation.errors, ...compatibility.reasons, ...missingRefs.map((name) => `missing provider configuration reference: ${name}`)]
  ));
  steps.push(step(
    'safe_test', 'Test connection', 'wfm',
    profile?.connectionTest?.status === 'passed' && profile?.connectionTest?.mode === 'bounded_non_mutating' ? 'complete' : 'ready',
    'Run a bounded, non-mutating check that proves provider identity, authentication and a small schema/sample path without applying workforce changes.'
  ));
  steps.push(step(
    'mapping', 'Review mapping', 'customer',
    profile?.mapping?.status === 'reviewed' ? 'complete' : 'ready',
    'Review provider-to-WFM field mapping separately from transport and authentication.'
  ));
  const recoveryRequired = (profile?.recovery?.maxAttempts || 1) > 1;
  steps.push(step(
    'resilience', 'Prove recovery and reconciliation', 'wfm',
    (!recoveryRequired || profile?.recoveryProof?.status === 'passed') && profile?.reconciliation?.status === 'passed' ? 'complete' : 'ready',
    'Exercise recovery when retries are enabled, then reconcile staged counts before activation.'
  ));
  steps.push(step(
    'authority', 'Confirm data authority', 'customer',
    profile?.authority?.entityOwners && Object.keys(profile.authority.entityOwners).length > 0 ? 'complete' : 'blocked',
    'Confirm which system owns each entity so there is one deterministic source of truth.'
  ));
  steps.push(step(
    'activation', 'Approve activation', 'customer',
    readiness.ready ? 'complete' : 'blocked',
    'Activation is explicit and bound to the exact reviewed connection, mapping, recovery, reconciliation and monitoring state.',
    readiness.reasons
  ));

  const blocked = steps.filter((item) => item.status === 'blocked');
  const next = steps.find((item) => item.status !== 'complete');
  return {
    providerKey: manifest?.providerKey || null,
    connectionId: profile?.connectionId || null,
    status: readiness.ready ? 'activation_ready' : blocked.length ? 'blocked' : 'in_progress',
    nextStep: next?.id || null,
    customerActionRequired: Boolean(next && next.owner === 'customer'),
    steps
  };
}

export function evaluateGenuineProviderProof(profile, manifest, evidence = {}) {
  const blockers = [];
  const compatibility = providerCompatibility(profile, manifest);
  blockers.push(...compatibility.reasons);
  blockers.push(...missingProviderConfigRefs(profile, manifest).map((name) => `missing provider configuration reference: ${name}`));
  if (evidence.authorised !== true) blockers.push('authorised provider proof is not recorded');
  if (evidence.nonProductionTargetVerified !== true) blockers.push('non-production provider target is not verified');
  if (evidence.providerCallObserved !== true) blockers.push('no genuine provider call has been observed');
  if (evidence.providerIdentityVerified !== true) blockers.push('provider identity has not been verified');
  if (evidence.authenticationObserved !== true) blockers.push('provider authentication has not been observed');
  if (evidence.boundedSampleObserved !== true) blockers.push('bounded provider sample has not been observed');
  if (evidence.mutationObserved !== false) blockers.push('proof must show no provider or workforce mutation');
  if (evidence.rawSensitiveDataPersisted !== false) blockers.push('proof must show raw sensitive provider data was not persisted');
  if (!isOpaqueReference(evidence.schemaEvidenceRef)) blockers.push('reviewable schema evidence reference is missing');
  if (evidence.reconciliationPassed !== true) blockers.push('reconciliation proof is missing');
  return {
    achieved: blockers.length === 0,
    blockers,
    claim: blockers.length === 0 ? 'genuine_authorised_non_mutating_provider_proof' : 'not_proven'
  };
}
