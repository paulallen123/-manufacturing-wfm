'use strict';

const { randomUUID } = require('node:crypto');
const { digest } = require('./vector-tool-foundry.cjs');

const SIGNALS = Object.freeze({
  REGRESSION: 'REGRESSION',
  REPEATED_VERIFIED_WIN: 'REPEATED_VERIFIED_WIN',
  REPEATED_MANUAL_WORK: 'REPEATED_MANUAL_WORK',
  COMPETITOR_GAP: 'COMPETITOR_GAP',
});

const ROUTES = Object.freeze({
  REGRESSION: 'PERSISTENT_EVAL_CANDIDATE',
  REPEATED_VERIFIED_WIN: 'VERSIONED_SKILL_OR_TOOL_CANDIDATE',
  REPEATED_MANUAL_WORK: 'AUTOMATION_OR_TOOL_CANDIDATE',
  COMPETITOR_GAP: 'GAP_EVAL_CANDIDATE',
});

const EVIDENCE_CLASSES = new Set(['SANITISED', 'DERIVED', 'SYNTHETIC']);

function clean(value, max = 320) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function exactCommit(value) {
  const commit = clean(value, 80);
  return /^[a-f0-9]{40}$/.test(commit) ? commit : null;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class VectorEngineeringLearningBridge {
  constructor({ foundry = null, now = Date.now } = {}) {
    this.foundry = foundry;
    this.now = now;
  }

  propose(input = {}) {
    const signal = clean(input.signal, 80).toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(SIGNALS, signal)) {
      fail('VECTOR_LEARNING_SIGNAL', 'Unsupported engineering learning signal.');
    }

    const evidenceClass = clean(input.evidenceClass || 'SANITISED', 40).toUpperCase();
    if (!EVIDENCE_CLASSES.has(evidenceClass)) {
      fail('VECTOR_LEARNING_EVIDENCE_CLASS', 'Engineering learning accepts only sanitised, derived or synthetic evidence.');
    }

    if (
      input.rawCustomerData === true ||
      input.rawSecret === true ||
      input.executionToken === true ||
      input.unsignedProductionAuthority === true
    ) {
      fail('VECTOR_LEARNING_BOUNDARY', 'Raw customer data, secrets, execution tokens and unsigned production authority are prohibited.');
    }

    const evidenceRefs = [...new Set(
      (Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [])
        .map((value) => clean(value, 180))
        .filter(Boolean)
    )];
    if (evidenceRefs.length === 0) {
      fail('VECTOR_LEARNING_EVIDENCE', 'At least one evidence reference is required.');
    }

    const confidence = Number(input.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      fail('VECTOR_LEARNING_CONFIDENCE', 'Confidence must be between 0 and 1.');
    }

    const patternCount = Number(input.patternCount ?? 1);
    if (!Number.isInteger(patternCount) || patternCount < 1) {
      fail('VECTOR_LEARNING_PATTERN_COUNT', 'Pattern count must be a positive integer.');
    }
    if (
      (signal === SIGNALS.REPEATED_VERIFIED_WIN || signal === SIGNALS.REPEATED_MANUAL_WORK) &&
      patternCount < 2
    ) {
      fail('VECTOR_LEARNING_REPEAT_REQUIRED', 'Repeated-win and repeated-manual-work candidates require at least two verified occurrences.');
    }

    const sourceRef = clean(input.sourceRef, 200);
    const sourceCommit = exactCommit(input.sourceCommit);
    if (!sourceRef && !sourceCommit) {
      fail('VECTOR_LEARNING_SOURCE', 'Learning candidates require source lineage.');
    }

    const core = {
      contractVersion: 'VECTOR_ENGINEERING_LEARNING_CANDIDATE_V1',
      candidateId: clean(input.candidateId || randomUUID(), 120),
      signal,
      route: ROUTES[signal],
      evidenceClass,
      evidenceRefs,
      evidenceDigests: evidenceRefs.map((ref) => digest(ref)),
      confidence,
      patternCount,
      summary: clean(input.summary, 500),
      sourceRef: sourceRef || null,
      sourceCommit,
      createdAt: new Date(this.now()).toISOString(),
      productFactory: {
        reviewRequired: true,
        holdoutEvaluationRequired: true,
        independentReleaseAuthorityRequired: true,
      },
      governance: {
        proposalOnly: true,
        mayExecute: false,
        mayMutateProduction: false,
        mayGrantAuthority: false,
        maySelfPromote: false,
        maySelfCertify: false,
        rawEvidenceStored: false,
      },
    };

    let toolRevisionProposal = null;
    if (input.toolRevision) {
      if (!this.foundry || typeof this.foundry.proposeToolRevision !== 'function') {
        fail('VECTOR_LEARNING_FOUNDRY', 'Tool revision candidates require a Tool Foundry instance.');
      }
      toolRevisionProposal = this.foundry.proposeToolRevision({
        toolId: input.toolRevision.toolId,
        fromVersion: input.toolRevision.fromVersion,
        proposedVersion: input.toolRevision.proposedVersion,
        reason: input.toolRevision.reason || core.summary || ('Learning candidate from ' + signal),
        changes: clone(input.toolRevision.changes || []),
        evidenceRefs,
      });
    }

    const candidate = {
      ...core,
      toolRevisionProposal,
    };
    return Object.freeze({
      ...candidate,
      candidateDigest: digest(candidate),
    });
  }

  verify(candidate = {}) {
    if (candidate.contractVersion !== 'VECTOR_ENGINEERING_LEARNING_CANDIDATE_V1') return false;
    if (!candidate.candidateDigest) return false;
    const core = clone(candidate);
    delete core.candidateDigest;
    return digest(core) === candidate.candidateDigest;
  }
}

module.exports = Object.freeze({
  SIGNALS,
  ROUTES,
  VectorEngineeringLearningBridge,
});
