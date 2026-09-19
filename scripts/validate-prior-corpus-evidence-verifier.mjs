import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  sha256,
  signalsDurableHistory,
  verifyCandidateEvidence,
  selectVerifiedPredecessor,
  verifySelectionReceipt,
} = require('../resilience/prior-corpus-evidence-verifier.cjs');

function validCandidate({ runId, artifactId, createdAt, headChar, corpusChar }) {
  const headSha = headChar.repeat(40);
  const corpusDigest = corpusChar.repeat(64);
  const snapshotRaw = JSON.stringify({
    schemaVersion: 2,
    entryCount: 33,
    corpusDigest,
    authority: {
      actionAuthority: false,
      productionAuthority: false,
      releaseAuthority: false,
      credentialAuthority: false,
      customerMutation: false,
      crossTenantMutation: false,
    },
  });
  const continuityRaw = JSON.stringify({
    status: 'PASS',
    proof: 'provider-neutral-incident-regression-corpus-continuity',
    outputCorpusDigest: corpusDigest,
    outputSnapshotSha256: sha256(snapshotRaw),
    actionAuthorityGranted: false,
    productionAuthorityGranted: false,
    releaseAuthorityGranted: false,
    crossTenantMutation: false,
    productionMutation: false,
    customerMutation: false,
  });
  const portableProofRaw = JSON.stringify({
    status: 'PASS',
    exactRuntime: true,
    providerNeutral: true,
    productionMutation: false,
    customerMutation: false,
    incidentRegressionCorpus: {
      entryCount: 33,
      snapshotSha256: sha256(snapshotRaw),
      corpusDigest,
    },
  });
  const envelopeRaw = JSON.stringify({
    finalEvidenceStatus: 'LOGIC_ONLY_RELEASE_BLOCKED',
    bindingMatches: true,
    workflowHeadSha: headSha,
    portableProofSha256: sha256(portableProofRaw),
    incidentRegressionCorpusDigest: corpusDigest,
    incidentRegressionCorpusSnapshotSha256: sha256(snapshotRaw),
    incidentRegressionCorpusPriorSnapshotLoaded: true,
  });
  return {
    runId,
    artifactId,
    headSha,
    createdAt,
    artifactCreatedAt: createdAt,
    portableProofRaw,
    envelopeRaw,
    snapshotRaw,
    continuityRaw,
  };
}

const older = validCandidate({
  runId: 400,
  artifactId: 9400,
  createdAt: '2026-09-19T05:00:00Z',
  headChar: 'a',
  corpusChar: 'b',
});
const newestTampered = validCandidate({
  runId: 401,
  artifactId: 9401,
  createdAt: '2026-09-19T06:00:00Z',
  headChar: 'c',
  corpusChar: 'd',
});
newestTampered.snapshotRaw = JSON.stringify({
  ...JSON.parse(newestTampered.snapshotRaw),
  entryCount: 34,
});

assert.equal(verifyCandidateEvidence(older).ok, true);
assert.equal(verifyCandidateEvidence(newestTampered).ok, false);

const fallback = selectVerifiedPredecessor({ candidates: [older, newestTampered] });
assert.equal(fallback.status, 'PASS_SELECTED_VERIFIED_PREDECESSOR');
assert.equal(fallback.selectedRunId, older.runId);
assert.equal(fallback.selectedArtifactId, older.artifactId);
assert.equal(fallback.rejectedCandidateCount, 1);
assert.equal(fallback.rejectedCandidates[0].runId, newestTampered.runId);
assert.equal(fallback.priorSnapshotLoaded, true);
assert.equal(fallback.durableHistoryKnown, true);
assert.equal(fallback.actionAuthorityGranted, false);
assert.equal(fallback.productionAuthorityGranted, false);
assert.equal(fallback.releaseAuthorityGranted, false);
assert.equal(verifySelectionReceipt(fallback), true);

const invalidA = validCandidate({
  runId: 500,
  artifactId: 9500,
  createdAt: '2026-09-19T06:10:00Z',
  headChar: 'e',
  corpusChar: 'f',
});
invalidA.envelopeRaw = JSON.stringify({
  ...JSON.parse(invalidA.envelopeRaw),
  bindingMatches: false,
});
const invalidB = validCandidate({
  runId: 499,
  artifactId: 9499,
  createdAt: '2026-09-19T05:10:00Z',
  headChar: '1',
  corpusChar: '2',
});
invalidB.portableProofRaw = JSON.stringify({
  ...JSON.parse(invalidB.portableProofRaw),
  status: 'FAIL',
});

const failClosed = selectVerifiedPredecessor({ candidates: [invalidA, invalidB] });
assert.equal(failClosed.status, 'FAIL_CLOSED_DURABLE_HISTORY_UNAUTHENTICATED');
assert.equal(failClosed.priorSnapshotLoaded, false);
assert.equal(failClosed.durableHistoryKnown, true);
assert.equal(failClosed.rejectedCandidateCount, 2);
assert.equal(failClosed.selectedRunId, null);
assert.equal(failClosed.actionAuthorityGranted, false);
assert.equal(failClosed.productionAuthorityGranted, false);
assert.equal(failClosed.releaseAuthorityGranted, false);
assert.equal(verifySelectionReceipt(failClosed), true);

const partialDurable = validCandidate({
  runId: 550,
  artifactId: 9550,
  createdAt: '2026-09-19T06:15:00Z',
  headChar: '4',
  corpusChar: '5',
});
delete partialDurable.snapshotRaw;
assert.equal(signalsDurableHistory(partialDurable), true);
const partialFailClosed = selectVerifiedPredecessor({ candidates: [partialDurable] });
assert.equal(partialFailClosed.status, 'FAIL_CLOSED_DURABLE_HISTORY_UNAUTHENTICATED');
assert.equal(partialFailClosed.durableHistoryKnown, true);
assert.equal(partialFailClosed.priorSnapshotLoaded, false);
assert.equal(partialFailClosed.rejectedCandidateCount, 1);
assert.match(partialFailClosed.rejectedCandidates[0].reason, /^missing-required-evidence:snapshotRaw$/);
assert.equal(verifySelectionReceipt(partialFailClosed), true);

const unavailableOnly = selectVerifiedPredecessor({
  candidates: [{
    runId: 600,
    artifactId: 9600,
    headSha: '3'.repeat(40),
    createdAt: '2026-09-19T06:20:00Z',
    artifactCreatedAt: '2026-09-19T06:20:00Z',
    evidenceUnavailable: true,
    unavailableReason: 'artifact-download-unavailable',
  }],
});
assert.equal(unavailableOnly.status, 'FAIL_CLOSED_PRIOR_EVIDENCE_UNAVAILABLE');
assert.equal(unavailableOnly.evidenceUnavailable, true);
assert.equal(verifySelectionReceipt(unavailableOnly), true);

const tamperedReceipt = { ...fallback, selectedRunId: 999 };
assert.equal(verifySelectionReceipt(tamperedReceipt), false);

console.log(JSON.stringify({
  schemaVersion: 1,
  proof: 'provider-neutral-prior-corpus-evidence-verifier',
  status: 'PASS',
  newestTamperedOlderVerifiedSelected: true,
  allDurableCandidatesInvalidFailClosed: true,
  partialDurableHistoryMissingSnapshotFailsClosed: true,
  unavailableEvidenceFailsClosed: true,
  deterministicNewestFirstSelection: true,
  tamperedSelectionReceiptRejected: true,
  actionAuthorityGranted: false,
  productionAuthorityGranted: false,
  releaseAuthorityGranted: false,
  customerMutation: false,
}, null, 2));
