import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebhookReplaySnapshotAuthority} from './webhook-replay-snapshot-authority.mjs';

const fp=letter=>`sha256:${letter.repeat(64)}`;
const ids={
  principal:fp('a'),hmac:fp('b'),eventSchema:fp('c'),snapshotSchema:fp('d'),query:fp('e'),
  payloadA:fp('1'),payloadB:fp('2'),payloadC:fp('3')
};

const policy=(overrides={})=>({
  provider:'ukg-pro-wfm',wfmTenantId:'wfm-eu-1',connectionId:'ukg-conn-1',sourceTenantId:'org_ukg_eu_1',
  subscriptionId:'subscription-eu-1',region:'EU',apiOrigin:'https://webhooks-eu.ukg.net',apiVersion:'webhooks-v3',
  replayRoute:'/webhooks/v2/subscriptions/subscription-eu-1/messages/replays',
  auditRoute:'/webhooks/v3/subscriptions/subscription-eu-1/messages/replays/{replayId}/audit-logs',
  snapshotRoute:'/wfm/read-only/people-time-snapshot',eventAliases:['integration-completed','time-punch','work-shift'],
  principalFingerprint:ids.principal,hmacKeyRevisionFingerprint:ids.hmac,eventSchemaFingerprint:ids.eventSchema,
  snapshotSchemaFingerprint:ids.snapshotSchema,queryFingerprint:ids.query,
  expectedCheckpointPredecessor:'ukg-recovery:42',windowStart:'2026-09-28T10:00:00.000Z',
  windowEnd:'2026-09-28T11:00:00.000Z',expectedObservedAt:'2026-09-28T11:05:00.000Z',
  retentionDays:14,pageCount:100,maxAuditPages:10,maxMessages:10000,maxRecords:20000,maxTextBytes:512,
  ...overrides
});

const page=(overrides={})=>({
  currentToken:null,nextToken:null,successful:true,replayStatus:'success',
  auditLogs:[
    {messageId:'message-1',firstAttemptedAt:'2026-09-28T10:10:00.000Z',lastAttemptedAt:'2026-09-28T10:12:00.000Z',status:'success'},
    {messageId:'message-2',firstAttemptedAt:'2026-09-28T10:20:00.000Z',lastAttemptedAt:'2026-09-28T10:22:00.000Z',status:'success'}
  ],
  ...overrides
});

const delivery=(overrides={})=>({
  auditMessageId:'message-1',webhookId:'webhook-1',eventAlias:'time-punch',eventTime:'2026-09-28T10:09:00.000Z',
  hmacVerified:true,hmacKeyRevisionFingerprint:ids.hmac,sourceId:'employee-1',sourceVersion:'punch-7',payloadDigest:ids.payloadA,
  ...overrides
});

const receipt=()=>({
  provider:'ukg-pro-wfm',wfmTenantId:'wfm-eu-1',connectionId:'ukg-conn-1',sourceTenantId:'org_ukg_eu_1',
  subscriptionId:'subscription-eu-1',region:'EU',apiOrigin:'https://webhooks-eu.ukg.net',apiVersion:'webhooks-v3',
  replayRoute:'/webhooks/v2/subscriptions/subscription-eu-1/messages/replays',
  auditRoute:'/webhooks/v3/subscriptions/subscription-eu-1/messages/replays/{replayId}/audit-logs',
  snapshotRoute:'/wfm/read-only/people-time-snapshot',eventAliases:['integration-completed','time-punch','work-shift'],
  principalFingerprint:ids.principal,hmacKeyRevisionFingerprint:ids.hmac,eventSchemaFingerprint:ids.eventSchema,
  snapshotSchemaFingerprint:ids.snapshotSchema,queryFingerprint:ids.query,checkpointPredecessor:'ukg-recovery:42',
  observedAt:'2026-09-28T11:05:00.000Z',
  replayRequest:{
    status:'failed',sinceDateTime:'2026-09-28T10:00:00.000Z',untilDateTime:'2026-09-28T11:00:00.000Z',
    accepted:true,replayId:'replay-81',requestedAt:'2026-09-28T11:00:30.000Z'
  },
  auditPages:[page()],
  deliveries:[
    delivery(),
    delivery({auditMessageId:'message-2',webhookId:'webhook-2',eventAlias:'work-shift',eventTime:'2026-09-28T10:19:00.000Z',sourceId:'employee-2',sourceVersion:'shift-4',payloadDigest:ids.payloadB})
  ],
  fallbackSnapshot:{
    successful:true,complete:true,terminalPage:true,coveredFrom:'2026-09-28T10:00:00.000Z',coveredTo:'2026-09-28T11:00:00.000Z',
    records:[
      {sourceId:'employee-1',sourceVersion:'punch-7',payloadDigest:ids.payloadA},
      {sourceId:'employee-2',sourceVersion:'shift-4',payloadDigest:ids.payloadB},
      {sourceId:'employee-3',sourceVersion:'unchanged-2',payloadDigest:ids.payloadC}
    ]
  }
});

test('admits successful replay audit plus complete fallback snapshot as reconciliation evidence only',()=>{
  const decision=createWebhookReplaySnapshotAuthority(policy()).admit(receipt());
  assert.equal(decision.recoveryReconciliationCandidate,true);
  assert.equal(decision.replayedMessageCount,2);
  assert.equal(decision.deliveryCount,2);
  assert.equal(decision.snapshotRecordCount,3);
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.payrollAuthority,false);
  assert.equal(decision.attendanceAuthority,false);
  assert.equal(decision.operationalAuthority,false);
  assert.equal(decision.writeBackAuthority,false);
  assert.equal(decision.replayAuthority,false);
  assert.equal(decision.causalAuthority,false);
  assert.equal(JSON.stringify(decision).includes('employee-1'),false);
});

test('binds tenant connection subscription region endpoint routes schemas principal and HMAC revision',()=>{
  const authority=createWebhookReplaySnapshotAuthority(policy());
  for(const mutate of [
    value=>{value.wfmTenantId='other';},value=>{value.connectionId='other';},value=>{value.sourceTenantId='other';},
    value=>{value.subscriptionId='other';},value=>{value.region='US';},value=>{value.apiOrigin='https://webhooks.ukg.net';},
    value=>{value.apiVersion='webhooks-v2';},value=>{value.replayRoute='/other';},value=>{value.auditRoute='/other/{replayId}';},
    value=>{value.snapshotRoute='/other';},value=>{value.principalFingerprint=fp('9');},
    value=>{value.hmacKeyRevisionFingerprint=fp('9');},value=>{value.eventSchemaFingerprint=fp('9');},
    value=>{value.snapshotSchemaFingerprint=fp('9');},value=>{value.queryFingerprint=fp('9');}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/tenant|connection|subscription|region|origin|version|route|principal|hmac|schema|query/i);}
});

test('enforces provider replay and retention windows',()=>{
  assert.throws(()=>createWebhookReplaySnapshotAuthority(policy({windowEnd:'2026-09-29T10:00:00.000Z'})),/24 hours/i);
  assert.throws(()=>createWebhookReplaySnapshotAuthority(policy({retentionDays:15})),/retention/i);
  assert.throws(()=>createWebhookReplaySnapshotAuthority(policy({windowStart:'2026-02-30T10:00:00.000Z'})),/real UTC/i);
  const stale=receipt();stale.observedAt='2026-10-13T11:05:00.000Z';
  assert.throws(()=>createWebhookReplaySnapshotAuthority({...policy(),expectedObservedAt:'2026-10-13T11:05:00.000Z'}).admit(stale),/retention/i);
});

test('requires an accepted failed-only replay request for the exact closed window',()=>{
  const authority=createWebhookReplaySnapshotAuthority(policy());
  for(const mutate of [
    value=>{value.replayRequest.status='all';},value=>{value.replayRequest.accepted=false;},
    value=>{value.replayRequest.sinceDateTime='2026-09-28T10:00:01.000Z';},
    value=>{value.replayRequest.untilDateTime='2026-09-28T10:59:59.000Z';},
    value=>{value.replayRequest.replayId='';},value=>{value.replayRequest.requestedAt='2026-09-28T09:59:59.000Z';}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/failed|accepted|window|replay|request/i);}
});

test('requires a gapless terminal cursor chain with successful replay status',()=>{
  const authority=createWebhookReplaySnapshotAuthority(policy());
  const two=receipt();two.auditPages=[
    page({nextToken:'token-2',auditLogs:[page().auditLogs[0]]}),
    page({currentToken:'token-2',auditLogs:[page().auditLogs[1]]})
  ];
  assert.equal(authority.admit(two).replayedMessageCount,2);
  for(const mutate of [
    value=>{value.auditPages[0].successful=false;},value=>{value.auditPages[0].replayStatus='processing';},
    value=>{value.auditPages[0].currentToken='unexpected';},
    value=>{value.auditPages=[page({nextToken:'missing'})];},
    value=>{value.auditPages=[page({nextToken:'loop'}),page({currentToken:'loop',nextToken:'loop',auditLogs:[]})];}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/page|cursor|terminal|success|replay/i);}
});

test('enforces the configured provider page count on every audit page',()=>{
  const value=receipt();
  value.auditPages[0].auditLogs=Array.from({length:101},(_,index)=>({
    ...page().auditLogs[0],messageId:`message-${index+1}`
  }));
  value.deliveries=Array.from({length:101},(_,index)=>delivery({
    auditMessageId:`message-${index+1}`,webhookId:`webhook-${index+1}`,
    sourceId:`employee-${index+1}`,sourceVersion:`version-${index+1}`
  }));
  value.fallbackSnapshot.records=Array.from({length:101},(_,index)=>({
    sourceId:`employee-${index+1}`,sourceVersion:`version-${index+1}`,payloadDigest:ids.payloadA
  }));
  assert.throws(()=>createWebhookReplaySnapshotAuthority(policy()).admit(value),/page count|page.*limit/i);
});

test('requires unique successful audit messages with valid attempt chronology',()=>{
  const authority=createWebhookReplaySnapshotAuthority(policy());
  for(const mutate of [
    value=>{value.auditPages[0].auditLogs[0].status='failed';},
    value=>{value.auditPages[0].auditLogs[0].firstAttemptedAt='2026-09-28T10:13:00.000Z';},
    value=>{value.auditPages[0].auditLogs[0].lastAttemptedAt='2026-09-28T11:06:00.000Z';},
    value=>{value.auditPages[0].auditLogs[1].messageId='message-1';},
    value=>{value.auditPages[0].auditLogs.push({...value.auditPages[0].auditLogs[0],status:'failed'});}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/status|attempt|observation|duplicate|conflict/i);}
});

test('requires exactly one HMAC-verified delivery for every successful replay message',()=>{
  const authority=createWebhookReplaySnapshotAuthority(policy());
  for(const mutate of [
    value=>{value.deliveries.pop();},value=>{value.deliveries.push(delivery({auditMessageId:'message-extra'}));},
    value=>{value.deliveries[0].hmacVerified=false;},value=>{value.deliveries[0].hmacKeyRevisionFingerprint=fp('9');},
    value=>{value.deliveries[0].eventAlias='employee-delete';},value=>{value.deliveries[0].eventTime='2026-09-28T09:59:59.000Z';}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/delivery|hmac|alias|window|message/i);}
});

test('collapses byte-identical delivery retries but rejects conflicting replay',()=>{
  const value=receipt();value.deliveries.push({...value.deliveries[0]});
  const decision=createWebhookReplaySnapshotAuthority(policy()).admit(value);
  assert.equal(decision.deliveryCount,2);
  assert.equal(decision.exactDeliveryReplayCount,1);
  const conflict=receipt();conflict.deliveries.push({...conflict.deliveries[0],payloadDigest:fp('9')});
  assert.throws(()=>createWebhookReplaySnapshotAuthority(policy()).admit(conflict),/conflicting delivery/i);
});

test('requires a complete exact-window fallback snapshot matching each source latest delivery',()=>{
  const authority=createWebhookReplaySnapshotAuthority(policy());
  const later=receipt();
  later.deliveries.push(delivery({auditMessageId:'message-1',webhookId:'webhook-1b',eventTime:'2026-09-28T10:11:00.000Z',sourceVersion:'punch-8',payloadDigest:ids.payloadC}));
  later.fallbackSnapshot.records[0]={sourceId:'employee-1',sourceVersion:'punch-8',payloadDigest:ids.payloadC};
  assert.equal(authority.admit(later).deliveryCount,3);
  for(const mutate of [
    value=>{value.fallbackSnapshot.successful=false;},value=>{value.fallbackSnapshot.complete=false;},
    value=>{value.fallbackSnapshot.terminalPage=false;},value=>{value.fallbackSnapshot.coveredFrom='2026-09-28T10:00:01.000Z';},
    value=>{value.fallbackSnapshot.coveredTo='2026-09-28T10:59:59.000Z';},value=>{value.fallbackSnapshot.records.shift();},
    value=>{value.fallbackSnapshot.records[0].sourceVersion='punch-6';},value=>{value.fallbackSnapshot.records[0].payloadDigest=fp('9');}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/snapshot|complete|terminal|window|latest|payload|version/i);}
});

test('preserves distinct Unicode identities without exposing source identifiers',()=>{
  const value=receipt();
  value.deliveries[0].sourceId='é';value.deliveries[1].sourceId='e\u0301';
  value.fallbackSnapshot.records[0].sourceId='é';value.fallbackSnapshot.records[1].sourceId='e\u0301';
  const decision=createWebhookReplaySnapshotAuthority(policy()).admit(value);
  assert.notEqual(decision.sourceCoverage[0].scopedSourceFingerprint,decision.sourceCoverage[1].scopedSourceFingerprint);
  assert.equal(JSON.stringify(decision).includes('é'),false);
});

test('rejects sparse oversized secret executable hidden and unsafe route evidence',()=>{
  const authority=createWebhookReplaySnapshotAuthority(policy());
  const sparse=receipt();sparse.auditPages.length=3;
  assert.throws(()=>authority.admit(sparse),/sparse/i);
  const oversized=receipt();oversized.auditPages[0].auditLogs=Array.from({length:10001},(_,index)=>({...page().auditLogs[0],messageId:`m-${index}`}));
  assert.throws(()=>authority.admit(oversized),/message|limit/i);
  const secret=receipt();secret.clientSecret='nope';
  assert.throws(()=>authority.admit(secret),/secret|not allowed/i);
  const executable=receipt();Object.defineProperty(executable.replayRequest,'accepted',{enumerable:true,get(){throw new Error('executed');}});
  assert.throws(()=>authority.admit(executable),/executable|hidden/i);
  const hidden=receipt();Object.defineProperty(hidden.deliveries[0],'extra',{enumerable:false,value:'hidden'});
  assert.throws(()=>authority.admit(hidden),/hidden/i);
  assert.throws(()=>createWebhookReplaySnapshotAuthority({...policy(),snapshotRoute:'/../admin'}),/route/i);
});

test('binds caps event aliases and observed transport evidence into deterministic immutable output',()=>{
  const first=createWebhookReplaySnapshotAuthority(policy()).admit(receipt());
  const second=createWebhookReplaySnapshotAuthority(policy()).admit(receipt());
  assert.equal(first.reconciliationFingerprint,second.reconciliationFingerprint);
  const reordered=createWebhookReplaySnapshotAuthority({...policy(),eventAliases:['work-shift','time-punch','integration-completed']}).admit(receipt());
  assert.equal(first.authorityFingerprint,reordered.authorityFingerprint);
  const capped=createWebhookReplaySnapshotAuthority({...policy(),maxRecords:19999}).admit(receipt());
  assert.notEqual(first.authorityFingerprint,capped.authorityFingerprint);
  const transport=receipt();transport.deliveries[0].webhookId='webhook-transport-changed';
  assert.notEqual(first.reconciliationFingerprint,createWebhookReplaySnapshotAuthority(policy()).admit(transport).reconciliationFingerprint);
  assert.throws(()=>{first.sourceCoverage.push('x');},TypeError);
  assert.throws(()=>{first.deliveryCount=0;},TypeError);
});
