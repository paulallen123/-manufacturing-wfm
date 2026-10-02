import test from 'node:test';
import assert from 'node:assert/strict';
import {createRotatingOAuthTransition} from './rotating-oauth-transition.mjs';

const fp=char=>`sha256:${char.repeat(64)}`;

const policy=()=>({
  provider:'deputy',
  wfmTenantId:'tenant-uk-01',
  connectionId:'deputy-connection-01',
  installationId:'factory-one',
  region:'UK',
  apiHost:'factory-one.uk.deputy.com',
  clientRevision:'oauth-client-3',
  requiredScope:'longlife_refresh_token',
  maximumAccessTtlSeconds:86400
});

const request=()=>({
  provider:'deputy',
  wfmTenantId:'tenant-uk-01',
  connectionId:'deputy-connection-01',
  installationId:'factory-one',
  region:'UK',
  apiHost:'factory-one.uk.deputy.com',
  clientRevision:'oauth-client-3',
  attemptId:'rotation-attempt-008',
  observedCredentialGeneration:7,
  observedRefreshFingerprint:fp('a'),
  requestedAt:'2026-09-26T18:00:00.000Z',
  currentAccessExpiresAt:'2026-09-26T18:05:00.000Z',
  reason:'scheduled-expiry'
});

const receipt=plan=>({
  planFingerprint:plan.planFingerprint,
  status:200,
  endpointHost:'factory-one.uk.deputy.com',
  scope:'longlife_refresh_token',
  observedStoredGeneration:7,
  priorRefreshFingerprint:fp('a'),
  newAccessFingerprint:fp('b'),
  newRefreshFingerprint:fp('c'),
  issuedAt:'2026-09-26T18:00:01.000Z',
  receivedAt:'2026-09-26T18:00:02.000Z',
  expiresInSeconds:86400
});

test('rotation plan binds one installation, region and credential generation',()=>{
  const authority=createRotatingOAuthTransition(policy());
  const plan=authority.authorize(request());
  assert.equal(plan.authority,'rotating-oauth-compare-and-swap');
  assert.equal(plan.expectedGeneration,7);
  assert.equal(plan.nextGeneration,8);
  assert.equal(plan.region,'UK');
  assert.equal(plan.apiHost,'factory-one.uk.deputy.com');
  assert.equal(plan.storeWriteAuthority,'compare-and-swap-only');
  assert.match(plan.transitionNamespace,/^oauth-rotation:[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(plan),true);
});

test('successful rotation emits secret-free compare-and-swap evidence once',()=>{
  const authority=createRotatingOAuthTransition(policy());
  const plan=authority.authorize(request());
  const admitted=authority.admit(plan,receipt(plan));
  assert.equal(admitted.rotationCandidate,true);
  assert.equal(admitted.expectedPreviousGeneration,7);
  assert.equal(admitted.nextGeneration,8);
  assert.equal(admitted.reconciliationRequired,true);
  assert.equal(admitted.storeWriteAuthority,'compare-and-swap-only');
  assert.equal(admitted.newRefreshFingerprint,fp('c'));
  assert.ok(!JSON.stringify(admitted).includes('access_token'));
  assert.throws(()=>authority.admit(plan,receipt(plan)),/already admitted/i);
});

test('refresh token rotation and fingerprint shape are mandatory',()=>{
  const mutations=[
    value=>{value.newRefreshFingerprint=fp('a');},
    value=>{value.newAccessFingerprint=fp('c');},
    value=>{value.newAccessFingerprint=fp('a');},
    value=>{value.newRefreshFingerprint='not-a-fingerprint';},
    value=>{value.newAccessFingerprint='sha256:short';},
    value=>{value.priorRefreshFingerprint=fp('d');}
  ];
  for(const mutate of mutations){
    const authority=createRotatingOAuthTransition(policy());
    const plan=authority.authorize(request());
    const candidate=receipt(plan);
    mutate(candidate);
    assert.throws(()=>authority.admit(plan,candidate),/fingerprint|rotate|prior/i);
  }
});

test('rotation reason is a bounded operational value rather than free-form evidence',()=>{
  const authority=createRotatingOAuthTransition(policy());
  assert.throws(()=>authority.authorize({...request(),reason:'refresh with embedded credential material'}),/reason/i);
});

test('stale generation, endpoint, scope and client drift fail closed',()=>{
  const mutations=[
    value=>{value.observedStoredGeneration=8;},
    value=>{value.endpointHost='other.uk.deputy.com';},
    value=>{value.scope='other-scope';}
  ];
  for(const mutate of mutations){
    const authority=createRotatingOAuthTransition(policy());
    const plan=authority.authorize(request());
    const candidate=receipt(plan);
    mutate(candidate);
    assert.throws(()=>authority.admit(plan,candidate));
  }
  assert.throws(()=>createRotatingOAuthTransition(policy()).authorize({...request(),clientRevision:'oauth-client-4'}));
});

test('only approved Deputy regions and exact installation hosts are accepted',()=>{
  assert.throws(()=>createRotatingOAuthTransition({...policy(),region:'CA'}),/region/i);
  assert.throws(()=>createRotatingOAuthTransition({...policy(),apiHost:'*.uk.deputy.com'}),/host/i);
  assert.throws(()=>createRotatingOAuthTransition({...policy(),apiHost:'factory-one.eu.deputy.com'}),/region|host/i);
});

test('failed, overlong and temporally impossible refresh receipts are rejected',()=>{
  const mutations=[
    value=>{value.status=401;},
    value=>{value.expiresInSeconds=86401;},
    value=>{value.expiresInSeconds=0;},
    value=>{value.issuedAt='2026-09-26T17:59:59.000Z';},
    value=>{value.receivedAt='2026-09-26T17:59:59.000Z';},
    value=>{value.receivedAt='2026-02-31T00:00:00.000Z';}
  ];
  for(const mutate of mutations){
    const authority=createRotatingOAuthTransition(policy());
    const plan=authority.authorize(request());
    const candidate=receipt(plan);
    mutate(candidate);
    assert.throws(()=>authority.admit(plan,candidate));
  }
});

test('raw secrets, duplicate attempts and fabricated plans never enter evidence',()=>{
  assert.throws(()=>createRotatingOAuthTransition({...policy(),clientSecret:'synthetic-secret'}),/secret|credential material/i);
  const authority=createRotatingOAuthTransition(policy());
  const plan=authority.authorize(request());
  assert.throws(()=>authority.authorize(request()),/attempt/i);
  assert.throws(()=>authority.admit({...plan},receipt(plan)),/not issued/i);
  assert.throws(()=>authority.admit(plan,{...receipt(plan),accessToken:'synthetic-secret'}),/secret|credential material/i);
});

// Regression: inert cloning must inspect an array descriptor before reading its value.
test('rejects indexed accessors without executing untrusted policy data',()=>{
  const input=policy();let calls=0;const values=[];
  Object.defineProperty(values,'0',{enumerable:true,get(){calls++;return 'employeeId';}});
  input.untrustedArrayEvidence=values;
  assert.throws(()=>createRotatingOAuthTransition(input),/executable|hidden/i);
  assert.equal(calls,0,'array accessor was executed before rejection');
});
