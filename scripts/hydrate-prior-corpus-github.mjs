import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { selectFromManifest } from './select-prior-corpus-evidence.mjs';

const REQUIRED_EVIDENCE = Object.freeze([
  'portable-autonomy-proof.json',
  'autonomy-proof-envelope.json',
  'incident-regression-corpus.snapshot.json',
  'incident-regression-corpus-continuity.json',
]);
const WORKFLOW_FILE = 'wfm-zero-engineer-support-contract.yml';
const MAX_RUN_PAGES = 10;
const RUNS_PER_PAGE = 100;

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`missing-required-environment:${name}`);
  return value;
}

function apiContext() {
  const apiBase = requiredEnv('GITHUB_API_URL').replace(/\/+$/, '');
  if (apiBase !== 'https://api.github.com') throw new Error('github-api-origin-not-allowed');
  const repository = requiredEnv('GITHUB_REPOSITORY');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('github-repository-invalid');
  return {
    apiBase,
    repository,
    branch: requiredEnv('GITHUB_REF_NAME'),
    currentRunId: Number(requiredEnv('GITHUB_RUN_ID')),
    token: requiredEnv('GH_TOKEN'),
  };
}

function apiUrl(context, pathname, query = {}) {
  const url = new URL(`${context.apiBase}/repos/${context.repository}/${pathname.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  return url;
}

function authHeaders(context) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${context.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function getJson(context, pathname, query = {}) {
  const response = await fetch(apiUrl(context, pathname, query), {
    method: 'GET',
    headers: authHeaders(context),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`github-read-failed:${response.status}:${pathname}`);
  return response.json();
}

async function downloadArtifact(context, artifactId, zipPath) {
  const response = await fetch(apiUrl(context, `actions/artifacts/${artifactId}/zip`), {
    method: 'GET',
    headers: authHeaders(context),
    redirect: 'manual',
  });
  if (response.status === 200) {
    fs.writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (![301, 302, 303, 307, 308].includes(response.status)) {
    throw new Error(`artifact-download-ticket-failed:${response.status}`);
  }
  const location = response.headers.get('location');
  if (!location) throw new Error('artifact-download-location-missing');
  const target = new URL(location);
  if (target.protocol !== 'https:') throw new Error('artifact-download-location-not-https');
  const download = await fetch(target, { method: 'GET', redirect: 'follow' });
  if (!download.ok) throw new Error(`artifact-download-failed:${download.status}`);
  fs.writeFileSync(zipPath, Buffer.from(await download.arrayBuffer()));
}

function extractRequiredEvidence(zipPath, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const name of REQUIRED_EVIDENCE) {
    const extracted = spawnSync('unzip', ['-p', zipPath, name], {
      encoding: null,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (extracted.error) throw extracted.error;
    if (extracted.status === 0 && Buffer.isBuffer(extracted.stdout) && extracted.stdout.length > 0) {
      fs.writeFileSync(path.join(outputDir, name), extracted.stdout);
    }
  }
}

function manifestEntry({ run, artifact, evidenceDir, evidenceUnavailable = false, unavailableReason, durableHistoryHint = false }) {
  const resolveEvidence = (name) => evidenceDir ? path.join(evidenceDir, name) : null;
  return {
    runId: Number(run?.runId || 0),
    artifactId: Number(artifact?.artifactId || 0),
    headSha: String(run?.headSha || '').toLowerCase(),
    createdAt: String(run?.createdAt || ''),
    artifactCreatedAt: String(artifact?.artifactCreatedAt || ''),
    evidenceUnavailable,
    unavailableReason: unavailableReason || undefined,
    durableHistoryHint,
    portableProofPath: resolveEvidence('portable-autonomy-proof.json'),
    envelopePath: resolveEvidence('autonomy-proof-envelope.json'),
    snapshotPath: resolveEvidence('incident-regression-corpus.snapshot.json'),
    continuityPath: resolveEvidence('incident-regression-corpus-continuity.json'),
  };
}

function writeManifest(file, candidates) {
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    proof: 'github-readonly-prior-corpus-candidate-manifest',
    candidates,
    productionMutation: false,
    customerMutation: false,
    releaseAuthorityGranted: false,
  }, null, 2) + '\n');
}

function appendEnvironment(file, key, value) {
  fs.appendFileSync(file, `${key}=${value}\n`);
}

async function listCompletedRuns(context) {
  const runs = [];
  for (let page = 1; page <= MAX_RUN_PAGES; page += 1) {
    const data = await getJson(context, `actions/workflows/${WORKFLOW_FILE}/runs`, {
      branch: context.branch,
      per_page: RUNS_PER_PAGE,
      page,
    });
    const pageRuns = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
    for (const run of pageRuns) {
      const runId = Number(run?.id || 0);
      if (runId === context.currentRunId) continue;
      if (String(run?.head_branch || '') !== context.branch) continue;
      if (run?.status !== 'completed') continue;
      runs.push({
        runId,
        headSha: String(run?.head_sha || '').toLowerCase(),
        createdAt: String(run?.created_at || ''),
        updatedAt: String(run?.updated_at || ''),
      });
    }
    if (pageRuns.length < RUNS_PER_PAGE) break;
  }
  runs.sort((a, b) => a.createdAt === b.createdAt ? b.runId - a.runId : (a.createdAt < b.createdAt ? 1 : -1));
  return runs;
}

async function retrieveCandidate(context, run, runnerTemp) {
  let metadata;
  try {
    metadata = await getJson(context, `actions/runs/${run.runId}/artifacts`, { per_page: 100 });
  } catch (error) {
    return manifestEntry({
      run,
      artifact: null,
      evidenceUnavailable: true,
      unavailableReason: `artifact-list-unavailable:${String(error?.message || error)}`,
    });
  }

  const expectedName = `portable-autonomy-proof-${run.runId}`;
  const matching = (Array.isArray(metadata?.artifacts) ? metadata.artifacts : [])
    .filter((artifact) => artifact?.name === expectedName)
    .sort((a, b) => {
      const ac = String(a?.created_at || '');
      const bc = String(b?.created_at || '');
      if (ac !== bc) return ac < bc ? 1 : -1;
      return Number(b?.id || 0) - Number(a?.id || 0);
    });
  const artifact = matching.find((item) => item?.expired !== true);
  if (!artifact) {
    const expired = matching[0];
    return manifestEntry({
      run,
      artifact: expired ? {
        artifactId: Number(expired.id || 0),
        artifactCreatedAt: String(expired.created_at || ''),
      } : null,
      evidenceUnavailable: Boolean(expired),
      unavailableReason: expired ? 'artifact-expired' : 'no-preserved-proof-artifact',
      durableHistoryHint: Boolean(expired),
    });
  }

  const artifactInfo = {
    artifactId: Number(artifact.id || 0),
    artifactCreatedAt: String(artifact.created_at || ''),
  };
  const zipPath = path.join(runnerTemp, `wfm-prior-artifact-${run.runId}.zip`);
  const evidenceDir = path.join(runnerTemp, `wfm-prior-artifact-${run.runId}`);
  try {
    await downloadArtifact(context, artifactInfo.artifactId, zipPath);
    extractRequiredEvidence(zipPath, evidenceDir);
  } catch (error) {
    return manifestEntry({
      run,
      artifact: artifactInfo,
      evidenceUnavailable: true,
      unavailableReason: `artifact-evidence-unavailable:${String(error?.message || error)}`,
      durableHistoryHint: true,
    });
  }
  return manifestEntry({ run, artifact: artifactInfo, evidenceDir });
}

async function main() {
  const context = apiContext();
  const runnerTemp = requiredEnv('RUNNER_TEMP');
  const workspace = requiredEnv('GITHUB_WORKSPACE');
  const githubEnv = requiredEnv('GITHUB_ENV');
  const manifestPath = path.join(runnerTemp, 'wfm-prior-corpus-manifest.json');
  const receiptPath = path.join(workspace, 'incident-regression-corpus-hydration.json');
  const selectedSnapshotPath = path.join(runnerTemp, 'incident-regression-corpus.prior.json');
  const candidates = [];

  let runs;
  try {
    runs = await listCompletedRuns(context);
  } catch (error) {
    candidates.push(manifestEntry({
      run: { runId: 0, headSha: '', createdAt: new Date(0).toISOString() },
      artifact: null,
      evidenceUnavailable: true,
      unavailableReason: `workflow-history-unavailable:${String(error?.message || error)}`,
    }));
    runs = [];
  }

  let result = null;
  for (const run of runs) {
    candidates.push(await retrieveCandidate(context, run, runnerTemp));
    writeManifest(manifestPath, candidates);
    result = selectFromManifest({ manifestPath, receiptPath, selectedSnapshotPath });
    if (result.receipt.priorSnapshotLoaded === true) break;
  }

  if (!result) {
    writeManifest(manifestPath, candidates);
    result = selectFromManifest({ manifestPath, receiptPath, selectedSnapshotPath });
  }

  if (result.receipt.priorSnapshotLoaded === true) {
    appendEnvironment(githubEnv, 'WFM_INCIDENT_CORPUS_INPUT', selectedSnapshotPath);
    console.log(`Verified prior incident corpus selected from run ${result.receipt.selectedRunId} artifact ${result.receipt.selectedArtifactId}.`);
  } else if (String(result.receipt.status).startsWith('FAIL_CLOSED_')) {
    console.error(`${result.receipt.status}: prior durable incident history could not be authenticated; refusing to bootstrap from zero.`);
    process.exit(2);
  } else {
    console.log(`${result.receipt.status}: no authenticated durable predecessor exists; controlled bootstrap remains permitted.`);
  }
}

main().catch((error) => {
  console.error(String(error?.stack || error));
  process.exit(1);
});
