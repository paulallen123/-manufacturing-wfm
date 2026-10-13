'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const {createHash}=require('node:crypto');
const {createAuthoritativePolicySourceRegistry}=require('./authoritative-policy-source-registry.cjs');
const {createRegulatoryChangeCandidate}=require('./regulatory-change-candidate.cjs');
const sha=s=>createHash('sha256').update(s).digest('hex');
function registry(){return createAuthoritativePolicySourceRegistry([{id:'gb-law',authorityTier:'PRIMARY_GOVERNMENT',channel:'API',jurisdiction:'GB',canonicalReference:'official:gb',nativeLanguages:['en'],freshnessHours:24}]);}
const sourceWithFreshness=freshnessHours=>({id:'synthetic',authorityTier:'PRIMARY_GOVERNMENT',channel:'API',jurisdiction:'GB',canonicalReference:'synthetic:source',freshnessHours});
test('exported authority tier metadata cannot widen private source admission',()=>{
  const {AUTHORITY_TIERS}=require('./authoritative-policy-source-registry.cjs');
  AUTHORITY_TIERS.add('INVENTED');
  try{assert.throws(()=>createAuthoritativePolicySourceRegistry([{...sourceWithFreshness(24),authorityTier:'INVENTED'}]),/supported authorityTier and channel/);}
  finally{AUTHORITY_TIERS.delete('INVENTED');}
});
test('exported channel metadata cannot widen private source admission',()=>{
  const {CHANNELS}=require('./authoritative-policy-source-registry.cjs');
  Set.prototype.add.call(CHANNELS,'UNVERIFIED');
  try{assert.throws(()=>createAuthoritativePolicySourceRegistry([{...sourceWithFreshness(24),channel:'UNVERIFIED'}]),/supported authorityTier and channel/);}
  finally{CHANNELS.delete('UNVERIFIED');}
});
test('editing exported metadata cannot remove supported source tiers or channels',()=>{
  const {AUTHORITY_TIERS,CHANNELS}=require('./authoritative-policy-source-registry.cjs');
  AUTHORITY_TIERS.delete('PRIMARY_GOVERNMENT');CHANNELS.delete('API');
  try{const r=createAuthoritativePolicySourceRegistry([sourceWithFreshness(24)]);assert.equal(r.all()[0].authorityTier,'PRIMARY_GOVERNMENT');assert.equal(r.all()[0].channel,'API');}
  finally{AUTHORITY_TIERS.add('PRIMARY_GOVERNMENT');CHANNELS.add('API');}
});
for(const invalid of ['2026-02-30T08:00:00Z','2025-02-29T08:00:00Z','1900-02-29T08:00:00Z','2026-04-31T08:00:00+01:00','2026-06-31','+002026-02-30T08:00:00Z','2026-02-30t08:00:00z','2026-02-30 08:00:00Z','2026-2-30 08:00:00Z']){
  test('impossible calendar timestamp '+invalid+' cannot enter source evidence',()=>{
    const r=registry();
    assert.throws(()=>r.recordSnapshot({sourceId:'gb-law',observedAt:invalid,contentDigest:sha('invalid'),verifiedRetrieval:true}),/observedAt.*valid ISO/);
    assert.equal(r.latest('gb-law'),null);
  });
  test('impossible assessment timestamp '+invalid+' cannot manufacture freshness',()=>{
    const r=registry(),snapshot=r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-03-02T08:00:00Z',contentDigest:sha('valid'),verifiedRetrieval:true});
    assert.throws(()=>r.assess('gb-law',{at:invalid}),/at.*valid ISO/);
    assert.equal(r.latest('gb-law'),snapshot);
  });
}
test('valid leap days and timezone offsets retain exact instants and receipt binding',()=>{
  for(const observedAt of ['2024-02-29T23:30:00-02:00','2000-02-29T08:00:00Z','2026-04-30T23:30:00-02:00','2026-03-01T00:30:00+02:00','+002000-02-29T08:00:00Z','-000004-02-29T08:00:00Z','0000-02-29T08:00:00Z','2024-02-29t08:00:00z','2024-2-29 08:00:00Z']){
    const r=registry(),snapshot=r.recordSnapshot({sourceId:'gb-law',observedAt,contentDigest:sha(observedAt),verifiedRetrieval:true});
    assert.equal(snapshot.observedAt,new Date(observedAt).toISOString());
    const a=r.assess('gb-law',{at:observedAt});
    assert.equal(a.state,'CURRENT');assert.equal(a.ageHours,0);assert.equal(a.snapshotDigest,snapshot.snapshotDigest);
    assert.equal(snapshot.executionAuthority,false);
  }
});
test('registered source language evidence cannot change under its admitted digest',()=>{
  const r=registry(),source=r.all()[0],before=JSON.stringify(source);
  assert.throws(()=>source.nativeLanguages.push('altered'),TypeError);
  assert.throws(()=>{source.nativeLanguages[0]='altered';},TypeError);
  assert.equal(JSON.stringify(source),before);
  const snapshot=r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-09-25T08:00:00Z',contentDigest:sha('v1'),verifiedRetrieval:true});
  assert.equal(snapshot.sourceDigest,source.sourceDigest);assert.deepEqual(r.all()[0].nativeLanguages,['en']);
});
test('registerSource result freezes normalized language evidence while caller inputs and returned lists stay detached',()=>{
  const input={...sourceWithFreshness(24),nativeLanguages:['en','en','fr']},r=createAuthoritativePolicySourceRegistry(),source=r.registerSource(input),before=JSON.stringify(source);
  assert.throws(()=>source.nativeLanguages.splice(0,1),TypeError);
  input.nativeLanguages.push('caller-edit');const list=r.all();list.pop();
  assert.equal(JSON.stringify(source),before);assert.deepEqual(source.nativeLanguages,['en','fr']);assert.equal(r.all().length,1);
  assert.equal(source.grantsExecutionAuthority,false);
});
for(const [label,value] of [['unknown','unknown'],['NaN',NaN],['Infinity',Infinity],['negative Infinity',-Infinity],['NaN text','NaN'],['Infinity text','Infinity']]){
  test('invalid '+label+' source freshness cannot manufacture current evidence',()=>{
    const r=createAuthoritativePolicySourceRegistry();
    assert.throws(()=>r.registerSource(sourceWithFreshness(value)),/freshnessHours.*finite/i);
    assert.equal(r.all().length,0);assert.throws(()=>r.assess('synthetic'),/Unknown source/);
    assert.throws(()=>createAuthoritativePolicySourceRegistry([sourceWithFreshness(value)]),/freshnessHours.*finite/i);
  });
}
test('finite freshness preserves defaults and clamping but never admits six-year-old evidence',()=>{
  for(const [value,expected] of [[undefined,24],[null,24],[0,24],['',24],[0.5,1],[-1,1],[24,24],['48',48],[3000,2160]]){
    const r=createAuthoritativePolicySourceRegistry([sourceWithFreshness(value)]);
    assert.equal(r.all()[0].freshnessHours,expected);
    r.recordSnapshot({sourceId:'synthetic',observedAt:'2020-01-01T00:00:00Z',contentDigest:sha('old'),verifiedRetrieval:true});
    const old=r.assess('synthetic',{at:'2026-10-13T00:00:00Z'});
    assert.equal(old.usable,false);assert.equal(old.state,'STALE');assert.equal(old.requiresAttention,true);
  }
});
test('verified official snapshot becomes current evidence',()=>{const r=registry();const s=r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-09-25T08:00:00Z',contentDigest:sha('v1'),verifiedRetrieval:true});assert.equal(r.assess('gb-law',{at:'2026-09-25T09:00:00Z'}).state,'CURRENT');assert.equal(s.executionAuthority,false);});
test('stale source cannot silently remain usable',()=>{const r=registry();r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-09-20T08:00:00Z',contentDigest:sha('v1'),verifiedRetrieval:true});const a=r.assess('gb-law',{at:'2026-09-25T09:00:00Z'});assert.equal(a.state,'STALE');assert.equal(a.usable,false);});
test('unverified retrieval cannot enter authoritative evidence',()=>{const r=registry();assert.throws(()=>r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-09-25T08:00:00Z',contentDigest:sha('v1'),verifiedRetrieval:false}),/verified retrieval/i);});
test('source metadata never grants execution authority',()=>{const r=registry();assert.equal(r.all()[0].grantsExecutionAuthority,false);});
for(const observedAt of ['2026-09-25T09:00:00.001Z','2026-09-25T10:00:00Z','2027-09-25T09:00:00Z']){
  test('snapshot observed at '+observedAt+' is unusable before observation',()=>{
    const r=registry();const snapshot=r.recordSnapshot({sourceId:'gb-law',observedAt,contentDigest:sha('future'),verifiedRetrieval:true});
    const a=r.assess('gb-law',{at:'2026-09-25T09:00:00Z'});
    assert.equal(a.usable,false);assert.equal(a.state,'NOT_YET_OBSERVED');assert.equal(a.requiresAttention,true);
    assert.equal(a.snapshotDigest,snapshot.snapshotDigest);assert.equal(r.latest('gb-law'),snapshot);
  });
}
test('same snapshot becomes current exactly at observation then expires without changing its receipt',()=>{
  const r=registry(),at='2026-09-25T09:00:00Z';const snapshot=r.recordSnapshot({sourceId:'gb-law',observedAt:at,contentDigest:sha('future'),verifiedRetrieval:true});
  assert.equal(r.assess('gb-law',{at:'2026-09-25T08:59:59.999Z'}).usable,false);
  assert.equal(r.assess('gb-law',{at}).state,'CURRENT');assert.equal(r.assess('gb-law',{at}).ageHours,0);
  assert.equal(r.assess('gb-law',{at:'2026-09-26T09:00:00Z'}).state,'CURRENT');
  const expired=r.assess('gb-law',{at:'2026-09-26T09:00:00.001Z'});assert.equal(expired.state,'STALE');assert.equal(expired.usable,false);
  assert.equal(r.latest('gb-law'),snapshot);assert.equal(expired.snapshotDigest,snapshot.snapshotDigest);
});
test('future source evidence cannot enter the existing regulatory candidate path',()=>{
  const r=registry();r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-09-25T10:00:00Z',contentDigest:sha('future'),verifiedRetrieval:true});
  const candidate=at=>createRegulatoryChangeCandidate({sourceAssessment:r.assess('gb-law',{at}),previousSnapshotDigest:sha('v1'),nextSnapshotDigest:sha('v1')});
  assert.throws(()=>candidate('2026-09-25T09:00:00Z'),/Current authoritative source evidence/);
  const current=candidate('2026-09-25T10:00:00Z');assert.equal(current.state,'NO_CHANGE');assert.equal(current.promotionAuthority,false);
});

