import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signData } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { planEvidenceBoundDataImport, digest } = require('../resilience/evidence-bound-data-import-plan.cjs');
const { planAuthorisedStagingImportReadiness } = require('../resilience/authorised-staging-import-readiness.cjs');
const { SCOPE, requestDigest, createAuthorisedStagingImportExecutor, verifyAuthorisedStagingExecutionReceipt } = require('../resilience/authorised-staging-import-executor.cjs');

const seal = (value, field = 'evidenceDigest') => ({ ...value, [field]: digest(value) });
function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])]));
  return value;
}

function rollout(employees, sites, tenantRef = 'tenant-demo') {
  const base = digest({ base: 'v1' });
  const sitePlans = [];
  let remaining = employees;
  for (let index = 0; index < sites; index += 1) {
    const employeeCount = Math.floor(remaining / (sites - index));
    remaining -= employeeCount;
    const siteId = `site-${String(index + 1).padStart(3, '0')}`;
    sitePlans.push({ siteId, entityId: 'entity-01', country: 'GB', employeeCount, riskScore: index % 5, baseTemplateDigest: base, templateDigest: digest({ siteId }), overlay: { dataRegion: 'uk' }, blocked: false, legalCoverageClaim: false });
  }
  const waves = [];
  for (let index = 0; index < sitePlans.length; index += 10) {
    const waveSites = sitePlans.slice(index, index + 10);
    waves.push({ wave: waves.length + 1, siteIds: waveSites.map((site) => site.siteId), employeeCount: waveSites.reduce((total, site) => total + site.employeeCount, 0), riskCeiling: Math.max(...waveSites.map((site) => site.riskScore)), purpose: 'phased-rollout' });
  }
  const core = { schemaVersion: 1, rolloutVersion: '1.0.0', scopeReceiptDigest: digest({ tenantRef }), tenantRef, status: 'ROLLOUT_PLANNED', topology: { sites, employees, entities: 1, countries: ['GB'], allowedDataRegions: ['uk'] }, baseTemplate: { digest: base, fieldCount: 7 }, sitePlans, waves, blockedItems: [], blockedSiteIds: [], clonePlans: [], trainingAssignments: [], driftBaseline: {}, metrics: {}, guardrails: { legalCoverageClaim: false, policyValuesInvented: false, crossRegionDataMovementAuthorised: false, secretCopyAuthorised: false, identityCopyAuthorised: false, productionWriteAuthorised: false }, authority: { environmentProvisioningAuthorityGranted: false, integrationWriteAuthorityGranted: false, customerMutation: false, payrollMutation: false, identityMutation: false, productionMutation: false, modelAuthorityGranted: false, releaseAuthorityGranted: false } };
  return { ...core, receiptDigest: digest(core) };
}

function schema() {
  const fields = [
    ['externalId', 'string', true, false, 'business'],
    ['firstName', 'string', true, false, 'business'],
    ['lastName', 'string', true, false, 'business'],
    ['siteId', 'string', true, false, 'business'],
    ['roleCode', 'string', true, false, 'business'],
    ['timezone', 'timezone', true, false, 'business'],
    ['status', 'enum', true, false, 'business'],
    ['payRate', 'number', false, true, 'payroll-control'],
  ].map(([fieldId, type, required, payrollImpacting, classification]) => ({ fieldId, type, required, payrollImpacting, classification }));
  const dataset = { datasetId: 'workers', schemaDigest: digest(fields), fields };
  return seal({ schemaEvidenceVersion: 1, owner: 'integration-data-fabric', verified: true, modelGenerated: false, customerSpecificAuthority: false, datasets: [dataset] });
}

function manifest(rolloutReceipt, observedAtMs = 2_000_000) {
  const fields = [
    ['externalId', 'string', 'business'],
    ['firstName', 'string', 'business'],
    ['lastName', 'string', 'business'],
    ['siteId', 'string', 'business'],
    ['roleCode', 'string', 'business'],
    ['timezone', 'timezone', 'business'],
    ['status', 'enum', 'business'],
    ['payRate', 'number', 'payroll-control'],
  ].map(([fieldId, type, classification]) => ({ fieldId, type, classification }));
  const dataset = { datasetId: 'workers', sourceSchemaDigest: digest(fields), recordCount: rolloutReceipt.topology.employees, fields };
  return seal({ manifestVersion: 1, owner: 'integration-data-fabric', verified: true, modelGenerated: false, readOnlyDiscovery: true, writeAuthorityGranted: false, customerMutationAuthorityGranted: false, payrollMutationAuthorityGranted: false, identityMutationAuthorityGranted: false, productionMutationAuthorityGranted: false, tenantRef: rolloutReceipt.tenantRef, sourceId: 'hris', evidenceLevel: 'tenant-authenticated', dataRegion: 'uk', observedAtMs, siteIds: rolloutReceipt.sitePlans.map((site) => site.siteId), datasets: [dataset] });
}

function syntheticExecutionReceipt(plan) {
  const core = { schemaVersion: 1, executorVersion: '1.0.0', status: 'simulation-verified', reason: null, tenantRef: plan.tenantRef, planReceiptDigest: plan.receiptDigest, permitDigest: digest({ permit: 'synthetic' }), executorId: 'deterministic-import-simulator', executedAt: 2_200_000, datasetsAttempted: plan.metrics.executableDatasets, datasetsVerified: plan.metrics.executableDatasets, rowsSimulated: plan.sourcePlans.reduce((total, source) => total + source.datasets.reduce((sum, dataset) => sum + (dataset.recordCount || 0), 0), 0), automaticRollbacksVerified: plan.metrics.executableDatasets, simulatedManualImportExecutionStepsRemoved: plan.metrics.executableDatasets, remainingHumanImportExecutionSteps: 0, datasetReceipts: [], scope: 'synthetic-staging-import-simulator-only', syntheticSimulationOnly: true, realCustomerDataRead: false, realCustomerDataMutation: false, realDataImportExecuted: false, autonomousCustomerImportProven: false, productionExecutionReady: false, integrationWriteAuthorityGranted: false, customerMutation: false, payrollMutation: false, identityMutation: false, productionMutation: false, modelAuthorityGranted: false, releaseAuthorityGranted: false, publicExposureCreated: false, newSpendIncurred: false };
  return { ...core, executionReceiptDigest: digest(core) };
}

function sourceAccess(plan, overrides = {}) {
  const source = plan.sourcePlans.find((item) => item.sourceId === overrides.sourceId) || plan.sourcePlans[0];
  const datasets = source.datasets.filter((dataset) => dataset.readyForStagingImportSimulation).map((dataset) => ({ datasetId: dataset.datasetId, availableFields: dataset.mappings.filter((mapping) => mapping.status === 'AUTOMATIC').map((mapping) => mapping.sourceField).sort() }));
  return seal({ version: 1, owner: 'integration-data-fabric', verified: true, modelGenerated: false, authorityGranted: false, readOnlyCapable: true, writeCapable: false, productionMutationCapable: false, payrollMutationCapable: false, identityMutationCapable: false, publicExposureCapable: false, tenantRef: plan.tenantRef, sourceId: source.sourceId, dataRegion: source.dataRegion, observedAtMs: 2_250_000, datasets, ...overrides });
}

function multiSourceFixture() {
  const rolloutReceipt = rollout(100, 2);
  const first = manifest(rolloutReceipt);
  const secondCore = { ...first, sourceId: 'hris-2' };
  delete secondCore.evidenceDigest;
  const second = seal(secondCore);
  const canonicalSchemaEvidence = schema();
  const importPlan = planEvidenceBoundDataImport({ rolloutReceipt, canonicalSchemaEvidence, sourceManifests: [first, second], nowMs: 2_100_000 });
  const readinessReceipt = planAuthorisedStagingImportReadiness({ importPlan, syntheticExecutionReceipt: syntheticExecutionReceipt(importPlan), sourceAccessEvidence: [sourceAccess(importPlan, { sourceId: 'hris' }), sourceAccess(importPlan, { sourceId: 'hris-2' })], stagingEvidence: [staging(importPlan)], nowMs: 2_300_000 });
  assert.equal(readinessReceipt.authorisationRequests.length, 2);
  return { rolloutReceipt, sourceManifest: first, sourceManifests: [first, second], canonicalSchemaEvidence, importPlan, readinessReceipt };
}

function staging(plan, overrides = {}) {
  return seal({ version: 1, verified: true, modelGenerated: false, authorityGranted: false, tenantRef: plan.tenantRef, environmentRef: 'staging-uk-01', dataRegion: 'uk', isolated: true, stagingOnly: true, productionConnected: false, publiclyReachable: false, customerProductionWriteCapable: false, payrollWriteCapable: false, identityWriteCapable: false, rollbackSupported: true, independentVerificationSupported: true, zeroIncrementalCost: true, observedAtMs: 2_250_000, ...overrides });
}

function fixture(employees = 100, sites = 2) {
  const rolloutReceipt = rollout(employees, sites);
  const sourceManifest = manifest(rolloutReceipt);
  const canonicalSchemaEvidence = schema();
  const importPlan = planEvidenceBoundDataImport({ rolloutReceipt, canonicalSchemaEvidence, sourceManifests: [sourceManifest], nowMs: 2_100_000 });
  const readinessReceipt = planAuthorisedStagingImportReadiness({ importPlan, syntheticExecutionReceipt: syntheticExecutionReceipt(importPlan), sourceAccessEvidence: [sourceAccess(importPlan)], stagingEvidence: [staging(importPlan)], nowMs: 2_300_000 });
  assert.equal(readinessReceipt.status, 'READY_FOR_EXPLICIT_CUSTOMER_AUTHORISATION');
  return { rolloutReceipt, sourceManifest, canonicalSchemaEvidence, importPlan, readinessReceipt };
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const keyId = 'customer-auth-key-2026-09';
const { privateKey: executionPrivateKey, publicKey: executionPublicKey } = generateKeyPairSync('ed25519');
const executionKeyId = 'staging-executor-key-2026-09';
function authorisation(input, overrides = {}, signingKey = privateKey) {
  const request = input.readinessReceipt.authorisationRequests[0];
  const core = { schemaVersion: 1, authorisationVersion: '1.0.0', scope: SCOPE, authorisationId: `auth-${input.importPlan.tenantRef}-${request.sourceId}`, issuer: 'customer-authorisation-service', issuerKeyId: keyId, signedAtMs: 2_350_000, validUntilMs: 2_450_000, humanApproved: true, modelIssued: false, oneShot: true, maxAttempts: 2, tenantRef: input.importPlan.tenantRef, readinessReceiptDigest: input.readinessReceipt.receiptDigest, importPlanReceiptDigest: input.importPlan.receiptDigest, requestDigest: requestDigest(request), sourceId: request.sourceId, dataRegion: request.dataRegion, stagingEnvironmentRef: request.stagingEnvironmentRef, datasets: structuredClone(request.datasets), rowBudget: request.datasets.reduce((total, dataset) => total + dataset.recordLimit, 0), datasetBudget: request.datasets.length, readOnlySourceAccess: true, stagingOnlyDestination: true, sourceWriteAllowed: false, productionWriteAllowed: false, payrollDataAllowed: false, identityAuthorityDataAllowed: false, secretDataAllowed: false, publicExposureAllowed: false, ...overrides };
  const signature = signData(null, Buffer.from(JSON.stringify(canon(core))), signingKey).toString('base64');
  return { ...core, signature };
}

function makeRow(index, fields, siteIds) {
  const values = { externalId: `E-${String(index + 1).padStart(8, '0')}`, firstName: `First-${index + 1}`, lastName: `Last-${index + 1}`, siteId: siteIds[index % siteIds.length], roleCode: 'OPERATOR', timezone: 'Europe/London', status: 'ACTIVE', payRate: 99 };
  return Object.fromEntries(fields.map((field) => [field, values[field]]));
}

function adapter(options = {}) {
  const stagingState = new Map();
  const snapshots = new Map();
  const journals = new Map();
  const claims = new Map();
  let failedRead = false;
  let readEnteredResolve;
  const readEntered = new Promise((resolve) => { readEnteredResolve = resolve; });
  let releaseReadResolve;
  const releaseRead = new Promise((resolve) => { releaseReadResolve = resolve; });
  const capability = { scope: SCOPE, tenantIsolation: true, sourceReadOnly: true, sourceWriteAuthority: false, fieldProjectionEnforced: true, endpointAllowlistEnforced: true, destinationIsolated: true, stagingOnly: true, destinationProductionConnected: false, publicExposure: false, payrollDataVisible: false, identityAuthorityDataVisible: false, secretMaterialVisible: false, productionWriteAuthority: false, rollbackSupported: true, independentVerificationSupported: true, durableOneShotClaims: true, exclusiveFencedClaims: true, idempotentWrites: true, zeroIncrementalCost: true, dataSourceClass: 'synthetic-authorised-fixture', ...options.capability };
  const key = (value) => `${value.tenantRef}:${value.sourceId}:${value.datasetId}`;
  const fenceOk = (value) => [...claims.values()].some((claim) => claim.executionId === value.executionId && claim.fencingToken === value.fencingToken && claim.status === 'active');
  const api = {
    capability,
    async claimAuthorisation(value) {
      const prior = claims.get(value.authorisationId);
      if (prior?.status === 'completed') return { claimed: false, replayOfCompletedExecution: true, executionId: value.executionId };
      if (prior?.status === 'active' && value.attemptAtMs <= prior.leaseUntilMs) return { claimed: false, activeLease: true, replayOfCompletedExecution: false, executionId: value.executionId };
      if (prior) {
        prior.attemptNumber += 1;
        prior.status = 'active';
        prior.fencingToken = `fence-${prior.attemptNumber}-${digest({ executionId: value.executionId, attempt: prior.attemptNumber }).slice(0, 16)}`;
        prior.leaseUntilMs = value.attemptAtMs + value.leaseDurationMs;
        return { claimed: true, replayOfCompletedExecution: false, resumeRequired: true, attemptNumber: prior.attemptNumber, executionId: value.executionId, fencingToken: prior.fencingToken };
      }
      const fencingToken = `fence-1-${digest({ executionId: value.executionId, attempt: 1 }).slice(0, 16)}`;
      claims.set(value.authorisationId, { status: 'active', executionId: value.executionId, attemptNumber: 1, fencingToken, leaseUntilMs: value.attemptAtMs + value.leaseDurationMs });
      return { claimed: true, replayOfCompletedExecution: false, resumeRequired: false, attemptNumber: 1, executionId: value.executionId, fencingToken };
    },
    async reconcileIncompleteExecution(value) {
      if (!fenceOk(value) || options.unsafeReconcile) return { executionId: value.executionId, fencingToken: value.fencingToken, knownGood: false, stagingClean: false, sourceUntouched: true, productionUntouched: true, rollbackJournalVerified: false, restoredDatasets: 0, recoveryJournalDigest: digest([]) };
      const journal = journals.get(value.executionId) || [];
      let verified = true;
      for (const item of [...journal].reverse()) {
        const snapshot = snapshots.get(item.snapshotKey);
        if (!snapshot) { verified = false; continue; }
        if (snapshot.existed) stagingState.set(item.stateKey, structuredClone(snapshot.state));
        else stagingState.delete(item.stateKey);
        const restored = snapshot.existed ? digest(stagingState.get(item.stateKey)) : digest({ rows: [], fields: [], contentDigest: digest([]) });
        if (restored !== item.stateDigest) verified = false;
      }
      if (verified) journals.delete(value.executionId);
      return { executionId: value.executionId, fencingToken: value.fencingToken, knownGood: verified, stagingClean: verified, sourceUntouched: true, productionUntouched: true, rollbackJournalVerified: verified, restoredDatasets: journal.length, recoveryJournalDigest: digest(journal.map((item) => ({ stateKey: item.stateKey, stateDigest: item.stateDigest }))) };
    },
    async readApprovedRows(value) {
      if (!fenceOk(value)) throw new Error('stale fencing token');
      if (typeof options.onRead === 'function') options.onRead();
      if (options.holdFirstRead) { readEnteredResolve(); await releaseRead; }
      if (options.failReadOnce && !failedRead) { failedRead = true; throw new Error('temporary source outage'); }
      const fields = [...value.approvedFields].sort();
      const rows = Array.from({ length: value.recordLimit }, (_, index) => makeRow(index, fields, value.approvedSiteIds));
      if (options.outOfScopeSite && rows.length) rows[0].siteId = 'site-unapproved';
      if (options.duplicateStableKey && rows.length > 1) rows[1].externalId = rows[0].externalId;
      if (options.extraField && rows.length) rows[0].payRate = 99;
      const sourceState = digest({ source: value.sourceId, dataset: value.datasetId, count: value.recordLimit, fields });
      return { accepted: true, tenantRef: options.crossTenant ? 'other-tenant' : value.tenantRef, sourceId: value.sourceId, datasetId: value.datasetId, sourceReadOnly: true, sourceWritePerformed: false, productionDataMutated: false, payrollDataRead: false, identityAuthorityDataRead: false, secretMaterialRead: false, endpointAllowlisted: true, deterministicOrder: true, sourceSchemaDigest: options.schemaDrift ? digest({ changed: true }) : value.sourceSchemaDigest, projectedFields: fields, sourceStateBeforeDigest: sourceState, sourceStateAfterDigest: options.sourceMutated ? digest({ sourceState, changed: true }) : sourceState, sourceDataClass: capability.dataSourceClass, recordCount: rows.length, rows };
    },
    async snapshotDataset(value) {
      if (!fenceOk(value)) throw new Error('stale fencing token');
      const existed = stagingState.has(key(value));
      const state = structuredClone(stagingState.get(key(value)) || { rows: [], fields: [], contentDigest: digest([]) });
      const stateDigest = digest(state);
      const snapshotKey = `${value.executionId}:${key(value)}:${stateDigest}`;
      snapshots.set(snapshotKey, { existed, state });
      const journal = journals.get(value.executionId) || [];
      journal.push({ stateKey: key(value), stateDigest, snapshotKey });
      journals.set(value.executionId, journal);
      return stateDigest;
    },
    async writeStagingRows(value) {
      if (!fenceOk(value)) throw new Error('stale fencing token');
      const state = { executionId: value.executionId, rows: structuredClone(value.rows), fields: [...value.targetFields].sort(), contentDigest: digest({ datasetId: value.datasetId, targetSchemaDigest: value.targetSchemaDigest, rows: value.rows }) };
      stagingState.set(key(value), state);
      const afterStateDigest = digest(state);
      return { accepted: true, idempotent: true, fencingToken: value.fencingToken, tenantRef: value.tenantRef, sourceId: value.sourceId, datasetId: value.datasetId, stagingEnvironmentRef: value.stagingEnvironmentRef, recordCount: value.rows.length, contentDigest: state.contentDigest, stagingOnly: true, productionDataTouched: false, sourceDataTouched: false, payrollDataTouched: false, identityDataTouched: false, publicExposureCreated: false, newSpendIncurred: false, mutationAuthority: { customer: false, production: false, payroll: false, identity: false }, afterStateDigest };
    },
    async verifyStagingDataset(value) {
      if (!fenceOk(value)) throw new Error('stale fencing token');
      const state = stagingState.get(key(value));
      return { verified: options.failVerify !== true, independent: true, fencingToken: value.fencingToken, tenantRef: value.tenantRef, sourceId: value.sourceId, datasetId: value.datasetId, stagingEnvironmentRef: value.stagingEnvironmentRef, recordCount: state?.rows?.length || 0, validationChecksPassed: value.expectedValidationChecks.length, contentDigest: options.badContentDigest ? digest({ bad: true }) : state?.contentDigest, observedStateDigest: digest(state), sourceUntouched: options.unsafeVerify ? false : true, sourceStateDigest: value.sourceStateDigest, productionDataTouched: options.unsafeVerify ? true : false, payrollDataTouched: false, identityDataTouched: false, publicExposureCreated: false };
    },
    async rollbackStagingDataset(value) {
      if (!fenceOk(value)) throw new Error('stale fencing token');
      const snapshot = snapshots.get(`${value.executionId}:${key(value)}:${value.restoreStateDigest}`);
      if (!snapshot || options.failRollback) return { rolledBack: false, fencingToken: value.fencingToken, tenantRef: value.tenantRef, sourceId: value.sourceId, datasetId: value.datasetId, observedStateDigest: digest(stagingState.get(key(value))) };
      if (snapshot.existed) stagingState.set(key(value), structuredClone(snapshot.state));
      else stagingState.delete(key(value));
      const observedStateDigest = snapshot.existed ? digest(stagingState.get(key(value))) : digest({ rows: [], fields: [], contentDigest: digest([]) });
      return { rolledBack: true, fencingToken: value.fencingToken, tenantRef: value.tenantRef, sourceId: value.sourceId, datasetId: value.datasetId, productionDataTouched: false, sourceDataTouched: false, payrollDataTouched: false, identityDataTouched: false, publicExposureCreated: false, observedStateDigest };
    },
    async pauseAuthorisation(value) {
      if (!fenceOk(value)) return { paused: false, executionId: value.executionId, fencingToken: value.fencingToken };
      const claim = [...claims.values()].find((item) => item.executionId === value.executionId);
      claim.status = 'paused';
      return { paused: true, executionId: value.executionId, fencingToken: value.fencingToken };
    },
    async completeAuthorisation(value) {
      if (!fenceOk(value)) return { completed: false, executionId: value.executionId, fencingToken: value.fencingToken };
      const item = claims.get(value.authorisationId);
      if (item) item.status = 'completed';
      if (options.failComplete !== true) journals.delete(value.executionId);
      return { completed: options.failComplete !== true, executionId: value.executionId, fencingToken: value.fencingToken };
    },
    _test: { readEntered, releaseRead: () => releaseReadResolve(), claims, stagingState, snapshots, journals },
  };
  return api;
}

function executor(input, sourceAdapter, now = 2_400_000, isKilled = () => false) {
  return createAuthorisedStagingImportExecutor({ adapter: sourceAdapter, authorisationPublicKeys: new Map([[keyId, publicKey]]), executionReceiptSigner: { keyId: executionKeyId, modelControlled: false, sign: (payload) => signData(null, payload, executionPrivateKey).toString('base64') }, now: typeof now === 'function' ? now : () => now, isKilled });
}

const scale = [[1, 1], [25, 1], [100, 2], [500, 5], [2_000, 10], [10_000, 50], [25_000, 120]];
const scaleResults = [];
for (const [employees, sites] of scale) {
  const input = fixture(employees, sites);
  const receipt = await executor(input, adapter()).execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: authorisation(input), canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  assert.equal(receipt.status, 'staging-import-verified');
  assert.equal(receipt.datasetsVerified, 1);
  assert.equal(receipt.rowsRead, employees);
  assert.equal(receipt.rowsStaged, employees);
  assert.equal(receipt.sourceDatasetsProvenUnchanged, 1);
  assert.equal(receipt.customerDataReadPerformed, false);
  assert.equal(receipt.realCustomerStagingImportExecuted, false);
  assert.equal(receipt.productionMutationPerformed, false);
  assert.equal(verifyAuthorisedStagingExecutionReceipt(receipt, new Map([[executionKeyId, executionPublicKey]])), true);
  scaleResults.push({ employees, sites, rowsReadAndReconciled: receipt.rowsRead, datasetsVerified: receipt.datasetsVerified, modeledManualStagingStepsRemoved: receipt.modeledManualStagingStepsRemoved, customerApprovalDecisionsApplied: 1 });
}

{
  const input = multiSourceFixture();
  const receipt = await executor(input, adapter()).execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: authorisation(input), canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: input.sourceManifests });
  assert.equal(receipt.status, 'staging-import-verified');
  assert.equal(receipt.remainingCustomerApprovalDecisions, 1);
}

{
  const input = fixture();
  const sourceAdapter = adapter({ holdFirstRead: true });
  const run = executor(input, sourceAdapter);
  const approval = authorisation(input);
  const args = { importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: approval, canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] };
  const firstPromise = run.execute(args);
  await sourceAdapter._test.readEntered;
  const concurrent = await run.execute(args);
  assert.equal(concurrent.reason, 'authorisation-already-in-progress');
  sourceAdapter._test.releaseRead();
  const first = await firstPromise;
  assert.equal(first.status, 'staging-import-verified');
}

{
  const input = fixture();
  const sourceAdapter = adapter({ holdFirstRead: true });
  const run = executor(input, sourceAdapter);
  const originalTenant = input.importPlan.tenantRef;
  const promise = run.execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: authorisation(input), canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  await sourceAdapter._test.readEntered;
  input.importPlan.tenantRef = 'mutated-during-await';
  sourceAdapter._test.releaseRead();
  const receipt = await promise;
  assert.equal(receipt.status, 'staging-import-verified');
  assert.equal(receipt.tenantRef, originalTenant);
}

{
  const input = fixture();
  let killed = false;
  const receipt = await executor(input, adapter({ onRead: () => { killed = true; } }), 2_400_000, () => killed).execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: authorisation(input), canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  assert.equal(receipt.reason, 'kill-switch-activated');
  assert.equal(receipt.rowsRead, 100);
  assert.equal(receipt.rowsStaged, 0);
  assert.equal(receipt.authorisedStagingImportExecuted, false);
}

{
  const input = fixture();
  const sourceAdapter = adapter({ failReadOnce: true });
  const run = executor(input, sourceAdapter);
  const approval = authorisation(input);
  const first = await run.execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: approval, canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  assert.equal(first.reason, 'source-read-unavailable');
  assert.equal(first.retryable, true);
  const recovered = await run.execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: approval, canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  assert.equal(recovered.status, 'staging-import-verified');
  const replay = await run.execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: approval, canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  assert.equal(replay.reason, 'completed-authorisation-replay-denied');
}

{
  const input = fixture();
  const sourceAdapter = adapter({ failReadOnce: true });
  const approval = authorisation(input);
  const executionId = digest({ authorisationId: approval.authorisationId, signature: approval.signature, plan: input.importPlan.receiptDigest });
  const stateKey = `${input.importPlan.tenantRef}:hris:workers`;
  const baseline = { executionId: 'previous-verified-execution', rows: [{ externalId: 'BASELINE' }], fields: ['externalId'], contentDigest: digest([{ externalId: 'BASELINE' }]) };
  sourceAdapter._test.stagingState.set(stateKey, structuredClone(baseline));
  const claim = await sourceAdapter.claimAuthorisation({ authorisationId: approval.authorisationId, authorisationDigest: digest({ approval: true }), executionId, maxAttempts: 2, attemptAtMs: 2_300_000, leaseDurationMs: 1_000 });
  const common = { tenantRef: input.importPlan.tenantRef, sourceId: 'hris', datasetId: 'workers', stagingEnvironmentRef: 'staging-uk-01', executionId, fencingToken: claim.fencingToken };
  const beforeStateDigest = await sourceAdapter.snapshotDataset(common);
  await sourceAdapter.writeStagingRows({ ...common, rows: [{ externalId: 'PARTIAL' }], targetFields: ['externalId'], targetSchemaDigest: digest({ target: true }), expectedContentDigest: digest({ partial: true }), beforeStateDigest, idempotencyKey: digest({ executionId, partial: true }) });
  const receipt = await executor(input, sourceAdapter).execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: approval, canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  assert.equal(receipt.reason, 'source-read-unavailable');
  assert.equal(receipt.retryable, false);
  assert.deepEqual(sourceAdapter._test.stagingState.get(stateKey), baseline);
}

for (const options of [
  { extraField: true, reason: 'source-field-projection-violation' },
  { crossTenant: true, reason: 'unsafe-or-unbound-source-read' },
  { schemaDrift: true, reason: 'unsafe-or-unbound-source-read' },
  { duplicateStableKey: true, reason: 'duplicate-stable-key' },
  { outOfScopeSite: true, reason: 'source-site-scope-violation' },
]) {
  const input = fixture();
  const receipt = await executor(input, adapter(options)).execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: authorisation(input), canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  assert.equal(receipt.reason, options.reason);
  assert.equal(receipt.productionMutationPerformed, false);
}
{
  const input = fixture();
  const receipt = await executor(input, adapter({ sourceMutated: true })).execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: authorisation(input), canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  assert.equal(receipt.reason, 'source-mutation-detected');
  assert.equal(receipt.status, 'reset-required');
  assert.equal(receipt.sourceMutationPerformed, true);
  assert.equal(receipt.sourceIntegrityStatus, 'mutation-detected');
}
{
  const input = fixture();
  const receipt = await executor(input, adapter()).execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: authorisation(input), canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  const forged = structuredClone(receipt);
  forged.realCustomerStagingImportExecuted = true;
  forged.autonomousCustomerImportProven = true;
  forged.rowsRead = 9_999_999;
  forged.rowsValidated = 9_999_999;
  forged.rowsStaged = 9_999_999;
  forged.modeledManualStagingStepsRemoved = 9_999_999;
  const forgedCore = structuredClone(forged);
  delete forgedCore.executionSignature;
  delete forgedCore.executionReceiptDigest;
  forged.executionReceiptDigest = digest(forgedCore);
  assert.equal(verifyAuthorisedStagingExecutionReceipt(forged, new Map([[executionKeyId, executionPublicKey]])), false);
}

{
  const input = fixture();
  const changed = authorisation(input);
  changed.payrollDataAllowed = true;
  const receipt = await executor(input, adapter()).execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: changed, canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  assert.equal(receipt.reason, 'customer-authorisation-invalid-or-unbound');
}
{
  const input = fixture();
  const modelApproval = authorisation(input, { modelIssued: true, humanApproved: false });
  const receipt = await executor(input, adapter()).execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: modelApproval, canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  assert.equal(receipt.reason, 'customer-authorisation-invalid-or-unbound');
}
{
  const input = fixture();
  const expired = authorisation(input, { validUntilMs: 2_399_999 });
  const receipt = await executor(input, adapter()).execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: expired, canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  assert.equal(receipt.reason, 'customer-authorisation-invalid-or-unbound');
}
{
  const input = fixture();
  const receipt = await executor(input, adapter({ failVerify: true })).execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: authorisation(input), canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  assert.equal(receipt.reason, 'independent-staging-verification-failed');
  assert.equal(receipt.automaticRollbacksVerified, 1);
  assert.equal(receipt.status, 'contained');
}
{
  const input = fixture();
  const receipt = await executor(input, adapter({ unsafeVerify: true })).execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: authorisation(input), canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  assert.equal(receipt.reason, 'unsafe-independent-verification-observation');
  assert.equal(receipt.status, 'reset-required');
  assert.equal(receipt.retryable, false);
  assert.equal(receipt.productionMutationPerformed, true);
  assert.equal(receipt.sourceIntegrityStatus, 'unsafe-or-unknown');
}
{
  const input = fixture();
  const receipt = await executor(input, adapter({ failVerify: true, failRollback: true })).execute({ importPlan: input.importPlan, readinessReceipt: input.readinessReceipt, customerAuthorisationReceipt: authorisation(input), canonicalSchemaEvidence: input.canonicalSchemaEvidence, sourceManifests: [input.sourceManifest] });
  assert.equal(receipt.status, 'reset-required');
  assert.equal(receipt.automaticRollbacksVerified, 0);
}
{
  const input = fixture();
  assert.throws(() => executor(input, adapter({ capability: { destinationProductionConnected: true } })), /safe authorised read-only staging adapter required/);
}

console.log(JSON.stringify({ schemaVersion: 1, proof: 'authorised-readonly-source-to-isolated-staging-execution', status: 'PASS', scaleResults, scaleProfiles: scaleResults.length, heldOutFailureClasses: ['transient-source-outage-safe-resume', 'completed-authorisation-replay', 'concurrent-authorisation-use-fenced', 'abandoned-partial-import-baseline-restoration', 'mid-await-input-mutation', 'kill-switch-during-source-read', 'field-projection-broadening', 'cross-tenant-source-result', 'source-mutation-during-read', 'provider-schema-drift', 'duplicate-stable-key', 'out-of-scope-site', 're-sealed-authorisation-expansion', 'signed-execution-receipt-forgery', 'model-issued-authorisation', 'expired-authorisation', 'independent-reconciliation-failure', 'unsafe-independent-verification-observation', 'rollback-failure-reset-required', 'production-connected-staging-adapter'], realCustomerDataRead: false, realCustomerStagingImportExecuted: false, customerAuthorisationCryptographicallyVerified: true, sourceMutationPerformed: false, productionMutationPerformed: false, payrollDataRead: false, identityAuthorityDataRead: false, modelAuthorityGranted: false, newSpendIncurred: false }, null, 2));
