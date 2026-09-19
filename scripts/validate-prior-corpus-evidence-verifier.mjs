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
  const continuityCore = {
    status: 'PASS',
    proof: 'provider-neutral-incident-regression-corpus-continuity',
    priorSnapshotLoaded: true,
    outputCorpusDigest: corpusDigest,
    outputSnapshotSha256: sha256(snapshotRaw),
    outputEntryCount: 33,
    currentScenarioClasses: 33,
    appendedCurrentClasses: 0,
    deduplicatedCurrentClasses: 33,
    exactPriorCatalogReplay: true,
    rawCustomerTextPersisted: false,
    rawTenantIdentifierPersisted: false,
    reusableSecretsPersisted: false,
    actionAuthorityGranted: false,
    productionAuthorityGranted: false,
    releaseAuthorityGranted: false,
    crossTenantMutation: false,
    productionMutation: false,
    customerMutation: false,
  };
  const continuity = {
    ...continuityCore,
    continuityDigest: sha256(JSON.stringify(continuityCore)),
  };
  const continuityRaw = JSON.stringify(continuity);
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
      continuityDigest: continuity.continuityDigest,
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
assert.match(fallback.selectedContinuityDigest, /^[a-f0-9]{64}$/);
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

const continuityBytesTampered = validCandidate({
  runId: 700,
  artifactId: 9700,
  createdAt: '2026-09-19T06:30:00Z',
  headChar: '6',
  corpusChar: '7',
});
const tamperedContinuity = JSON.parse(continuityBytesTampered.continuityRaw);
tamperedContinuity.rawCustomerTextPersisted = true;
continuityBytesTampered.continuityRaw = JSON.stringify(tamperedContinuity);
const continuityBytesTamperedResult = verifyCandidateEvidence(continuityBytesTampered);
assert.equal(continuityBytesTamperedResult.ok, false);
assert.equal(continuityBytesTamperedResult.reason, 'verification-failed:continuityDigestValid');

const continuityDigestRecomputed = validCandidate({
  runId: 701,
  artifactId: 9701,
  createdAt: '2026-09-19T06:31:00Z',
  headChar: '8',
  corpusChar: '9',
});
const recomputedContinuity = JSON.parse(continuityDigestRecomputed.continuityRaw);
recomputedContinuity.rawCustomerTextPersisted = true;
delete recomputedContinuity.continuityDigest;
recomputedContinuity.continuityDigest = sha256(JSON.stringify(recomputedContinuity));
continuityDigestRecomputed.continuityRaw = JSON.stringify(recomputedContinuity);
const continuityDigestRecomputedResult = verifyCandidateEvidence(continuityDigestRecomputed);
assert.equal(continuityDigestRecomputedResult.ok, false);
assert.equal(continuityDigestRecomputedResult.reason, 'verification-failed:portableBindsContinuityDigest');

const envelopeCorpusDigestTampered = validCandidate({
  runId: 702,
  artifactId: 9702,
  createdAt: '2026-09-19T06:32:00Z',
  headChar: 'a',
  corpusChar: 'c',
});
envelopeCorpusDigestTampered.envelopeRaw = JSON.stringify({
  ...JSON.parse(envelopeCorpusDigestTampered.envelopeRaw),
  incidentRegressionCorpusDigest: '0'.repeat(64),
});
const envelopeCorpusDigestTamperedResult = verifyCandidateEvidence(envelopeCorpusDigestTampered);
assert.equal(envelopeCorpusDigestTamperedResult.ok, false);
assert.equal(envelopeCorpusDigestTamperedResult.reason, 'verification-failed:envelopeBindsCorpusDigest');

const envelopeSnapshotBindingTampered = validCandidate({
  runId: 703,
  artifactId: 9703,
  createdAt: '2026-09-19T06:33:00Z',
  headChar: 'b',
  corpusChar: 'd',
});
envelopeSnapshotBindingTampered.envelopeRaw = JSON.stringify({
  ...JSON.parse(envelopeSnapshotBindingTampered.envelopeRaw),
  incidentRegressionCorpusSnapshotSha256: '0'.repeat(64),
});
const envelopeSnapshotBindingTamperedResult = verifyCandidateEvidence(envelopeSnapshotBindingTampered);
assert.equal(envelopeSnapshotBindingTamperedResult.ok, false);
assert.equal(envelopeSnapshotBindingTamperedResult.reason, 'verification-failed:envelopeBindsSnapshotBytes');

const portableEntryCountTampered = validCandidate({
  runId: 704,
  artifactId: 9704,
  createdAt: '2026-09-19T06:34:00Z',
  headChar: 'c',
  corpusChar: 'e',
});
const portableWithWrongEntryCount = JSON.parse(portableEntryCountTampered.portableProofRaw);
portableWithWrongEntryCount.incidentRegressionCorpus.entryCount = 34;
portableEntryCountTampered.portableProofRaw = JSON.stringify(portableWithWrongEntryCount);
portableEntryCountTampered.envelopeRaw = JSON.stringify({
  ...JSON.parse(portableEntryCountTampered.envelopeRaw),
  portableProofSha256: sha256(portableEntryCountTampered.portableProofRaw),
});
const portableEntryCountTamperedResult = verifyCandidateEvidence(portableEntryCountTampered);
assert.equal(portableEntryCountTamperedResult.ok, false);
assert.equal(portableEntryCountTamperedResult.reason, 'verification-failed:corpusEntryCountMatchesSnapshot');

const tamperedReceipt = { ...fallback, selectedRunId: 999 };
assert.equal(verifySelectionReceipt(tamperedReceipt), false);
const continuityReceiptTampered = { ...fallback, selectedContinuityDigest: '0'.repeat(64) };
assert.equal(verifySelectionReceipt(continuityReceiptTampered), false);

console.log(JSON.stringify({
  schemaVersion: 3,
  proof: 'provider-neutral-prior-corpus-evidence-verifier',
  status: 'PASS',
  newestTamperedOlderVerifiedSelected: true,
  allDurableCandidatesInvalidFailClosed: true,
  partialDurableHistoryMissingSnapshotFailsClosed: true,
  unavailableEvidenceFailsClosed: true,
  deterministicNewestFirstSelection: true,
  continuityBytesTamperRejected: true,
  recomputedContinuityDigestWithoutPortableBindingRejected: true,
  envelopeCorpusDigestTamperRejected: true,
  envelopeSnapshotBindingTamperRejected: true,
  portableEntryCountMismatchRejected: true,
  selectionReceiptBindsContinuityDigest: true,
  tamperedSelectionReceiptRejected: true,
  actionAuthorityGranted: false,
  productionAuthorityGranted: false,
  releaseAuthorityGranted: false,
  customerMutation: false,
}, null, 2));
