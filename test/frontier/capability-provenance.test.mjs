import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCapabilityAttestation,verifyAttestationPrivacy} from '../../src/frontier/capability-provenance.mjs';

const base={
  scope:{tenantId:'t1',siteId:'s1'},
  event:{authoritative:true,tenantId:'t1',siteId:'s1',productRef:'product-9',lotRef:'lot-22',processStep:'critical-weld',executedAt:'2026-09-20T18:00:00Z',holderRef:'opaque-holder-7',revision:'mes-r9'},
  requirement:{authoritative:true,processStep:'critical-weld',skillCode:'WELD-3'},
  credential:{authoritative:true,tenantId:'t1',siteId:'s1',holderRef:'opaque-holder-7',skillCode:'WELD-3',status:'active',validFrom:'2026-01-01T00:00:00Z',validUntil:'2026-12-31T23:59:59Z',credentialRef:'vc:73',issuerRef:'issuer:approved-body',revision:'vc-r4'}
};

test('creates a privacy-minimised competence attestation from authoritative aligned evidence',()=>{
  const r=buildCapabilityAttestation(base);
  assert.equal(r.status,'attestable');
  assert.equal(r.attestation.competenceCoverage,true);
  assert.equal(r.attestation.holderDisclosure,'withheld');
  assert.equal(verifyAttestationPrivacy(r.attestation).status,'accepted');
});

test('expired or revoked credentials fail closed',()=>{
  const expired=structuredClone(base);expired.credential.validUntil='2026-09-19T00:00:00Z';
  assert.equal(buildCapabilityAttestation(expired).reason,'credential_not_valid_at_execution');
  const revoked=structuredClone(base);revoked.credential.status='revoked';
  assert.equal(buildCapabilityAttestation(revoked).reason,'credential_not_active');
});

test('cross-site and cross-tenant evidence cannot be joined',()=>{
  const site=structuredClone(base);site.credential.siteId='s2';
  assert.equal(buildCapabilityAttestation(site).reason,'site_scope_mismatch');
  const tenant=structuredClone(base);tenant.event.tenantId='t2';
  assert.equal(buildCapabilityAttestation(tenant).reason,'tenant_scope_mismatch');
});

test('process skill and holder bindings are deterministic hard gates',()=>{
  const skill=structuredClone(base);skill.credential.skillCode='WELD-2';
  assert.equal(buildCapabilityAttestation(skill).reason,'process_or_skill_mismatch');
  const holder=structuredClone(base);holder.credential.holderRef='other';
  assert.equal(buildCapabilityAttestation(holder).reason,'holder_binding_mismatch');
});

test('direct PII is rejected before an attestation can be emitted',()=>{
  const input=structuredClone(base);input.event.employeeId='E123';
  assert.equal(buildCapabilityAttestation(input).reason,'direct_pii_present');
});

test('the attestation never claims physical execution or product conformity',()=>{
  const r=buildCapabilityAttestation(base);
  assert.match(r.attestation.claimBoundary,/does not independently prove physical task execution/i);
  assert.match(r.attestation.claimBoundary,/product conformity/i);
});
