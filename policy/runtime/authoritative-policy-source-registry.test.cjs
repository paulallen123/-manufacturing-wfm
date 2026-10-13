'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const {createHash}=require('node:crypto');
const {createAuthoritativePolicySourceRegistry}=require('./authoritative-policy-source-registry.cjs');
const {createRegulatoryChangeCandidate}=require('./regulatory-change-candidate.cjs');
const sha=s=>createHash('sha256').update(s).digest('hex');
function registry(){return createAuthoritativePolicySourceRegistry([{id:'gb-law',authorityTier:'PRIMARY_GOVERNMENT',channel:'API',jurisdiction:'GB',canonicalReference:'official:gb',nativeLanguages:['en'],freshnessHours:24}]);}
const sourceWithFreshness=freshnessHours=>({id:'synthetic',authorityTier:'PRIMARY_GOVERNMENT',channel:'API',jurisdiction:'GB',canonicalReference:'synthetic:source',freshnessHours});
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

