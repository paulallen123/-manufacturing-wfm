import test from 'node:test';
import assert from 'node:assert/strict';
import {createCappedProjectionChainAuthority} from './capped-projection-chain-authority.mjs';

const QUERY=`sha256:${'1'.repeat(64)}`;
const SCHEMA=`sha256:${'2'.repeat(64)}`;
const SCOPE=`sha256:${'3'.repeat(64)}`;
const PAYLOAD_A=`sha256:${'4'.repeat(64)}`;
const PAYLOAD_B=`sha256:${'5'.repeat(64)}`;
const CONFLICT=`sha256:${'6'.repeat(64)}`;
const BOOKMARK='<B><P><p>Job</p></P><L><v>1002</v></L></B>';

const policy=(overrides={})=>({
  provider:'infor-cloudsuite-industrial',
  wfmTenantId:'tenant-uk-1',
  connectionId:'connection-csi-1',
  sourceTenantId:'infor-tenant-1',
  configurationId:'CSI-PROD',
  siteId:'LEEDS',
  apiOrigin:'https://mingle-api.eu1.inforcloudsuite.com',
  apiVersion:'mongoose-rest-v2',
  projectionId:'SLJobs-WFM-v1',
  queryFingerprint:QUERY,
  schemaFingerprint:SCHEMA,
  scopeFingerprint:SCOPE,
  expectedCheckpointPredecessor:'checkpoint:jobs:000042',
  expectedObservedAt:'2026-09-27T03:00:00Z',
  effectiveRecordCap:2,
  maxPages:10,
  maxRecords:1000,
  maxBookmarkBytes:4096,
  ...overrides
});

const record=(overrides={})=>({id:'job-1001',sourceVersion:'2026-09-27T02:00:00Z',payloadDigest:PAYLOAD_A,...overrides});

const page=(overrides={})=>({
  pageIndex:0,
  requestBookmark:null,
  nextBookmark:null,
  moreRowsExist:false,
  messageCode:0,
  effectiveRecordCap:2,
  queryFingerprint:QUERY,
  schemaFingerprint:SCHEMA,
  scopeFingerprint:SCOPE,
  records:[record()],
  ...overrides
});

const receipt=(overrides={})=>({
  provider:'infor-cloudsuite-industrial',
  wfmTenantId:'tenant-uk-1',
  connectionId:'connection-csi-1',
  sourceTenantId:'infor-tenant-1',
  configurationId:'CSI-PROD',
  siteId:'LEEDS',
  apiOrigin:'https://mingle-api.eu1.inforcloudsuite.com',
  apiVersion:'mongoose-rest-v2',
  projectionId:'SLJobs-WFM-v1',
  queryFingerprint:QUERY,
  schemaFingerprint:SCHEMA,
  scopeFingerprint:SCOPE,
  checkpointPredecessor:'checkpoint:jobs:000042',
  observedAt:'2026-09-27T03:00:00Z',
  complete:true,
  pages:[page()],
  ...overrides
});

test('admits a complete bookmark chain only as bounded reconciliation evidence',()=>{
  const pages=[
    page({nextBookmark:BOOKMARK,moreRowsExist:true,records:[record(),record({id:'job-1002',payloadDigest:PAYLOAD_B})]}),
    page({pageIndex:1,requestBookmark:BOOKMARK,records:[record({id:'job-1003',payloadDigest:`sha256:${'7'.repeat(64)}`})]})
  ];
  const decision=createCappedProjectionChainAuthority(policy()).admit(receipt({pages}));
  assert.equal(decision.projectionReconciliationCandidate,true);
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.writeBackAuthority,false);
  assert.equal(decision.uniqueVersionCount,3);
  assert.match(decision.reconciliationFingerprint,/^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(decision),/<B>|Job<\/p>/);
});

test('requires MoreRowsExist and bookmark continuity to agree',()=>{
  const authority=createCappedProjectionChainAuthority(policy());
  assert.throws(()=>authority.admit(receipt({pages:[page({moreRowsExist:true,nextBookmark:null})]})),/bookmark.*required|terminal/i);
  assert.throws(()=>authority.admit(receipt({pages:[page({moreRowsExist:false,nextBookmark:BOOKMARK})]})),/bookmark.*forbidden|terminal/i);
  assert.throws(()=>authority.admit(receipt({pages:[page({moreRowsExist:true,nextBookmark:BOOKMARK}),page({pageIndex:1,requestBookmark:'wrong'})]})),/bookmark chain/i);
  assert.throws(()=>authority.admit(receipt({pages:[page({moreRowsExist:true,nextBookmark:BOOKMARK})]})),/terminal|incomplete/i);
});

test('does not infer completeness from row count below or at the cap',()=>{
  const authority=createCappedProjectionChainAuthority(policy());
  assert.throws(()=>authority.admit(receipt({complete:false,pages:[page({records:[]})]})),/incomplete/i);
  assert.throws(()=>authority.admit(receipt({pages:[page({moreRowsExist:true,nextBookmark:null,records:[record(),record({id:'job-1002',payloadDigest:PAYLOAD_B})]})]})),/bookmark.*required|terminal/i);
  const underCap=authority.admit(receipt({pages:[page({records:[]})]}));
  assert.equal(underCap.reportedRecordCount,0);
  assert.equal(underCap.deletionAuthority,false);
});

test('binds tenant configuration site projection query schema and scope',()=>{
  const authority=createCappedProjectionChainAuthority(policy());
  for(const [field,value] of [
    ['sourceTenantId','other-tenant'],['configurationId','CSI-TEST'],['siteId','YORK'],
    ['apiOrigin','https://other.example.com'],['apiVersion','mongoose-rest-v1'],
    ['projectionId','SLItems-WFM-v1'],['queryFingerprint',CONFLICT],
    ['schemaFingerprint',CONFLICT],['scopeFingerprint',CONFLICT]
  ]) assert.throws(()=>authority.admit(receipt({[field]:value})),/approved authority/i);
});

test('binds checkpoint and observation horizons outside the receipt',()=>{
  const authority=createCappedProjectionChainAuthority(policy());
  assert.throws(()=>authority.admit(receipt({checkpointPredecessor:'checkpoint:jobs:000041'})),/checkpoint predecessor/i);
  assert.throws(()=>authority.admit(receipt({observedAt:'2026-09-28T03:00:00Z'})),/observation horizon/i);
});

test('rejects provider errors, cap drift and unbounded receipts',()=>{
  const authority=createCappedProjectionChainAuthority(policy({maxPages:1,maxRecords:1}));
  assert.throws(()=>authority.admit(receipt({pages:[page({messageCode:1})]})),/provider.*error|messageCode/i);
  assert.throws(()=>authority.admit(receipt({pages:[page({effectiveRecordCap:200})]})),/record cap.*approved authority/i);
  assert.throws(()=>authority.admit(receipt({pages:[page({nextBookmark:BOOKMARK,moreRowsExist:true}),page({pageIndex:1,requestBookmark:BOOKMARK})]})),/page limit/i);
  assert.throws(()=>authority.admit(receipt({pages:[page({records:[record(),record({id:'job-1002',payloadDigest:PAYLOAD_B})]})]})),/record limit/i);
});

test('collapses exact versions and quarantines conflicting replays',()=>{
  const authority=createCappedProjectionChainAuthority(policy());
  const exact=authority.admit(receipt({pages:[page({records:[record(),{...record()}]})]}));
  assert.equal(exact.uniqueVersionCount,1);
  assert.equal(exact.exactReplayCount,1);
  assert.throws(()=>authority.admit(receipt({pages:[page({records:[record(),record({payloadDigest:CONFLICT})]})]})),/conflicting duplicate/i);
});

test('preserves opaque source identity bytes and uses collision-free identity tuples',()=>{
  const authority=createCappedProjectionChainAuthority(policy());
  const whitespaceDistinct=authority.admit(receipt({pages:[page({records:[
    record({id:'job',sourceVersion:'v1'}),
    record({id:' job',sourceVersion:'v1',payloadDigest:PAYLOAD_B})
  ]})]}));
  assert.equal(whitespaceDistinct.uniqueVersionCount,2);
  assert.deepEqual(whitespaceDistinct.records.map(item=>item.id).sort(),[' job','job']);

  const tupleDistinct=authority.admit(receipt({pages:[page({records:[
    record({id:'a\u0000b',sourceVersion:'c'}),
    record({id:'a',sourceVersion:'b\u0000c',payloadDigest:PAYLOAD_B})
  ]})]}));
  assert.equal(tupleDistinct.uniqueVersionCount,2);
});

test('partitions identical source IDs by site and projection',()=>{
  const leeds=createCappedProjectionChainAuthority(policy()).admit(receipt());
  const york=createCappedProjectionChainAuthority(policy({siteId:'YORK'})).admit(receipt({siteId:'YORK'}));
  const items=createCappedProjectionChainAuthority(policy({projectionId:'SLItems-WFM-v1'})).admit(receipt({projectionId:'SLItems-WFM-v1'}));
  assert.notEqual(leeds.checkpointNamespace,york.checkpointNamespace);
  assert.notEqual(leeds.records[0].scopedRecordFingerprint,york.records[0].scopedRecordFingerprint);
  assert.notEqual(leeds.checkpointNamespace,items.checkpointNamespace);
});

test('rejects secrets and executable evidence and returns immutable output',()=>{
  const secret=receipt();
  secret.pages[0].apiKey='do-not-store';
  assert.throws(()=>createCappedProjectionChainAuthority(policy()).admit(secret),/secret|credential/i);
  const arraySecret=receipt();
  arraySecret.pages.apiKey='do-not-store';
  assert.throws(()=>createCappedProjectionChainAuthority(policy()).admit(arraySecret),/secret|credential|array/i);
  const executable=receipt();
  Object.defineProperty(executable.pages[0].records[0],'id',{enumerable:true,get(){throw new Error('executed');}});
  assert.throws(()=>createCappedProjectionChainAuthority(policy()).admit(executable),/executable|hidden/i);
  const decision=createCappedProjectionChainAuthority(policy()).admit(receipt());
  assert.equal(Object.isFrozen(decision),true);
  assert.equal(Object.isFrozen(decision.records),true);
  assert.throws(()=>decision.records.push({}),TypeError);
});
