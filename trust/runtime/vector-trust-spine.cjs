'use strict';

const { createHash, randomUUID } = require('node:crypto');

const EPISTEMIC_TYPES = new Set([
  'OBSERVED_FACT',
  'CUSTOMER_ASSERTION',
  'DERIVED_FACT',
  'INFERENCE',
  'PREDICTION',
  'RECOMMENDATION',
]);

const RISK_ORDER = Object.freeze({
  READ_ONLY: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
}

function clean(value, max = 240) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function validDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function toIso(value, name) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) throw new Error(name + ' must be a valid ISO timestamp.');
  return new Date(ms).toISOString();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deny(code, message, detail = null) {
  const error = new Error(message);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

class EvidenceLedger {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.records = [];
    this.byId = new Map();
    this.headDigest = digest({ contract: 'VECTOR_EVIDENCE_LEDGER_V1', genesis: true });
  }

  append(input = {}) {
    const tenant = clean(input.tenant, 120);
    const subjectId = clean(input.subjectId, 180);
    const claimKey = clean(input.claimKey, 180);
    const sourceSystem = clean(input.sourceSystem, 180);
    const sourceIdentity = clean(input.sourceIdentity || sourceSystem, 180);
    const epistemicType = clean(input.epistemicType, 40).toUpperCase();
    if (!tenant || !subjectId || !claimKey || !sourceSystem) {
      deny('VECTOR_EVIDENCE_INPUT', 'tenant, subjectId, claimKey and sourceSystem are required.');
    }
    if (!EPISTEMIC_TYPES.has(epistemicType)) {
      deny('VECTOR_EVIDENCE_TYPE', 'Unsupported epistemic type.');
    }

    const observedAt = toIso(input.observedAt || new Date(this.now()).toISOString(), 'observedAt');
    const effectiveAt = toIso(input.effectiveAt || observedAt, 'effectiveAt');
    const expiresAt = input.expiresAt ? toIso(input.expiresAt, 'expiresAt') : null;
    const sourceTrust = Number(input.sourceTrust ?? 1);
    const confidence = Number(input.confidence ?? (epistemicType === 'OBSERVED_FACT' ? 1 : 0.5));
    if (!Number.isFinite(sourceTrust) || sourceTrust < 0 || sourceTrust > 1) {
      deny('VECTOR_EVIDENCE_TRUST', 'sourceTrust must be between 0 and 1.');
    }
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      deny('VECTOR_EVIDENCE_CONFIDENCE', 'confidence must be between 0 and 1.');
    }

    const id = clean(input.id || randomUUID(), 120);
    if (this.byId.has(id)) deny('VECTOR_EVIDENCE_DUPLICATE', 'Evidence id already exists.');

    const value = clone(input.value);
    const valueDigest = digest(value);
    const sameClaim = this.records.filter((row) =>
      row.tenant === tenant &&
      row.subjectId === subjectId &&
      row.claimKey === claimKey &&
      !this.records.some((candidate) => candidate.supersedes === row.id)
    );

    const contradictionRefs = sameClaim
      .filter((row) => row.valueDigest !== valueDigest && row.sourceTrust >= 0.7 && sourceTrust >= 0.7)
      .map((row) => row.id);

    const core = {
      contractVersion: 'VECTOR_EVIDENCE_LEDGER_V1',
      id,
      tenant,
      subjectId,
      claimKey,
      value,
      valueDigest,
      epistemicType,
      sourceSystem,
      sourceIdentity,
      schemaVersion: clean(input.schemaVersion || 'unknown', 80),
      observedAt,
      effectiveAt,
      ingestedAt: new Date(this.now()).toISOString(),
      expiresAt,
      sourceTrust,
      confidence,
      contradictionRefs,
      transformationRef: input.transformationRef ? clean(input.transformationRef, 180) : null,
      authorityRef: input.authorityRef ? clean(input.authorityRef, 180) : null,
      supersedes: input.supersedes ? clean(input.supersedes, 120) : null,
      previousDigest: this.headDigest,
    };
    const record = { ...core, recordDigest: digest(core) };
    this.records.push(record);
    this.byId.set(id, record);
    this.headDigest = record.recordDigest;

    if (record.supersedes) {
      const prior = this.byId.get(record.supersedes);
      if (!prior || prior.tenant !== tenant) deny('VECTOR_EVIDENCE_SUPERSEDE', 'Superseded evidence must exist in the same tenant.');
    }

    return clone(record);
  }

  get(id) {
    const row = this.byId.get(clean(id, 120));
    return row ? clone(row) : null;
  }

  verifyChain() {
    let previous = digest({ contract: 'VECTOR_EVIDENCE_LEDGER_V1', genesis: true });
    for (const row of this.records) {
      if (row.previousDigest !== previous) return false;
      const core = { ...row };
      delete core.recordDigest;
      if (digest(core) !== row.recordDigest) return false;
      previous = row.recordDigest;
    }
    return previous === this.headDigest;
  }

  assess(refs = [], { tenant, now = this.now(), maxAgeMs = null } = {}) {
    const ids = [...new Set(refs.map((value) => clean(value, 120)).filter(Boolean))];
    const missing = [];
    const stale = [];
    const contradicted = [];
    const wrongTenant = [];
    const records = [];

    for (const id of ids) {
      const row = this.byId.get(id);
      if (!row) {
        missing.push(id);
        continue;
      }
      if (tenant && row.tenant !== tenant) {
        wrongTenant.push(id);
        continue;
      }
      records.push(row);
      const observedMs = Date.parse(row.observedAt);
      const expiresMs = row.expiresAt ? Date.parse(row.expiresAt) : null;
      if ((expiresMs && now > expiresMs) || (Number.isFinite(maxAgeMs) && maxAgeMs >= 0 && now - observedMs > maxAgeMs)) stale.push(id);
      if (row.contradictionRefs.length) contradicted.push(id);
    }

    const trustFloor = records.length ? Math.min(...records.map((row) => row.sourceTrust)) : 0;
    const confidenceFloor = records.length ? Math.min(...records.map((row) => row.confidence)) : 0;
    const complete = ids.length > 0 && !missing.length && !wrongTenant.length;
    const safe = complete && !stale.length && !contradicted.length;

    return Object.freeze({
      contractVersion: 'VECTOR_EVIDENCE_ASSESSMENT_V1',
      tenant: tenant || null,
      refs: ids,
      complete,
      safe,
      missing,
      stale,
      contradicted,
      wrongTenant,
      trustFloor,
      confidenceFloor,
      assessmentDigest: digest({ tenant: tenant || null, ids, missing, stale, contradicted, wrongTenant, trustFloor, confidenceFloor }),
    });
  }
}

class CustomerGuardian {
  constructor({ invariants = [] } = {}) {
    this.invariants = [...invariants];
  }

  evaluate(action = {}, context = {}) {
    const violations = [];
    if (!action.tenant || !action.targetTenant || action.tenant !== action.targetTenant) {
      violations.push({ code: 'TENANT_BOUNDARY', message: 'Action crosses or lacks an explicit tenant boundary.' });
    }
    if (context.safetyInterlockBlocked === true && action.domain === 'production') {
      violations.push({ code: 'SAFETY_INTERLOCK', message: 'Production action conflicts with a safety interlock.' });
    }
    if (action.actionType === 'payroll.release' && Number(context.highSeverityPayIntegrityExceptions || 0) > 0) {
      violations.push({ code: 'PAYROLL_INTEGRITY', message: 'Payroll cannot release while high-severity pay-integrity exceptions remain.' });
    }
    if (action.actionType === 'workforce.redeploy' && context.requiredCompetenceValid !== true) {
      violations.push({ code: 'COMPETENCE_REQUIRED', message: 'Worker redeployment requires current required competence.' });
    }
    if (context.telemetryBlind === true && RISK_ORDER[action.riskClass] > RISK_ORDER.LOW) {
      violations.push({ code: 'TELEMETRY_BLIND', message: 'Consequential action is prohibited while critical telemetry is unavailable.' });
    }
    for (const invariant of this.invariants) {
      const result = invariant(clone(action), clone(context));
      if (result && result.allowed === false) {
        violations.push({ code: clean(result.code || 'CUSTOM_INVARIANT', 120), message: clean(result.message || 'Customer invariant rejected the action.', 300) });
      }
    }
    return Object.freeze({
      allowed: violations.length === 0,
      violations,
      guardianDigest: digest({ actionType: action.actionType || null, tenant: action.tenant || null, violations }),
    });
  }
}

class AuthorityKernel {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.grants = new Map();
  }

  issueGrant(input = {}) {
    const grantId = clean(input.grantId || randomUUID(), 120);
    const issuer = clean(input.issuer, 160);
    const actor = clean(input.actor, 160);
    const tenant = clean(input.tenant, 120);
    const resource = clean(input.resource, 200);
    const actionTypes = [...new Set((input.actionTypes || []).map((value) => clean(value, 180)).filter(Boolean))];
    const riskCeiling = clean(input.riskCeiling || 'READ_ONLY', 40).toUpperCase();
    const expiresAt = toIso(input.expiresAt, 'expiresAt');
    const maxBlastRadius = Number(input.maxBlastRadius ?? 1);

    if (!issuer || !actor || !tenant || !resource || !actionTypes.length) deny('VECTOR_AUTH_INPUT', 'issuer, actor, tenant, resource and actionTypes are required.');
    if (issuer === actor) deny('VECTOR_AUTH_SELF_GRANT', 'Actors cannot grant authority to themselves.');
    if (!(riskCeiling in RISK_ORDER)) deny('VECTOR_AUTH_RISK', 'Unknown risk ceiling.');
    if (!Number.isSafeInteger(maxBlastRadius) || maxBlastRadius < 0) deny('VECTOR_AUTH_BLAST', 'maxBlastRadius must be a non-negative integer.');
    if (Date.parse(expiresAt) <= this.now()) deny('VECTOR_AUTH_EXPIRED', 'Authority grant must expire in the future.');
    if (input.issuerAuthorityVerified !== true) deny('VECTOR_AUTH_ISSUER', 'Grant issuer authority must be independently verified.');

    const core = {
      contractVersion: 'VECTOR_AUTHORITY_GRANT_V1',
      grantId,
      issuer,
      actor,
      tenant,
      resource,
      actionTypes,
      riskCeiling,
      maxBlastRadius,
      evidencePrerequisites: [...new Set((input.evidencePrerequisites || []).map((value) => clean(value, 120)).filter(Boolean))],
      requiresIndependentVerification: input.requiresIndependentVerification !== false,
      customerApprovalRef: input.customerApprovalRef ? clean(input.customerApprovalRef, 180) : null,
      issuedAt: new Date(this.now()).toISOString(),
      expiresAt,
      mayDelegate: false,
      mayExpandAuthority: false,
    };
    const grant = { ...core, grantDigest: digest(core) };
    this.grants.set(grantId, grant);
    return clone(grant);
  }

  evaluate({ grantId, actor, action, evidenceAssessment } = {}) {
    const grant = this.grants.get(clean(grantId, 120));
    const reasons = [];
    if (!grant) reasons.push('GRANT_NOT_FOUND');
    if (grant) {
      if (grant.actor !== clean(actor, 160)) reasons.push('ACTOR_MISMATCH');
      if (Date.parse(grant.expiresAt) <= this.now()) reasons.push('GRANT_EXPIRED');
      if (grant.tenant !== action?.tenant || action?.tenant !== action?.targetTenant) reasons.push('TENANT_MISMATCH');
      if (grant.resource !== action?.resource) reasons.push('RESOURCE_MISMATCH');
      if (!grant.actionTypes.includes(action?.actionType)) reasons.push('ACTION_NOT_GRANTED');
      if (!(action?.riskClass in RISK_ORDER) || RISK_ORDER[action.riskClass] > RISK_ORDER[grant.riskCeiling]) reasons.push('RISK_EXCEEDS_GRANT');
      if (!Number.isSafeInteger(action?.blastRadius) || action.blastRadius > grant.maxBlastRadius) reasons.push('BLAST_RADIUS_EXCEEDED');
      if (grant.evidencePrerequisites.length) {
        const refs = new Set(evidenceAssessment?.refs || []);
        if (grant.evidencePrerequisites.some((ref) => !refs.has(ref))) reasons.push('EVIDENCE_PREREQUISITE_MISSING');
      }
      if (evidenceAssessment?.safe !== true && RISK_ORDER[action?.riskClass] > RISK_ORDER.READ_ONLY) reasons.push('EVIDENCE_NOT_SAFE');
    }
    return Object.freeze({
      allowed: Boolean(grant) && reasons.length === 0,
      reasons,
      grant: grant ? clone(grant) : null,
      authorityDigest: digest({ grantId: grant?.grantId || null, actor: clean(actor, 160), actionType: action?.actionType || null, reasons }),
    });
  }
}

class UnknownsEngine {
  assess(input = {}) {
    const reasons = [];
    if (input.certifiedPlaybookMatch !== true) reasons.push('NO_CERTIFIED_PLAYBOOK');
    if (input.evidenceAssessment?.safe !== true) reasons.push('EVIDENCE_UNSAFE_OR_INCOMPLETE');
    if ((input.evidenceAssessment?.contradicted || []).length) reasons.push('CONTRADICTORY_EVIDENCE');
    if (input.telemetryBlind === true) reasons.push('TELEMETRY_BLIND');
    if (input.modelDisagreement === true) reasons.push('MODEL_DISAGREEMENT');
    if (input.blastRadiusKnown === false) reasons.push('UNBOUNDED_BLAST_RADIUS');
    if (input.novelDownstreamResponse === true) reasons.push('NOVEL_DOWNSTREAM_RESPONSE');
    if (input.customerCorrection === true) reasons.push('CUSTOMER_CORRECTED_SYSTEM');
    const level = reasons.length === 0 ? 'KNOWN' : reasons.length <= 2 ? 'UNCERTAIN' : 'NOVEL_OR_COMPOUND';
    const autonomyCeiling = level === 'KNOWN' ? 'CERTIFIED_ACTIONS' : level === 'UNCERTAIN' ? 'SHADOW_OR_LOW_RISK' : 'CONTAINMENT_ONLY';
    return Object.freeze({
      level,
      reasons,
      autonomyCeiling,
      unknownsDigest: digest({ level, reasons, autonomyCeiling }),
    });
  }
}

class TypedActionGateway {
  constructor({ evidenceLedger, guardian, authorityKernel, unknownsEngine = new UnknownsEngine() } = {}) {
    if (!evidenceLedger || !guardian || !authorityKernel) throw new Error('TypedActionGateway requires evidenceLedger, guardian and authorityKernel.');
    this.evidenceLedger = evidenceLedger;
    this.guardian = guardian;
    this.authorityKernel = authorityKernel;
    this.unknownsEngine = unknownsEngine;
    this.registry = new Map();
    this.idempotency = new Map();
  }

  register(spec = {}) {
    const actionType = clean(spec.actionType, 180);
    if (!actionType) deny('VECTOR_ACTION_SPEC', 'actionType is required.');
    if (this.registry.has(actionType)) deny('VECTOR_ACTION_SPEC_DUPLICATE', 'Action type already registered.');
    if (!(clean(spec.riskClass, 40).toUpperCase() in RISK_ORDER)) deny('VECTOR_ACTION_SPEC_RISK', 'Action spec riskClass is invalid.');
    if (typeof spec.executor !== 'function' || typeof spec.verifier !== 'function') deny('VECTOR_ACTION_SPEC_HANDLER', 'Action spec requires executor and verifier.');
    if (spec.executorId && spec.verifierId && spec.executorId === spec.verifierId) deny('VECTOR_ACTION_SPEC_SEPARATION', 'Executor and verifier identities must differ.');
    this.registry.set(actionType, {
      actionType,
      domain: clean(spec.domain || 'general', 80),
      riskClass: clean(spec.riskClass, 40).toUpperCase(),
      maxBlastRadius: Number(spec.maxBlastRadius ?? 1),
      reversible: spec.reversible === true,
      executor: spec.executor,
      verifier: spec.verifier,
      rollback: typeof spec.rollback === 'function' ? spec.rollback : null,
      executorId: clean(spec.executorId || 'executor', 120),
      verifierId: clean(spec.verifierId || 'verifier', 120),
      maxEvidenceAgeMs: Number.isFinite(spec.maxEvidenceAgeMs) ? Number(spec.maxEvidenceAgeMs) : null,
    });
  }

  async execute(input = {}) {
    const actionType = clean(input.actionType, 180);
    const spec = this.registry.get(actionType);
    if (!spec) deny('VECTOR_ACTION_UNKNOWN', 'Action type is not registered.');

    const action = {
      contractVersion: 'VECTOR_TYPED_ACTION_V1',
      actionId: clean(input.actionId || randomUUID(), 120),
      actionType,
      domain: spec.domain,
      riskClass: spec.riskClass,
      tenant: clean(input.tenant, 120),
      targetTenant: clean(input.targetTenant || input.tenant, 120),
      resource: clean(input.resource, 200),
      blastRadius: Number(input.blastRadius ?? 1),
      evidenceRefs: [...new Set((input.evidenceRefs || []).map((value) => clean(value, 120)).filter(Boolean))],
      requestedChange: clone(input.requestedChange),
      idempotencyKey: clean(input.idempotencyKey, 180),
    };
    if (!action.tenant || !action.resource || !action.idempotencyKey) deny('VECTOR_ACTION_INPUT', 'tenant, resource and idempotencyKey are required.');
    if (!Number.isSafeInteger(action.blastRadius) || action.blastRadius < 0 || action.blastRadius > spec.maxBlastRadius) {
      deny('VECTOR_ACTION_BLAST', 'Action blast radius exceeds registered action limits.');
    }

    if (this.idempotency.has(action.idempotencyKey)) return clone(this.idempotency.get(action.idempotencyKey));

    const evidenceAssessment = this.evidenceLedger.assess(action.evidenceRefs, {
      tenant: action.tenant,
      maxAgeMs: spec.maxEvidenceAgeMs,
    });
    const unknowns = this.unknownsEngine.assess({
      certifiedPlaybookMatch: input.certifiedPlaybookMatch === true,
      evidenceAssessment,
      telemetryBlind: input.telemetryBlind === true,
      modelDisagreement: input.modelDisagreement === true,
      blastRadiusKnown: true,
      novelDownstreamResponse: false,
      customerCorrection: false,
    });
    if (unknowns.autonomyCeiling === 'CONTAINMENT_ONLY' && RISK_ORDER[action.riskClass] > RISK_ORDER.READ_ONLY) {
      deny('VECTOR_ACTION_UNKNOWNS', 'Unknowns Engine reduced autonomy to containment-only.', unknowns);
    }

    const guardian = this.guardian.evaluate(action, input.context || {});
    if (!guardian.allowed) deny('VECTOR_ACTION_GUARDIAN', 'Customer Guardian rejected the action.', guardian);

    const authority = this.authorityKernel.evaluate({
      grantId: input.grantId,
      actor: input.actor,
      action,
      evidenceAssessment,
    });
    if (!authority.allowed) deny('VECTOR_ACTION_AUTHORITY', 'Authority Kernel rejected the action.', authority);

    const executionRequest = {
      action,
      evidenceAssessment,
      authorityDigest: authority.authorityDigest,
      guardianDigest: guardian.guardianDigest,
      unknownsDigest: unknowns.unknownsDigest,
    };
    const beforeDigest = digest(executionRequest);
    const execution = await spec.executor(clone(executionRequest));
    if (!execution || execution.executorId !== spec.executorId) deny('VECTOR_ACTION_EXECUTOR', 'Executor identity mismatch.');
    const executionDigest = validDigest(execution.executionDigest) ? execution.executionDigest : digest(execution);

    const verification = await spec.verifier(clone({
      action,
      execution,
      executionDigest,
      evidenceAssessment,
    }));
    if (!verification || verification.verifierId !== spec.verifierId || spec.verifierId === spec.executorId) {
      deny('VECTOR_ACTION_VERIFIER', 'Independent verifier identity mismatch.');
    }
    if (verification.executionDigest && verification.executionDigest !== executionDigest) {
      deny('VECTOR_ACTION_VERIFY_BINDING', 'Verification is not bound to the exact execution.');
    }

    let rollback = null;
    if (verification.verified !== true) {
      if (spec.reversible && spec.rollback) {
        rollback = await spec.rollback(clone({ action, execution, verification, executionDigest }));
        if (rollback?.verified !== true) deny('VECTOR_ACTION_ROLLBACK', 'Rollback failed independent verification.');
      }
      deny('VECTOR_ACTION_POSTCONDITION', 'Action postconditions were not independently verified.', { verification, rollback });
    }

    const receiptCore = {
      contractVersion: 'VECTOR_TYPED_ACTION_RECEIPT_V1',
      action,
      beforeDigest,
      executionDigest,
      verificationDigest: validDigest(verification.verificationDigest) ? verification.verificationDigest : digest(verification),
      verifierId: spec.verifierId,
      executorId: spec.executorId,
      evidenceAssessmentDigest: evidenceAssessment.assessmentDigest,
      authorityDigest: authority.authorityDigest,
      guardianDigest: guardian.guardianDigest,
      unknownsDigest: unknowns.unknownsDigest,
      status: 'VERIFIED',
    };
    const receipt = { ...receiptCore, receiptDigest: digest(receiptCore) };
    this.idempotency.set(action.idempotencyKey, receipt);
    return clone(receipt);
  }
}

function createCausalEpisode(input = {}) {
  const tenant = clean(input.tenant, 120);
  const episodeId = clean(input.episodeId || randomUUID(), 120);
  const evidenceRefs = [...new Set((input.evidenceRefs || []).map((value) => clean(value, 120)).filter(Boolean))];
  const alternatives = Array.isArray(input.alternatives) ? clone(input.alternatives) : [];
  if (!tenant || !evidenceRefs.length || alternatives.length < 2) {
    deny('VECTOR_T9_EPISODE_INPUT', 'T9 causal episode requires tenant, evidence and at least two alternatives.');
  }
  const selectedActionId = clean(input.selectedActionId, 120) || null;
  const outcomeRefs = [...new Set((input.outcomeRefs || []).map((value) => clean(value, 120)).filter(Boolean))];
  const core = {
    contractVersion: 'VECTOR_T9_CAUSAL_EPISODE_V1',
    episodeId,
    tenant,
    observedAt: toIso(input.observedAt || new Date().toISOString(), 'observedAt'),
    contextRevision: clean(input.contextRevision || 'unknown', 180),
    evidenceRefs,
    alternatives,
    selectedActionId,
    prediction: clone(input.prediction || null),
    outcomeRefs,
    customerCorrection: input.customerCorrection ? clone(input.customerCorrection) : null,
    causalHypothesis: input.causalHypothesis ? clone(input.causalHypothesis) : null,
    counterfactualStatus: clean(input.counterfactualStatus || 'NOT_EVALUATED', 80),
    promotion: {
      mode: 'PROPOSAL_ONLY',
      mayGrantAuthority: false,
      maySelfPromote: false,
      requiresIndependentEvaluation: true,
    },
  };
  return Object.freeze({ ...core, episodeDigest: digest(core) });
}

module.exports = Object.freeze({
  EPISTEMIC_TYPES,
  RISK_ORDER,
  EvidenceLedger,
  CustomerGuardian,
  AuthorityKernel,
  UnknownsEngine,
  TypedActionGateway,
  createCausalEpisode,
  stable,
  digest,
});
