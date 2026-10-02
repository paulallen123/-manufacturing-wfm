import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpaquePageChainAuthority} from './opaque-page-chain-authority.mjs';

const policy=()=>({
  provider:'quinyx',
  wfmTenantId:'tenant-uk-1',
  connectionId:'connection-7',
  providerAccountId:'quinyx-account-42',
  region:'eu',
  apiOrigin:'https://api.eu.quinyx.com',
  apiVersion:'v3',
  resource:'organization/groups',
  queryFingerprint:'sha256:active-groups-only',
  schemaFingerprint:'sha256:schema-v3',
  credentialRevision:'credential-4',
  maxPages:3,
  maxRecords:5,
  maxTokenLength:128
});

const record=(sourceId,sourceVersion,payloadDigest)=>({sourceId,sourceVersion,payloadDigest});
const run=()=>({
  provider:'quinyx',
  wfmTenantId:'tenant-uk-1',
  connectionId:'connection-7',
  providerAccountId:'quinyx-account-42',
  region:'eu',
  apiOrigin:'https://api.eu.quinyx.com',
  apiVersion:'v3',
  resource:'organization/groups',
  queryFingerprint:'sha256:active-groups-only',
  schemaFingerprint:'sha256:schema-v3',
  credentialRevision:'credential-4',
  startedAt:'2026-09-26T19:00:00Z',
  completedAt:'2026-09-26T19:00:03Z',
  complete:true,
  pages:[
    {
      index:1,
      requestedPageToken:null,
      nextPageToken:'opaque-page-2',
      pageDigest:'sha256:page-1',
      records:[record('group-1','2026-09-26T18:00:00Z','sha256:group-1')]
    },
    {
      index:2,
      requestedPageToken:'opaque-page-2',
      nextPageToken:null,
      pageDigest:'sha256:page-2',
      records:[record('group-2','2026-09-26T18:01:00Z','sha256:group-2')]
    }
  ]
});

test('admits one exact-scope terminal chain only as a reconciliation candidate',()=>{
  const decision=createOpaquePageChainAuthority(policy()).admitChain(run());
  assert.equal(decision.reconciliationCandidate,true);
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.reportedRecordCount,2);
  assert.equal(decision.uniqueRecordCount,2);
  assert.equal(decision.exactReplayCount,0);
  assert.match(decision.checkpointNamespace,/^opaque-page-chain:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(decision).includes('opaque-page-2'),false);
  assert.equal(Object.isFrozen(decision),true);
});

test('rejects cross-tenant, host, version, resource and credential drift',()=>{
  for(const [field,value] of [
    ['wfmTenantId','tenant-other'],
    ['providerAccountId','quinyx-account-99'],
    ['apiOrigin','https://api.us.quinyx.com'],
    ['apiVersion','v2'],
    ['resource','hr/employees'],
    ['queryFingerprint','sha256:all-groups'],
    ['credentialRevision','credential-5']
  ]){
    const candidate=run();
    candidate[field]=value;
    assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(candidate),/approved authority/);
  }
});

test('rejects token gaps, token loops and page-index gaps',()=>{
  const tokenGap=run();
  tokenGap.pages[1].requestedPageToken='wrong-token';
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(tokenGap),/token chain/);

  const loop=run();
  loop.pages[1].nextPageToken='opaque-page-2';
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(loop),/loop|reused/);

  const indexGap=run();
  indexGap.pages[1].index=3;
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(indexGap),/page index/);
});

test('compares opaque continuation tokens byte-for-byte',()=>{
  const whitespaceDrift=run();
  whitespaceDrift.pages[0].nextPageToken='opaque-page-2 ';
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(whitespaceDrift),/token chain|token.*whitespace/i);

  const unicodeDrift=run();
  unicodeDrift.pages[0].nextPageToken='caf\u00e9';
  unicodeDrift.pages[1].requestedPageToken='cafe\u0301';
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(unicodeDrift),/token chain/);
});

test('rejects partial chains and complete chains with a continuation token',()=>{
  const partial=run();
  partial.complete=false;
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(partial),/incomplete/);

  const unterminated=run();
  unterminated.pages[1].nextPageToken='opaque-page-3';
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(unterminated),/terminal|continuation/);
});

test('enforces bounded pages, records and opaque token length',()=>{
  const tooManyPages=run();
  tooManyPages.pages.push({
    index:3,requestedPageToken:null,nextPageToken:null,pageDigest:'sha256:page-3',records:[]
  });
  tooManyPages.pages.push({
    index:4,requestedPageToken:null,nextPageToken:null,pageDigest:'sha256:page-4',records:[]
  });
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(tooManyPages),/page limit/);

  const tooManyRecords=run();
  tooManyRecords.pages[1].records=[
    record('2','v1','d2'),record('3','v1','d3'),record('4','v1','d4'),
    record('5','v1','d5'),record('6','v1','d6')
  ];
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(tooManyRecords),/record limit/);

  const longToken=run();
  longToken.pages[0].nextPageToken='x'.repeat(129);
  longToken.pages[1].requestedPageToken='x'.repeat(129);
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(longToken),/token length/);
});

test('collapses exact record replays but quarantines conflicting versions',()=>{
  const replay=run();
  replay.pages[1].records=[record('group-1','2026-09-26T18:00:00Z','sha256:group-1')];
  const replayDecision=createOpaquePageChainAuthority(policy()).admitChain(replay);
  assert.equal(replayDecision.uniqueRecordCount,1);
  assert.equal(replayDecision.exactReplayCount,1);

  const conflict=run();
  conflict.pages[1].records=[record('group-1','2026-09-26T18:00:00Z','sha256:changed')];
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(conflict),/conflicting duplicate/);
});

test('rejects duplicate page receipts and executable or secret-bearing evidence',()=>{
  const duplicatePage=run();
  duplicatePage.pages[1].pageDigest='sha256:page-1';
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(duplicatePage),/page digest/);

  const secret=run();
  secret.pages[0].records[0].accessToken='do-not-store';
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(secret),/secret|credential/);

  const executable=run();
  Object.defineProperty(executable.pages[0].records[0],'payloadDigest',{enumerable:true,get(){throw new Error('executed');}});
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(executable),/executable|hidden/);
});

test('rejects impossible or reversed observation windows',()=>{
  const impossible=run();
  impossible.completedAt='2026-02-30T19:00:03Z';
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(impossible),/real UTC/);

  const reversed=run();
  reversed.completedAt='2026-09-26T18:59:59Z';
  assert.throws(()=>createOpaquePageChainAuthority(policy()).admitChain(reversed),/before/);
});

test('requires an exact HTTPS regional origin and deeply immutable output',()=>{
  for(const apiOrigin of ['http://api.eu.quinyx.com','https://*.quinyx.com','https://api.eu.quinyx.com/path']){
    const candidate=policy();
    candidate.apiOrigin=apiOrigin;
    assert.throws(()=>createOpaquePageChainAuthority(candidate),/exact HTTPS origin/);
  }
  const decision=createOpaquePageChainAuthority(policy()).admitChain(run());
  assert.equal(Object.isFrozen(decision.recordVersions),true);
  assert.throws(()=>decision.recordVersions.push('forged'),TypeError);
});

// Regression: inert cloning must inspect an array descriptor before reading its value.
test('rejects indexed accessors without executing untrusted policy data',()=>{
  const input=policy();let calls=0;const values=[];
  Object.defineProperty(values,'0',{enumerable:true,get(){calls++;return 'employeeId';}});
  input.untrustedArrayEvidence=values;
  assert.throws(()=>createOpaquePageChainAuthority(input),/executable|hidden/i);
  assert.equal(calls,0,'array accessor was executed before rejection');
});
