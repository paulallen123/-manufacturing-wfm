import test from 'node:test';
import assert from 'node:assert/strict';
import {createManufacturingObservationAuthority} from './manufacturing-observation-authority.mjs';

const policy=(overrides={})=>({
  provider:'sap-digital-manufacturing',
  wfmTenantId:'tenant-uk-1',
  connectionId:'connection-sap-dm-1',
  sourceInstanceId:'dm-eu20-tenant-42',
  plantId:'plant-1000',
  apiOrigin:'https://api.eu20.dmc.cloud.sap',
  apiVersion:'oee-v1',
  dataset:'production-summary',
  sourceKind:'analytic-projection',
  schemaFingerprint:'sha256:sap-dm-oee-production-summary-v1',
  approvedMetrics:[
    {metric:'yield',unit:'EA'},
    {metric:'scrap',unit:'EA'},
    {metric:'availability-loss',unit:'SECOND'}
  ],
  approvedResources:['resource-line-1','resource-line-2'],
  maxWindowSeconds:604800,
  maxLagSeconds:900,
  maxResources:5,
  maxObservations:20,
  ...overrides
});

const observation=(overrides={})=>({
  sourceId:'summary-1',
  sourceVersion:'2026-09-26T21:05:00Z',
  metric:'yield',
  value:'120.5',
  unit:'EA',
  occurredAt:'2026-09-26T21:00:00Z',
  resourceId:'resource-line-1',
  workCenterId:'work-centre-assembly',
  orderId:'order-7001',
  operationId:'operation-20',
  payloadDigest:'sha256:summary-1-yield',
  ...overrides
});

const run=(overrides={})=>({
  provider:'sap-digital-manufacturing',
  wfmTenantId:'tenant-uk-1',
  connectionId:'connection-sap-dm-1',
  sourceInstanceId:'dm-eu20-tenant-42',
  plantId:'plant-1000',
  apiOrigin:'https://api.eu20.dmc.cloud.sap',
  apiVersion:'oee-v1',
  dataset:'production-summary',
  sourceKind:'analytic-projection',
  schemaFingerprint:'sha256:sap-dm-oee-production-summary-v1',
  windowStart:'2026-09-26T20:00:00Z',
  windowEnd:'2026-09-26T22:00:00Z',
  dataAvailableThrough:'2026-09-26T21:58:00Z',
  observedAt:'2026-09-26T22:00:00Z',
  complete:true,
  observations:[
    observation(),
    observation({
      sourceId:'summary-2',metric:'scrap',value:'3',payloadDigest:'sha256:summary-2-scrap'
    })
  ],
  ...overrides
});

test('admits exact-scope analytical manufacturing observations without action authority',()=>{
  const decision=createManufacturingObservationAuthority(policy()).admitWindow(run());
  assert.equal(decision.derivedObservationCandidate,true);
  assert.equal(decision.transactionalEvidenceCandidate,false);
  assert.equal(decision.operationalDecisionAuthority,false);
  assert.equal(decision.writeBackAuthority,false);
  assert.equal(decision.payrollAuthority,false);
  assert.equal(decision.causalClaimAuthority,false);
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.uniqueObservationCount,2);
  assert.equal(decision.exactReplayCount,0);
  assert.equal(decision.freshnessSeconds,120);
  assert.equal(decision.stale,false);
  assert.match(decision.checkpointNamespace,/^manufacturing-observation:[a-f0-9]{64}$/);
});

test('rejects tenant, connection, instance, plant, host, version, dataset and schema drift',()=>{
  for(const [field,value] of [
    ['wfmTenantId','tenant-other'],['connectionId','connection-other'],['sourceInstanceId','dm-other'],
    ['plantId','plant-2000'],['apiOrigin','https://api.us10.dmc.cloud.sap'],['apiVersion','oee-v2'],
    ['dataset','availability-losses'],['schemaFingerprint','sha256:changed']
  ]){
    const candidate=run({[field]:value});
    assert.throws(()=>createManufacturingObservationAuthority(policy()).admitWindow(candidate),/approved authority/);
  }
});

test('rejects unapproved metrics, units and resources',()=>{
  const metric=run({observations:[observation({metric:'quality-loss'})]});
  assert.throws(()=>createManufacturingObservationAuthority(policy()).admitWindow(metric),/metric.*approved/i);
  const unit=run({observations:[observation({unit:'KG'})]});
  assert.throws(()=>createManufacturingObservationAuthority(policy()).admitWindow(unit),/unit.*approved/i);
  const resource=run({observations:[observation({resourceId:'resource-unknown'})]});
  assert.throws(()=>createManufacturingObservationAuthority(policy()).admitWindow(resource),/resource.*approved/i);
});

test('requires canonical non-negative decimal strings instead of binary floats',()=>{
  for(const value of [120.5,'01','1.0','1e3','-1','NaN','Infinity']){
    const candidate=run({observations:[observation({value})]});
    assert.throws(()=>createManufacturingObservationAuthority(policy()).admitWindow(candidate),/canonical non-negative decimal/);
  }
  const zero=createManufacturingObservationAuthority(policy()).admitWindow(run({observations:[observation({value:'0'})]}));
  assert.equal(zero.observations[0].value,'0');
});

test('rejects oversized decimal evidence before it can amplify a backfill',()=>{
  const oversized=run({observations:[observation({value:'1'.repeat(129)})]});
  assert.throws(
    ()=>createManufacturingObservationAuthority(policy()).admitWindow(oversized),
    /decimal.*length limit/i
  );
});

test('collapses exact source-version metric replays and quarantines conflicts',()=>{
  const replay=run();
  replay.observations.push({...replay.observations[0]});
  const admitted=createManufacturingObservationAuthority(policy()).admitWindow(replay);
  assert.equal(admitted.uniqueObservationCount,2);
  assert.equal(admitted.exactReplayCount,1);
  const conflict=run();
  conflict.observations.push({...conflict.observations[0],value:'121',payloadDigest:'sha256:changed'});
  assert.throws(()=>createManufacturingObservationAuthority(policy()).admitWindow(conflict),/conflicting duplicate/);
});

test('enforces complete bounded windows, resource cardinality and observation limits',()=>{
  assert.throws(()=>createManufacturingObservationAuthority(policy()).admitWindow(run({complete:false})),/incomplete/);
  assert.throws(()=>createManufacturingObservationAuthority(policy()).admitWindow(run({
    windowStart:'2026-09-18T20:00:00Z'
  })),/window.*limit/i);
  const manyResources=['r1','r2','r3','r4','r5','r6'];
  const widePolicy=policy({approvedResources:manyResources,maxResources:5});
  const observations=manyResources.map((resourceId,index)=>observation({
    sourceId:`summary-${index}`,resourceId,payloadDigest:`sha256:${index}`
  }));
  assert.throws(()=>createManufacturingObservationAuthority(widePolicy).admitWindow(run({observations})),/resource limit/);
  assert.throws(()=>createManufacturingObservationAuthority(policy({maxObservations:1})).admitWindow(run()),/observation limit/);
});

test('marks delayed projections stale without converting them into transactional truth',()=>{
  const stale=createManufacturingObservationAuthority(policy()).admitWindow(run({
    dataAvailableThrough:'2026-09-26T21:30:00Z'
  }));
  assert.equal(stale.freshnessSeconds,1800);
  assert.equal(stale.stale,true);
  assert.equal(stale.transactionalEvidenceCandidate,false);
  assert.equal(stale.operationalDecisionAuthority,false);
});

test('distinguishes transactional reads from analytical projections but grants neither direct writes',()=>{
  const transactionalPolicy=policy({
    apiVersion:'quantity-confirmation-v1',dataset:'quantity-confirmation-postings',
    sourceKind:'transactional-read',schemaFingerprint:'sha256:quantity-postings-v1'
  });
  const transactionalRun=run({
    apiVersion:'quantity-confirmation-v1',dataset:'quantity-confirmation-postings',
    sourceKind:'transactional-read',schemaFingerprint:'sha256:quantity-postings-v1'
  });
  const decision=createManufacturingObservationAuthority(transactionalPolicy).admitWindow(transactionalRun);
  assert.equal(decision.transactionalEvidenceCandidate,true);
  assert.equal(decision.derivedObservationCandidate,false);
  assert.equal(decision.writeBackAuthority,false);
  assert.equal(decision.operationalDecisionAuthority,false);
});

test('rejects impossible chronology and observations outside the closed source window',()=>{
  assert.throws(()=>createManufacturingObservationAuthority(policy()).admitWindow(run({
    dataAvailableThrough:'2026-09-26T22:01:00Z'
  })),/available.*observation/i);
  assert.throws(()=>createManufacturingObservationAuthority(policy()).admitWindow(run({
    windowEnd:'2026-09-26T19:59:59Z'
  })),/window end/);
  assert.throws(()=>createManufacturingObservationAuthority(policy()).admitWindow(run({
    observations:[observation({occurredAt:'2026-09-26T22:00:01Z'})]
  })),/outside.*window/);
  assert.throws(()=>createManufacturingObservationAuthority(policy()).admitWindow(run({
    observedAt:'2026-02-30T22:00:00Z'
  })),/real UTC/);
});

test('rejects secret-bearing and executable evidence',()=>{
  const secret=run();
  secret.observations[0].accessToken='do-not-store';
  assert.throws(()=>createManufacturingObservationAuthority(policy()).admitWindow(secret),/secret|credential/);
  const executable=run();
  Object.defineProperty(executable.observations[0],'value',{enumerable:true,get(){throw new Error('executed');}});
  assert.throws(()=>createManufacturingObservationAuthority(policy()).admitWindow(executable),/executable|hidden/);
});

test('requires exact HTTPS origins and deeply immutable decisions',()=>{
  for(const apiOrigin of ['http://api.eu20.dmc.cloud.sap','https://*.dmc.cloud.sap','https://api.eu20.dmc.cloud.sap/path']){
    assert.throws(()=>createManufacturingObservationAuthority(policy({apiOrigin})),/exact HTTPS origin/);
  }
  const decision=createManufacturingObservationAuthority(policy()).admitWindow(run());
  assert.equal(Object.isFrozen(decision),true);
  assert.equal(Object.isFrozen(decision.observations),true);
  assert.throws(()=>decision.observations.push({}),TypeError);
});

// Regression: inert cloning must inspect an array descriptor before reading its value.
test('rejects indexed accessors without executing untrusted policy data',()=>{
  const input=policy();let calls=0;const values=[];
  Object.defineProperty(values,'0',{enumerable:true,get(){calls++;return 'employeeId';}});
  input.untrustedArrayEvidence=values;
  assert.throws(()=>createManufacturingObservationAuthority(input),/executable|hidden/i);
  assert.equal(calls,0,'array accessor was executed before rejection');
});
