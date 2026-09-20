import crypto from 'node:crypto';

const HARD_NO_DOWNGRADE = new Set([401, 403, 407, 429]);
const CAPABILITY_ABSENT = new Set([404, 405, 410, 501]);

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function requireField(value, name) {
  if (!clean(value)) throw new Error(`Missing required ${name}`);
}

function canonicalCompatibility(primary, fallback) {
  if (clean(primary.canonicalContract) && primary.canonicalContract === fallback.canonicalContract) {
    return {compatible: true, mappingReviewRequired: false};
  }
  if (clean(fallback.compatibilityMapper)) {
    return {compatible: true, mappingReviewRequired: true};
  }
  return {compatible: false, mappingReviewRequired: true};
}

function assertReadRoute(route) {
  requireField(route.version, 'route.version');
  requireField(route.path, 'route.path');
  const method = clean(route.method || 'GET').toUpperCase();
  if (route.operationClass !== 'read') {
    throw new Error(`Route ${route.version}:${route.path} is not declared read-only`);
  }
  if (!['GET', 'HEAD'].includes(method) && route.readViaPostProven !== true) {
    throw new Error(`Route ${route.version}:${route.path} uses ${method} without proven read semantics`);
  }
  return {...route, method};
}

export function resolveReadRoutePlan({provider, resource, routes, requiredCapabilities = []}) {
  requireField(provider, 'provider');
  requireField(resource, 'resource');
  if (!Array.isArray(routes) || routes.length === 0) throw new Error('At least one route is required');

  const normalized = routes
    .filter(route => route && route.available !== false)
    .map(assertReadRoute)
    .filter(route => requiredCapabilities.every(cap => (route.capabilities || []).includes(cap)))
    .sort((a, b) => (a.preference ?? 999) - (b.preference ?? 999));

  if (normalized.length === 0) throw new Error(`No safe read route satisfies ${provider}:${resource}`);

  const primary = normalized[0];
  const fallbacks = normalized.slice(1).filter(route => {
    if (route.providerFallbackDeclared !== true) return false;
    return canonicalCompatibility(primary, route).compatible;
  });

  return {
    provider,
    resource,
    primary,
    fallbacks,
    downgradeOnAuthFailure: false,
    downgradeOnRateLimit: false,
    checkpointNamespaceIncludesVersion: true,
    versionSwitchRequiresReconciliation: true
  };
}

export function versionFallbackDecision({status, phase = 'request', providerFallbackDeclared = false}) {
  const code = Number(status);
  if (!providerFallbackDeclared) return {allow: false, action: 'stop', reason: 'provider-fallback-not-declared'};
  if (HARD_NO_DOWNGRADE.has(code)) {
    return {allow: false, action: code === 429 ? 'retry-current-version' : 'credential-or-permission-diagnostic', reason: `status-${code}-must-not-downgrade`};
  }
  if (code >= 500 && code <= 599) return {allow: false, action: 'retry-current-version', reason: 'transient-server-error-must-not-downgrade'};
  if (phase === 'capability-probe' && CAPABILITY_ABSENT.has(code)) {
    return {allow: true, action: 'try-declared-fallback', reason: `capability-absent-${code}`};
  }
  return {allow: false, action: 'stop', reason: 'fallback-not-safe-for-this-failure'};
}

export function versionTransitionPlan({fromRoute, toRoute}) {
  const from = assertReadRoute(fromRoute);
  const to = assertReadRoute(toRoute);
  const sameVersion = from.version === to.version;
  const samePagination = clean(from.paginationStyle) === clean(to.paginationStyle);
  const compatibility = canonicalCompatibility(from, to);

  return {
    checkpointCompatible: sameVersion && samePagination,
    requiresOverlapReplay: !sameVersion || !samePagination,
    mappingReviewRequired: compatibility.mappingReviewRequired,
    canonicalCompatibility: compatibility.compatible,
    reason: sameVersion && samePagination ? 'same-version-and-pagination-contract' : 'version-or-pagination-contract-changed'
  };
}

export function checkpointNamespace({tenantId, provider, resource, apiVersion, paginationStyle, schemaFingerprint = ''}) {
  for (const [value, name] of [[tenantId, 'tenantId'], [provider, 'provider'], [resource, 'resource'], [apiVersion, 'apiVersion'], [paginationStyle, 'paginationStyle']]) {
    requireField(value, name);
  }
  const material = JSON.stringify({tenantId, provider, resource, apiVersion, paginationStyle, schemaFingerprint});
  return `vr_${crypto.createHash('sha256').update(material).digest('hex').slice(0, 32)}`;
}
