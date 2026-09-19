import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { selectFromManifest } from './select-prior-corpus-evidence.mjs';

const require = createRequire(import.meta.url);
const { sha256, verifySelectionReceipt } = require('../resilience/prior-corpus-evidence-verifier.cjs');

function fixture({ dir, runId, artifactId, createdAt, headChar, corpusChar, tamperSnapshot = false, invalidateEnvelope = false }) {
  fs.mkdirSync(dir, { recursive: true });
  const headSha = headChar.repeat(40);
  const corpusDigest = corpusChar.repeat(64);
  let snapshotRaw = JSON.stringify({ schemaVersion: 2, entryCount: 33, corpusDigest });
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
  const continuity = { ...continuityCore, continuityDigest: sha256(JSON.stringify(continuityCore)) };
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
    bindingMatches: !invalidateEnvelope,
    workflowHeadSha: headSha,
    portableProofSha256: sha256(portableProofRaw),
    incidentRegressionCorpusDigest: corpusDigest,
    incidentRegressionCorpusSnapshotSha256: sha256(snapshotRaw),
    incidentRegressionCorpusPriorSnapshotLoaded: true,
  });
  if (tamperSnapshot) snapshotRaw = JSON.stringify({ schemaVersion: 2, entryCount: 34, corpusDigest });

  const files = {
    portableProofPath: path.join(dir, 'portable-autonomy-proof.json'),
    envelopePath: path.join(dir, 'autonomy-proof-envelope.json'),
    snapshotPath: path.join(dir, 'incident-regression-corpus.snapshot.json'),
    continuityPath: path.join(dir, 'incident-regression-corpus-continuity.json'),
  };
  fs.writeFileSync(files.portableProofPath, portableProofRaw);
  fs.writeFileSync(files.envelopePath, envelopeRaw);
  fs.writeFileSync(files.snapshotPath, snapshotRaw);
  fs.writeFileSync(files.continuityPath, continuityRaw);
  return { runId, artifactId, headSha, createdAt, artifactCreatedAt: createdAt, ...files };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-prior-corpus-adapter-'));
try {
  const older = fixture({
    dir: path.join(root, 'older'), runId: 800, artifactId: 9800,
    createdAt: '2026-09-19T07:00:00Z', headChar: 'a', corpusChar: 'b',
  });
  const newestTampered = fixture({
    dir: path.join(root, 'newer'), runId: 801, artifactId: 9801,
    createdAt: '2026-09-19T08:00:00Z', headChar: 'c', corpusChar: 'd', tamperSnapshot: true,
  });
  const manifestPath = path.join(root, 'manifest.json');
  const receiptPath = path.join(root, 'receipt.json');
  const selectedSnapshotPath = path.join(root, 'selected.snapshot.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, candidates: [newestTampered, older] }, null, 2));

  const selected = selectFromManifest({ manifestPath, receiptPath, selectedSnapshotPath });
  assert.equal(selected.receipt.status, 'PASS_SELECTED_VERIFIED_PREDECESSOR');
  assert.equal(selected.receipt.selectedRunId, 800);
  assert.equal(selected.receipt.rejectedCandidateCount, 1);
  assert.match(selected.receipt.selectedEvidenceProofDigest, /^[a-f0-9]{64}$/);
  assert.equal(selected.selectedSnapshotSha256, selected.receipt.selectedSnapshotSha256);
  assert.equal(sha256(fs.readFileSync(selectedSnapshotPath)), selected.receipt.selectedSnapshotSha256);
  assert.equal(verifySelectionReceipt(JSON.parse(fs.readFileSync(receiptPath, 'utf8'))), true);

  const invalidA = fixture({
    dir: path.join(root, 'invalid-a'), runId: 900, artifactId: 9900,
    createdAt: '2026-09-19T08:10:00Z', headChar: 'e', corpusChar: 'f', invalidateEnvelope: true,
  });
  const invalidB = fixture({
    dir: path.join(root, 'invalid-b'), runId: 899, artifactId: 9899,
    createdAt: '2026-09-19T08:05:00Z', headChar: '1', corpusChar: '2', tamperSnapshot: true,
  });
  const failManifestPath = path.join(root, 'fail-manifest.json');
  const failReceiptPath = path.join(root, 'fail-receipt.json');
  fs.writeFileSync(failManifestPath, JSON.stringify({ schemaVersion: 1, candidates: [invalidA, invalidB] }, null, 2));
  const failed = selectFromManifest({ manifestPath: failManifestPath, receiptPath: failReceiptPath });
  assert.equal(failed.receipt.status, 'FAIL_CLOSED_DURABLE_HISTORY_UNAUTHENTICATED');
  assert.equal(failed.receipt.priorSnapshotLoaded, false);
  assert.equal(failed.receipt.durableHistoryKnown, true);
  assert.equal(failed.receipt.rejectedCandidateCount, 2);
  assert.equal(verifySelectionReceipt(failed.receipt), true);

  const unavailableManifestPath = path.join(root, 'unavailable-manifest.json');
  const unavailableReceiptPath = path.join(root, 'unavailable-receipt.json');
  fs.writeFileSync(unavailableManifestPath, JSON.stringify({
    schemaVersion: 1,
    candidates: [{
      runId: 950,
      artifactId: 9950,
      headSha: '3'.repeat(40),
      createdAt: '2026-09-19T08:20:00Z',
      artifactCreatedAt: '2026-09-19T08:20:00Z',
      evidenceUnavailable: true,
      unavailableReason: 'artifact-download-unavailable',
    }],
  }, null, 2));
  const unavailable = selectFromManifest({ manifestPath: unavailableManifestPath, receiptPath: unavailableReceiptPath });
  assert.equal(unavailable.receipt.status, 'FAIL_CLOSED_PRIOR_EVIDENCE_UNAVAILABLE');
  assert.equal(unavailable.receipt.evidenceUnavailable, true);

  console.log(JSON.stringify({
    schemaVersion: 1,
    proof: 'provider-neutral-prior-corpus-selection-adapter',
    status: 'PASS',
    newerTamperedOlderVerifiedSelected: true,
    selectedSnapshotDigestRevalidatedBeforeCopy: true,
    selectedEvidenceProofDigestBound: true,
    allDurableCandidatesInvalidFailClosed: true,
    unavailableEvidenceFailClosed: true,
    actionAuthorityGranted: false,
    productionAuthorityGranted: false,
    releaseAuthorityGranted: false,
    productionMutation: false,
    customerMutation: false,
  }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
