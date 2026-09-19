import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  sha256,
  selectVerifiedPredecessor,
  verifySelectionReceipt,
} = require('../resilience/prior-corpus-evidence-verifier.cjs');

function readOptional(file) {
  if (!file) return undefined;
  try {
    return fs.readFileSync(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function resolveMaybe(baseDir, value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

export function loadManifest(manifestPath) {
  const absolute = path.resolve(manifestPath);
  const raw = fs.readFileSync(absolute, 'utf8');
  const parsed = JSON.parse(raw);
  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed?.candidates)) {
    throw new Error('prior-corpus-manifest-invalid');
  }
  return { absolute, baseDir: path.dirname(absolute), raw, parsed };
}

export function materializeCandidates(manifest) {
  const { baseDir, parsed } = manifest;
  return parsed.candidates.map((entry) => {
    const portableProofPath = resolveMaybe(baseDir, entry.portableProofPath);
    const envelopePath = resolveMaybe(baseDir, entry.envelopePath);
    const snapshotPath = resolveMaybe(baseDir, entry.snapshotPath);
    const continuityPath = resolveMaybe(baseDir, entry.continuityPath);
    return {
      runId: Number(entry.runId || 0),
      artifactId: Number(entry.artifactId || 0),
      headSha: String(entry.headSha || '').toLowerCase(),
      createdAt: String(entry.createdAt || ''),
      artifactCreatedAt: String(entry.artifactCreatedAt || ''),
      evidenceUnavailable: entry.evidenceUnavailable === true,
      unavailableReason: entry.unavailableReason ? String(entry.unavailableReason) : undefined,
      durableHistoryHint: entry.durableHistoryHint === true,
      portableProofRaw: readOptional(portableProofPath),
      envelopeRaw: readOptional(envelopePath),
      snapshotRaw: readOptional(snapshotPath),
      continuityRaw: readOptional(continuityPath),
      __snapshotPath: snapshotPath,
    };
  });
}

export function selectFromManifest({ manifestPath, receiptPath, selectedSnapshotPath } = {}) {
  if (!manifestPath || !receiptPath) throw new Error('manifestPath and receiptPath are required');
  const manifest = loadManifest(manifestPath);
  const candidates = materializeCandidates(manifest);
  const receipt = selectVerifiedPredecessor({ candidates });
  if (!verifySelectionReceipt(receipt)) throw new Error('provider-neutral-selection-receipt-invalid');

  const receiptOut = path.resolve(receiptPath);
  fs.mkdirSync(path.dirname(receiptOut), { recursive: true });
  fs.writeFileSync(receiptOut, JSON.stringify(receipt, null, 2) + '\n');

  let selectedSnapshotSha256 = null;
  if (receipt.priorSnapshotLoaded) {
    if (!selectedSnapshotPath) throw new Error('selectedSnapshotPath required for verified predecessor');
    const selected = candidates.find((candidate) => candidate.runId === receipt.selectedRunId
      && candidate.artifactId === receipt.selectedArtifactId);
    if (!selected?.__snapshotPath) throw new Error('selected-predecessor-snapshot-path-missing');
    const bytes = fs.readFileSync(selected.__snapshotPath);
    selectedSnapshotSha256 = sha256(bytes);
    if (selectedSnapshotSha256 !== receipt.selectedSnapshotSha256) {
      throw new Error('selected-predecessor-snapshot-digest-drift');
    }
    const output = path.resolve(selectedSnapshotPath);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(selected.__snapshotPath, output);
  }

  return {
    receipt,
    selectedSnapshotSha256,
    manifestSha256: sha256(manifest.raw),
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = selectFromManifest({
      manifestPath: args.manifest,
      receiptPath: args.receipt,
      selectedSnapshotPath: args['selected-snapshot'],
    });
    console.log(JSON.stringify({
      schemaVersion: 1,
      proof: 'provider-neutral-prior-corpus-selection-adapter',
      status: result.receipt.status,
      priorSnapshotLoaded: result.receipt.priorSnapshotLoaded,
      selectedRunId: result.receipt.selectedRunId,
      selectedArtifactId: result.receipt.selectedArtifactId,
      selectedEvidenceProofDigest: result.receipt.selectedEvidenceProofDigest,
      manifestSha256: result.manifestSha256,
      selectedSnapshotSha256: result.selectedSnapshotSha256,
      actionAuthorityGranted: false,
      productionAuthorityGranted: false,
      releaseAuthorityGranted: false,
      productionMutation: false,
      customerMutation: false,
    }, null, 2));
    if (String(result.receipt.status).startsWith('FAIL_CLOSED_')) process.exit(2);
  } catch (error) {
    console.error(String(error?.stack || error));
    process.exit(1);
  }
}
