import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresenceSignalAuthority} from './presence-signal-reconciliation.mjs';

const policy=()=>({
  provider:'hid-origo',
  wfmTenantId:'tenant-1',
  connectionId:'connection-1',
  organizationId:'org-42',
  apiOrigin:'https://event.api.origo.hidglobal.com',
  applicationRevision:'vector-access-read-3',
  filterId:'filter-site-zone-events',
  callbackRegistrationId:'callback-17',
  eventSource:'urn:hid:origo:organization:org-42',
  schemaFingerprint:'sha256:hid-cloud-events-v1',
  approvedEventTypes:['zone.entered','zone.exited'],
  approvedLocations:[
    {siteId:'site-london',zoneIds:['zone-line-1','zone-line-2']},
    {siteId:'site-leeds',zoneIds:['zone-assembly']}
  ],
  maxClockSkewSeconds:120,
  maxEvents:10
});

const event=(overrides={})=>({
  id:'event-1',
  source:'urn:hid:origo:organization:org-42',
  type:'zone.entered',
  subject:'credential-user-9',
  time:'2026-09-26T20:00:02Z',
  receivedAt:'2026-09-26T20:00:05Z',
  siteId:'site-london',
  zoneId:'zone-line-1',
  readerId:'reader-3',
  payloadDigest:'sha256:event-1',
  channel:'history',
  ...overrides
});

const run=()=>({
  provider:'hid-origo',
  wfmTenantId:'tenant-1',
  connectionId:'connection-1',
  organizationId:'org-42',
  apiOrigin:'https://event.api.origo.hidglobal.com',
  applicationRevision:'vector-access-read-3',
  filterId:'filter-site-zone-events',
  callbackRegistrationId:'callback-17',
  schemaFingerprint:'sha256:hid-cloud-events-v1',
  callbackStatus:'ACTIVE',
  callbackValidUntil:'2026-12-25T00:00:00Z',
  callbackAuthVerified:true,
  historyWindowStart:'2026-09-26T20:00:00Z',
  historyWindowEnd:'2026-09-26T20:05:00Z',
  observedAt:'2026-09-26T20:05:10Z',
  historyComplete:true,
  events:[
    event({channel:'callback'}),
    event({channel:'history'}),
    event({
      id:'event-2',type:'zone.exited',time:'2026-09-26T20:04:00Z',receivedAt:'2026-09-26T20:04:04Z',
      payloadDigest:'sha256:event-2',channel:'history'
    })
  ]
});

test('reconciles authenticated callbacks against complete history as presence signals only',()=>{
  const decision=createPresenceSignalAuthority(policy()).admitReconciliation(run());
  assert.equal(decision.presenceSignalCandidate,true);
  assert.equal(decision.attendanceAuthority,false);
  assert.equal(decision.payrollAuthority,false);
  assert.equal(decision.accessDecisionAuthority,false);
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.reportedEventCount,3);
  assert.equal(decision.uniqueEventCount,2);
  assert.equal(decision.exactReplayCount,1);
  assert.equal(decision.missedCallbackCount,1);
  assert.equal(decision.callbackRepairRequired,false);
  assert.equal(JSON.stringify(decision).includes('credential-user-9'),false);
  assert.match(decision.signals[0].subjectFingerprint,/^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(decision.signals),true);
});

test('rejects organization, host, filter, callback, schema and application drift',()=>{
  for(const [field,value] of [
    ['organizationId','org-99'],['apiOrigin','https://other.example.com'],['filterId','filter-other'],
    ['callbackRegistrationId','callback-99'],['schemaFingerprint','sha256:other'],['applicationRevision','vector-access-read-4']
  ]){
    const candidate=run();
    candidate[field]=value;
    assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(candidate),/approved authority/);
  }
});

test('rejects unauthenticated callback events and incomplete history',()=>{
  const unauthenticated=run();
  unauthenticated.callbackAuthVerified=false;
  assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(unauthenticated),/callback authentication/);

  const incomplete=run();
  incomplete.historyComplete=false;
  assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(incomplete),/history.*incomplete/i);
});

test('requires every callback hint to appear in the complete history window',()=>{
  const missingFromHistory=run();
  missingFromHistory.events=missingFromHistory.events.filter(item=>item.channel==='callback'||item.id==='event-2');
  assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(missingFromHistory),/absent from complete history/);
});

test('counts events recovered from history when callbacks were missed',()=>{
  const historyOnly=run();
  historyOnly.events=historyOnly.events.filter(item=>item.channel==='history');
  historyOnly.callbackAuthVerified=false;
  const decision=createPresenceSignalAuthority(policy()).admitReconciliation(historyOnly);
  assert.equal(decision.missedCallbackCount,2);
  assert.equal(decision.exactReplayCount,0);
});

test('pseudonymous subject fingerprints remain isolated across WFM tenants and connections',()=>{
  const first=createPresenceSignalAuthority(policy()).admitReconciliation(run());
  const secondPolicy=policy();
  secondPolicy.wfmTenantId='tenant-2';
  secondPolicy.connectionId='connection-2';
  const secondRun=run();
  secondRun.wfmTenantId='tenant-2';
  secondRun.connectionId='connection-2';
  const second=createPresenceSignalAuthority(secondPolicy).admitReconciliation(secondRun);
  assert.notEqual(first.signals[0].subjectFingerprint,second.signals[0].subjectFingerprint);
});

test('quarantines conflicting event IDs and duplicate evidence shapes',()=>{
  const conflict=run();
  conflict.events[1].payloadDigest='sha256:tampered';
  assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(conflict),/conflicting duplicate event/);

  const wrongSubject=run();
  wrongSubject.events[1].subject='other-subject';
  assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(wrongSubject),/conflicting duplicate event/);
});

test('rejects unapproved event types, sites and zones',()=>{
  const wrongType=run();
  wrongType.events[0].type='credential.deleted';
  wrongType.events[1].type='credential.deleted';
  assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(wrongType),/event type/);

  const wrongSite=run();
  wrongSite.events[0].siteId='site-paris';
  wrongSite.events[1].siteId='site-paris';
  assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(wrongSite),/site/);

  const wrongZone=run();
  wrongZone.events[0].zoneId='zone-office';
  wrongZone.events[1].zoneId='zone-office';
  assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(wrongZone),/zone/);
});

test('rejects events outside the closed window or beyond allowed clock skew',()=>{
  const outside=run();
  outside.events[0].time='2026-09-26T19:57:59Z';
  outside.events[1].time='2026-09-26T19:57:59Z';
  assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(outside),/outside.*window/i);

  const impossible=run();
  impossible.events[0].receivedAt='2026-02-30T20:00:05Z';
  assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(impossible),/real UTC/);

  const backwards=run();
  backwards.events[0].receivedAt='2026-09-26T19:57:00Z';
  backwards.events[1].receivedAt='2026-09-26T19:57:00Z';
  assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(backwards),/clock skew/);
});

test('marks suspended, expired or elapsed callback registrations for repair after history recovery',()=>{
  for(const [status,validUntil] of [
    ['SUSPENDED','2026-12-25T00:00:00Z'],['EXPIRED','2026-09-20T00:00:00Z'],['ACTIVE','2026-09-26T20:05:05Z']
  ]){
    const candidate=run();
    candidate.callbackStatus=status;
    candidate.callbackValidUntil=validUntil;
    const decision=createPresenceSignalAuthority(policy()).admitReconciliation(candidate);
    assert.equal(decision.callbackRepairRequired,true);
    assert.equal(decision.presenceSignalCandidate,true);
    assert.equal(decision.checkpointAdvanceAllowed,false);
  }
});

test('enforces event bounds and excludes secrets or executable evidence',()=>{
  const tooMany=run();
  tooMany.events=[];
  for(let index=0;index<11;index++){
    tooMany.events.push(event({id:`event-${index}`,payloadDigest:`sha256:${index}`,channel:'history'}));
  }
  assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(tooMany),/event limit/);

  const secret=run();
  secret.events[0].accessToken='do-not-store';
  assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(secret),/secret|credential/);

  const executable=run();
  Object.defineProperty(executable.events[0],'payloadDigest',{enumerable:true,get(){throw new Error('executed');}});
  assert.throws(()=>createPresenceSignalAuthority(policy()).admitReconciliation(executable),/executable|hidden/);
});

test('requires exact HTTPS origins and immutable approved-location policy',()=>{
  for(const apiOrigin of ['http://event.api.origo.hidglobal.com','https://*.hidglobal.com','https://event.api.origo.hidglobal.com/path']){
    const candidate=policy();
    candidate.apiOrigin=apiOrigin;
    assert.throws(()=>createPresenceSignalAuthority(candidate),/exact HTTPS origin/);
  }
  const authority=createPresenceSignalAuthority(policy());
  const decision=authority.admitReconciliation(run());
  assert.throws(()=>decision.signals.push({}),TypeError);
});

// Regression: inert cloning must inspect an array descriptor before reading its value.
test('rejects indexed accessors without executing untrusted policy data',()=>{
  const input=policy();let calls=0;const values=[];
  Object.defineProperty(values,'0',{enumerable:true,get(){calls++;return 'employeeId';}});
  input.untrustedArrayEvidence=values;
  assert.throws(()=>createPresenceSignalAuthority(input),/executable|hidden/i);
  assert.equal(calls,0,'array accessor was executed before rejection');
});
