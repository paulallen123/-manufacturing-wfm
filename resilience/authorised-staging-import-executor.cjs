'use strict';

const { createHash, verify: verifySignature } = require('node:crypto');
const { verifyEvidenceBoundDataImportPlan } = require('./evidence-bound-data-import-plan.cjs');
const { verifyReadinessReceipt } = require('./authorised-staging-import-readiness.cjs');

const VERSION = '1.0.0';
const SCOPE = 'authorised-readonly-source-to-isolated-staging-only';
const OWNER = 'integration-data-fabric';
const NEVER = new Set(['secret', 'credential', 'biometric', 'health-sensitive', 'payroll-control', 'security-authority', 'identity-authority']);
const RETRYABLE = new Set(['source-read-unavailable', 'independent-staging-verification-failed']);

function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])]));
  }
  return value;
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canon(value))).digest('hex');
}
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
function isDigest(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''));
}
function id(value, max = 180) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
}
function sealed(value, field = 'evidenceDigest') {
  if (!value || !isDigest(value[field])) return false;
  const copy = clone(value);
  const expected = copy[field];
  delete copy[field];
  return digest(copy) === expected;
}
function equal(left, right) {
  return JSON.stringify(canon(left)) === JSON.stringify(canon(right));
}
function allFalse(value) {
  return value && typeof value === 'object' && Object.values(value).every((item) => item === false);
}
function unsignedAuthorisation(receipt) {
  const copy = clone(receipt);
  delete copy.signature;
  return copy;
}
function requestDigest(request) {
  return digest(request);
}

function verifyCustomerAuthorisation(receipt, request, readiness, importPlan, publicKeys, nowMs) {
  if (!receipt || receipt.schemaVersion !== 1 || receipt.authorisationVersion !== VERSION) return false;
  if (receipt.scope !== SCOPE || receipt.issuer !== 'customer-authorisation-service') return false;
  if (!id(receipt.authorisationId) || !id(receipt.issuerKeyId) || !id(receipt.tenantRef)) return false;
  if (receipt.tenantRef !== importPlan.tenantRef || receipt.sourceId !== request.sourceId) return false;
  if (receipt.dataRegion !== request.dataRegion || receipt.stagingEnvironmentRef !== request.stagingEnvironmentRef) return false;
  if (receipt.readinessReceiptDigest !== readiness.receiptDigest || receipt.importPlanReceiptDigest !== importPlan.receiptDigest) return false;
  if (receipt.requestDigest !== requestDigest(request) || !equal(receipt.datasets, request.datasets)) return false;
  if (receipt.humanApproved !== true || receipt.modelIssued !== false || receipt.oneShot !== true) return false;
  if (receipt.readOnlySourceAccess !== true || receipt.stagingOnlyDestination !== true) return false;
  if (receipt.productionWriteAllowed !== false || receipt.sourceWriteAllowed !== false || receipt.payrollDataAllowed !== false) return false;
  if (receipt.identityAuthorityDataAllowed !== false || receipt.secretDataAllowed !== false || receipt.publicExposureAllowed !== false) return false;
  if (!Number.isSafeInteger(receipt.signedAtMs) || !Number.isSafeInteger(receipt.validUntilMs)) return false;
  if (receipt.signedAtMs > nowMs || nowMs > receipt.validUntilMs || receipt.validUntilMs <= receipt.signedAtMs) return false;
  if (!Number.isSafeInteger(receipt.maxAttempts) || receipt.maxAttempts < 1 || receipt.maxAttempts > 3) return false;
  const expectedRows = request.datasets.reduce((total, dataset) => total + dataset.recordLimit, 0);
  if (receipt.rowBudget !== expectedRows || receipt.datasetBudget !== request.datasets.length) return false;
  if (typeof receipt.signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(receipt.signature)) return false;
  const publicKey = publicKeys.get(receipt.issuerKeyId);
  if (!publicKey) return false;
  try {
    return verifySignature(
      null,
      Buffer.from(JSON.stringify(canon(unsignedAuthorisation(receipt)))),
      publicKey,
      Buffer.from(receipt.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

function schemaIndex(evidence) {
  if (!evidence || evidence.schemaEvidenceVersion !== 1 || evidence.owner !== OWNER || evidence.verified !== true || evidence.modelGenerated !== false || evidence.customerSpecificAuthority !== false || !sealed(evidence) || !Array.isArray(evidence.datasets)) return null;
  const datasets = new Map();
  for (const dataset of evidence.datasets) {
    if (!dataset || !id(dataset.datasetId) || !isDigest(dataset.schemaDigest) || !Array.isArray(dataset.fields) || digest(dataset.fields) !== dataset.schemaDigest) return null;
    datasets.set(dataset.datasetId, new Map(dataset.fields.map((field) => [field.fieldId, field])));
  }
  return datasets;
}

function manifestIndex(manifests, tenantRef) {
  const result = new Map();
  for (const manifest of Array.isArray(manifests) ? manifests : []) {
    if (!manifest || manifest.owner !== OWNER || manifest.verified !== true || manifest.modelGenerated !== false || manifest.tenantRef !== tenantRef || manifest.readOnlyDiscovery !== true || manifest.writeAuthorityGranted !== false || manifest.customerMutationAuthorityGranted !== false || manifest.payrollMutationAuthorityGranted !== false || manifest.identityMutationAuthorityGranted !== false || manifest.productionMutationAuthorityGranted !== false || !sealed(manifest)) continue;
    result.set(manifest.evidenceDigest, manifest);
  }
  return result;
}

function validateBindings(importPlan, readiness, schemaEvidence, sourceManifests) {
  if (!verifyEvidenceBoundDataImportPlan(importPlan)) return { ok: false, reason: 'verified-import-plan-required' };
  if (!verifyReadinessReceipt(readiness) || readiness.status !== 'READY_FOR_EXPLICIT_CUSTOMER_AUTHORISATION' || readiness.importPlanReceiptDigest !== importPlan.receiptDigest) return { ok: false, reason: 'verified-authorisation-readiness-required' };
  if (schemaEvidence?.evidenceDigest !== importPlan.canonicalSchemaEvidenceDigest) return { ok: false, reason: 'canonical-schema-evidence-mismatch' };
  const schemas = schemaIndex(schemaEvidence);
  if (!schemas) return { ok: false, reason: 'canonical-schema-evidence-invalid' };
  const manifests = manifestIndex(sourceManifests, importPlan.tenantRef);
  for (const source of importPlan.sourcePlans) {
    const manifest = manifests.get(source.evidenceDigest);
    if (!manifest || manifest.sourceId !== source.sourceId || manifest.dataRegion !== source.dataRegion) return { ok: false, reason: 'source-manifest-evidence-missing' };
    for (const dataset of source.datasets.filter((item) => item.readyForStagingImportSimulation === true)) {
      const sourceDataset = manifest.datasets.find((item) => item.datasetId === dataset.datasetId);
      const targetFields = schemas.get(dataset.datasetId);
      if (!sourceDataset || sourceDataset.sourceSchemaDigest !== dataset.sourceSchemaDigest) return { ok: false, reason: 'source-schema-binding-mismatch' };
      if (!targetFields || schemaEvidence.datasets.find((item) => item.datasetId === dataset.datasetId)?.schemaDigest !== dataset.targetSchemaDigest) return { ok: false, reason: 'target-schema-binding-mismatch' };
      for (const mapping of dataset.mappings.filter((item) => item.status === 'AUTOMATIC')) {
        const sourceField = sourceDataset.fields.find((item) => item.fieldId === mapping.sourceField);
        const targetField = targetFields.get(mapping.targetField);
        if (!sourceField || !targetField) return { ok: false, reason: 'mapping-field-not-in-bound-schema' };
        if (NEVER.has(sourceField.classification || 'business') || NEVER.has(targetField.classification || 'business') || targetField.payrollImpacting === true) return { ok: false, reason: 'sensitive-or-payroll-field-in-automatic-mapping' };
      }
    }
  }
  return { ok: true, schemas, manifests };
}

function assertAdapter(adapter) {
  const capability = adapter?.capability || {};
  const methods = ['claimAuthorisation', 'reconcileIncompleteExecution', 'readApprovedRows', 'snapshotDataset', 'writeStagingRows', 'verifyStagingDataset', 'rollbackStagingDataset', 'pauseAuthorisation', 'completeAuthorisation'];
  const validClass = ['synthetic-authorised-fixture', 'authorised-customer-workforce'].includes(capability.dataSourceClass);
  if (capability.scope !== SCOPE || capability.tenantIsolation !== true || capability.sourceReadOnly !== true || capability.sourceWriteAuthority !== false || capability.fieldProjectionEnforced !== true || capability.endpointAllowlistEnforced !== true || capability.destinationIsolated !== true || capability.stagingOnly !== true || capability.destinationProductionConnected !== false || capability.publicExposure !== false || capability.payrollDataVisible !== false || capability.identityAuthorityDataVisible !== false || capability.secretMaterialVisible !== false || capability.productionWriteAuthority !== false || capability.rollbackSupported !== true || capability.independentVerificationSupported !== true || capability.durableOneShotClaims !== true || capability.exclusiveFencedClaims !== true || capability.idempotentWrites !== true || capability.zeroIncrementalCost !== true || !validClass || methods.some((method) => typeof adapter[method] !== 'function')) {
    throw Object.assign(new Error('safe authorised read-only staging adapter required'), { code: 'WFM_AUTHORISED_STAGING_ADAPTER' });
  }
}

function valueValid(value, type) {
  if (value === null || value === undefined) return false;
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'date') return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (type === 'datetime') return typeof value === 'string' && Number.isFinite(Date.parse(value));
  return typeof value === 'string';
}

function transformValue(value, transform, field) {
  if (transform === 'identity') return value;
  if (transform === 'trim') return typeof value === 'string' ? value.trim() : value;
  if (transform === 'uppercase') return typeof value === 'string' ? value.toUpperCase() : value;
  if (transform === 'lowercase') return typeof value === 'string' ? value.toLowerCase() : value;
  if (transform === 'iso-date') return new Date(value).toISOString().slice(0, 10);
  if (transform === 'timezone-normalize') return String(value).trim();
  if (transform === 'stable-id') return digest({ field, value }).slice(0, 32);
  throw Object.assign(new Error('unsupported deterministic transform'), { code: 'WFM_STAGING_TRANSFORM' });
}

function validateAndMapRows(rows, dataset, sourceDataset, targetFields, approvedFields, approvedSiteIds) {
  if (!Array.isArray(rows) || rows.length !== dataset.recordCount) return { ok: false, reason: 'source-record-count-drift' };
  const expected = [...approvedFields].sort();
  const mappings = dataset.mappings.filter((item) => item.status === 'AUTOMATIC');
  const sourceTypes = new Map(sourceDataset.fields.map((field) => [field.fieldId, field.type]));
  const siteScope = new Set(approvedSiteIds);
  const output = [];
  const stableIds = new Set();
  for (const row of rows) {
    if (!row || Array.isArray(row) || typeof row !== 'object' || !equal(Object.keys(row).sort(), expected)) return { ok: false, reason: 'source-field-projection-violation' };
    if (Object.prototype.hasOwnProperty.call(row, 'siteId') && !siteScope.has(row.siteId)) return { ok: false, reason: 'source-site-scope-violation' };
    const mapped = {};
    for (const mapping of mappings) {
      const sourceValue = row[mapping.sourceField];
      if (!valueValid(sourceValue, sourceTypes.get(mapping.sourceField))) return { ok: false, reason: 'source-value-type-or-nullability-invalid' };
      let transformed;
      try { transformed = transformValue(sourceValue, mapping.transform, mapping.sourceField); } catch { return { ok: false, reason: 'unsupported-deterministic-transform' }; }
      if (!valueValid(transformed, targetFields.get(mapping.targetField)?.type)) return { ok: false, reason: 'target-value-type-invalid' };
      mapped[mapping.targetField] = transformed;
    }
    if (Object.prototype.hasOwnProperty.call(mapped, 'externalId')) {
      if (stableIds.has(mapped.externalId)) return { ok: false, reason: 'duplicate-stable-key' };
      stableIds.add(mapped.externalId);
    }
    output.push(mapped);
  }
  return { ok: true, rows: output };
}

function terminal(base, detail = {}, receiptSigner) {
  const core = {
    schemaVersion: 1,
    executorVersion: VERSION,
    ...base,
    ...detail,
    scope: SCOPE,
    customerAuthorisationApplied: base.authorisationClaimed === true,
    authorisedStagingImportExecuted: detail.status === 'staging-import-verified',
    productionMutationPerformed: Object.prototype.hasOwnProperty.call(detail, 'productionMutationPerformed') ? detail.productionMutationPerformed : (Object.prototype.hasOwnProperty.call(base, 'productionMutationPerformed') ? base.productionMutationPerformed : false),
    sourceMutationPerformed: Object.prototype.hasOwnProperty.call(detail, 'sourceMutationPerformed') ? detail.sourceMutationPerformed : (Object.prototype.hasOwnProperty.call(base, 'sourceMutationPerformed') ? base.sourceMutationPerformed : null),
    sourceIntegrityStatus: detail.sourceIntegrityStatus ?? base.sourceIntegrityStatus ?? 'not-observed',
    payrollDataRead: detail.payrollDataRead ?? false,
    identityAuthorityDataRead: detail.identityAuthorityDataRead ?? false,
    secretMaterialRead: detail.secretMaterialRead ?? false,
    publicExposureCreated: detail.publicExposureCreated ?? false,
    modelAuthorityGranted: false,
    productionAuthorityGranted: false,
    releaseAuthorityGranted: false,
    newSpendIncurred: false,
  };
  const unsigned = { ...core, executionReceiptDigest: digest(core) };
  const signature = receiptSigner.sign(Buffer.from(JSON.stringify(canon(unsigned))));
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw Object.assign(new Error('execution receipt signer returned invalid signature'), { code: 'WFM_STAGING_RECEIPT_SIGNATURE' });
  return { ...unsigned, executionSignature: { keyId: receiptSigner.keyId, value: signature } };
}

function verifyAuthorisedStagingExecutionReceipt(receipt, executionPublicKeys) {
  if (!receipt || receipt.schemaVersion !== 1 || receipt.executorVersion !== VERSION || !receipt.executionSignature || !id(receipt.executionSignature.keyId) || typeof receipt.executionSignature.value !== 'string') return false;
  const unsigned = clone(receipt);
  delete unsigned.executionSignature;
  const core = clone(unsigned);
  const expectedDigest = core.executionReceiptDigest;
  delete core.executionReceiptDigest;
  if (!isDigest(expectedDigest) || digest(core) !== expectedDigest) return false;
  const publicKeys = executionPublicKeys instanceof Map ? executionPublicKeys : new Map(Object.entries(executionPublicKeys || {}));
  const publicKey = publicKeys.get(receipt.executionSignature.keyId);
  if (!publicKey) return false;
  try {
    if (!verifySignature(null, Buffer.from(JSON.stringify(canon(unsigned))), publicKey, Buffer.from(receipt.executionSignature.value, 'base64'))) return false;
  } catch { return false; }
  if (receipt.scope !== SCOPE || receipt.modelAuthorityGranted !== false || receipt.productionAuthorityGranted !== false || receipt.releaseAuthorityGranted !== false || receipt.newSpendIncurred !== false || receipt.autonomousCustomerImportProven !== false) return false;
  if (![receipt.payrollDataRead, receipt.identityAuthorityDataRead, receipt.secretMaterialRead, receipt.publicExposureCreated].every((value) => typeof value === 'boolean')) return false;
  if (!['contained', 'reset-required', 'staging-import-verified'].includes(receipt.status) || !Array.isArray(receipt.datasetReceipts)) return false;
  if (![receipt.datasetsAttempted, receipt.datasetsVerified, receipt.rowsRead, receipt.rowsValidated, receipt.rowsStaged, receipt.sourceDatasetsProvenUnchanged, receipt.automaticRollbacksVerified, receipt.modeledManualStagingStepsRemoved, receipt.remainingCustomerApprovalDecisions].every((value) => Number.isSafeInteger(value) && value >= 0)) return false;
  const verifiedReceipts = receipt.datasetReceipts.filter((item) => item.status === 'staging-import-verified');
  const verifiedRows = verifiedReceipts.reduce((total, item) => total + item.recordCount, 0);
  const realCustomer = receipt.sourceDataClass === 'authorised-customer-workforce';
  if (receipt.customerDataReadPerformed !== (realCustomer && receipt.rowsRead > 0)) return false;
  if (receipt.realCustomerStagingImportExecuted !== (realCustomer && receipt.status === 'staging-import-verified' && receipt.datasetsVerified > 0)) return false;
  if (receipt.status === 'staging-import-verified') {
    if (receipt.reason !== null || receipt.authorisationClaimed !== true || receipt.customerAuthorisationApplied !== true || receipt.authorisedStagingImportExecuted !== true || receipt.productionMutationPerformed !== false || receipt.sourceMutationPerformed !== false || receipt.sourceIntegrityStatus !== 'proven-unchanged' || receipt.payrollDataRead !== false || receipt.identityAuthorityDataRead !== false || receipt.secretMaterialRead !== false || receipt.publicExposureCreated !== false) return false;
    if (receipt.datasetsAttempted !== receipt.datasetsVerified || receipt.datasetsVerified !== verifiedReceipts.length || receipt.rowsRead !== verifiedRows || receipt.rowsValidated !== verifiedRows || receipt.rowsStaged !== verifiedRows || receipt.sourceDatasetsProvenUnchanged !== receipt.datasetsVerified || receipt.automaticRollbacksVerified !== 0 || receipt.modeledManualStagingStepsRemoved !== receipt.datasetsVerified * 2) return false;
  } else {
    if (receipt.authorisedStagingImportExecuted !== false || receipt.realCustomerStagingImportExecuted !== false || receipt.modeledManualStagingStepsRemoved !== 0) return false;
  }
  return true;
}

function createAuthorisedStagingImportExecutor({ adapter, authorisationPublicKeys, executionReceiptSigner, now = Date.now, isKilled = () => false } = {}) {
  assertAdapter(adapter);
  const publicKeys = authorisationPublicKeys instanceof Map ? new Map(authorisationPublicKeys) : new Map(Object.entries(authorisationPublicKeys || {}));
  if (publicKeys.size === 0) throw Object.assign(new Error('trusted customer authorisation public key required'), { code: 'WFM_CUSTOMER_AUTHORISATION_KEY' });
  if (!executionReceiptSigner || !id(executionReceiptSigner.keyId) || executionReceiptSigner.modelControlled !== false || typeof executionReceiptSigner.sign !== 'function') throw Object.assign(new Error('trusted execution receipt signer required'), { code: 'WFM_STAGING_RECEIPT_SIGNER' });
  const capabilityDigest = digest(adapter.capability);
  const sourceDataClass = adapter.capability.dataSourceClass;
  const trusted = Object.freeze({
    claim: adapter.claimAuthorisation,
    reconcile: adapter.reconcileIncompleteExecution,
    read: adapter.readApprovedRows,
    snapshot: adapter.snapshotDataset,
    write: adapter.writeStagingRows,
    verify: adapter.verifyStagingDataset,
    rollback: adapter.rollbackStagingDataset,
    complete: adapter.completeAuthorisation,
    pause: adapter.pauseAuthorisation,
  });
  const signerFunction = executionReceiptSigner.sign;
  const signer = Object.freeze({ keyId: executionReceiptSigner.keyId, modelControlled: false, sign: signerFunction });
  const intact = () => digest(adapter.capability) === capabilityDigest && adapter.claimAuthorisation === trusted.claim && adapter.reconcileIncompleteExecution === trusted.reconcile && adapter.readApprovedRows === trusted.read && adapter.snapshotDataset === trusted.snapshot && adapter.writeStagingRows === trusted.write && adapter.verifyStagingDataset === trusted.verify && adapter.rollbackStagingDataset === trusted.rollback && adapter.completeAuthorisation === trusted.complete && adapter.pauseAuthorisation === trusted.pause && executionReceiptSigner.sign === signerFunction;
  const finish = (base, detail = {}) => terminal(base, detail, signer);

  async function execute({ importPlan, readinessReceipt, customerAuthorisationReceipt, canonicalSchemaEvidence, sourceManifests = [], executorId = 'deterministic-authorised-staging-importer' } = {}) {
    const executedAt = Number(now());
    importPlan = clone(importPlan);
    readinessReceipt = clone(readinessReceipt);
    customerAuthorisationReceipt = clone(customerAuthorisationReceipt);
    canonicalSchemaEvidence = clone(canonicalSchemaEvidence);
    sourceManifests = clone(sourceManifests);
    const base = {
      status: 'contained',
      reason: 'invalid-input',
      retryable: false,
      tenantRef: importPlan?.tenantRef || null,
      importPlanReceiptDigest: importPlan?.receiptDigest || null,
      readinessReceiptDigest: readinessReceipt?.receiptDigest || null,
      authorisationId: customerAuthorisationReceipt?.authorisationId || null,
      authorisationClaimed: false,
      executionId: null,
      executorId: id(executorId) ? executorId : null,
      executedAt,
      datasetsAttempted: 0,
      datasetsVerified: 0,
      rowsRead: 0,
      rowsValidated: 0,
      rowsStaged: 0,
      sourceDatasetsProvenUnchanged: 0,
      automaticRollbacksVerified: 0,
      datasetReceipts: [],
      sourceDataClass,
      customerDataReadPerformed: false,
      realCustomerStagingImportExecuted: false,
      autonomousCustomerImportProven: false,
      sourceMutationPerformed: null,
      sourceIntegrityStatus: 'not-observed',
      modeledManualStagingStepsRemoved: 0,
      remainingCustomerApprovalDecisions: readinessReceipt?.authorisationRequests?.length || 0,
    };
    if (!base.executorId || !Number.isSafeInteger(executedAt)) return finish(base, { reason: 'executor-identity-and-time-required' });
    const bound = validateBindings(importPlan, readinessReceipt, canonicalSchemaEvidence, sourceManifests);
    if (!bound.ok) return finish(base, { reason: bound.reason });
    if (!intact()) return finish(base, { reason: 'trusted-component-drift-before-execution' });
    if (isKilled()) return finish(base, { reason: 'kill-switch-active-before-execution' });
    const matchingRequests = readinessReceipt.authorisationRequests.filter((item) => item.sourceId === customerAuthorisationReceipt?.sourceId);
    const request = matchingRequests[0];
    if (matchingRequests.length !== 1) return finish(base, { reason: 'single-bound-source-authorisation-request-required' });
    if (!verifyCustomerAuthorisation(customerAuthorisationReceipt, request, readinessReceipt, importPlan, publicKeys, executedAt)) return finish(base, { reason: 'customer-authorisation-invalid-or-unbound' });
    const guardReason = () => {
      if (isKilled()) return 'kill-switch-activated';
      if (!intact()) return 'trusted-component-drift-during-execution';
      const current = Number(now());
      if (!Number.isSafeInteger(current) || current > customerAuthorisationReceipt.validUntilMs) return 'customer-authorisation-expired-during-execution';
      return null;
    };
    const executionId = digest({ authorisationId: customerAuthorisationReceipt.authorisationId, signature: customerAuthorisationReceipt.signature, plan: importPlan.receiptDigest });
    base.executionId = executionId;
    let claim;
    try {
      claim = await trusted.claim.call(adapter, { authorisationId: customerAuthorisationReceipt.authorisationId, authorisationDigest: digest(unsignedAuthorisation(customerAuthorisationReceipt)), executionId, maxAttempts: customerAuthorisationReceipt.maxAttempts, attemptAtMs: executedAt, leaseDurationMs: 30_000 });
    } catch {}
    const claimOk = claim && claim.claimed === true && claim.executionId === executionId && id(claim.fencingToken) && Number.isSafeInteger(claim.attemptNumber) && claim.attemptNumber >= 1 && claim.attemptNumber <= customerAuthorisationReceipt.maxAttempts && claim.replayOfCompletedExecution === false;
    if (!claimOk) return finish(base, { reason: claim?.replayOfCompletedExecution === true ? 'completed-authorisation-replay-denied' : claim?.activeLease === true ? 'authorisation-already-in-progress' : 'durable-authorisation-claim-failed' });
    const fencingToken = claim.fencingToken;
    base.authorisationClaimed = true;
    base.remainingCustomerApprovalDecisions = Math.max(0, readinessReceipt.authorisationRequests.length - 1);
    const afterClaimGuard = guardReason();
    if (afterClaimGuard) return finish(base, { reason: afterClaimGuard });
    if (claim.resumeRequired === true) {
      let recovery;
      try { recovery = await trusted.reconcile.call(adapter, { executionId, authorisationId: customerAuthorisationReceipt.authorisationId, fencingToken }); } catch {}
      if (!recovery || recovery.executionId !== executionId || recovery.fencingToken !== fencingToken || recovery.knownGood !== true || recovery.stagingClean !== true || recovery.sourceUntouched !== true || recovery.productionUntouched !== true || recovery.rollbackJournalVerified !== true || !Number.isSafeInteger(recovery.restoredDatasets) || recovery.restoredDatasets < 0 || !isDigest(recovery.recoveryJournalDigest)) return finish(base, { status: 'reset-required', reason: 'incomplete-execution-could-not-be-safely-reconciled', sourceIntegrityStatus: 'unsafe-or-unknown' });
      const afterRecoveryGuard = guardReason();
      if (afterRecoveryGuard) return finish(base, { reason: afterRecoveryGuard });
    }

    const sourcePlan = importPlan.sourcePlans.find((item) => item.sourceId === request.sourceId);
    if (!sourcePlan) return finish(base, { reason: 'authorised-source-no-longer-in-import-plan' });
    const manifest = bound.manifests.get(sourcePlan.evidenceDigest);
    const touched = [];
    const receipts = [];
    let attempted = 0;
    let verified = 0;
    let rowsRead = 0;
    let rowsValidated = 0;
    let rowsStaged = 0;
    let unchanged = 0;
    let rollbacks = 0;

    async function rollbackAll(reason, safety = {}) {
      let allSafe = true;
      for (const item of [...touched].reverse()) {
        let rollback;
        try { rollback = await trusted.rollback.call(adapter, { ...item, executionId, fencingToken, restoreStateDigest: item.beforeStateDigest }); } catch {}
        if (rollback?.productionDataTouched === true) safety.productionMutationPerformed = true;
        if (rollback?.sourceDataTouched === true) { safety.sourceMutationPerformed = true; safety.sourceIntegrityStatus = 'mutation-detected'; }
        if (rollback?.publicExposureCreated === true) safety.publicExposureCreated = true;
        const safe = rollback && rollback.rolledBack === true && rollback.fencingToken === fencingToken && rollback.tenantRef === importPlan.tenantRef && rollback.sourceId === item.sourceId && rollback.datasetId === item.datasetId && rollback.productionDataTouched === false && rollback.sourceDataTouched === false && rollback.payrollDataTouched === false && rollback.identityDataTouched === false && rollback.publicExposureCreated === false && rollback.observedStateDigest === item.beforeStateDigest;
        if (safe) rollbacks += 1;
        else allSafe = false;
      }
      let retryable = allSafe && RETRYABLE.has(reason) && claim.attemptNumber < customerAuthorisationReceipt.maxAttempts;
      if (retryable) {
        let paused;
        try { paused = await trusted.pause.call(adapter, { executionId, authorisationId: customerAuthorisationReceipt.authorisationId, fencingToken, reason }); } catch {}
        retryable = paused?.paused === true && paused.executionId === executionId && paused.fencingToken === fencingToken;
      }
      const rolledBackReceipts = allSafe ? receipts.map((item) => ({ ...item, status: 'rolled-back-after-later-failure' })) : receipts;
      return finish({ ...base, datasetsAttempted: attempted, datasetsVerified: 0, rowsRead, rowsValidated, rowsStaged: allSafe ? 0 : rowsStaged, sourceDatasetsProvenUnchanged: unchanged, automaticRollbacksVerified: rollbacks, datasetReceipts: rolledBackReceipts, customerDataReadPerformed: sourceDataClass === 'authorised-customer-workforce' && rowsRead > 0, modeledManualStagingStepsRemoved: 0 }, { status: allSafe && safety.forceReset !== true ? 'contained' : 'reset-required', reason, retryable, ...safety });
    }

    for (const requestedDataset of request.datasets) {
      const beforeDatasetGuard = guardReason();
      if (beforeDatasetGuard) return rollbackAll(beforeDatasetGuard);
      const dataset = sourcePlan.datasets.find((item) => item.datasetId === requestedDataset.datasetId && item.readyForStagingImportSimulation === true);
      const sourceDataset = manifest.datasets.find((item) => item.datasetId === requestedDataset.datasetId);
      const targetFields = bound.schemas.get(requestedDataset.datasetId);
      const automaticSourceFields = dataset?.mappings.filter((item) => item.status === 'AUTOMATIC').map((item) => item.sourceField).sort();
      if (!dataset || !sourceDataset || !targetFields || !equal(automaticSourceFields, [...requestedDataset.fields].sort()) || requestedDataset.recordLimit !== dataset.recordCount) return rollbackAll('authorised-dataset-scope-no-longer-matches-plan');
      let read;
      try {
        read = await trusted.read.call(adapter, { tenantRef: importPlan.tenantRef, sourceId: request.sourceId, datasetId: dataset.datasetId, approvedFields: clone(requestedDataset.fields), approvedSiteIds: clone(sourcePlan.siteIds), recordLimit: requestedDataset.recordLimit, sourceSchemaDigest: dataset.sourceSchemaDigest, authorisationId: customerAuthorisationReceipt.authorisationId, executionId, fencingToken });
      } catch {}
      if (!read) return rollbackAll('source-read-unavailable');
      if (Array.isArray(read.rows)) rowsRead += read.rows.length;
      if (isDigest(read.sourceStateBeforeDigest) && isDigest(read.sourceStateAfterDigest) && read.sourceStateBeforeDigest !== read.sourceStateAfterDigest) return rollbackAll('source-mutation-detected', { forceReset: true, sourceMutationPerformed: true, sourceIntegrityStatus: 'mutation-detected' });
      if (read.sourceWritePerformed === true || read.productionDataMutated === true || read.payrollDataRead === true || read.identityAuthorityDataRead === true || read.secretMaterialRead === true) return rollbackAll('unsafe-source-read-observation', { forceReset: true, sourceMutationPerformed: read.sourceWritePerformed === true ? true : null, sourceIntegrityStatus: read.sourceWritePerformed === true ? 'mutation-detected' : 'unsafe-or-unknown', productionMutationPerformed: read.productionDataMutated === true ? true : null, payrollDataRead: read.payrollDataRead === true, identityAuthorityDataRead: read.identityAuthorityDataRead === true, secretMaterialRead: read.secretMaterialRead === true });
      const afterReadGuard = guardReason();
      if (afterReadGuard) return rollbackAll(afterReadGuard);
      const readSafe = read.accepted === true && read.tenantRef === importPlan.tenantRef && read.sourceId === request.sourceId && read.datasetId === dataset.datasetId && read.sourceReadOnly === true && read.sourceWritePerformed === false && read.productionDataMutated === false && read.payrollDataRead === false && read.identityAuthorityDataRead === false && read.secretMaterialRead === false && read.endpointAllowlisted === true && read.deterministicOrder === true && read.sourceSchemaDigest === dataset.sourceSchemaDigest && equal(read.projectedFields, [...requestedDataset.fields].sort()) && isDigest(read.sourceStateBeforeDigest) && read.sourceStateBeforeDigest === read.sourceStateAfterDigest && read.sourceDataClass === sourceDataClass && Array.isArray(read.rows) && read.recordCount === read.rows.length && read.recordCount <= requestedDataset.recordLimit;
      if (!readSafe) return rollbackAll('unsafe-or-unbound-source-read', { forceReset: true, sourceIntegrityStatus: 'unsafe-or-unknown' });
      const mapped = validateAndMapRows(read.rows, dataset, sourceDataset, targetFields, requestedDataset.fields, sourcePlan.siteIds);
      if (!mapped.ok) return rollbackAll(mapped.reason);
      rowsValidated += mapped.rows.length;
      unchanged += 1;
      let snapshot;
      try { snapshot = await trusted.snapshot.call(adapter, { tenantRef: importPlan.tenantRef, sourceId: request.sourceId, datasetId: dataset.datasetId, stagingEnvironmentRef: request.stagingEnvironmentRef, executionId, fencingToken }); } catch {}
      const afterSnapshotGuard = guardReason();
      if (afterSnapshotGuard) return rollbackAll(afterSnapshotGuard);
      if (!isDigest(snapshot)) return rollbackAll('staging-snapshot-unavailable');
      const targetFieldNames = dataset.mappings.filter((item) => item.status === 'AUTOMATIC').map((item) => item.targetField).sort();
      const expectedContentDigest = digest({ datasetId: dataset.datasetId, targetSchemaDigest: dataset.targetSchemaDigest, rows: mapped.rows });
      let written;
      try {
        written = await trusted.write.call(adapter, { tenantRef: importPlan.tenantRef, sourceId: request.sourceId, datasetId: dataset.datasetId, stagingEnvironmentRef: request.stagingEnvironmentRef, rows: mapped.rows, targetFields: targetFieldNames, targetSchemaDigest: dataset.targetSchemaDigest, expectedContentDigest, idempotencyKey: digest({ executionId, datasetId: dataset.datasetId }), beforeStateDigest: snapshot, executionId, fencingToken });
      } catch {}
      attempted += 1;
      touched.push({ tenantRef: importPlan.tenantRef, sourceId: request.sourceId, datasetId: dataset.datasetId, stagingEnvironmentRef: request.stagingEnvironmentRef, beforeStateDigest: snapshot });
      const afterWriteGuard = guardReason();
      if (afterWriteGuard) return rollbackAll(afterWriteGuard);
      const writeSafe = written && written.accepted === true && written.idempotent === true && written.fencingToken === fencingToken && written.tenantRef === importPlan.tenantRef && written.sourceId === request.sourceId && written.datasetId === dataset.datasetId && written.stagingEnvironmentRef === request.stagingEnvironmentRef && written.recordCount === mapped.rows.length && written.contentDigest === expectedContentDigest && written.stagingOnly === true && written.productionDataTouched === false && written.sourceDataTouched === false && written.payrollDataTouched === false && written.identityDataTouched === false && written.publicExposureCreated === false && written.newSpendIncurred === false && allFalse(written.mutationAuthority) && isDigest(written.afterStateDigest);
      if (!writeSafe) return rollbackAll('unsafe-or-unbound-staging-write', { forceReset: true, productionMutationPerformed: written?.productionDataTouched === true ? true : null, sourceMutationPerformed: written?.sourceDataTouched === true ? true : null, sourceIntegrityStatus: written?.sourceDataTouched === true ? 'mutation-detected' : 'unsafe-or-unknown', publicExposureCreated: written?.publicExposureCreated === true });
      rowsStaged += mapped.rows.length;
      let checked;
      try {
        checked = await trusted.verify.call(adapter, { tenantRef: importPlan.tenantRef, sourceId: request.sourceId, datasetId: dataset.datasetId, stagingEnvironmentRef: request.stagingEnvironmentRef, expectedRecordCount: mapped.rows.length, expectedTargetFields: targetFieldNames, expectedContentDigest, expectedStateDigest: written.afterStateDigest, expectedValidationChecks: clone(dataset.validationChecks), sourceStateDigest: read.sourceStateBeforeDigest, executionId, fencingToken });
      } catch {}
      const afterVerifyGuard = guardReason();
      if (afterVerifyGuard) return rollbackAll(afterVerifyGuard);
      if (checked && (checked.productionDataTouched === true || checked.sourceUntouched === false || checked.payrollDataTouched === true || checked.identityDataTouched === true || checked.publicExposureCreated === true)) return rollbackAll('unsafe-independent-verification-observation', { forceReset: true, productionMutationPerformed: checked.productionDataTouched === true ? true : null, sourceMutationPerformed: null, sourceIntegrityStatus: 'unsafe-or-unknown', publicExposureCreated: checked.publicExposureCreated === true });
      const checkSafe = checked && checked.verified === true && checked.independent === true && checked.fencingToken === fencingToken && checked.tenantRef === importPlan.tenantRef && checked.sourceId === request.sourceId && checked.datasetId === dataset.datasetId && checked.stagingEnvironmentRef === request.stagingEnvironmentRef && checked.recordCount === mapped.rows.length && checked.validationChecksPassed === dataset.validationChecks.length && checked.contentDigest === expectedContentDigest && checked.observedStateDigest === written.afterStateDigest && checked.sourceUntouched === true && checked.sourceStateDigest === read.sourceStateBeforeDigest && checked.productionDataTouched === false && checked.payrollDataTouched === false && checked.identityDataTouched === false && checked.publicExposureCreated === false;
      if (!checkSafe) return rollbackAll('independent-staging-verification-failed');
      verified += 1;
      receipts.push({ sourceId: request.sourceId, datasetId: dataset.datasetId, status: 'staging-import-verified', recordCount: mapped.rows.length, sourceSchemaDigest: dataset.sourceSchemaDigest, targetSchemaDigest: dataset.targetSchemaDigest, sourceStateDigest: read.sourceStateBeforeDigest, stagingStateDigest: written.afterStateDigest, contentDigest: expectedContentDigest, validationChecksPassed: checked.validationChecksPassed, sourceUntouched: true, productionUntouched: true });
    }
    let completed;
    const beforeCompleteGuard = guardReason();
    if (beforeCompleteGuard) return rollbackAll(beforeCompleteGuard);
    try { completed = await trusted.complete.call(adapter, { executionId, authorisationId: customerAuthorisationReceipt.authorisationId, fencingToken, status: 'staging-import-verified', receiptDigest: digest(receipts) }); } catch {}
    const afterCompleteGuard = guardReason();
    if (afterCompleteGuard) return rollbackAll(afterCompleteGuard);
    if (!completed || completed.completed !== true || completed.executionId !== executionId || completed.fencingToken !== fencingToken) return rollbackAll('durable-authorisation-completion-failed');
    const realCustomer = sourceDataClass === 'authorised-customer-workforce';
    return finish({ ...base, datasetsAttempted: attempted, datasetsVerified: verified, rowsRead, rowsValidated, rowsStaged, sourceDatasetsProvenUnchanged: unchanged, automaticRollbacksVerified: rollbacks, datasetReceipts: receipts, customerDataReadPerformed: realCustomer && rowsRead > 0, realCustomerStagingImportExecuted: realCustomer && verified > 0, modeledManualStagingStepsRemoved: verified * 2, remainingCustomerApprovalDecisions: Math.max(0, readinessReceipt.authorisationRequests.length - 1) }, { status: 'staging-import-verified', reason: null, retryable: false, sourceMutationPerformed: false, sourceIntegrityStatus: 'proven-unchanged', productionMutationPerformed: false });
  }
  return Object.freeze({ execute });
}

module.exports = { VERSION, SCOPE, digest, requestDigest, createAuthorisedStagingImportExecutor, verifyAuthorisedStagingExecutionReceipt };
