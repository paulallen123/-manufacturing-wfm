import test from 'node:test';
import assert from 'node:assert/strict';
import {createIndustrialSampleWindowAuthority} from './industrial-sample-window-authority.mjs';

const hashes={
  principal:`sha256:${'a'.repeat(64)}`,iam:`sha256:${'b'.repeat(64)}`,query:`sha256:${'c'.repeat(64)}`,schema:`sha256:${'d'.repeat(64)}`,
  token:`sha256:${'e'.repeat(64)}`,value:`sha256:${'f'.repeat(64)}`,changed:`sha256:${'1'.repeat(64)}`
};

const policy=()=>({
  provider:'aws-iot-sitewise',wfmTenantId:'wfm-tenant-uk',connectionId:'sitewise-connection-1',awsAccountId:'123456789012',awsRegion:'eu-west-1',
  dataPlaneOrigin:'https://data.iotsitewise.eu-west-1.amazonaws.com',endpointVariant:'standard',apiVersion:'2019-12-02',readOperation:'GetAssetPropertyValueHistory',batchEntryId:null,batchEntryCount:null,
  siteId:'uk-plant-1',edgeGatewayId:'gw-plant-1',assetId:'asset-line-1',propertyId:'property-power-kw',propertyAlias:'/uk/plant-1/line-1/power',
  unit:'kW',sourceTimestampMode:'device',principalFingerprint:hashes.principal,iamPolicyFingerprint:hashes.iam,queryFingerprint:hashes.query,
  schemaFingerprint:hashes.schema,expectedCheckpointPredecessor:'checkpoint:90',windowStart:{seconds:1790488800,offsetInNanos:0},
  windowEnd:{seconds:1790492400,offsetInNanos:0},providerStartExclusive:{seconds:1790488799,offsetInNanos:0},
  providerEndInclusive:{seconds:1790492400,offsetInNanos:0},expectedObservedAt:'2026-09-27T07:00:00.000Z',maxPages:10,maxSamples:20000
});

const sample=(overrides={})=>({sourceTimestamp:{seconds:1790490600,offsetInNanos:123456789},ingestedAt:'2026-09-27T06:30:01.000Z',quality:'GOOD',valueType:'double',nullValueType:null,valueDigest:hashes.value,...overrides});
const receipt=()=>({
  provider:'aws-iot-sitewise',wfmTenantId:'wfm-tenant-uk',connectionId:'sitewise-connection-1',awsAccountId:'123456789012',awsRegion:'eu-west-1',
  dataPlaneOrigin:'https://data.iotsitewise.eu-west-1.amazonaws.com',endpointVariant:'standard',apiVersion:'2019-12-02',readOperation:'GetAssetPropertyValueHistory',batchEntryId:null,batchEntryCount:null,
  siteId:'uk-plant-1',edgeGatewayId:'gw-plant-1',assetId:'asset-line-1',propertyId:'property-power-kw',propertyAlias:'/uk/plant-1/line-1/power',
  unit:'kW',sourceTimestampMode:'device',principalFingerprint:hashes.principal,iamPolicyFingerprint:hashes.iam,queryFingerprint:hashes.query,
  schemaFingerprint:hashes.schema,checkpointPredecessor:'checkpoint:90',windowStart:{seconds:1790488800,offsetInNanos:0},
  windowEnd:{seconds:1790492400,offsetInNanos:0},providerStartExclusive:{seconds:1790488799,offsetInNanos:0},
  providerEndInclusive:{seconds:1790492400,offsetInNanos:0},observedAt:'2026-09-27T07:00:00.000Z',complete:true,terminal:true,
  skippedEntries:[],errorEntries:[],pages:[
    {pageIndex:0,entryId:null,requestTokenDigest:null,nextTokenDigest:hashes.token,successful:true,samples:[sample()]},
    {pageIndex:1,entryId:null,requestTokenDigest:hashes.token,nextTokenDigest:null,successful:true,samples:[sample({sourceTimestamp:{seconds:1790490601,offsetInNanos:0},quality:'UNCERTAIN'})]}
  ]
});

test('admits a gapless terminal industrial history window as reconciliation evidence only',()=>{
  const decision=createIndustrialSampleWindowAuthority(policy()).admit(receipt());
  assert.equal(decision.sampleWindowReconciliationCandidate,true);
  assert.deepEqual(decision.qualityCounts,{GOOD:1,UNCERTAIN:1,BAD:0});
  assert.equal(decision.uniqueSampleCount,2);
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.operationalDecisionAuthority,false);
  assert.equal(decision.causalClaimAuthority,false);
  assert.equal(decision.writeBackAuthority,false);
  assert.equal(decision.payrollAuthority,false);
});

test('rejects account region endpoint site gateway asset property alias and unit drift',()=>{
  const authority=createIndustrialSampleWindowAuthority(policy());
  for(const mutate of [
    value=>{value.awsAccountId='210987654321';},value=>{value.awsRegion='eu-central-1';},
    value=>{value.dataPlaneOrigin='https://data.iotsitewise.eu-central-1.amazonaws.com';},value=>{value.siteId='de-plant-1';},
    value=>{value.edgeGatewayId='gw-plant-2';},value=>{value.assetId='asset-line-2';},value=>{value.propertyId='property-energy-kwh';},
    value=>{value.propertyAlias='/uk/plant-1/line-1/energy';},value=>{value.unit='kWh';}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/account|region|origin|site|gateway|asset|property|alias|unit/i);}
});

test('rejects custom ports and undocumented FIPS region endpoints',()=>{
  assert.throws(()=>createIndustrialSampleWindowAuthority({...policy(),dataPlaneOrigin:'https://data.iotsitewise.eu-west-1.amazonaws.com:8443'}),/origin|port/i);
  assert.throws(()=>createIndustrialSampleWindowAuthority({...policy(),endpointVariant:'fips',dataPlaneOrigin:'https://data.iotsitewise-fips.eu-west-1.amazonaws.com'}),/FIPS|endpoint|origin/i);
  const usEast={...policy(),awsRegion:'us-east-1',endpointVariant:'fips',dataPlaneOrigin:'https://data.iotsitewise-fips.us-east-1.amazonaws.com'};
  assert.doesNotThrow(()=>createIndustrialSampleWindowAuthority(usEast));
});

test('allows only exact read-history operations and matching timestamp-source mode',()=>{
  assert.throws(()=>createIndustrialSampleWindowAuthority({...policy(),readOperation:'BatchPutAssetPropertyValue'}),/read history/i);
  const authority=createIndustrialSampleWindowAuthority(policy());
  const write=receipt();write.readOperation='BatchPutAssetPropertyValue';
  assert.throws(()=>authority.admit(write),/operation/i);
  const timestampMode=receipt();timestampMode.sourceTimestampMode='server';
  assert.throws(()=>authority.admit(timestampMode),/timestamp/i);
});

test('requires a gapless successful page chain that reaches one terminal token',()=>{
  const authority=createIndustrialSampleWindowAuthority(policy());
  for(const mutate of [
    value=>{value.complete=false;},value=>{value.terminal=false;},value=>{value.pages[1].requestTokenDigest=hashes.changed;},
    value=>{value.pages[0].pageIndex=1;},value=>{value.pages[0].successful=false;},value=>{value.pages[0].nextTokenDigest=null;},
    value=>{value.pages[1].nextTokenDigest=hashes.token;},value=>{value.pages.push({...value.pages[1],pageIndex:2});}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/complete|terminal|token|page|failed|limit/i);}
});

test('rejects skipped or errored batch entries instead of treating partial success as complete',()=>{
  const authority=createIndustrialSampleWindowAuthority(policy());
  const skipped=receipt();skipped.skippedEntries=[{entryId:'property-power-kw',reason:'THROTTLED'}];
  assert.throws(()=>authority.admit(skipped),/skipped|partial/i);
  const errored=receipt();errored.errorEntries=[{entryId:'property-power-kw',errorCode:'ResourceNotFoundException'}];
  assert.throws(()=>authority.admit(errored),/error|partial/i);
});

test('binds every BatchGet success page to the exact approved entry id',()=>{
  const batchPolicy={...policy(),readOperation:'BatchGetAssetPropertyValueHistory',batchEntryId:'power-history-entry',batchEntryCount:1};
  const batchReceipt=receipt();batchReceipt.readOperation='BatchGetAssetPropertyValueHistory';batchReceipt.batchEntryId='power-history-entry';batchReceipt.batchEntryCount=1;
  for(const page of batchReceipt.pages) page.entryId='power-history-entry';
  const authority=createIndustrialSampleWindowAuthority(batchPolicy);
  assert.equal(authority.admit(batchReceipt).batchEntryId,'power-history-entry');
  const drift=structuredClone(batchReceipt);drift.pages[1].entryId='other-property-entry';
  assert.throws(()=>authority.admit(drift),/entry/i);
  assert.throws(()=>createIndustrialSampleWindowAuthority({...policy(),readOperation:'BatchGetAssetPropertyValueHistory',batchEntryId:null,batchEntryCount:1}),/entry/i);
  assert.throws(()=>createIndustrialSampleWindowAuthority({...policy(),readOperation:'BatchGetAssetPropertyValueHistory',batchEntryId:'power-history-entry',batchEntryCount:2}),/single|count|entry/i);
  assert.throws(()=>createIndustrialSampleWindowAuthority({...policy(),batchEntryId:'unexpected'}),/entry/i);
  for(const batchEntryId of [' ','bad id','bad\u0000id','a'.repeat(65),'a:b']){
    assert.throws(()=>createIndustrialSampleWindowAuthority({...policy(),readOperation:'BatchGetAssetPropertyValueHistory',batchEntryId,batchEntryCount:1}),/entry.*(?:pattern|AWS|valid)|batch.*entry/i);
  }
});

test('preserves nanosecond timestamps and rejects samples outside the exact window',()=>{
  const authority=createIndustrialSampleWindowAuthority(policy());
  const decision=authority.admit(receipt());
  assert.equal(decision.samples[0].sourceTimestamp.offsetInNanos,123456789);
  for(const mutate of [
    value=>{value.pages[0].samples[0].sourceTimestamp.offsetInNanos=1000000000;},
    value=>{value.pages[0].samples[0].sourceTimestamp={seconds:1790488799,offsetInNanos:999999999};},
    value=>{value.pages[0].samples[0].sourceTimestamp={seconds:1790492400,offsetInNanos:0};},
    value=>{value.pages[0].samples[0].ingestedAt='2026-09-27T07:00:00.001Z';},
    value=>{value.observedAt='2026-09-27T06:59:59.999Z';}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/nano|window|observation|ingest/i);}
});

test('over-reads documented whole-second provider bounds then filters the canonical nanosecond window',()=>{
  const authority=createIndustrialSampleWindowAuthority(policy());
  const atStart=receipt();atStart.pages[0].samples[0].sourceTimestamp={seconds:1790488800,offsetInNanos:0};
  assert.equal(authority.admit(atStart).samples[0].sourceTimestamp.seconds,1790488800);
  const subsecondPolicy={...policy(),windowEnd:{seconds:1790492400,offsetInNanos:500},providerEndInclusive:{seconds:1790492400,offsetInNanos:0}};
  const subsecondReceipt=receipt();subsecondReceipt.windowEnd={seconds:1790492400,offsetInNanos:500};subsecondReceipt.providerEndInclusive={seconds:1790492400,offsetInNanos:0};
  subsecondReceipt.pages[0].samples[0].sourceTimestamp={seconds:1790492400,offsetInNanos:499};
  assert.equal(createIndustrialSampleWindowAuthority(subsecondPolicy).admit(subsecondReceipt).samples[1].sourceTimestamp.offsetInNanos,499);
  subsecondReceipt.pages[0].samples[0].sourceTimestamp={seconds:1790492400,offsetInNanos:500};
  assert.throws(()=>createIndustrialSampleWindowAuthority(subsecondPolicy).admit(subsecondReceipt),/window/i);
  assert.throws(()=>createIndustrialSampleWindowAuthority({...policy(),windowStart:{seconds:1,offsetInNanos:0},providerStartExclusive:{seconds:1,offsetInNanos:0}}),/over-read|boundary/i);
  for(const mutate of [
    value=>{value.providerStartExclusive.seconds=1790488800;},
    value=>{value.providerStartExclusive.offsetInNanos=1;},
    value=>{value.providerEndInclusive.seconds=1790492399;},
    value=>{value.providerEndInclusive.offsetInNanos=1;}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/provider|window|boundary/i);}
});

test('preserves all documented quality states without turning them into decision authority',()=>{
  const value=receipt();value.pages[1].samples.push(sample({sourceTimestamp:{seconds:1790490602,offsetInNanos:0},quality:'BAD'}));
  const decision=createIndustrialSampleWindowAuthority(policy()).admit(value);
  assert.deepEqual(decision.qualityCounts,{GOOD:1,UNCERTAIN:1,BAD:1});
  assert.equal(decision.operationalDecisionAuthority,false);
  const invalid=receipt();invalid.pages[0].samples[0].quality='UNKNOWN';
  assert.throws(()=>createIndustrialSampleWindowAuthority(policy()).admit(invalid),/quality/i);
});

test('preserves documented null variants and their underlying SiteWise type',()=>{
  const value=receipt();
  value.pages[0].samples[0]=sample({quality:'BAD',valueType:'null',nullValueType:'D'});
  const decision=createIndustrialSampleWindowAuthority(policy()).admit(value);
  assert.equal(decision.samples[0].valueType,'null');
  assert.equal(decision.samples[0].nullValueType,'D');
  for(const mutate of [
    sample=>{sample.nullValueType='X';},
    sample=>{sample.quality='GOOD';},
    sample=>{sample.valueType='double';sample.nullValueType='D';},
    sample=>{sample.valueType='null';sample.nullValueType=null;}
  ]){const invalid=receipt();invalid.pages[0].samples[0]=sample({quality:'BAD',valueType:'null',nullValueType:'D'});mutate(invalid.pages[0].samples[0]);assert.throws(()=>createIndustrialSampleWindowAuthority(policy()).admit(invalid),/null|quality|type/i);}
});

test('collapses exact sample replays and quarantines conflicting values at one timestamp',()=>{
  const exact=receipt();exact.pages[0].samples.push({...exact.pages[0].samples[0],sourceTimestamp:{...exact.pages[0].samples[0].sourceTimestamp}});
  const decision=createIndustrialSampleWindowAuthority(policy()).admit(exact);
  assert.equal(decision.exactReplayCount,1);
  const conflict=receipt();conflict.pages[0].samples.push(sample({valueDigest:hashes.changed}));
  assert.throws(()=>createIndustrialSampleWindowAuthority(policy()).admit(conflict),/conflicting/i);
});

test('binds IAM principal query schema predecessor and observation horizon',()=>{
  const authority=createIndustrialSampleWindowAuthority(policy());
  for(const mutate of [
    value=>{value.principalFingerprint=hashes.changed;},value=>{value.iamPolicyFingerprint=hashes.changed;},value=>{value.queryFingerprint=hashes.changed;},
    value=>{value.schemaFingerprint=hashes.changed;},value=>{value.checkpointPredecessor='checkpoint:89';},value=>{value.windowEnd.seconds=1790492399;}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/principal|IAM|query|schema|predecessor|window/i);}
});

test('rejects oversized sparse secret executable and hidden evidence and freezes output',()=>{
  assert.throws(()=>createIndustrialSampleWindowAuthority({...policy(),accessToken:'nope'}),/secret|not allowed/i);
  const authority=createIndustrialSampleWindowAuthority(policy());
  const sparse=receipt();sparse.pages=new Array(1);assert.throws(()=>authority.admit(sparse),/sparse|array/i);
  const oversized=receipt();oversized.pages[0].samples=Array.from({length:20001},(_,i)=>sample({sourceTimestamp:{seconds:1790488800+i%3599,offsetInNanos:i}}));
  assert.throws(()=>authority.admit(oversized),/limit/i);
  const accessor=receipt();Object.defineProperty(accessor,'clientSecret',{enumerable:true,get(){throw new Error('executed');}});
  assert.throws(()=>authority.admit(accessor),/secret|credential/i);
  const hidden=receipt();Object.defineProperty(hidden.pages[0].samples[0],'hidden',{enumerable:false,value:true});
  assert.throws(()=>authority.admit(hidden),/hidden|allowed/i);
  const decision=authority.admit(receipt());assert.equal(Object.isFrozen(decision),true);assert.equal(Object.isFrozen(decision.samples),true);assert.equal(Object.isFrozen(decision.samples[0]),true);
});
