import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateStaticCredentialAuthority,assertStaticCredentialAuthoritySafe,assertNoStaticCredentialMaterial} from './static-credential-authority.mjs';

test('allows a pinned HTTPS read credential only after scope, binding, rotation and revocation are proven',()=>{
  const decision=evaluateStaticCredentialAuthority({
    transport:'https',
    hostPinned:true,
    runtimeCapabilities:['reports:read'],
    resourceCoverage:'approved-sites',
    companyBindingVerified:true,
    rotationVerified:true,
    revocationVerified:true,
    credentialAgeDays:20,
    maxCredentialAgeDays:90,
    evidence:{credentialType:'api-key-secret-basic',host:'api.vendor.example',scope:'approved-sites'}
  });
  assert.equal(decision.allowed,true);
  assert.equal(decision.mode,'bounded-static-read-authority');
  assert.equal(decision.runtimeReadOnly,true);
  assert.equal(decision.retryAuthenticationFailure,false);
});

test('fails closed on broad all-resource reads until the customer explicitly approves that visibility',()=>{
  const decision=evaluateStaticCredentialAuthority({
    transport:'https',hostPinned:true,runtimeCapabilities:['reports:read'],resourceCoverage:'all-stations',
    companyBindingVerified:true,rotationVerified:true,revocationVerified:true
  });
  assert.equal(decision.allowed,false);
  assert.ok(decision.reasons.includes('broad-resource-scope-not-approved'));
});

test('does not trade narrower resource scope for write or admin authority',()=>{
  const decision=evaluateStaticCredentialAuthority({
    transport:'https',hostPinned:true,runtimeCapabilities:['reports:read','production-orders:write'],resourceCoverage:'station-42',
    companyBindingVerified:true,rotationVerified:true,revocationVerified:true
  });
  assert.equal(decision.allowed,false);
  assert.ok(decision.reasons.includes('write-or-admin-authority-present'));
  assert.throws(()=>assertStaticCredentialAuthoritySafe({
    transport:'https',hostPinned:true,runtimeCapabilities:['administrator'],resourceCoverage:'station-42',
    companyBindingVerified:true,rotationVerified:true,revocationVerified:true
  }),error=>error?.code==='WFM_STATIC_CREDENTIAL_AUTHORITY_BLOCKED');
});

test('blocks stale or operationally unproven long-lived credentials',()=>{
  const decision=evaluateStaticCredentialAuthority({
    transport:'https',hostPinned:true,runtimeCapabilities:['read'],resourceCoverage:'approved-sites',
    companyBindingVerified:true,rotationVerified:false,revocationVerified:false,credentialAgeDays:120,maxCredentialAgeDays:90
  });
  assert.equal(decision.allowed,false);
  assert.ok(decision.reasons.includes('credential-rotation-not-proven'));
  assert.ok(decision.reasons.includes('credential-revocation-not-proven'));
  assert.ok(decision.reasons.includes('credential-age-exceeds-policy'));
});

test('rejects API keys, secrets, tokens and Authorization values from evidence payloads',()=>{
  assert.throws(()=>assertNoStaticCredentialMaterial({provider:'example',secretKey:'do-not-store'}),error=>error?.code==='WFM_STATIC_CREDENTIAL_EVIDENCE_LEAK');
  const decision=evaluateStaticCredentialAuthority({
    transport:'https',hostPinned:true,runtimeCapabilities:['read'],resourceCoverage:'approved-sites',customerApprovedBroadScope:false,
    companyBindingVerified:true,rotationVerified:true,revocationVerified:true,evidence:{authorizationHeader:'Basic should-not-be-here'}
  });
  assert.equal(decision.allowed,false);
  assert.ok(decision.reasons.includes('credential-material-present-in-evidence'));
});
