import test from 'node:test';
import assert from 'node:assert/strict';
import {createCapabilityPagedReadAuthority} from './capability-paged-read-authority.mjs';

const METADATA=`sha256:${'1'.repeat(64)}`;
const QUERY=`sha256:${'2'.repeat(64)}`;
const SCHEMA=`sha256:${'3'.repeat(64)}`;
const PAYLOAD_A=`sha256:${'4'.repeat(64)}`;
const PAYLOAD_B=`sha256:${'5'.repeat(64)}`;
const CONFLICT=`sha256:${'6'.repeat(64)}`;
const CURSOR='<Page><Program>PMS100MI</Program><Key>100</Key></Page>';

const policy=(overrides={})=>({
  provider:'infor-m3',
  wfmTenantId:'tenant-uk-1',
  connectionId:'connection-m3-1',
  sourceTenantId:'M3_TENANT',
  companyId:'100',
  divisionId:'AAA',
  facilityId:'FAB1',
  apiOrigin:'https://mingle-ionapi.eu1.inforcloudsuite.com',
  apiVersion:'m3-mi-rest-v2',
  program:'PMS100MI',
  transaction:'SearchMO',
  operationClass:'read-list',
  paginationSupported:true,
  metadataFingerprint:METADATA,
  queryFingerprint:QUERY,
  schemaFingerprint:SCHEMA,
  expectedCheckpointPredecessor:'checkpoint:m3-mo:000042',
  expectedObservedAt:'2026-09-27T04:00:00Z',
  recordCap:100,
  maxPages:20,
  maxRecords:2000,
  maxCursorBytes:4096,
  ...overrides
});

const record=(overrides={})=>({id:'mo-1001',sourceVersion:'2026-09-27T03:30:00Z',payloadDigest:PAYLOAD_A,...overrides});

const page=(overrides={})=>({
  pageIndex:0,
  requestCursor:null,
  nextCursor:null,
  hasMore:false,
  successful:true,
  recordCap:100,
  metadataFingerprint:METADATA,
  queryFingerprint:QUERY,
  schemaFingerprint:SCHEMA,
  records:[record()],
  ...overrides
});

const receipt=(overrides={})=>({
  provider:'infor-m3',
  wfmTenantId:'tenant-uk-1',
  connectionId:'connection-m3-1',
  sourceTenantId:'M3_TENANT',
  companyId:'100',
  divisionId:'AAA',
  facilityId:'FAB1',
  apiOrigin:'https://mingle-ionapi.eu1.inforcloudsuite.com',
  apiVersion:'m3-mi-rest-v2',
  program:'PMS100MI',
  transaction:'SearchMO',
  operationClass:'read-list',
  metadataFingerprint:METADATA,
  queryFingerprint:QUERY,
  schemaFingerprint:SCHEMA,
  checkpointPredecessor:'checkpoint:m3-mo:000042',
  observedAt:'2026-09-27T04:00:00Z',
  complete:true,
  pages:[page()],
  ...overrides
});

test('admits only a terminal capability-proven page chain as reconciliation evidence',()=>{
  const pages=[
    page({hasMore:true,nextCursor:CURSOR,records:Array.from({length:100},(_,i)=>record({id:`mo-${1000+i}`,payloadDigest:i?PAYLOAD_B:PAYLOAD_A}))}),
    page({pageIndex:1,requestCursor:CURSOR,records:[record({id:'mo-2000',payloadDigest:CONFLICT})]})
  ];
  const decision=createCapabilityPagedReadAuthority(policy()).admit(receipt({pages}));
  assert.equal(decision.pagedReadReconciliationCandidate,true);
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.writeBackAuthority,false);
  assert.equal(decision.uniqueVersionCount,101);
  assert.doesNotMatch(JSON.stringify(decision),/<Page>|PMS100MI<\/Program>/);
});

test('rejects operations without proven pagination or read-list semantics',()=>{
  assert.throws(()=>createCapabilityPagedReadAuthority(policy({paginationSupported:false})),/pagination.*proven|unsupported/i);
  assert.throws(()=>createCapabilityPagedReadAuthority(policy({operationClass:'update'})),/read-list|mutation/i);
});

test('requires continuation continuity terminal agreement and receipt completeness',()=>{
  const authority=createCapabilityPagedReadAuthority(policy());
  assert.throws(()=>authority.admit(receipt({complete:false})),/incomplete/i);
  assert.throws(()=>authority.admit(receipt({pages:[page({hasMore:true,nextCursor:null})]})),/cursor.*required|terminal/i);
  assert.throws(()=>authority.admit(receipt({pages:[page({hasMore:false,nextCursor:CURSOR})]})),/cursor.*forbidden|terminal/i);
  assert.throws(()=>authority.admit(receipt({pages:[page({hasMore:true,nextCursor:CURSOR}),page({pageIndex:1,requestCursor:'wrong'})]})),/cursor chain/i);
  assert.throws(()=>authority.admit(receipt({pages:[page({hasMore:true,nextCursor:CURSOR})]})),/terminal|incomplete/i);
});

test('does not infer completeness from a successful capped page',()=>{
  const authority=createCapabilityPagedReadAuthority(policy());
  const full=page({hasMore:true,nextCursor:null,records:Array.from({length:100},(_,i)=>record({id:`mo-${i}`,payloadDigest:i?PAYLOAD_B:PAYLOAD_A}))});
  assert.throws(()=>authority.admit(receipt({pages:[full]})),/cursor.*required|terminal/i);
});

test('binds tenant company division facility operation metadata query and schema',()=>{
  const authority=createCapabilityPagedReadAuthority(policy());
  for(const [field,value] of [
    ['sourceTenantId','OTHER'],['companyId','200'],['divisionId','BBB'],['facilityId','FAB2'],
    ['apiOrigin','https://other.example.com'],['apiVersion','v1'],['program','MMS200MI'],
    ['transaction','LstItmWhs'],['metadataFingerprint',CONFLICT],['queryFingerprint',CONFLICT],
    ['schemaFingerprint',CONFLICT]
  ]) assert.throws(()=>authority.admit(receipt({[field]:value})),/approved authority/i);
});

test('binds checkpoint observation cap and bounded execution',()=>{
  const authority=createCapabilityPagedReadAuthority(policy({maxPages:1,maxRecords:1}));
  assert.throws(()=>authority.admit(receipt({checkpointPredecessor:'checkpoint:m3-mo:000041'})),/checkpoint predecessor/i);
  assert.throws(()=>authority.admit(receipt({observedAt:'2026-09-28T04:00:00Z'})),/observation horizon/i);
  assert.throws(()=>authority.admit(receipt({pages:[page({recordCap:99})]})),/record cap.*approved authority/i);
  assert.throws(()=>authority.admit(receipt({pages:[page({hasMore:true,nextCursor:CURSOR}),page({pageIndex:1,requestCursor:CURSOR})]})),/page limit/i);
  assert.throws(()=>authority.admit(receipt({pages:[page({records:[record(),record({id:'mo-2',payloadDigest:PAYLOAD_B})]})]})),/record limit/i);
});

test('quarantines failed pages and conflicting replays',()=>{
  const authority=createCapabilityPagedReadAuthority(policy());
  assert.throws(()=>authority.admit(receipt({pages:[page({successful:false})]})),/provider.*failed|successful/i);
  const exact=authority.admit(receipt({pages:[page({records:[record(),{...record()}]})]}));
  assert.equal(exact.exactReplayCount,1);
  assert.throws(()=>authority.admit(receipt({pages:[page({records:[record(),record({payloadDigest:CONFLICT})]})]})),/conflicting duplicate/i);
});

test('preserves opaque identity tuples without delimiter or normalization collisions',()=>{
  const authority=createCapabilityPagedReadAuthority(policy());
  const decision=authority.admit(receipt({pages:[page({records:[
    record({id:'mo',sourceVersion:' v1'}),
    record({id:' mo',sourceVersion:'v1',payloadDigest:PAYLOAD_B}),
    record({id:'a\u0000b',sourceVersion:'c',payloadDigest:CONFLICT}),
    record({id:'a',sourceVersion:'b\u0000c',payloadDigest:`sha256:${'7'.repeat(64)}`})
  ]})]}));
  assert.equal(decision.uniqueVersionCount,4);
});

test('rejects secret or executable evidence and returns deeply immutable output',()=>{
  const secret=receipt();
  secret.pages.apiKey='do-not-store';
  assert.throws(()=>createCapabilityPagedReadAuthority(policy()).admit(secret),/secret|credential/i);
  const executable=receipt();
  Object.defineProperty(executable.pages[0].records[0],'id',{enumerable:true,get(){throw new Error('executed');}});
  assert.throws(()=>createCapabilityPagedReadAuthority(policy()).admit(executable),/executable|hidden/i);
  const decision=createCapabilityPagedReadAuthority(policy()).admit(receipt());
  assert.equal(Object.isFrozen(decision),true);
  assert.equal(Object.isFrozen(decision.records),true);
  assert.throws(()=>decision.records.push({}),TypeError);
});
