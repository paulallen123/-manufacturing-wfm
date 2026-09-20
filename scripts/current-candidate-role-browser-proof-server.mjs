import http from 'node:http';

let state = 'RUNNING';
let detail = null;

const expectedCandidateSha = String(process.env.WFM_EXPECTED_CANDIDATE_SHA || '').trim().toLowerCase();
const targetDeployedSha = String(process.env.WFM_TARGET_DEPLOYED_SHA || '').trim().toLowerCase();
const targetDeploymentId = String(process.env.WFM_TARGET_DEPLOYMENT_ID || '').trim();
const shaPattern = /^[0-9a-f]{40}$/;

const body = () => JSON.stringify({
  status: state,
  expectedCandidateSha,
  targetDeployedSha,
  targetDeploymentId,
  exactTargetShaBound: Boolean(expectedCandidateSha && targetDeployedSha && expectedCandidateSha === targetDeployedSha),
  claimBoundary: 'fixture/demo browser proof only; exact-current proof requires Railway deployment metadata SHA binding; production approval and real-provider claims remain false',
  detail
});

const server = http.createServer((req, res) => {
  res.statusCode = state === 'FAIL' ? 503 : 200;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(body());
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', resolve);
});
console.log('BROWSER_PROOF_SERVER=READY');

try {
  if (!shaPattern.test(expectedCandidateSha)) {
    throw new Error(`EXPECTED_CANDIDATE_SHA_INVALID|value=${expectedCandidateSha || 'missing'}`);
  }
  if (!shaPattern.test(targetDeployedSha)) {
    throw new Error(`TARGET_DEPLOYED_SHA_MISSING_OR_INVALID|value=${targetDeployedSha || 'missing'}`);
  }
  if (!targetDeploymentId) {
    throw new Error('TARGET_DEPLOYMENT_ID_MISSING');
  }
  if (targetDeployedSha !== expectedCandidateSha) {
    throw new Error(`TARGET_SHA_MISMATCH|expected=${expectedCandidateSha}|target=${targetDeployedSha}|deployment=${targetDeploymentId}`);
  }

  console.log(`TARGET_SHA_ATTESTATION=PASS|expected=${expectedCandidateSha}|target=${targetDeployedSha}|deployment=${targetDeploymentId}`);
  await import('./current-candidate-role-browser-proof.mjs');
  state = 'PASS';
  console.log('BROWSER_PROOF_SERVER=PASS');
} catch (error) {
  state = 'FAIL';
  detail = String(error?.stack || error);
  console.error(`TARGET_SHA_ATTESTATION_OR_BROWSER_PROOF=FAIL\n${detail}`);
  console.error(`BROWSER_PROOF_SERVER=FAIL\n${detail}`);
  setTimeout(() => process.exit(1), 1000).unref();
}
