'use strict';

const { createHash } = require('node:crypto');

const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const ACCEPTED_ENVELOPE_STATES = new Set([
  'LOGIC_ONLY_RELEASE_BLOCKED',
  'ELIGIBLE_EXACT_RELEASE_EVIDENCE',
]);

function sha256(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'utf8');
  return createHash('sha256').update(input).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function safeParse(raw, label) {
  try {
    return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw ?? ''));
  } catch {
    const error = new Error(`${label}-json-invalid`);
    error.code = 'WFM_PRIOR_CORPUS_INVALID_JSON';
    throw error;
  }
}

function tryParse(raw) {
  if (!(typeof raw === 'string' || Buffer.isBuffer(raw)) || raw.length === 0) return null;
  try {
    return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : raw);
  } catch {
    return null;
  }
}

function continuityDigest(continuity) {
  if (!continuity || typeof continuity !== 'object' || Array.isArray(continuity)) return null;
  const core = { ...continuity };
  delete core.continuityDigest;
  return sha256(JSON.stringify(core));
}

function normalizedCandidate(candidate) {
  return {
    runId: Number(candidate?.runId || 0),
    artifactId: Number(candidate?.artifactId || 0),
    headSha: String(candidate?.headSha || '').trim().toLowerCase(),
    createdAt: String(candidate?.createdAt || ''),
    artifactCreatedAt: String(candidate?.artifactCreatedAt || ''),
  };
}

function validMetadata(meta) {
  return Number.isSafeInteger(meta.runId) && meta.runId > 0
    && Number.isSafeInteger(meta.artifactId) && meta.artifactId > 0
    && HEX40.test(meta.headSha)
    && meta.createdAt.length > 0
    && meta.artifactCreatedAt.length > 0;
}

function signalsDurableHistory(candidate) {
  if (candidate?.durableHistoryHint === true) return true;
  if ((typeof candidate?.snapshotRaw === 'string' || Buffer.isBuffer(candidate?.snapshotRaw))
    && candidate.snapshotRaw.length > 0) return true;

  const portable = tryParse(candidate?.portableProofRaw);
  const corpus = portable?.incidentRegressionCorpus;
  if (corpus && (Number(corpus.entryCount) > 0
    || HEX64.test(String(corpus.corpusDigest || ''))
    || HEX64.test(String(corpus.snapshotSha256 || ''))
    || HEX64.test(String(corpus.continuityDigest || '')))) return true;

  const continuity = tryParse(candidate?.continuityRaw);
  if (continuity?.proof === 'provider-neutral-incident-regression-corpus-continuity'
    || HEX64.test(String(continuity?.continuityDigest || ''))
    || HEX64.test(String(continuity?.outputCorpusDigest || ''))
    || HEX64.test(String(continuity?.outputSnapshotSha256 || ''))) return true;

  const envelope = tryParse(candidate?.envelopeRaw);
  if (HEX64.test(String(envelope?.incidentRegressionCorpusDigest || ''))
    || HEX64.test(String(envelope?.incidentRegressionCorpusSnapshotSha256 || ''))
    || envelope?.incidentRegressionCorpusPriorSnapshotLoaded === true) return true;

  return false;
}

function verifyCandidateEvidence(candidate) {
  const meta = normalizedCandidate(candidate);
  if (!validMetadata(meta)) {
    return { ok: false, reason: 'candidate-metadata-invalid', meta };
  }
  if (candidate?.evidenceUnavailable === true) {
    return {
      ok: false,
      reason: String(candidate?.unavailableReason || 'candidate-evidence-unavailable'),
      meta,
      evidenceUnavailable: true,
    };
  }
  const requiredRaw = ['portableProofRaw', 'envelopeRaw', 'snapshotRaw', 'continuityRaw'];
  for (const key of requiredRaw) {
    if (!(typeof candidate?.[key] === 'string' || Buffer.isBuffer(candidate?.[key])) || candidate[key].length === 0) {
      return { ok: false, reason: `missing-required-evidence:${key}`, meta };
    }
  }

  try {
    const portableRaw = Buffer.isBuffer(candidate.portableProofRaw)
      ? candidate.portableProofRaw
      : Buffer.from(candidate.portableProofRaw, 'utf8');
    const snapshotRaw = Buffer.isBuffer(candidate.snapshotRaw)
      ? candidate.snapshotRaw
      : Buffer.from(candidate.snapshotRaw, 'utf8');
    const portable = safeParse(portableRaw, 'portable-proof');
    const envelope = safeParse(candidate.envelopeRaw, 'proof-envelope');
    const snapshot = safeParse(snapshotRaw, 'incident-corpus-snapshot');
    const continuity = safeParse(candidate.continuityRaw, 'incident-corpus-continuity');
    const corpus = portable?.incidentRegressionCorpus || {};
    const computedContinuityDigest = continuityDigest(continuity);

    const authoritySafe = continuity?.actionAuthorityGranted === false
      && continuity?.productionAuthorityGranted === false
      && continuity?.releaseAuthorityGranted === false
      && continuity?.crossTenantMutation === false
      && continuity?.productionMutation === false
      && continuity?.customerMutation === false;

    const checks = {
      portablePass: portable?.status === 'PASS',
      exactRuntime: portable?.exactRuntime === true,
      providerNeutral: portable?.providerNeutral === true,
      noProductionMutation: portable?.productionMutation === false,
      noCustomerMutation: portable?.customerMutation === false,
      envelopeStateAccepted: ACCEPTED_ENVELOPE_STATES.has(envelope?.finalEvidenceStatus),
      envelopeBindingMatches: envelope?.bindingMatches === true,
      envelopeHeadMatches: String(envelope?.workflowHeadSha || '').toLowerCase() === meta.headSha,
      envelopeBindsPortableBytes: envelope?.portableProofSha256 === sha256(portableRaw),
      envelopeBindsCorpusDigest: envelope?.incidentRegressionCorpusDigest === snapshot?.corpusDigest,
      envelopeBindsSnapshotBytes: envelope?.incidentRegressionCorpusSnapshotSha256 === sha256(snapshotRaw),
      portableBindsSnapshotBytes: corpus?.snapshotSha256 === sha256(snapshotRaw),
      corpusDigestMatchesSnapshot: HEX64.test(String(snapshot?.corpusDigest || ''))
        && corpus?.corpusDigest === snapshot?.corpusDigest,
      corpusEntryCountMatchesSnapshot: Number.isSafeInteger(snapshot?.entryCount)
        && corpus?.entryCount === snapshot?.entryCount,
      nonEmptySnapshot: Number.isSafeInteger(snapshot?.entryCount) && snapshot.entryCount > 0,
      continuityPass: continuity?.status === 'PASS',
      continuityProofIdentity: continuity?.proof === 'provider-neutral-incident-regression-corpus-continuity',
      continuityCorpusDigestMatches: continuity?.outputCorpusDigest === snapshot?.corpusDigest,
      continuitySnapshotShaMatches: continuity?.outputSnapshotSha256 === sha256(snapshotRaw),
      continuityDigestValid: HEX64.test(String(continuity?.continuityDigest || ''))
        && computedContinuityDigest === continuity?.continuityDigest,
      portableBindsContinuityDigest: HEX64.test(String(corpus?.continuityDigest || ''))
        && corpus?.continuityDigest === continuity?.continuityDigest,
      authoritySafe,
    };

    const failedCheck = Object.entries(checks).find(([, value]) => value !== true);
    if (failedCheck) {
      return { ok: false, reason: `verification-failed:${failedCheck[0]}`, meta, checks };
    }

    return {
      ok: true,
      meta,
      snapshotSha256: sha256(snapshotRaw),
      corpusDigest: snapshot.corpusDigest,
      entryCount: snapshot.entryCount,
      continuityDigest: continuity.continuityDigest,
      proofDigest: sha256(canonical({
        meta,
        portableProofSha256: sha256(portableRaw),
        snapshotSha256: sha256(snapshotRaw),
        corpusDigest: snapshot.corpusDigest,
        entryCount: snapshot.entryCount,
        continuityDigest: continuity.continuityDigest,
      })),
    };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error || 'verification-failed:unknown'), meta };
  }
}

function sortCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const a = normalizedCandidate(left);
    const b = normalizedCandidate(right);
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    if (a.runId !== b.runId) return b.runId - a.runId;
    if (a.artifactCreatedAt !== b.artifactCreatedAt) {
      return a.artifactCreatedAt < b.artifactCreatedAt ? 1 : -1;
    }
    return b.artifactId - a.artifactId;
  });
}

function selectionDigest(receipt) {
  const core = { ...receipt };
  delete core.selectionDigest;
  return sha256(canonical(core));
}

function selectVerifiedPredecessor({ candidates = [] } = {}) {
  if (!Array.isArray(candidates)) throw new Error('candidates must be an array');
  const ordered = sortCandidates(candidates);
  const rejectedCandidates = [];
  let durableHistoryKnown = false;
  let evidenceUnavailable = false;

  for (const candidate of ordered) {
    if (signalsDurableHistory(candidate)) durableHistoryKnown = true;
    if (candidate?.evidenceUnavailable === true) evidenceUnavailable = true;

    const verification = verifyCandidateEvidence(candidate);
    if (verification.ok) {
      const receipt = {
        schemaVersion: 1,
        proof: 'provider-neutral-prior-corpus-evidence-selection',
        status: 'PASS_SELECTED_VERIFIED_PREDECESSOR',
        priorSnapshotLoaded: true,
        durableHistoryKnown: true,
        evidenceUnavailable,
        selectedRunId: verification.meta.runId,
        selectedArtifactId: verification.meta.artifactId,
        selectedArtifactCreatedAt: verification.meta.artifactCreatedAt,
        selectedHeadSha: verification.meta.headSha,
        selectedSnapshotSha256: verification.snapshotSha256,
        selectedCorpusDigest: verification.corpusDigest,
        selectedEntryCount: verification.entryCount,
        selectedContinuityDigest: verification.continuityDigest,
        selectedEvidenceProofDigest: verification.proofDigest,
        rejectedCandidateCount: rejectedCandidates.length,
        rejectedCandidates,
        actionAuthorityGranted: false,
        productionAuthorityGranted: false,
        releaseAuthorityGranted: false,
        crossTenantMutation: false,
        productionMutation: false,
        customerMutation: false,
      };
      return { ...receipt, selectionDigest: selectionDigest(receipt) };
    }
    if (verification.evidenceUnavailable === true) evidenceUnavailable = true;
    rejectedCandidates.push({
      runId: verification.meta?.runId || null,
      artifactId: verification.meta?.artifactId || null,
      reason: verification.reason,
    });
  }

  let status = 'BOOTSTRAP_NO_DURABLE_HISTORY';
  if (ordered.length === 0) status = 'BOOTSTRAP_NO_PRIOR_RUNS';
  else if (durableHistoryKnown) status = 'FAIL_CLOSED_DURABLE_HISTORY_UNAUTHENTICATED';
  else if (evidenceUnavailable) status = 'FAIL_CLOSED_PRIOR_EVIDENCE_UNAVAILABLE';

  const receipt = {
    schemaVersion: 1,
    proof: 'provider-neutral-prior-corpus-evidence-selection',
    status,
    priorSnapshotLoaded: false,
    durableHistoryKnown,
    evidenceUnavailable,
    selectedRunId: null,
    selectedArtifactId: null,
    selectedArtifactCreatedAt: null,
    selectedHeadSha: null,
    selectedSnapshotSha256: null,
    selectedCorpusDigest: null,
    selectedEntryCount: 0,
    selectedContinuityDigest: null,
    selectedEvidenceProofDigest: null,
    rejectedCandidateCount: rejectedCandidates.length,
    rejectedCandidates,
    actionAuthorityGranted: false,
    productionAuthorityGranted: false,
    releaseAuthorityGranted: false,
    crossTenantMutation: false,
    productionMutation: false,
    customerMutation: false,
  };
  return { ...receipt, selectionDigest: selectionDigest(receipt) };
}

function verifySelectionReceipt(receipt) {
  if (!receipt
    || receipt.schemaVersion !== 1
    || receipt.proof !== 'provider-neutral-prior-corpus-evidence-selection') return false;
  if (!HEX64.test(String(receipt.selectionDigest || '')) || selectionDigest(receipt) !== receipt.selectionDigest) return false;
  if (receipt.actionAuthorityGranted !== false
    || receipt.productionAuthorityGranted !== false
    || receipt.releaseAuthorityGranted !== false
    || receipt.crossTenantMutation !== false
    || receipt.productionMutation !== false
    || receipt.customerMutation !== false) return false;
  if (receipt.priorSnapshotLoaded === true) {
    return receipt.status === 'PASS_SELECTED_VERIFIED_PREDECESSOR'
      && receipt.durableHistoryKnown === true
      && Number.isSafeInteger(receipt.selectedRunId) && receipt.selectedRunId > 0
      && Number.isSafeInteger(receipt.selectedArtifactId) && receipt.selectedArtifactId > 0
      && HEX40.test(String(receipt.selectedHeadSha || ''))
      && HEX64.test(String(receipt.selectedSnapshotSha256 || ''))
      && HEX64.test(String(receipt.selectedCorpusDigest || ''))
      && HEX64.test(String(receipt.selectedContinuityDigest || ''))
      && HEX64.test(String(receipt.selectedEvidenceProofDigest || ''))
      && Number.isSafeInteger(receipt.selectedEntryCount) && receipt.selectedEntryCount > 0;
  }
  return new Set([
    'BOOTSTRAP_NO_PRIOR_RUNS',
    'BOOTSTRAP_NO_DURABLE_HISTORY',
    'FAIL_CLOSED_DURABLE_HISTORY_UNAUTHENTICATED',
    'FAIL_CLOSED_PRIOR_EVIDENCE_UNAVAILABLE',
  ]).has(receipt.status)
    && receipt.selectedEvidenceProofDigest === null;
}

module.exports = {
  sha256,
  signalsDurableHistory,
  verifyCandidateEvidence,
  selectVerifiedPredecessor,
  verifySelectionReceipt,
};
