'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INCIDENT_CLASSES,
  fingerprintIncident,
  createRegressionCase,
  createResolutionReceipt,
  planRecurrence,
  certifyCompoundResponse
} = require('./extreme-incident-learning.cjs');

function incident(overrides = {}) {
  return {
    incidentClass: 'MULTI_INTEGRATION_OUTAGE',
    subsystem: 'integration-fabric',
    signals: ['payroll connector down', 'erp connector down'],
    errorCodes: ['UPSTREAM_503'],
    invariantFailures: ['outbound backlog not terminal'],
    affectedInterfaces: ['payroll', 'erp'],
    dependencyClasses: ['third-party-api'],
    ...overrides
  };
}

function verified(overrides = {}) {
  return {
    incident: incident(),
    containment: { applied: true, actionType: 'integration.write.fence' },
    repair: {
      executed: true,
      actionType: 'integration.adapter.failover',
      actionAllowlisted: true,
      machineQuorumPassed: true,
      sameAuthorityEnvelope: true,
      noAuthorityExpansion: true
    },
    verification: {
      independentVerifierPassed: true,
      tenantInvariantPassed: true,
      securityInvariantPassed: true,
      reconciliationPassed: true,
      noSilentDataLoss: true,
      recoveryStable: true,
      rollbackOrCompensationProved: true,
      exactReplayPassed: true,
      independentReplayPassed: true
    },
    prevention: {
      regressionAdded: true,
      detectionRuleAdded: true,
      guardOrInvariantAdded: true,
      failureInjectionAdded: true
    },
    timings: { detectionMs: 1000, containmentMs: 1250, recoveryMs: 5000 },
    evidenceRefs: ['evidence://incident/1', 'evidence://verification/1'],
    ...overrides
  };
}

test('all required extreme incident classes are recognised', () => {
  const required = [
    'PAYROLL_CRITICAL',
    'MULTI_INTEGRATION_OUTAGE',
    'PROVIDER_SCHEMA_OR_API_DRIFT',
    'CLOCKING_INTEGRITY',
    'OFFLINE_SITE_RECOVERY',
    'GLOBAL_POLICY_CONFLICT',
    'SECURITY_OR_TENANT_INCIDENT',
    'DATASTORE_OR_SERVICE_FAILURE',
    'BAD_RELEASE',
    'EXTREME_LOAD',
    'CONTRADICTORY_SOURCE_DATA',
    'NOVEL_OR_COMPOUND'
  ];
  assert.deepEqual(INCIDENT_CLASSES, required);
  for (const incidentClass of required) {
    assert.match(fingerprintIncident({
      incidentClass,
      subsystem: 'proof',
      signals: ['stable proof signal']
    }), /^[a-f0-9]{64}$/);
  }
});

test('fingerprints ignore ordering but preserve causal identity', () => {
  const a = fingerprintIncident(incident());
  const b = fingerprintIncident(incident({
    signals: ['erp connector down', 'payroll connector down'],
    affectedInterfaces: ['erp', 'payroll']
  }));
  assert.equal(a, b);

  const c = fingerprintIncident(incident({ errorCodes: ['SCHEMA_DRIFT'] }));
  assert.notEqual(a, c);
});

test('an unverified repair never becomes a reusable autonomous reflex', () => {
  const receipt = createResolutionReceipt(verified({
    verification: {
      ...verified().verification,
      reconciliationPassed: false
    }
  }));
  assert.equal(receipt.terminal, 'CONTAINED');
  assert.equal(receipt.playbookCertified, false);

  const next = planRecurrence({ incident: verified().incident, resolution: receipt });
  assert.equal(next.mode, 'CONTAIN_AND_PROVE');
  assert.equal(next.repairAction, null);
});

test('a fully verified repair becomes a certified fast path without widening authority', () => {
  const receipt = createResolutionReceipt(verified());
  assert.equal(receipt.terminal, 'CERTIFIED_REFLEX');
  assert.equal(receipt.playbookCertified, true);
  assert.equal(receipt.mayExpandAuthority, false);
  assert.equal(receipt.maySelfGrantAuthority, false);
  assert.equal(receipt.humanOperationalTouchBudget, 0);
  assert.equal(receipt.recurrenceTargets.detectionMs, 800);
  assert.equal(receipt.recurrenceTargets.recoveryMs, 4000);

  const next = planRecurrence({ incident: verified().incident, resolution: receipt });
  assert.equal(next.mode, 'CERTIFIED_FAST_PATH');
  assert.equal(next.repairAction, 'integration.adapter.failover');
  assert.equal(next.executeOnlyIfCurrentMachineQuorumPasses, true);
  assert.equal(next.executeOnlyInsideExistingAuthorityEnvelope, true);
  assert.equal(next.independentVerificationStillRequired, true);
});

test('a similar-looking but different failure cannot borrow another incident repair', () => {
  const receipt = createResolutionReceipt(verified());
  const next = planRecurrence({
    incident: incident({ errorCodes: ['AUTH_401'] }),
    resolution: receipt
  });
  assert.equal(next.mode, 'CONTAIN_AND_PROVE');
  assert.equal(next.repairAction, null);
});

test('prevention is part of certification, not a note after the repair', () => {
  const receipt = createResolutionReceipt(verified({
    prevention: {
      ...verified().prevention,
      failureInjectionAdded: false
    }
  }));
  assert.equal(receipt.terminal, 'VERIFIED_RECOVERY');
  assert.equal(receipt.playbookCertified, false);
});

test('permanent replay case is tenant-safe and cannot grant execution authority', () => {
  const regression = createRegressionCase({
    incident: incident(),
    evidenceRefs: ['evidence://sanitised/incident-1'],
    expectedInvariants: [
      'all queued business events reach one terminal state',
      'no duplicate downstream mutation',
      'tenant boundary remains intact'
    ]
  });
  assert.equal(regression.permanentRegression, true);
  assert.equal(regression.exactReplayRequired, true);
  assert.equal(regression.independentReplayRequired, true);
  assert.equal(regression.productionMutation, false);
  assert.equal(regression.mayGrantAuthority, false);
});

test('unsafe evidence is rejected from the learning memory', () => {
  assert.throws(() => createRegressionCase({
    incident: incident(),
    evidenceRefs: ['evidence://unsafe'],
    expectedInvariants: ['safe'],
    rawSecret: true
  }), /sanitised, tenant-safe evidence/);
});

test('response targets are always based on the best verified result seen so far', () => {
  const receipt = createResolutionReceipt(verified({
    timings: { detectionMs: 1400, containmentMs: 1600, recoveryMs: 6200 },
    previousVerifiedResolution: { bestDetectionMs: 900, bestRecoveryMs: 4200 }
  }));
  assert.equal(receipt.bestDetectionMs, 900);
  assert.equal(receipt.bestRecoveryMs, 4200);
  assert.equal(receipt.recurrenceTargets.detectionMs, 720);
  assert.equal(receipt.recurrenceTargets.recoveryMs, 3360);
});

test('compound disasters require combined proof; component success alone is not enough', () => {
  const integration = createResolutionReceipt(verified());
  const datastore = createResolutionReceipt(verified({
    incident: incident({
      incidentClass: 'DATASTORE_OR_SERVICE_FAILURE',
      subsystem: 'primary-datastore',
      signals: ['primary unavailable'],
      errorCodes: ['DB_UNAVAILABLE'],
      invariantFailures: ['authoritative write path unavailable'],
      affectedInterfaces: ['database'],
      dependencyClasses: ['datastore']
    }),
    repair: {
      ...verified().repair,
      actionType: 'datastore.failover'
    },
    evidenceRefs: ['evidence://incident/db', 'evidence://verification/db']
  }));

  const blocked = certifyCompoundResponse({
    componentResolutions: [integration, datastore],
    verification: {
      compoundSimulationPassed: true,
      compoundIndependentReplayPassed: false,
      orderingAndDependencyChecksPassed: true,
      tenantInvariantPassed: true,
      securityInvariantPassed: true,
      noSplitBrain: true,
      noSilentDataLoss: true,
      rollbackOrCompensationProved: true,
      noAuthorityExpansion: true
    }
  });
  assert.equal(blocked.certified, false);
  assert.equal(blocked.mode, 'COMPOUND_CONTAIN_AND_PROVE');

  const certified = certifyCompoundResponse({
    componentResolutions: [integration, datastore],
    verification: {
      compoundSimulationPassed: true,
      compoundIndependentReplayPassed: true,
      orderingAndDependencyChecksPassed: true,
      tenantInvariantPassed: true,
      securityInvariantPassed: true,
      noSplitBrain: true,
      noSilentDataLoss: true,
      rollbackOrCompensationProved: true,
      noAuthorityExpansion: true
    }
  });
  assert.equal(certified.certified, true);
  assert.equal(certified.mode, 'CERTIFIED_COMPOUND_FAST_PATH');
  assert.equal(certified.humanOperationalTouchBudget, 0);
  assert.equal(certified.mayExpandAuthority, false);
});
