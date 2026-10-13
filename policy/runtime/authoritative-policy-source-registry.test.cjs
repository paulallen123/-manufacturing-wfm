'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const {createHash}=require('node:crypto');
const {createAuthoritativePolicySourceRegistry}=require('./authoritative-policy-source-registry.cjs');
const {createRegulatoryChangeCandidate}=require('./regulatory-change-candidate.cjs');
const sha=s=>createHash('sha256').update(s).digest('hex');
function registry(){return createAuthoritativePolicySourceRegistry([{id:'gb-law',authorityTier:'PRIMARY_GOVERNMENT',channel:'API',jurisdiction:'GB',canonicalReference:'official:gb',nativeLanguages:['en'],freshnessHours:24}]);}
const sourceWithFreshness=freshnessHours=>({id:'synthetic',authorityTier:'PRIMARY_GOVERNMENT',channel:'API',jurisdiction:'GB',canonicalReference:'synthetic:source',freshnessHours});
function snapshotAt(r,content,observedAt='2026-10-13T12:00:00Z',sourceId='gb-law'){
  return r.recordSnapshot({sourceId,observedAt,contentDigest:sha(content),verifiedRetrieval:true});
}
test('contradictory latest content denies current assessment in either arrival order',()=>{
  for(const order of [['first','second'],['second','first']]){
    const r=registry(),receipts=order.map(content=>snapshotAt(r,content));
    const result=r.assess('gb-law',{at:'2026-10-13T13:00:00Z'});
    assert.equal(result.state,'CONFLICTING');assert.equal(result.usable,false);assert.equal(result.requiresAttention,true);
    assert.equal(result.observedAt,'2026-10-13T12:00:00.000Z');
    assert.deepEqual(result.conflictingSnapshotDigests,receipts.map(x=>x.snapshotDigest).sort());
    assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result.conflictingSnapshotDigests),true);
    assert.equal(r.latest('gb-law'),receipts[1]);
  }
});
test('equivalent timezone observations cannot disguise contradictory content',()=>{
  const r=registry();snapshotAt(r,'first','2026-10-13T13:00:00+01:00');snapshotAt(r,'second');
  assert.equal(r.assess('gb-law',{at:'2026-10-13T13:00:00Z'}).state,'CONFLICTING');
});
test('conflicting current source cannot qualify changed or NO_CHANGE regulatory intake',()=>{
  const r=registry(),first=snapshotAt(r,'first'),second=snapshotAt(r,'second');
  const assessment=r.assess('gb-law',{at:'2026-10-13T13:00:00Z'});
  for(const previousSnapshotDigest of [first.snapshotDigest,second.snapshotDigest])
    assert.throws(()=>createRegulatoryChangeCandidate({sourceAssessment:assessment,previousSnapshotDigest,nextSnapshotDigest:second.snapshotDigest,changes:[{domain:'informational',jurisdiction:'GB',confidence:1,ambiguity:'LOW',sourceRefs:['synthetic:policy']}]}),/Current authoritative source evidence/);
});
test('same-content repeats retain current last-receipt behavior and immutable receipts',()=>{
  const r=registry(),first=snapshotAt(r,'same'),before=JSON.stringify(first);
  const repeat=r.recordSnapshot({sourceId:'gb-law',observedAt:first.observedAt,contentDigest:first.contentDigest,verifiedRetrieval:true,retrievalMethod:'OFFICIAL_WEB',revision:'same-content-receipt'});
  const a=r.assess('gb-law',{at:'2026-10-13T13:00:00Z'});assert.equal(a.state,'CURRENT');assert.equal(a.snapshotDigest,repeat.snapshotDigest);
  assert.equal(r.latest('gb-law'),repeat);assert.equal(JSON.stringify(first),before);
});
test('a strictly newer uncontested observation resolves only the assessment conflict',()=>{
  const r=registry(),first=snapshotAt(r,'first'),second=snapshotAt(r,'second'),before=[JSON.stringify(first),JSON.stringify(second)];
  assert.equal(r.assess('gb-law',{at:'2026-10-13T13:00:00Z'}).usable,false);
  const current=snapshotAt(r,'new','2026-10-13T13:00:00Z');
  const a=r.assess('gb-law',{at:current.observedAt});assert.equal(a.state,'CURRENT');assert.equal(a.snapshotDigest,current.snapshotDigest);
  assert.deepEqual([JSON.stringify(first),JSON.stringify(second)],before);
  snapshotAt(r,'third-delayed');assert.equal(r.assess('gb-law',{at:current.observedAt}).state,'CURRENT');
});
test('conflicts are source-scoped and do not override disabled source denial',()=>{
  const r=registry();r.registerSource({...sourceWithFreshness(24),id:'other'});r.registerSource({...sourceWithFreshness(24),id:'disabled',active:false});
  snapshotAt(r,'first');snapshotAt(r,'second');const other=snapshotAt(r,'other',undefined,'other');
  snapshotAt(r,'first',undefined,'disabled');snapshotAt(r,'second',undefined,'disabled');
  assert.equal(r.assess('gb-law',{at:other.observedAt}).state,'CONFLICTING');
  assert.equal(r.assess('other',{at:other.observedAt}).state,'CURRENT');assert.equal(r.assess('disabled',{at:other.observedAt}).state,'DISABLED');
});
test('regulatory intake binds its next snapshot to the actual current registry assessment',()=>{
  const r=registry(),old=r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-10-13T11:00:00Z',contentDigest:sha('old'),verifiedRetrieval:true});
  const current=r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-10-13T12:00:00Z',contentDigest:sha('current'),verifiedRetrieval:true});
  const assessment=r.assess('gb-law',{at:'2026-10-13T13:00:00Z'}),changes=[{domain:'working-time',jurisdiction:'GB',confidence:1,ambiguity:'LOW',sourceRefs:['synthetic:policy']}];
  assert.throws(()=>createRegulatoryChangeCandidate({sourceAssessment:assessment,previousSnapshotDigest:old.snapshotDigest,nextSnapshotDigest:old.snapshotDigest,changes}),/snapshot.*match/i);
  const result=createRegulatoryChangeCandidate({sourceAssessment:assessment,previousSnapshotDigest:old.snapshotDigest,nextSnapshotDigest:current.snapshotDigest,changes});
  assert.equal(result.sourceId,'gb-law');assert.equal(result.nextSnapshotDigest,current.snapshotDigest);assert.equal(result.reviewRequired,true);assert.equal(result.executionAuthority,false);
});
test('late older snapshot cannot hide a newer future observation from policy admission',()=>{
  const r=registry(),future=r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-10-14T12:00:00Z',contentDigest:sha('future'),verifiedRetrieval:true});
  const older=r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-10-13T12:00:00Z',contentDigest:sha('older'),verifiedRetrieval:true});
  assert.equal(older.observedAt,'2026-10-13T12:00:00.000Z');
  assert.equal(r.latest('gb-law'),future);
  const assessment=r.assess('gb-law',{at:'2026-10-13T13:00:00Z'});
  assert.equal(assessment.state,'NOT_YET_OBSERVED');assert.equal(assessment.usable,false);assert.equal(assessment.snapshotDigest,future.snapshotDigest);
  assert.throws(()=>createRegulatoryChangeCandidate({sourceAssessment:assessment,previousSnapshotDigest:sha('v1'),nextSnapshotDigest:sha('v1')}),/Current authoritative source evidence/);
});
test('source snapshot chronology is independent of delayed delivery order',()=>{
  const times=['2026-10-12T12:00:00Z','2026-10-13T12:00:00Z','2026-10-14T12:00:00Z'];
  for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]){
    const r=registry(),receipts=order.map(i=>r.recordSnapshot({sourceId:'gb-law',observedAt:times[i],contentDigest:sha('v'+i),verifiedRetrieval:true}));
    const latest=receipts.find(x=>x.observedAt==='2026-10-14T12:00:00.000Z');
    assert.equal(r.latest('gb-law'),latest);
    assert.equal(r.assess('gb-law',{at:'2026-10-14T12:00:00Z'}).state,'CURRENT');
    assert.equal(r.assess('gb-law',{at:'2026-10-15T12:00:00.001Z'}).state,'STALE');
  }
});
test('equal observation instants retain last-recorded tie behavior and source isolation',()=>{
  const r=registry();r.registerSource({...sourceWithFreshness(24),id:'other'});
  r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-10-13T13:00:00+01:00',contentDigest:sha('first'),verifiedRetrieval:true});
  const second=r.recordSnapshot({sourceId:'gb-law',observedAt:'2026-10-13T12:00:00Z',contentDigest:sha('second'),verifiedRetrieval:true});
  const other=r.recordSnapshot({sourceId:'other',observedAt:'2027-10-13T12:00:00Z',contentDigest:sha('other'),verifiedRetrieval:true});
  assert.equal(r.latest('gb-law'),second);assert.equal(r.latest('other'),other);assert.equal(r.latest('unknown'),null);
  assert.equal(second.executionAuthority,false);
});
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
  const candidate=at=>{const assessment=r.assess('gb-law',{at});return createRegulatoryChangeCandidate({sourceAssessment:assessment,previousSnapshotDigest:assessment.snapshotDigest,nextSnapshotDigest:assessment.snapshotDigest});};
  assert.throws(()=>candidate('2026-09-25T09:00:00Z'),/Current authoritative source evidence/);
  const current=candidate('2026-09-25T10:00:00Z');assert.equal(current.state,'NO_CHANGE');assert.equal(current.promotionAuthority,false);
});

