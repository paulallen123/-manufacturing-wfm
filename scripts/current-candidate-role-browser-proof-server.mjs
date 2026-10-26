import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { roleProofResult } from './vector-proof-result.mjs';

let state = 'RUNNING';
let detail = null;
let assetBinding = { status: 'UNVERIFIED' };
let outcome = { roleChecks: 'UNVERIFIED', endToEndVerified: false, productReady: false };

const body = () => JSON.stringify({
  ...outcome,
  status: state,
  candidateSha: process.env.WFM_EXPECTED_CANDIDATE_SHA,
  claimBoundary: 'fixture/demo browser proof only; production approval and real-provider claims remain false',
  assetBinding,
  detail
});

const server = http.createServer((req, res) => {
  // Serving a running proof process is liveness, never product readiness.
  let readinessRequest;
  try {
    readinessRequest = new URL(req.url || '/', 'http://localhost').pathname === '/ready';
  } catch {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ error: 'Invalid request target' }));
    return;
  }
  res.statusCode = state === 'FAIL' || (readinessRequest && outcome.productReady !== true) ? 503 : 200;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(body());
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', resolve);
});
console.log('BROWSER_PROOF_SERVER=READY');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function proveCanonicalAssetBinding() {
  const requireBinding = process.env.WFM_REQUIRE_VECTOR_ASSET_DIGESTS === 'true';
  const expectedJs = String(process.env.VECTOR_CANONICAL_JS_SHA256 || '').trim().toLowerCase();
  const expectedCss = String(process.env.VECTOR_CANONICAL_CSS_SHA256 || '').trim().toLowerCase();
  const expectedWorkflow = String(process.env.VECTOR_WORKFLOW_JS_SHA256 || '').trim().toLowerCase();

  if (!expectedJs || !expectedCss || !expectedWorkflow) {
    assert.equal(requireBinding, false, 'Strict browser proof requires Vector JS, CSS and authenticated workflow digests.');
    return { status: 'UNBOUND', required: false };
  }

  assert.match(expectedJs, /^[0-9a-f]{64}$/, 'Invalid VECTOR_CANONICAL_JS_SHA256.');
  assert.match(expectedCss, /^[0-9a-f]{64}$/, 'Invalid VECTOR_CANONICAL_CSS_SHA256.');
  assert.match(expectedWorkflow, /^[0-9a-f]{64}$/, 'Invalid VECTOR_WORKFLOW_JS_SHA256.');

  const origin = new URL(process.env.VECTOR_PROOF_URL).origin;
  const [jsResponse, cssResponse, workflowResponse] = await Promise.all([
    fetch(`${origin}/vector-ui.js`, { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
    fetch(`${origin}/vector-ui.css`, { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
    fetch(`${origin}/vector-workflows.js`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
  ]);

  assert.equal(jsResponse.status, 200, 'Canonical Vector script unavailable for exact-byte proof.');
  assert.equal(cssResponse.status, 200, 'Canonical Vector stylesheet unavailable for exact-byte proof.');
  assert.equal(workflowResponse.status, 200, 'Authenticated Vector workflow controller unavailable for exact-byte proof.');

  const [jsBytes, cssBytes, workflowBytes] = await Promise.all([
    jsResponse.arrayBuffer().then(buffer => Buffer.from(buffer)),
    cssResponse.arrayBuffer().then(buffer => Buffer.from(buffer)),
    workflowResponse.arrayBuffer().then(buffer => Buffer.from(buffer))
  ]);
  const actualJs = sha256(jsBytes);
  const actualCss = sha256(cssBytes);
  const actualWorkflow = sha256(workflowBytes);

  assert.equal(actualJs, expectedJs, 'Hosted /vector-ui.js bytes do not match the exact source-built candidate digest.');
  assert.equal(actualCss, expectedCss, 'Hosted /vector-ui.css bytes do not match the exact source-built candidate digest.');
  assert.equal(actualWorkflow, expectedWorkflow, 'Hosted /vector-workflows.js bytes do not match the exact source-built candidate digest.');

  return {
    status: 'BOUND',
    required: requireBinding,
    origin,
    jsSha256: actualJs,
    cssSha256: actualCss,
    workflowSha256: actualWorkflow
  };
}

try {
  assetBinding = await proveCanonicalAssetBinding();
  const proof = await import('./current-candidate-role-browser-proof.mjs');
  outcome = roleProofResult(assetBinding, proof.browserProofEvidence?.leaveJourney,
    proof.browserProofEvidence?.attendanceJourney, proof.browserProofEvidence?.payrollJourney);
  state = outcome.status;
  console.log(`BROWSER_PROOF_ASSET_BINDING=${assetBinding.status}`);
  console.log('BROWSER_ROLE_CHECKS=PASS');
  console.log('BROWSER_PROOF_SERVER=PARTIAL|endToEndVerified=false|productReady=false');
} catch (error) {
  state = 'FAIL';
  detail = String(error?.stack || error);
  console.error(`BROWSER_PROOF_SERVER=FAIL\n${detail}`);
  setTimeout(() => process.exit(1), 1000).unref();
}

