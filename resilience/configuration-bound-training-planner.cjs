'use strict';

const { createHash } = require('node:crypto');

const TRAINING_PLAN_VERSION = '1.0.0';
const TRUSTED_GAP_SOURCES = new Set(['training-runtime', 'deterministic-assessment', 'product-telemetry']);
const GAP_RULES = Object.freeze({
  COMPREHENSION_FAILED: 'training-profile-guided',
  LANGUAGE_UNSUPPORTED: 'product-localisation-gap',
  DEVICE_MISMATCH: 'implementation-device-profile',
  WORKFLOW_MISMATCH: 'implementation-workflow-discovery',
  POLICY_CONTEXT_MISSING: 'policy-evidence-refresh',
  REPEATED_SUPPORT_AFTER_TRAINING: 'product-ux-simplification-candidate',
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function isDigest(value) { return /^[a-f0-9]{64}$/.test(String(value || '')); }
function validRef(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

function validSelfSealedReceipt(value, digestField) {
  if (!value || typeof value !== 'object' || !isDigest(value[digestField])) return false;
  const core = clone(value); delete core[digestField];
  return digest(core) === value[digestField];
}

function assertPlanningInputs(rolloutReceipt, environmentSnapshot) {
  if (!validSelfSealedReceipt(rolloutReceipt, 'receiptDigest')) fail('WFM_TRAINING_ROLLOUT', 'self-sealed rollout receipt required');
  if (!validSelfSealedReceipt(environmentSnapshot, 'snapshotDigest')) fail('WFM_TRAINING_ENVIRONMENT', 'self-sealed environment snapshot required');
  if (!validRef(rolloutReceipt.tenantRef) || rolloutReceipt.tenantRef !== environmentSnapshot.tenantRef) fail('WFM_TRAINING_TENANT', 'training inputs must bind to the same tenant');
  if (!rolloutReceipt.authority || Object.values(rolloutReceipt.authority).some((value) => value !== false)) fail('WFM_TRAINING_ROLLOUT_AUTHORITY', 'rollout receipt must not carry execution authority');
  if (!environmentSnapshot.authority || Object.values(environmentSnapshot.authority).some((value) => value !== false)) fail('WFM_TRAINING_ENVIRONMENT_AUTHORITY', 'environment snapshot must not carry execution authority');
  if (!Array.isArray(rolloutReceipt.trainingAssignments) || !Array.isArray(rolloutReceipt.sitePlans)) fail('WFM_TRAINING_ROLLOUT', 'rollout training assignments and site plans required');
  if (!Array.isArray(environmentSnapshot.records) || !Array.isArray(environmentSnapshot.missingCriticalKinds) || !Array.isArray(environmentSnapshot.missingCriticalSubjects) || !Array.isArray(environmentSnapshot.conflicts)) fail('WFM_TRAINING_ENVIRONMENT', 'environment evidence collections required');
}

function topicSet(role) {
  const r = String(role || '').toLowerCase();
  if (/(payroll|finance)/.test(r)) return ['role-navigation', 'payroll-readiness', 'exception-review'];
  if (/(ops|operations)/.test(r)) return ['role-navigation', 'multi-site-risk', 'cost-and-production-context'];
  if (/(manager|supervisor|team-lead)/.test(r)) return ['role-navigation', 'team-exceptions', 'weekly-signoff'];
  if (/(admin|implementation)/.test(r)) return ['role-navigation', 'configuration-boundaries', 'support-and-recovery'];
  if (/(employee|worker|operator)/.test(r)) return ['role-navigation', 'attendance-and-time', 'leave-and-schedule'];
  return ['role-navigation', 'configured-workflows'];
}

function deliveryShape(profile, device) {
  const guided = profile === 'low-digital-confidence' || profile === 'guided';
  const shared = device === 'shared-terminal';
  return {
    mode: guided ? 'guided-step-by-step' : shared ? 'shared-device-short-session' : 'self-paced-configured-environment',
    maxActionsPerCheckpoint: guided ? 3 : 7,
    requiresLocalChampion: false,
    deviceAdaptation: device,
    comprehensionCheckRequired: true,
  };
}

function environmentBinding(environmentSnapshot) {
  const relevantKinds = new Set(['role', 'workflow', 'policy', 'feature', 'local-setting']);
  const evidence = environmentSnapshot.records
    .filter((record) => relevantKinds.has(record.kind) && record.freshness === 'FRESH')
    .map((record) => ({ kind: record.kind, subjectRef: record.subjectRef, payloadDigest: record.payloadDigest, evidenceDigest: record.evidenceDigest }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.subjectRef.localeCompare(b.subjectRef));
  return { snapshotDigest: environmentSnapshot.snapshotDigest, evidence, bindingDigest: digest({ snapshotDigest: environmentSnapshot.snapshotDigest, evidence }) };
}

function normalizeGapEvidence({ tenantRef, modules, trainingGapEvidence }) {
  const moduleDigests = new Set(modules.map((module) => module.moduleDigest));
  const accepted = []; let ignored = 0;
  for (const item of Array.isArray(trainingGapEvidence) ? trainingGapEvidence : []) {
    if (!item || typeof item !== 'object') { ignored++; continue; }
    if (item.tenantRef !== tenantRef) fail('WFM_TRAINING_TENANT', 'cross-tenant training gap evidence denied');
    if (item.verified !== true || !TRUSTED_GAP_SOURCES.has(item.source) || !isDigest(item.evidenceDigest) || !moduleDigests.has(item.moduleDigest) || !(item.gapCode in GAP_RULES)) { ignored++; continue; }
    accepted.push({ moduleDigest: item.moduleDigest, gapCode: item.gapCode, source: item.source, evidenceDigest: item.evidenceDigest });
  }
  accepted.sort((a, b) => a.moduleDigest.localeCompare(b.moduleDigest) || a.gapCode.localeCompare(b.gapCode) || a.evidenceDigest.localeCompare(b.evidenceDigest));
  return { accepted, ignored };
}

function buildModules(rolloutReceipt, environmentSnapshot) {
  const siteById = new Map(rolloutReceipt.sitePlans.map((site) => [site.siteId, site]));
  const binding = environmentBinding(environmentSnapshot);
  const evidenceReady = environmentSnapshot.supportDisposition === 'HEALTHY_EVIDENCE_READY'
    && environmentSnapshot.missingCriticalKinds.length === 0
    && environmentSnapshot.missingCriticalSubjects.length === 0
    && environmentSnapshot.conflicts.length === 0
    && binding.evidence.some((x) => x.kind === 'role')
    && binding.evidence.some((x) => x.kind === 'workflow')
    && binding.evidence.some((x) => x.kind === 'feature');
  const modules = rolloutReceipt.trainingAssignments.map((assignment, index) => {
    const site = siteById.get(assignment.siteId);
    if (!site) fail('WFM_TRAINING_SITE', `assignment ${index} references unknown site`);
    if (assignment.generatedFromTemplateDigest !== site.templateDigest) fail('WFM_TRAINING_TEMPLATE_DRIFT', `assignment ${index} is not bound to current site template`);
    const topics = topicSet(assignment.role);
    const delivery = deliveryShape(assignment.profile, assignment.device);
    const localPolicyEvidenceDigest = site.overlay?.policyPackRef?.evidenceDigest || null;
    const core = {
      tenantRef: rolloutReceipt.tenantRef,
      siteId: assignment.siteId,
      role: assignment.role,
      language: assignment.language,
      device: assignment.device,
      profile: assignment.profile,
      siteTemplateDigest: site.templateDigest,
      environmentBindingDigest: binding.bindingDigest,
      localPolicyEvidenceDigest,
      topics,
      delivery,
      configurationBound: true,
      legalCoverageClaim: false,
      translationLegalValidationClaim: false,
      deliveryReady: evidenceReady && site.blocked !== true,
      blockedReason: site.blocked === true ? 'rollout-site-blocked' : evidenceReady ? null : 'environment-evidence-not-ready',
    };
    return { ...core, moduleDigest: digest(core) };
  });
  return { modules, binding, evidenceReady };
}

function compileConfigurationBoundTrainingPlan({ rolloutReceipt, environmentSnapshot, trainingGapEvidence = [] } = {}) {
  assertPlanningInputs(rolloutReceipt, environmentSnapshot);
  const { modules, binding, evidenceReady } = buildModules(rolloutReceipt, environmentSnapshot);
  const gaps = normalizeGapEvidence({ tenantRef: rolloutReceipt.tenantRef, modules, trainingGapEvidence });
  const feedbackRules = [...new Set(gaps.accepted.map((gap) => GAP_RULES[gap.gapCode]))].sort();
  const uniqueVariants = new Set(modules.map((module) => digest({ role: module.role, language: module.language, device: module.device, profile: module.profile, topics: module.topics }))).size;
  const blockedModules = modules.filter((module) => module.deliveryReady !== true).length;
  const championSuggestedSites = rolloutReceipt.topology?.sites > 10
    ? [...new Set(modules.filter((module) => /(admin|manager|ops)/i.test(module.role)).map((module) => module.siteId))].sort()
    : [];
  const core = {
    schemaVersion: 1,
    trainingPlanVersion: TRAINING_PLAN_VERSION,
    tenantRef: rolloutReceipt.tenantRef,
    rolloutReceiptDigest: rolloutReceipt.receiptDigest,
    environmentSnapshotDigest: environmentSnapshot.snapshotDigest,
    environmentBinding: binding,
    status: blockedModules === 0 && evidenceReady ? 'TRAINING_MANIFEST_READY' : 'TRAINING_MANIFEST_BLOCKED',
    modules,
    acceptedGapEvidence: gaps.accepted,
    feedbackRules,
    championModel: { required: false, optionalSuggestedSiteIds: championSuggestedSites },
    metrics: {
      trainingAssignments: rolloutReceipt.trainingAssignments.length,
      modulesGenerated: modules.length,
      uniqueTrainingVariants: uniqueVariants,
      manualTrainingAssignmentStepsRemoved: modules.length,
      trainingQuestionsAdded: 0,
      blockedModules,
      trustedTrainingGapsAccepted: gaps.accepted.length,
      trainingGapEvidenceIgnored: gaps.ignored,
      feedbackRulesGenerated: feedbackRules.length,
      localChampionRequiredCount: 0,
    },
    guardrails: {
      legalCoverageClaim: false,
      modelGeneratedAuthority: false,
      customerContactPerformed: false,
      trainingCompletionClaim: false,
      productionWriteAuthorised: false,
      userIdentityMutationAuthorised: false,
      policyValuesInvented: false,
    },
    authority: {
      trainingDeliveryAuthorityGranted: false,
      environmentProvisioningAuthorityGranted: false,
      integrationWriteAuthorityGranted: false,
      customerMutation: false,
      payrollMutation: false,
      identityMutation: false,
      productionMutation: false,
      modelAuthorityGranted: false,
      executionAuthorityGranted: false,
      releaseAuthorityGranted: false,
    },
  };
  return { ...core, receiptDigest: digest(core) };
}

function verifyConfigurationBoundTrainingPlan(receipt, { rolloutReceipt, environmentSnapshot } = {}) {
  try { assertPlanningInputs(rolloutReceipt, environmentSnapshot); } catch { return false; }
  if (!receipt || receipt.schemaVersion !== 1 || receipt.trainingPlanVersion !== TRAINING_PLAN_VERSION || !isDigest(receipt.receiptDigest)) return false;
  if (receipt.tenantRef !== rolloutReceipt.tenantRef || receipt.rolloutReceiptDigest !== rolloutReceipt.receiptDigest || receipt.environmentSnapshotDigest !== environmentSnapshot.snapshotDigest) return false;
  if (!receipt.authority || Object.values(receipt.authority).some((value) => value !== false)) return false;
  if (!receipt.guardrails || Object.values(receipt.guardrails).some((value) => value !== false)) return false;
  const rebuilt = buildModules(rolloutReceipt, environmentSnapshot);
  if (JSON.stringify(receipt.environmentBinding) !== JSON.stringify(rebuilt.binding) || JSON.stringify(receipt.modules) !== JSON.stringify(rebuilt.modules)) return false;
  const moduleDigests = new Set(rebuilt.modules.map((module) => module.moduleDigest));
  if (!Array.isArray(receipt.acceptedGapEvidence) || receipt.acceptedGapEvidence.some((gap) => !moduleDigests.has(gap.moduleDigest) || !(gap.gapCode in GAP_RULES) || !TRUSTED_GAP_SOURCES.has(gap.source) || !isDigest(gap.evidenceDigest))) return false;
  const expectedRules = [...new Set(receipt.acceptedGapEvidence.map((gap) => GAP_RULES[gap.gapCode]))].sort();
  if (JSON.stringify(receipt.feedbackRules) !== JSON.stringify(expectedRules)) return false;
  const blockedModules = rebuilt.modules.filter((module) => module.deliveryReady !== true).length;
  const expectedStatus = blockedModules === 0 && rebuilt.evidenceReady ? 'TRAINING_MANIFEST_READY' : 'TRAINING_MANIFEST_BLOCKED';
  if (receipt.status !== expectedStatus || receipt.metrics?.trainingAssignments !== rolloutReceipt.trainingAssignments.length || receipt.metrics?.modulesGenerated !== rebuilt.modules.length || receipt.metrics?.manualTrainingAssignmentStepsRemoved !== rebuilt.modules.length || receipt.metrics?.trainingQuestionsAdded !== 0 || receipt.metrics?.blockedModules !== blockedModules || receipt.metrics?.trustedTrainingGapsAccepted !== receipt.acceptedGapEvidence.length || receipt.metrics?.feedbackRulesGenerated !== expectedRules.length || receipt.metrics?.localChampionRequiredCount !== 0) return false;
  if (receipt.championModel?.required !== false) return false;
  const core = clone(receipt); delete core.receiptDigest;
  return digest(core) === receipt.receiptDigest;
}

module.exports = { TRAINING_PLAN_VERSION, GAP_RULES, compileConfigurationBoundTrainingPlan, verifyConfigurationBoundTrainingPlan, digest };
