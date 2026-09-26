import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagedTaskIngressAuthority} from './managed-task-ingress-authority.mjs';

const policy=()=>({
  provider:'snaplogic',
  wfmTenantId:'tenant-uk-01',
  connectionId:'connection-snaplogic-01',
  environmentId:'customer-prod-emea',
  controlPlaneHost:'emea.snaplogic.com',
  taskPath:'/api/1/rest/slsched/feed/customer/project/wfm-workers',
  taskRevision:'task-17',
  pipelineRevision:'pipeline-42',
  schemaFingerprint:'sha256:workers-v4',
  credentialRevision:'credential-9',
  method:'POST',
  parameterNames:['sourceWindowFrom','sourceWindowTo'],
  sourceAuthority:'read-only-projection',
  sinkAuthority:'wfm-ingress-only',
  mutationAuthority:false
});

const request=()=>({
  provider:'snaplogic',
  wfmTenantId:'tenant-uk-01',
  connectionId:'connection-snaplogic-01',
  environmentId:'customer-prod-emea',
  url:'https://emea.snaplogic.com/api/1/rest/slsched/feed/customer/project/wfm-workers',
  method:'POST',
  authPlacement:'authorization-header',
  taskRevision:'task-17',
  pipelineRevision:'pipeline-42',
  schemaFingerprint:'sha256:workers-v4',
  parameters:{
    sourceWindowFrom:'2026-09-26T15:00:00.000Z',
    sourceWindowTo:'2026-09-26T16:00:00.000Z'
  }
});

const receipt=plan=>({
  planFingerprint:plan.planFingerprint,
  ruuid:'52d66e5a-cd52-4e14-90a1-4450938aa991',
  state:'Completed',
  startedAt:'2026-09-26T16:00:01.000Z',
  completedAt:'2026-09-26T16:00:12.000Z',
  taskRevision:'task-17',
  pipelineRevision:'pipeline-42',
  schemaFingerprint:'sha256:workers-v4',
  errorDocumentCount:0,
  failedSnapCount:0,
  reportedRecordCount:3,
  records:[
    {sourceRecordId:'worker-1',sourceVersion:'7',payloadDigest:'sha256:worker-1-v7'},
    {sourceRecordId:'worker-1',sourceVersion:'7',payloadDigest:'sha256:worker-1-v7'},
    {sourceRecordId:'worker-2',sourceVersion:'3',payloadDigest:'sha256:worker-2-v3'}
  ]
});

test('exact read-only task compiles to a stable header-authenticated ingress plan',()=>{
  const authority=createManagedTaskIngressAuthority(policy());
  const first=authority.authorize(request());
  const second=authority.authorize(request());
  assert.equal(first.authority,'read-ingress-only');
  assert.equal(first.planFingerprint,second.planFingerprint);
  assert.match(first.checkpointNamespace,/^managed-task:[a-f0-9]{64}$/);
  assert.equal(first.controlPlaneHost,'emea.snaplogic.com');
  assert.equal(first.taskPath,'/api/1/rest/slsched/feed/customer/project/wfm-workers');
  assert.equal(Object.isFrozen(first),true);
});

test('query credentials and mutation-capable task contracts are rejected before invocation',()=>{
  const queryAuth=request();
  queryAuth.authPlacement='query-parameter';
  assert.throws(()=>createManagedTaskIngressAuthority(policy()).authorize(queryAuth),/authorization header/i);

  for(const mutate of [
    value=>{value.sourceAuthority='read-write';},
    value=>{value.sinkAuthority='arbitrary-destination';},
    value=>{value.mutationAuthority=true;}
  ]){
    const candidate=policy();
    mutate(candidate);
    assert.throws(()=>createManagedTaskIngressAuthority(candidate),/read-only|ingress|mutation/i);
  }
});

test('route, method, revision, schema and parameter drift fail closed',()=>{
  const changes={
    wfmTenantId:'tenant-other',
    connectionId:'connection-other',
    environmentId:'customer-test-emea',
    url:'https://elastic.snaplogic.com/api/1/rest/slsched/feed/customer/project/wfm-workers',
    method:'DELETE',
    taskRevision:'task-18',
    pipelineRevision:'pipeline-43',
    schemaFingerprint:'sha256:other'
  };
  for(const [field,value] of Object.entries(changes)){
    assert.throws(()=>createManagedTaskIngressAuthority(policy()).authorize({...request(),[field]:value}),undefined,field);
  }
  assert.throws(()=>createManagedTaskIngressAuthority(policy()).authorize({
    ...request(),parameters:{...request().parameters,adminAction:'stop-pipeline'}
  }),/parameter/i);
});

test('completed error-free execution deduplicates exact replays without granting checkpoint authority',()=>{
  const authority=createManagedTaskIngressAuthority(policy());
  const plan=authority.authorize(request());
  const admitted=authority.admitExecution(plan,receipt(plan));
  assert.equal(admitted.reconciliationCandidate,true);
  assert.equal(admitted.checkpointAdvanceAllowed,false);
  assert.equal(admitted.deletionAuthority,false);
  assert.equal(admitted.reportedRecordCount,3);
  assert.equal(admitted.uniqueRecordCount,2);
  assert.equal(admitted.exactReplayCount,1);
  assert.deepEqual(admitted.recordIdentities,[
    '["worker-1","7","sha256:worker-1-v7"]',
    '["worker-2","3","sha256:worker-2-v3"]'
  ]);
});

test('structured identity framing keeps delimiter-bearing source IDs distinct',()=>{
  const authority=createManagedTaskIngressAuthority(policy());
  const plan=authority.authorize(request());
  const candidate=receipt(plan);
  candidate.records=[
    {sourceRecordId:'worker\u001f1',sourceVersion:'2',payloadDigest:'sha256:first'},
    {sourceRecordId:'worker',sourceVersion:'1\u001f2',payloadDigest:'sha256:second'}
  ];
  candidate.reportedRecordCount=2;
  const admitted=authority.admitExecution(plan,candidate);
  assert.equal(admitted.uniqueRecordCount,2);
  assert.equal(admitted.exactReplayCount,0);
});

test('conflicting duplicate identity is quarantined instead of choosing a payload',()=>{
  const authority=createManagedTaskIngressAuthority(policy());
  const plan=authority.authorize(request());
  const candidate=receipt(plan);
  candidate.records[1].payloadDigest='sha256:conflict';
  assert.throws(()=>authority.admitExecution(plan,candidate),/conflicting duplicate/i);
});

test('nonterminal, failed, misbound and impossible-time executions are quarantined',()=>{
  const mutations=[
    value=>{value.state='Started';},
    value=>{value.errorDocumentCount=1;},
    value=>{value.failedSnapCount=1;},
    value=>{value.reportedRecordCount=4;},
    value=>{value.planFingerprint='sha256:other';},
    value=>{value.taskRevision='task-18';},
    value=>{value.pipelineRevision='pipeline-43';},
    value=>{value.schemaFingerprint='sha256:other';},
    value=>{value.completedAt='2026-09-26T15:59:59.000Z';},
    value=>{value.startedAt='2026-02-31T00:00:00.000Z';}
  ];
  for(const mutate of mutations){
    const authority=createManagedTaskIngressAuthority(policy());
    const plan=authority.authorize(request());
    const candidate=receipt(plan);
    mutate(candidate);
    assert.throws(()=>authority.admitExecution(plan,candidate));
  }
});

test('secret-like fields and fabricated plans never enter evidence',()=>{
  assert.throws(()=>createManagedTaskIngressAuthority({...policy(),bearerToken:'synthetic-secret'}),/secret|credential material/i);
  const authority=createManagedTaskIngressAuthority(policy());
  assert.throws(()=>authority.authorize({...request(),authorization:'Bearer synthetic-secret'}),/secret|credential material/i);
  const plan=authority.authorize(request());
  assert.throws(()=>authority.admitExecution({...plan},{...receipt(plan)}),/not issued/i);
  assert.throws(()=>authority.admitExecution(plan,{...receipt(plan),cookie:'synthetic-secret'}),/secret|credential material/i);
  assert.ok(!JSON.stringify(plan).includes('synthetic-secret'));
});
