import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';

let state = 'RUNNING';
let detail = null;
let assetBinding = { status: 'UNVERIFIED' };

const body = () => JSON.stringify({
  status: state,
  candidateSha: process.env.WFM_EXPECTED_CANDIDATE_SHA,
  claimBoundary: 'fixture/demo browser proof only; production approval and real-provider claims remain false',
  assetBinding,
  detail
});

const server = http.createServer((req, res) => {
  res.statusCode = state === 'PASS' ? 200 : 503;
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

  if (!expectedJs || !expectedCss) {
    assert.equal(requireBinding, false, 'Strict browser proof requires VECTOR_CANONICAL_JS_SHA256 and VECTOR_CANONICAL_CSS_SHA256.');
    return { status: 'UNBOUND', required: false };
  }

  assert.match(expectedJs, /^[0-9a-f]{64}$/, 'Invalid VECTOR_CANONICAL_JS_SHA256.');
  assert.match(expectedCss, /^[0-9a-f]{64}$/, 'Invalid VECTOR_CANONICAL_CSS_SHA256.');

  const origin = new URL(process.env.VECTOR_PROOF_URL).origin;
  const [jsResponse, cssResponse] = await Promise.all([
    fetch(`${origin}/vector-ui.js`, { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
    fetch(`${origin}/vector-ui.css`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
  ]);

  assert.equal(jsResponse.status, 200, 'Canonical Vector script unavailable for exact-byte proof.');
  assert.equal(cssResponse.status, 200, 'Canonical Vector stylesheet unavailable for exact-byte proof.');

  const [jsBytes, cssBytes] = await Promise.all([
    jsResponse.arrayBuffer().then(buffer => Buffer.from(buffer)),
    cssResponse.arrayBuffer().then(buffer => Buffer.from(buffer))
  ]);
  const actualJs = sha256(jsBytes);
  const actualCss = sha256(cssBytes);

  assert.equal(actualJs, expectedJs, 'Hosted /vector-ui.js bytes do not match the exact source-built candidate digest.');
  assert.equal(actualCss, expectedCss, 'Hosted /vector-ui.css bytes do not match the exact source-built candidate digest.');

  return {
    status: 'BOUND',
    required: requireBinding,
    origin,
    jsSha256: actualJs,
    cssSha256: actualCss
  };
}

function assertAuthoritativeProofSource() {
  const roleSource = fs.readFileSync(new URL('./current-candidate-role-browser-proof.mjs', import.meta.url), 'utf8');
  assert.ok(roleSource.includes('/api/weekly-review?period=2026-09-07'), 'Role proof is not bound to authoritative Weekly Review period.');
  assert.ok(roleSource.includes('/api/workforce/lifecycle/action-evidence/time-review?period=2026-09-07'), 'Role proof lifecycle evidence is missing authoritative period binding.');
  assert.equal(roleSource.includes("fetch('/api/time-review'"), false, 'Legacy Time Review source alias reappeared in role proof.');
  console.log('BROWSER_PROOF_AUTHORITATIVE_SOURCE=PASS');
}

try {
  assertAuthoritativeProofSource();
  assetBinding = await proveCanonicalAssetBinding();
  await import('./current-candidate-hosted-action-proof.mjs');
  await import('./current-candidate-role-browser-proof.mjs');
  state = 'PASS';
  console.log(`BROWSER_PROOF_ASSET_BINDING=${assetBinding.status}`);
  console.log('BROWSER_PROOF_SERVER=PASS');
} catch (error) {
  state = 'FAIL';
  detail = String(error?.stack || error);
  console.error(`BROWSER_PROOF_SERVER=FAIL\n${detail}`);
  setTimeout(() => process.exit(1), 1000).unref();
}
