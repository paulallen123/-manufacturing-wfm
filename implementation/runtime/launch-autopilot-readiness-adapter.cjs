'use strict';

const { createTwinRevision } = require('./implementation-digital-twin.cjs');
const { digest } = require('./launch-autopilot-controller.cjs');
const { buildIntegrationPath } = require('./launch-integration-pathfinder.cjs');

const GATE_REQUIREMENTS = Object.freeze({
  scope: ['configuration-scope'],
  'tenant-environment': ['tenant-environment'],
  'identity-access': ['identity-access'],
  'source-systems': ['source-systems'],
  mapping: ['source-systems', 'payroll-mapping'],
  configuration: [
    'people-data',
    'organisation-model',
    'time-policies',
    'absence-policies',
    'scheduling',
    'approvals',
    'clocking',
    'payroll-mapping'
  ],
  'scenario-validation': ['scenario-validation'],
  'historical-replay': ['historical-replay'],
  'live-data-import': ['test-data-cleanup', 'live-data-import'],
  'role-learning': ['role-learning', 'privileged-competency', 'frontline-readiness'],
  'security-controls': ['security-controls'],
  resilience: ['resilience']
});

function compact(value, max = 180) {
  return String(value ?? '').trim().slice(0, max);
}

function requirementIndex(readiness) {
  return new Map((readiness?.requirements || []).map(item => [item.key, item]));
}

function proofObserved(requirements, fallback) {
  const volatileDerivedSources = new Set(['customer-scope', 'adaptive-learning-engine']);
  const values = requirements
    .filter(item => !volatileDerivedSources.has(String(item?.source || '')))
    .map(item => Date.parse(String(item?.observedAt || '')))
    .filter(Number.isFinite);
  if (values.length) return new Date(Math.min(...values)).toISOString();
  const parsed = Date.parse(String(fallback || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
}

function statusForRequirements(requirements) {
  if (requirements.length && requirements.every(item => item?.satisfied === true)) return 'PASS';
  if (requirements.some(item => String(item?.status || '').toUpperCase() === 'FAIL')) return 'FAIL';
  if (requirements.some(item => ['WARN', 'DEGRADED'].includes(String(item?.status || '').toUpperCase()))) return 'DEGRADED';
  return 'UNKNOWN';
}

function buildImplementationTwin(readiness, integrations = null) {
  const scope = readiness?.customerScope;
  if (!scope || !readiness?.tenant) return null;
  const observedAt = compact(readiness.startedAt, 80) || new Date(0).toISOString();
  const nodes = [{
    id: 'tenant',
    type: 'tenant',
    source: 'implementation-scope',
    observedAt,
    verified: true,
    data: {
      companyName: compact(scope.companyName, 160),
      employeeCount: Number(scope.employeeCount || 0),
      countries: Array.isArray(scope.countries) ? scope.countries : []
    }
  }];

  const edges = [];
  for (const [index, site] of (scope.sites || []).entries()) {
    const id = 'site:' + digest({ index, site }).slice(0, 20);
    nodes.push({
      id,
      type: 'site',
      source: 'implementation-scope',
      observedAt,
      verified: true,
      data: { name: compact(site, 160) }
    });
    edges.push({
      from: 'tenant',
      to: id,
      relation: 'contains',
      source: 'implementation-scope',
      observedAt,
      verified: true
    });
  }

  for (const [index, name] of (scope.sourceSystems || []).entries()) {
    const id = 'system:' + digest({ index, name }).slice(0, 20);
    nodes.push({
      id,
      type: 'system',
      source: 'implementation-scope',
      observedAt,
      verified: false,
      data: { name: compact(name, 160) }
    });
    edges.push({
      from: 'tenant',
      to: id,
      relation: 'uses',
      source: 'implementation-scope',
      observedAt,
      verified: true
    });
  }

  for (const connection of integrations?.connections || []) {
    const id = 'integration:' + compact(connection.id, 120);
    const stamp = compact(connection.lastSyncAt || connection.lastHealthAt || observedAt, 80);
    const reconciliationPass = connection?.lastReconciliation?.status === 'PASS';
    nodes.push({
      id,
      type: 'integration',
      source: 'autonomous-integration-hub',
      observedAt: stamp,
      verified: connection.state === 'ACTIVE' && reconciliationPass,
      state: compact(connection.state, 40) || 'OBSERVED',
      data: {
        productKey: compact(connection.productKey, 120),
        mappingVersion: Number(connection.mappingVersion || 0),
        reconciliationStatus: connection?.lastReconciliation?.status || null,
        risk: connection.state === 'ACTIVE' && reconciliationPass ? 'LOW' : 'HIGH'
      }
    });
    edges.push({
      from: 'tenant',
      to: id,
      relation: 'connected-by',
      source: 'autonomous-integration-hub',
      observedAt: stamp,
      verified: connection.state === 'ACTIVE' && reconciliationPass
    });
  }

  return createTwinRevision({ tenant: readiness.tenant, nodes, edges });
}

function receiptForGate({ gate, readiness, requirements, observedAt, twinRevision = null, detail = {}, evidenceSuffix = '' }) {
  const status = statusForRequirements(requirements);
  const evidenceState = requirements.map(item => ({
    key: item?.key || null,
    status: item?.status || 'MISSING',
    confidence: Number(item?.confidence || 0),
    satisfied: item?.satisfied === true,
    source: item?.source || null,
    detailDigest: digest(item?.detail || {})
  }));
  return {
    gate,
    status,
    source: 'one-day-enterprise-engine',
    evidenceRef: 'implementation:' + readiness.runId + ':' + gate + ':' + digest({ evidenceState, evidenceSuffix }).slice(0, 32),
    observedAt,
    verified: status === 'PASS',
    twinRevision,
    detail: { requirements: evidenceState, ...detail }
  };
}

function syncLaunchAutopilot({ controller, readiness, integrations = null }) {
  if (!controller || typeof controller.recordReceipt !== 'function') throw new Error('Launch Autopilot controller is required.');
  if (!readiness?.tenant || !readiness?.runId) throw new Error('Implementation readiness with tenant and runId is required.');

  const index = requirementIndex(readiness);
  const fallbackObservedAt = readiness.startedAt;
  const twin = buildImplementationTwin(readiness, integrations);
  if (twin && typeof controller.observeTwin === 'function') {
    controller.observeTwin({ tenant: readiness.tenant, runId: readiness.runId, twin });
  }

  for (const [gate, keys] of Object.entries(GATE_REQUIREMENTS)) {
    const requirements = keys.map(key => index.get(key) || { key, status: 'MISSING', confidence: 0, satisfied: false });
    controller.recordReceipt({
      tenant: readiness.tenant,
      runId: readiness.runId,
      receipt: receiptForGate({
        gate,
        readiness,
        requirements,
        observedAt: proofObserved(requirements, fallbackObservedAt),
        twinRevision: twin?.revision || null
      })
    });
  }

  const scopeRequirement = index.get('configuration-scope');
  controller.recordReceipt({
    tenant: readiness.tenant,
    runId: readiness.runId,
    receipt: twin && scopeRequirement?.satisfied === true ? {
      gate: 'implementation-twin',
      status: 'PASS',
      source: 'implementation-digital-twin',
      evidenceRef: 'twin:' + twin.revision,
      observedAt: proofObserved([scopeRequirement], fallbackObservedAt),
      verified: true,
      twinRevision: twin.revision,
      detail: { revision: twin.revision, nodes: twin.nodes.length, edges: twin.edges.length }
    } : {
      gate: 'implementation-twin',
      status: 'UNKNOWN',
      source: 'implementation-digital-twin',
      evidenceRef: 'twin:pending:' + readiness.runId,
      observedAt: proofObserved([scopeRequirement].filter(Boolean), fallbackObservedAt),
      verified: false,
      detail: { reason: 'IMPLEMENTATION_SCOPE_REQUIRED' }
    }
  });

  const allRequirements = readiness.requirements || [];
  const existingReady = readiness.operationalReady === true &&
    allRequirements.length > 0 &&
    allRequirements.every(item => item.satisfied === true) &&
    (readiness.blockingDecisions || []).length === 0;
  controller.recordReceipt({
    tenant: readiness.tenant,
    runId: readiness.runId,
    receipt: {
      gate: 'existing-readiness',
      status: existingReady ? 'PASS' : 'DEGRADED',
      source: 'one-day-enterprise-engine',
      evidenceRef: 'existing-readiness:' + readiness.runId + ':' + digest({
        operationalReady: readiness.operationalReady === true,
        requirements: allRequirements.map(item => [item.key, item.status, item.confidence, item.satisfied]),
        blockingDecisions: (readiness.blockingDecisions || []).map(item => item.key || item.id)
      }).slice(0, 32),
      observedAt: proofObserved(allRequirements, fallbackObservedAt),
      verified: existingReady,
      detail: {
        operationalReady: readiness.operationalReady === true,
        satisfiedRequirements: allRequirements.filter(item => item.satisfied === true).length,
        totalRequirements: allRequirements.length,
        blockingDecisions: (readiness.blockingDecisions || []).length
      }
    }
  });

  const launch = controller.status(readiness.tenant, readiness.runId);
  const integrationPath = buildIntegrationPath({ integrationStatus: integrations });
  return {
    ...launch,
    twinRevision: twin?.revision || null,
    integrationPath,
    compatibility: {
      existingImplementationReady: existingReady,
      noRequirementRemoved: true,
      productionMutation: false
    }
  };
}

module.exports = {
  GATE_REQUIREMENTS,
  statusForRequirements,
  proofObserved,
  buildImplementationTwin,
  syncLaunchAutopilot
};
