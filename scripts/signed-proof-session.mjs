import assert from 'node:assert/strict';
import crypto from 'node:crypto';

function sessionCookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const first = values[0];
  assert.ok(first, 'Signed proof-session did not return a session cookie.');
  const pair = first.split(';', 1)[0], split = pair.indexOf('=');
  assert.ok(split > 0, 'Proof-session Set-Cookie header is malformed.');
  return { name: pair.slice(0, split), value: pair.slice(split + 1) };
}

function privateKey() {
  const encoded=String(process.env.PROOF_PRIVATE_KEY_B64||'').trim();
  assert.ok(encoded, 'PROOF_PRIVATE_KEY_B64 is required for signed browser proof.');
  return crypto.createPrivateKey(Buffer.from(encoded,'base64').toString('utf8'));
}

function canonicalAssertion(input) {
  return [
    'VECTOR_PROOF_RUNNER_V1',
    'wfm-proof-runner',
    'wfm-proof-session',
    String(input.email||'').trim().toLowerCase(),
    String(input.origin||'').replace(/\/$/,''),
    String(input.nonce||''),
    String(input.issuedAt||''),
    String(input.expiresAt||'')
  ].join('\n');
}

export async function signedProofSession(email, origin) {
  const cleanOrigin=String(origin||'').replace(/\/$/,'');
  const issuedAt=Date.now(), assertion={
    email:String(email||'').trim().toLowerCase(),
    origin:cleanOrigin,
    nonce:crypto.randomBytes(24).toString('base64url'),
    issuedAt,
    expiresAt:issuedAt+45000
  };
  assertion.signature=crypto.sign(null,Buffer.from(canonicalAssertion(assertion)),privateKey()).toString('base64url');
  const response=await fetch(cleanOrigin+'/api/proof-runner/session',{
    method:'POST',
    headers:{'content-type':'application/json',origin:cleanOrigin,referer:cleanOrigin+'/',accept:'application/json'},
    body:JSON.stringify(assertion),
    signal:AbortSignal.timeout(15000)
  });
  assert.equal(response.status,200,`${email} signed proof-session failed with HTTP ${response.status}.`);
  const cookie=sessionCookieFrom(response);
  return {cookie,responseStatus:response.status,authMethod:'proof-runner-signed'};
}
