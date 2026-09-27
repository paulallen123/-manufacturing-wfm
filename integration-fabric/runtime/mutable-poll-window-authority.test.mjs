import test from 'node:test';
import assert from 'node:assert/strict';
import {createMutablePollWindowAuthority} from './mutable-poll-window-authority.mjs';

const policy=(overrides={})=>({
  provider:'maintainx',
  wfmTenantId:'tenant-uk-1',
  connectionId:'connection-maintainx-1',
  organizationId:'321',
  apiOrigin:'https://api.getmaintainx.com',
  apiVersion:'v1',
  resource:'workorders',
  paginationMode:'cursor',
  queryFingerprint:'sha256:open-workorders-v1',
  schemaFingerprint:'sha256:maintainx-workorder-v1',
  overlapSeconds:0,
  maxWindowSeconds:86400,
  maxPages:10,
  maxRecords:1000,
  maxClockSkewSeconds:60,
  ...overrides
});

const record=(overrides={})=>({
  id:'1001',
  organizationId:'321',
  updatedAt:'2026-09-27T01:05:00Z',
  payloadDigest:'sha256:workorder-1001-v1',
  ...overrides
});

const page=(overrides={})=>({
  pageIndex:0,
  requestCursor:null,
  nextCursor:null,
  lowerBoundApplied:'2026-09-27T01:00:00Z',
  queryFingerprint:'sha256:open-workorders-v1',
  records:[record()],
  ...overrides
});

const batch=(overrides={})=>({
  provider:'maintainx',
  wfmTenantId:'tenant-uk-1',
  connectionId:'connection-maintainx-1',
  organizationId:'321',
  apiOrigin:'https://api.getmaintainx.com',
  apiVersion:'v1',
  resource:'workorders',
  paginationMode:'cursor',
  queryFingerprint:'sha256:open-workorders-v1',
  schemaFingerprint:'sha256:maintainx-workorder-v1',
  windowStartInclusive:'2026-09-27T01:00:00Z',
  observedAt:'2026-09-27T01:10:00Z',
  complete:true,
  paginationComplete:true,
  pages:[page()],
  ...overrides
});

test('admits a complete cursor chain only as a watermark reconciliation candidate',()=>{
  const decision=createMutablePollWindowAuthority(policy()).admitBatch(batch());
  assert.equal(decision.pollWindowReconciliationCandidate,true);
  assert.equal(decision.watermarkCandidate,'2026-09-27T01:05:00.000Z');
  assert.equal(decision.nextPollFromInclusive,'2026-09-27T01:05:00.000Z');
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.writeBackAuthority,false);
  assert.equal(decision.payrollAuthority,false);
  assert.match(decision.checkpointNamespace,/^mutable-poll:[a-f0-9]{64}$/);
});

test('requires the identical lower bound and query on every page',()=>{
  const authority=createMutablePollWindowAuthority(policy());
  const pages=[
    page({pageIndex:0,nextCursor:'cursor-1'}),
    page({pageIndex:1,requestCursor:'cursor-1',lowerBoundApplied:'2026-09-27T01:02:00Z'})
  ];
  assert.throws(()=>authority.admitBatch(batch({pages})),/lower bound.*every page/i);
  pages[1]=page({pageIndex:1,requestCursor:'cursor-1',queryFingerprint:'sha256:changed'});
  assert.throws(()=>authority.admitBatch(batch({pages})),/queryFingerprint.*approved authority/i);
});

test('rejects cursor gaps, loops, duplicate page receipts and non-terminal chains',()=>{
  const authority=createMutablePollWindowAuthority(policy());
  assert.throws(()=>authority.admitBatch(batch({pages:[page({nextCursor:'cursor-1'}),page({pageIndex:1,requestCursor:'wrong'})]})),/cursor chain/i);
  assert.throws(()=>authority.admitBatch(batch({pages:[page({nextCursor:'cursor-1'}),page({pageIndex:1,requestCursor:'cursor-1',nextCursor:'cursor-1'})]})),/cursor loop/i);
  assert.throws(()=>authority.admitBatch(batch({pages:[page(),page()]})),/pageIndex.*sequence/i);
  assert.throws(()=>authority.admitBatch(batch({pages:[page({nextCursor:'cursor-1'})]})),/terminal cursor/i);
});

test('requires overlap replay for offset pagination and derives the overlapped next window',()=>{
  const offsetPolicy=policy({resource:'assets',paginationMode:'offset',queryFingerprint:'sha256:assets-v1',overlapSeconds:120});
  const pages=[
    {pageIndex:0,requestOffset:0,nextOffset:2,lowerBoundApplied:'2026-09-27T01:00:00Z',queryFingerprint:'sha256:assets-v1',records:[record()]},
    {pageIndex:1,requestOffset:2,nextOffset:null,lowerBoundApplied:'2026-09-27T01:00:00Z',queryFingerprint:'sha256:assets-v1',records:[record({id:'1002',updatedAt:'2026-09-27T01:08:00Z',payloadDigest:'sha256:asset-1002'})]}
  ];
  const decision=createMutablePollWindowAuthority(offsetPolicy).admitBatch(batch({resource:'assets',paginationMode:'offset',queryFingerprint:'sha256:assets-v1',pages}));
  assert.equal(decision.watermarkCandidate,'2026-09-27T01:08:00.000Z');
  assert.equal(decision.nextPollFromInclusive,'2026-09-27T01:06:00.000Z');
  assert.throws(()=>createMutablePollWindowAuthority({...offsetPolicy,overlapSeconds:0}),/offset.*overlap/i);
});

test('rejects offset gaps and repeated offsets',()=>{
  const authority=createMutablePollWindowAuthority(policy({resource:'assets',paginationMode:'offset',queryFingerprint:'sha256:assets-v1',overlapSeconds:60}));
  const base={resource:'assets',paginationMode:'offset',queryFingerprint:'sha256:assets-v1'};
  assert.throws(()=>authority.admitBatch(batch({...base,pages:[
    {pageIndex:0,requestOffset:0,nextOffset:2,lowerBoundApplied:'2026-09-27T01:00:00Z',queryFingerprint:'sha256:assets-v1',records:[]},
    {pageIndex:1,requestOffset:3,nextOffset:null,lowerBoundApplied:'2026-09-27T01:00:00Z',queryFingerprint:'sha256:assets-v1',records:[]}
  ]})),/offset chain/i);
  assert.throws(()=>authority.admitBatch(batch({...base,pages:[
    {pageIndex:0,requestOffset:0,nextOffset:0,lowerBoundApplied:'2026-09-27T01:00:00Z',queryFingerprint:'sha256:assets-v1',records:[]}
  ]})),/offset loop/i);
});

test('isolates organization identity and rejects scope drift',()=>{
  const authority=createMutablePollWindowAuthority(policy());
  assert.throws(()=>authority.admitBatch(batch({organizationId:'999'})),/organizationId.*approved authority/i);
  assert.throws(()=>authority.admitBatch(batch({pages:[page({records:[record({organizationId:'999'})]})]})),/record.*organization/i);
  const other=createMutablePollWindowAuthority(policy({connectionId:'connection-maintainx-2',organizationId:'999'})).admitBatch(batch({connectionId:'connection-maintainx-2',organizationId:'999',pages:[page({records:[record({organizationId:'999'})]})]}));
  const first=authority.admitBatch(batch());
  assert.notEqual(first.checkpointNamespace,other.checkpointNamespace);
  assert.notEqual(first.records[0].scopedRecordFingerprint,other.records[0].scopedRecordFingerprint);
});

test('collapses exact page overlap replays but quarantines divergent same-version payloads',()=>{
  const exact=createMutablePollWindowAuthority(policy()).admitBatch(batch({pages:[page({records:[record(),{...record()}]})]}));
  assert.equal(exact.uniqueVersionCount,1);
  assert.equal(exact.exactReplayCount,1);
  assert.throws(()=>createMutablePollWindowAuthority(policy()).admitBatch(batch({pages:[page({records:[record(),record({payloadDigest:'sha256:conflict'})]})]})),/conflicting duplicate/i);
});

test('preserves distinct source versions for the same record',()=>{
  const decision=createMutablePollWindowAuthority(policy()).admitBatch(batch({pages:[page({records:[
    record(),record({updatedAt:'2026-09-27T01:06:00Z',payloadDigest:'sha256:workorder-1001-v2'})
  ]})]}));
  assert.equal(decision.uniqueVersionCount,2);
  assert.deepEqual(decision.records.map(item=>item.updatedAt),['2026-09-27T01:05:00.000Z','2026-09-27T01:06:00.000Z']);
});

test('rejects incomplete evidence, over-limit batches and out-of-window versions',()=>{
  const authority=createMutablePollWindowAuthority(policy());
  assert.throws(()=>authority.admitBatch(batch({complete:false})),/incomplete/i);
  assert.throws(()=>authority.admitBatch(batch({paginationComplete:false})),/pagination.*incomplete/i);
  assert.throws(()=>createMutablePollWindowAuthority(policy({maxPages:1})).admitBatch(batch({pages:[page({nextCursor:'c1'}),page({pageIndex:1,requestCursor:'c1'})]})),/page limit/i);
  assert.throws(()=>authority.admitBatch(batch({pages:[page({records:[record({updatedAt:'2026-09-27T00:59:59Z'})]})]})),/before.*lower bound/i);
  assert.throws(()=>authority.admitBatch(batch({pages:[page({records:[record({updatedAt:'2026-09-27T01:11:01Z'})]})]})),/clock-skew/i);
});

test('an empty complete window cannot invent a watermark or deletion authority',()=>{
  const decision=createMutablePollWindowAuthority(policy()).admitBatch(batch({pages:[page({records:[]})]}));
  assert.equal(decision.watermarkCandidate,null);
  assert.equal(decision.nextPollFromInclusive,'2026-09-27T01:00:00.000Z');
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.checkpointAdvanceAllowed,false);
});

test('rejects secrets, executable data, non-HTTPS origins and mutation-shaped resources',()=>{
  const secret=batch();
  secret.pages[0].records[0].apiKey='do-not-store';
  assert.throws(()=>createMutablePollWindowAuthority(policy()).admitBatch(secret),/secret|credential/i);
  const snakeSecret=batch();
  snakeSecret.pages[0].records[0].api_key='do-not-store-either';
  assert.throws(()=>createMutablePollWindowAuthority(policy()).admitBatch(snakeSecret),/secret|credential/i);
  const executable=batch();
  Object.defineProperty(executable.pages[0].records[0],'id',{enumerable:true,get(){throw new Error('executed');}});
  assert.throws(()=>createMutablePollWindowAuthority(policy()).admitBatch(executable),/executable|hidden/i);
  assert.throws(()=>createMutablePollWindowAuthority(policy({apiOrigin:'http://api.getmaintainx.com'})),/exact HTTPS origin/i);
  assert.throws(()=>createMutablePollWindowAuthority(policy({resource:'workorders/1001/comments'})),/resource/i);
});

test('returns deeply immutable evidence',()=>{
  const decision=createMutablePollWindowAuthority(policy()).admitBatch(batch());
  assert.equal(Object.isFrozen(decision),true);
  assert.equal(Object.isFrozen(decision.records),true);
  assert.equal(Object.isFrozen(decision.records[0]),true);
  assert.throws(()=>decision.records.push({}),TypeError);
});
