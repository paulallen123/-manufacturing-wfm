const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../scripts/vector-http-verifier.cjs');

test('candidate allowlist rejects the main site before sending credentials', async () => {
  let requests = 0;
  await assert.rejects(V.runProof({ origin: V.MAIN, password: 'test-only-password-123456', fetchImpl: async () => { requests++; } }), /TARGET_NOT_CANDIDATE/);
  assert.equal(requests, 0);
});

test('non-fixture health stops verification before login or mutation', async () => {
  const calls = [];
  await assert.rejects(V.runProof({ origin: V.TARGET, password: 'test-only-password-123456', fetchImpl: async (url, init) => {
    calls.push({url, method: init.method});
    return new Response(JSON.stringify({status:'ok', fixtureOnly:false}), {status:200});
  }}), /FIXTURE_BOUNDARY/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
});

test('asset comparison rejects different deployed bytes', () => {
  assert.throws(() => V.verifyAsset(Buffer.from('unexpected UI'), '0'.repeat(64)), /ASSET_DIGEST_MISMATCH/);
});

test('proof failure is separate from verifier liveness and monitored product health', () => {
  const state = { product: {status:'PASS'}, proof: {status:'FAIL', error:'ASSET_DIGEST_MISMATCH'} };
  assert.equal(V.statusResponse('/healthz', state).code, 200);
  assert.equal(V.statusResponse('/', state).code, 200);
  assert.equal(V.statusResponse('/proof', state).code, 503);
  state.product.status = 'FAIL';
  assert.equal(V.statusResponse('/', state).code, 503);
  assert.equal(V.statusResponse('/healthz', state).code, 200);
});
