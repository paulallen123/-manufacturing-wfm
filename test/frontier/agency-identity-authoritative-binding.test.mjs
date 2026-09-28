import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  AGENCY_IDENTITY_AUTHORITATIVE_BINDING_DDL,
  agencyIdentitySourceSubjectFingerprint,
  agencyIdentityContinuitySubjectFingerprint,
  createPostgresAgencyIdentityAuthoritativeBindingResolver,
} from '../../src/frontier/agency-identity-authoritative-binding.mjs';
import {
  createHmacJsonAgencyIdentityObservationAdapter,
  ingestAgencyIdentityObservation,
} from '../../src/frontier/agency-identity-observation-ingress.mjs';

const KEY='authoritative-binding-fingerprint-key-0123456789abcdef';
const WEBHOOK_SECRET='0123456789abcdef0123456789abcdef0123456789abcdef';
const OBSERVED='2026-10-05T05:58:00.000Z';
const RECEIVED='2026-10-05T05:58:10.000Z';
const ASSIGNMENT='a'.repeat(24);
const ASSURANCE='b'.repeat(32);
const BINDING_VERSION='c'.repeat(32);
const TOKEN_FP='d'.repeat(16);
const SUBJECT_REF='badge-provider-raw-123';
const expectedSourceFp=agencyIdentitySourceSubjectFingerprint({tenantId:'T1',sourceSystemId:'turnstile',sourceSubjectRef:SUBJECT_REF},KEY);

function authoritativeRow(overrides={}){
  return {
    tenant_id:'T1',site_id:'S1',request_id:'R1',agency_id:'A1',worker_id:'W1',
    assignment_fingerprint:ASSIGNMENT,assurance_version_id:ASSURANCE,
    checked_at:'2026-10-04T09:00:00.000Z',coverage_until:'2026-10-31T23:59:59.000Z',promoted_at:'2026-10-04T09:05:00.000Z',
    source_system_id:'turnstile',binding_version_id:BINDING_VERSION,token_fingerprint:TOKEN_FP,consumed_at:'2026-10-04T10:00:00.000Z',
    ...overrides,
  };
}

function resolverWith(query){return createPostgresAgencyIdentityAuthoritativeBindingResolver({query,fingerprintKey:KEY});}

function validResolveInput(overrides={}){
  return {tenantId:'T1',siteId:'S1',requestId:'R1',sourceSystemId:'turnstile',sourceSubjectRef:SUBJECT_REF,observedAt:OBSERVED,...overrides};
}

test('authoritative resolver performs one read-only exact-scope lookup and never sends the raw source subject to PostgreSQL',async()=>{
  const calls=[];
  const resolver=resolverWith(async(sql,values)=>{calls.push({sql,values});return {rows:[authoritativeRow()]};});
  const result=await resolver.resolveBinding(validResolveInput());
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/^\s*WITH\s+active_mapping/i);
  assert.doesNotMatch(calls[0].sql,/\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.equal(calls[0].values[4],expectedSourceFp);
  assert.equal(calls[0].values.includes(SUBJECT_REF),false);
  assert.equal(result.workerId,'W1');
  assert.equal(result.agencyId,'A1');
  assert.equal(result.assuranceVersionId,ASSURANCE);
  assert.equal(result.assignmentFingerprint,ASSIGNMENT);
  assert.match(result.subjectFingerprint,/^[0-9a-f]{32}$/);
  assert.match(result.bindingEvidenceFingerprint,/^[0-9a-f]{32}$/);
  assert.doesNotMatch(JSON.stringify(result),/badge-provider-raw-123/);
});

test('resolver contract requires one active source mapping, accepted preferred-worker response, current non-conflicted RTW assurance and time coverage',async()=>{
  const resolver=resolverWith(async(sql)=>{
    assert.match(sql,/HAVING count\(\*\) = 1/i);
    assert.match(sql,/wfm_agency_portal_token_consumptions/i);
    assert.match(sql,/wfm_agency_rtw_assurance_current/i);
    assert.match(sql,/conflicted = false/i);
    assert.match(sql,/confirm_preferred_worker/);
    assert.match(sql,/partial_fill/);
    assert.match(sql,/assuranceVersionId/);
    assert.match(sql,/consumed_at <= \$6::timestamptz/i);
    assert.match(sql,/promoted_at <= \$6::timestamptz/i);
    assert.match(sql,/coverage_until IS NULL OR current\.coverage_until >= \$6::timestamptz/i);
    return {rows:[authoritativeRow()]};
  });
  const result=await resolver.resolveBinding(validResolveInput());
  assert.equal(result.workerId,'W1');
});

test('missing, ambiguous or malformed authoritative evidence fails closed',async()=>{
  for(const rows of [[],[authoritativeRow(),authoritativeRow()]]){
    const resolver=resolverWith(async()=>({rows}));
    await assert.rejects(()=>resolver.resolveBinding(validResolveInput()),/identity_binding_not_authoritative/);
  }
  const malformed=[
    authoritativeRow({assurance_version_id:'not-hex'}),
    authoritativeRow({assignment_fingerprint:'bad'}),
    authoritativeRow({site_id:'OTHER'}),
    authoritativeRow({consumed_at:null}),
  ];
  for(const row of malformed){
    const resolver=resolverWith(async()=>({rows:[row]}));
    await assert.rejects(()=>resolver.resolveBinding(validResolveInput()));
  }
});

test('resolver postconditions reject future acceptance/check/promotion and expired coverage even if a broken database adapter returns a row',async()=>{
  const rows=[
    authoritativeRow({consumed_at:'2026-10-05T06:00:00Z'}),
    authoritativeRow({checked_at:'2026-10-05T06:00:00Z'}),
    authoritativeRow({promoted_at:'2026-10-05T06:00:00Z'}),
    authoritativeRow({coverage_until:'2026-10-05T05:57:59Z'}),
  ];
  for(const row of rows){
    const resolver=resolverWith(async()=>({rows:[row]}));
    await assert.rejects(()=>resolver.resolveBinding(validResolveInput()),/identity_binding_(?:evidence_time_invalid|coverage_expired)/);
  }
});

test('source-subject fingerprints are source scoped while continuity subject fingerprints are stable for the same worker across systems',()=>{
  const sourceA=agencyIdentitySourceSubjectFingerprint({tenantId:'T1',sourceSystemId:'turnstile',sourceSubjectRef:'same-provider-ref'},KEY);
  const sourceB=agencyIdentitySourceSubjectFingerprint({tenantId:'T1',sourceSystemId:'attendance',sourceSubjectRef:'same-provider-ref'},KEY);
  assert.notEqual(sourceA,sourceB);
  const continuityA=agencyIdentityContinuitySubjectFingerprint({tenantId:'T1',agencyId:'A1',workerId:'W1'},KEY);
  const continuityB=agencyIdentityContinuitySubjectFingerprint({tenantId:'T1',agencyId:'A1',workerId:'W1'},KEY);
  assert.equal(continuityA,continuityB);
  assert.notEqual(continuityA,sourceA);
});

test('authenticated observation ingress can use the authoritative PostgreSQL resolver without exposing source identity or creating mutation authority',async()=>{
  const resolver=resolverWith(async(sql,values)=>{
    assert.equal(values[4],expectedSourceFp);
    return {rows:[authoritativeRow()]};
  });
  const adapter=createHmacJsonAgencyIdentityObservationAdapter({secret:WEBHOOK_SECRET});
  const registry={async resolveSource(){return {sourceSystemId:'turnstile',adapter,allowedSignalTypes:['access_pass'],maxEventAgeMinutes:60,maxFutureSkewSeconds:30};}};
  const body=JSON.stringify({eventId:'evt-authoritative-1',sourceSubjectRef:SUBJECT_REF,signalType:'access_pass',observedAt:OBSERVED,rawBadgeNumber:'SHOULD-NOT-PERSIST'});
  const timestamp=String(Math.floor(Date.parse(RECEIVED)/1000));
  const signature=crypto.createHmac('sha256',WEBHOOK_SECRET).update(timestamp).update('.').update(body).digest('hex');
  let stored=null;
  const result=await ingestAgencyIdentityObservation({tenantId:'T1',siteId:'S1',requestId:'R1',sourceSystemId:'turnstile',rawBody:body,headers:{'x-wfm-timestamp':timestamp,'x-wfm-signature':signature},receivedAt:RECEIVED,sourceRegistry:registry,bindingResolver:resolver,continuityStore:{async appendObservation(row){stored=structuredClone(row);return {duplicate:false,row};}}});
  assert.equal(result.accepted,true);
  assert.equal(result.workerId,'W1');
  assert.equal(result.rankingImpact,'none');
  assert.equal(result.scheduleWriteAuthorized,false);
  assert.equal(result.payrollWriteAuthorized,false);
  assert.equal(result.clockingWriteAuthorized,false);
  const serialized=JSON.stringify({result,stored});
  assert.doesNotMatch(serialized,/badge-provider-raw-123|SHOULD-NOT-PERSIST/);
});

test('append-only mapping DDL prevents silent source-subject reassignment in place',()=>{
  assert.match(AGENCY_IDENTITY_AUTHORITATIVE_BINDING_DDL,/PRIMARY KEY \(tenant_id, source_system_id, source_subject_fingerprint, binding_version_id\)/i);
  assert.match(AGENCY_IDENTITY_AUTHORITATIVE_BINDING_DDL,/BEFORE UPDATE/i);
  assert.match(AGENCY_IDENTITY_AUTHORITATIVE_BINDING_DDL,/BEFORE DELETE/i);
  assert.match(AGENCY_IDENTITY_AUTHORITATIVE_BINDING_DDL,/append only/i);
  assert.doesNotMatch(AGENCY_IDENTITY_AUTHORITATIVE_BINDING_DDL,/source_subject_ref|badge_number|photo|biometric/i);
});

test('5,000 unrecognised provider identities produce zero authoritative bindings',async()=>{
  let accepted=0;
  const resolver=resolverWith(async(_sql,values)=>({rows:values[4]===expectedSourceFp?[authoritativeRow()]:[]}));
  for(let i=0;i<5000;i+=1){
    try{await resolver.resolveBinding(validResolveInput({sourceSubjectRef:`forged-${i}`}));accepted+=1;}catch{}
  }
  assert.equal(accepted,0);
});
