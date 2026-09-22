'use strict';

const ROUTE_ORDER = Object.freeze([
  'NATIVE_API',
  'MIDDLEWARE',
  'EVENT',
  'DATABASE',
  'SFTP',
  'FILE',
  'DOCUMENT',
  'NATIVE_CAPTURE'
]);

function clean(value, max = 180) {
  return String(value ?? '').trim().slice(0, max);
}

function routeForConnection(connection = {}) {
  const auth = clean(connection.authMethod, 40).toLowerCase();
  if (auth === 'sftp') return 'SFTP';
  if (['oauth2', 'api-key', 'service-account'].includes(auth)) return 'NATIVE_API';
  return null;
}

function connectionEvidence(connection = {}) {
  const route = routeForConnection(connection);
  const reconciliationPass = connection?.lastReconciliation?.status === 'PASS';
  const active = connection.state === 'ACTIVE' && reconciliationPass;
  return {
    id: clean(connection.id, 120),
    source: clean(connection.name || connection.productKey, 160),
    route,
    state: clean(connection.state, 40) || 'UNKNOWN',
    executorAvailable: Boolean(route),
    authorised: !['AUTHORIZATION_REQUIRED', 'REAUTH_REQUIRED'].includes(connection.state),
    provenanceBound: Boolean(connection.id && connection.sourceInstanceId),
    reconcilable: reconciliationPass,
    authoritativeCoverage: active,
    proven: active && Boolean(route),
    evidenceRef: active && route
      ? 'integration:' + clean(connection.id, 120) + ':mapping:' + Number(connection.mappingVersion || 0) + ':reconciliation:PASS'
      : null,
    observedAt: clean(connection.lastSyncAt || connection.lastHealthAt || connection?.lastReconciliation?.createdAt, 80) || null
  };
}

function normaliseCapability(capability = {}) {
  const route = clean(capability.route, 40).toUpperCase();
  if (!ROUTE_ORDER.includes(route)) return null;
  return {
    route,
    source: clean(capability.source || 'declared-capability', 160),
    executorAvailable: capability.executorAvailable === true,
    authorised: capability.authorised === true,
    provenanceBound: capability.provenanceBound === true,
    reconcilable: capability.reconcilable === true,
    authoritativeCoverage: capability.authoritativeCoverage === true,
    proven: capability.proven === true,
    evidenceRef: clean(capability.evidenceRef, 500) || null,
    observedAt: clean(capability.observedAt, 80) || null
  };
}

function proofEligible(candidate) {
  return Boolean(candidate &&
    candidate.executorAvailable === true &&
    candidate.authorised === true &&
    candidate.provenanceBound === true &&
    candidate.reconcilable === true &&
    candidate.authoritativeCoverage === true &&
    candidate.proven === true &&
    candidate.evidenceRef);
}

function proofReady(candidate) {
  return Boolean(candidate &&
    candidate.executorAvailable === true &&
    candidate.authorised === true &&
    candidate.provenanceBound === true);
}

function buildIntegrationPath({ integrationStatus = null, fallbackCapabilities = [] } = {}) {
  const candidates = [];
  for (const connection of integrationStatus?.connections || []) {
    const evidence = connectionEvidence(connection);
    if (evidence.route) candidates.push(evidence);
  }
  for (const capability of fallbackCapabilities) {
    const normalized = normaliseCapability(capability);
    if (normalized) candidates.push(normalized);
  }

  const byRoute = new Map();
  for (const route of ROUTE_ORDER) {
    byRoute.set(route, candidates.filter(candidate => candidate.route === route));
  }

  let selected = null;
  for (const route of ROUTE_ORDER) {
    selected = byRoute.get(route).find(proofEligible) || null;
    if (selected) break;
  }

  const availableForProof = ROUTE_ORDER.filter(route => byRoute.get(route).some(proofReady));
  const declaredWithoutExecutor = ROUTE_ORDER.filter(route =>
    byRoute.get(route).some(candidate => candidate.executorAvailable !== true)
  );
  const needsProof = ROUTE_ORDER.filter(route =>
    byRoute.get(route).some(candidate => candidate.executorAvailable === true && !proofEligible(candidate))
  );

  const state = selected
    ? 'PROVEN_ROUTE'
    : availableForProof.length
      ? 'PROOF_REQUIRED'
      : candidates.length
        ? 'EXECUTOR_UNAVAILABLE'
        : 'DISCOVERY_REQUIRED';

  return Object.freeze({
    state,
    ready: Boolean(selected),
    selected: selected ? {
      route: selected.route,
      source: selected.source,
      evidenceRef: selected.evidenceRef,
      observedAt: selected.observedAt
    } : null,
    routeOrder: [...ROUTE_ORDER],
    availableForProof,
    needsProof,
    declaredWithoutExecutor,
    candidateCount: candidates.length,
    rule: 'A fallback route never counts as connected until its real executor, authority, provenance, reconciliation and authoritative coverage are all proven.'
  });
}

module.exports = {
  ROUTE_ORDER,
  routeForConnection,
  connectionEvidence,
  normaliseCapability,
  proofEligible,
  buildIntegrationPath
};
