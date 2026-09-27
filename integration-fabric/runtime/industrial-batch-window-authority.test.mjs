import test from 'node:test';
import assert from 'node:assert/strict';
import * as authorityModule from './industrial-sample-window-authority.mjs';

const sha=character=>`sha256:${character.repeat(64)}`;
const hashes={principal:sha('a'),iam:sha('b'),query:sha('c'),schema:sha('d'),token:sha('e'),power:sha('f'),speed:sha('1')};

const entry=(entryId,assetId,propertyId,unit)=>({
  entryId,siteId:'uk-plant-1',edgeGatewayId:'gw-plant-1',assetId,propertyId,propertyAlias:`/uk/plant-1/${assetId}/${propertyId}`,
  unit,sourceTimestampMode:'device',windowStart:{seconds:1790488800,offsetInNanos:0},windowEnd:{seconds:1790492400,offsetInNanos:0},
  providerStartExclusive:{seconds:1790488799,offsetInNanos:0},providerEndInclusive:{seconds:1790492400,offsetInNanos:0}
});
const entries=()=>[entry('power_entry','asset-line-1','property-power','kW'),entry('speed_entry','asset-line-2','property-speed','rpm')];
const sample=(seconds,valueDigest,overrides={})=>({sourceTimestamp:{seconds,offsetInNanos:123},ingestedAt:'2026-09-27T07:30:00.000Z',quality:'GOOD',valueType:'double',nullValueType:null,valueDigest,...overrides});
const policy=()=>({
  provider:'aws-iot-sitewise',wfmTenantId:'wfm-tenant-uk',connectionId:'sitewise-connection-1',awsAccountId:'123456789012',awsRegion:'eu-west-1',
  endpointVariant:'standard',dataPlaneOrigin:'https://data.iotsitewise.eu-west-1.amazonaws.com',apiVersion:'2019-12-02',readOperation:'BatchGetAssetPropertyValueHistory',
  principalFingerprint:hashes.principal,iamPolicyFingerprint:hashes.iam,queryFingerprint:hashes.query,schemaFingerprint:hashes.schema,
  expectedCheckpointPredecessor:'checkpoint:91',expectedObservedAt:'2026-09-27T08:00:00.000Z',maxPages:10,maxSamples:40000,entries:entries()
});
const receipt=()=>({
  provider:'aws-iot-sitewise',wfmTenantId:'wfm-tenant-uk',connectionId:'sitewise-connection-1',awsAccountId:'123456789012',awsRegion:'eu-west-1',
  endpointVariant:'standard',dataPlaneOrigin:'https://data.iotsitewise.eu-west-1.amazonaws.com',apiVersion:'2019-12-02',readOperation:'BatchGetAssetPropertyValueHistory',
  principalFingerprint:hashes.principal,iamPolicyFingerprint:hashes.iam,queryFingerprint:hashes.query,schemaFingerprint:hashes.schema,
  checkpointPredecessor:'checkpoint:91',observedAt:'2026-09-27T08:00:00.000Z',complete:true,terminal:true,entries:entries(),pages:[
    {pageIndex:0,requestTokenDigest:null,nextTokenDigest:hashes.token,successful:true,successEntries:[
      {entryId:'power_entry',samples:[sample(1790490000,hashes.power)]},
      {entryId:'speed_entry',samples:[sample(1790490000,hashes.speed)]}
    ],skippedEntries:[],errorEntries:[]},
    {pageIndex:1,requestTokenDigest:hashes.token,nextTokenDigest:null,successful:true,successEntries:[
      {entryId:'speed_entry',samples:[sample(1790490001,hashes.speed)]}
    ],skippedEntries:[{entryId:'power_entry',completionStatus:'SUCCESS',errorInfo:null}],errorEntries:[]}
  ]
});

test('admits a complete multi-entry batch while preserving independent entry histories',()=>{
  assert.equal(typeof authorityModule.createIndustrialBatchWindowAuthority,'function');
  const decision=authorityModule.createIndustrialBatchWindowAuthority(policy()).admit(receipt());
  assert.equal(decision.batchWindowReconciliationCandidate,true);
  assert.equal(decision.entryCount,2);
  assert.deepEqual(decision.entries.map(item=>[item.entryId,item.uniqueSampleCount]),[['power_entry',1],['speed_entry',2]]);
  assert.notEqual(decision.entries[0].samples[0].scopedSampleFingerprint,decision.entries[1].samples[0].scopedSampleFingerprint);
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.operationalDecisionAuthority,false);
  assert.equal(decision.writeBackAuthority,false);
  assert.equal(Object.isFrozen(decision.entries[0].samples),true);
});

test('requires two to sixteen unique AWS-valid entry definitions with exact receipt scope',()=>{
  for(const mutate of [
    value=>{value.entries=value.entries.slice(0,1);},
    value=>{value.entries=Array.from({length:17},(_,index)=>entry(`entry_${index}`,'asset','property','count'));},
    value=>{value.entries[1].entryId=value.entries[0].entryId;},
    value=>{value.entries[0].entryId=null;},
    value=>{value.entries[0].entryId='bad entry';},
    value=>{value.entries[0].providerStartExclusive.seconds++;},
    value=>{value.entries[0].providerEndInclusive.offsetInNanos=1;}
  ]){const value=policy();mutate(value);assert.throws(()=>authorityModule.createIndustrialBatchWindowAuthority(value),/entries|entry|duplicated|pattern|boundary/i);}
  const authority=authorityModule.createIndustrialBatchWindowAuthority(policy());
  for(const mutate of [
    value=>{value.entries.reverse();},value=>{value.entries[0].siteId='other-site';},value=>{value.entries[0].unit='W';},value=>{value.entries[0].propertyId='other-property';}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/entries|approved|site|unit|property/i);}
});

test('requires every page to partition the exact entry set once',()=>{
  const authority=authorityModule.createIndustrialBatchWindowAuthority(policy());
  for(const mutate of [
    value=>{value.pages[0].successEntries.pop();},
    value=>{value.pages[0].successEntries[1].entryId='unknown_entry';},
    value=>{value.pages[1].successEntries[0].entryId='power_entry';},
    value=>{value.pages[1].skippedEntries[0].entryId='speed_entry';},
    value=>{value.pages[0].skippedEntries.push({entryId:'power_entry',completionStatus:'SUCCESS',errorInfo:null});},
    value=>{value.pages[0].errorEntries.push({entryId:'power_entry',errorCode:'AccessDeniedException',errorMessage:'denied'});}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/partition|scope|duplicated|skipped|failed|entry/i);}
});

test('allows only success to skipped-success lifecycle and rejects regressions or error completion',()=>{
  const authority=authorityModule.createIndustrialBatchWindowAuthority(policy());
  for(const mutate of [
    value=>{value.pages[1].skippedEntries[0].completionStatus='ERROR';value.pages[1].skippedEntries[0].errorInfo={errorCode:'AccessDeniedException',errorTimestamp:1790490000};},
    value=>{value.pages[1].skippedEntries[0].errorInfo={errorCode:'InternalFailureException',errorTimestamp:1790490000};},
    value=>{value.pages[0].successEntries=value.pages[0].successEntries.filter(item=>item.entryId!=='power_entry');value.pages[0].skippedEntries=[{entryId:'power_entry',completionStatus:'SUCCESS',errorInfo:null}];}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/complete|success|skipped/i);}
  const regression=receipt();
  regression.pages[1].nextTokenDigest=sha('2');
  regression.pages.push({pageIndex:2,requestTokenDigest:sha('2'),nextTokenDigest:null,successful:true,successEntries:[{entryId:'power_entry',samples:[]}],skippedEntries:[{entryId:'speed_entry',completionStatus:'SUCCESS',errorInfo:null}],errorEntries:[]});
  assert.throws(()=>authority.admit(regression),/after completion/i);
});

test('binds one gapless terminal global token chain and bounded execution',()=>{
  const authority=authorityModule.createIndustrialBatchWindowAuthority(policy());
  for(const mutate of [
    value=>{value.complete=false;},value=>{value.terminal=false;},value=>{value.pages[1].requestTokenDigest=sha('3');},
    value=>{value.pages[0].pageIndex=1;},value=>{value.pages[0].successful=false;},value=>{value.pages[0].nextTokenDigest=null;},
    value=>{value.pages[1].nextTokenDigest=hashes.token;},value=>{value.pages.push({...value.pages[1],pageIndex:2});}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/complete|terminal|token|page|failed|limit/i);}
});

test('isolates replays and conflicts within each entry timestamp',()=>{
  const exact=receipt();exact.pages[0].successEntries[0].samples.push(structuredClone(exact.pages[0].successEntries[0].samples[0]));
  const decision=authorityModule.createIndustrialBatchWindowAuthority(policy()).admit(exact);
  assert.equal(decision.entries[0].exactReplayCount,1);
  assert.equal(decision.entries[1].exactReplayCount,0);
  const conflict=receipt();conflict.pages[0].successEntries[0].samples.push(sample(1790490000,hashes.speed));
  assert.throws(()=>authorityModule.createIndustrialBatchWindowAuthority(policy()).admit(conflict),/conflict/i);
});

test('preserves quality and typed null variants per entry without operational authority',()=>{
  const value=receipt();value.pages[0].successEntries[0].samples[0]=sample(1790490000,hashes.power,{quality:'BAD',valueType:'null',nullValueType:'D'});
  const decision=authorityModule.createIndustrialBatchWindowAuthority(policy()).admit(value);
  assert.equal(decision.entries[0].samples[0].nullValueType,'D');assert.equal(decision.operationalDecisionAuthority,false);
  for(const mutate of [
    sample=>{sample.nullValueType='X';},sample=>{sample.quality='GOOD';},sample=>{sample.valueType='double';sample.nullValueType='D';}
  ]){const invalid=receipt(),target=invalid.pages[0].successEntries[0].samples[0];target.quality='BAD';target.valueType='null';target.nullValueType='D';mutate(target);assert.throws(()=>authorityModule.createIndustrialBatchWindowAuthority(policy()).admit(invalid),/null|quality|type/i);}
});

test('binds global authority fingerprints predecessor horizon and exact regional endpoint',()=>{
  const authority=authorityModule.createIndustrialBatchWindowAuthority(policy());
  for(const mutate of [
    value=>{value.awsAccountId='210987654321';},value=>{value.awsRegion='eu-central-1';},value=>{value.dataPlaneOrigin='https://data.iotsitewise.eu-central-1.amazonaws.com';},
    value=>{value.principalFingerprint=sha('4');},value=>{value.iamPolicyFingerprint=sha('4');},value=>{value.queryFingerprint=sha('4');},value=>{value.schemaFingerprint=sha('4');},
    value=>{value.checkpointPredecessor='checkpoint:90';},value=>{value.observedAt='2026-09-27T08:00:00.001Z';}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/account|region|origin|principal|IAM|query|schema|predecessor|observation/i);}
});

test('rejects unsafe evidence and returns a deeply immutable deterministic decision',()=>{
  assert.throws(()=>authorityModule.createIndustrialBatchWindowAuthority({...policy(),clientSecret:'nope'}),/secret|not allowed/i);
  const authority=authorityModule.createIndustrialBatchWindowAuthority(policy());
  const sparse=receipt();sparse.pages[0].successEntries=new Array(2);assert.throws(()=>authority.admit(sparse),/sparse|array/i);
  const accessor=receipt();Object.defineProperty(accessor.pages[0],'accessToken',{enumerable:true,get(){throw new Error('executed');}});assert.throws(()=>authority.admit(accessor),/secret|credential/i);
  const oversized=receipt();oversized.pages[0].successEntries[0].samples=Array.from({length:40001},(_,index)=>sample(1790488801+index%3500,hashes.power,{sourceTimestamp:{seconds:1790488801+index%3500,offsetInNanos:index}}));assert.throws(()=>authority.admit(oversized),/limit/i);
  const first=authority.admit(receipt()),second=authority.admit(receipt());assert.equal(first.reconciliationFingerprint,second.reconciliationFingerprint);assert.equal(Object.isFrozen(first),true);assert.equal(Object.isFrozen(first.entries),true);assert.equal(Object.isFrozen(first.entries[0].samples[0]),true);
});
