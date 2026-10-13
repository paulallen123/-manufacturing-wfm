'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {createRegulatoryChangeCandidate}=require('./regulatory-change-candidate.cjs');
const sourceAssessment={sourceId:'gb-law',state:'CURRENT',usable:true};
function candidate(confidence,domain='informational'){
  return createRegulatoryChangeCandidate({sourceAssessment,previousSnapshotDigest:'a',nextSnapshotDigest:'b',changes:[{id:'synthetic',domain,jurisdiction:'GB',confidence,ambiguity:'LOW',sourceRefs:['synthetic:policy']} ]});
}
for(const [label,confidence] of [['NaN',NaN],['Infinity',Infinity],['negative Infinity',-Infinity],['non-numeric text','unknown'],['above one',1.01],['negative',-0.01],['boolean',true],['array',[1]],['object',{valueOf(){return 1;}}],['blank text',' ']]){
  test('invalid '+label+' confidence cannot suppress qualified policy review',()=>assert.throws(()=>candidate(confidence),/confidence.*finite.*0.*1/i));
}
test('valid confidence threshold and absent confidence preserve qualified-review behavior',()=>{
  for(const confidence of [undefined,null,0,0.949999]) assert.equal(candidate(confidence).reviewRequired,true);
  for(const confidence of [0.95,1,'0.99']){
    const result=candidate(confidence);assert.equal(result.reviewRequired,false);assert.equal(result.state,'STRUCTURED_LOW_AMBIGUITY_CANDIDATE');
    assert.equal(result.changes[0].confidence,Number(confidence));assert.equal(result.promotionAuthority,false);assert.equal(result.executionAuthority,false);
  }
  assert.equal(candidate(1,'working-time').reviewRequired,true);
});
test('malformed confidence in a mixed candidate denies admission without changing caller evidence',()=>{
  const changes=[{id:'valid',domain:'informational',jurisdiction:'GB',confidence:1,ambiguity:'LOW',sourceRefs:['synthetic:policy']},{id:'invalid',domain:'informational',jurisdiction:'GB',confidence:'unknown',ambiguity:'LOW',sourceRefs:['synthetic:policy']}];
  const before=structuredClone(changes);
  assert.throws(()=>createRegulatoryChangeCandidate({sourceAssessment,previousSnapshotDigest:'a',nextSnapshotDigest:'b',changes}),/confidence/i);
  assert.deepEqual(changes,before);
});
test('unchanged authoritative snapshot creates no change',()=>{const r=createRegulatoryChangeCandidate({sourceAssessment,previousSnapshotDigest:'a',nextSnapshotDigest:'a'});assert.equal(r.state,'NO_CHANGE');assert.equal(r.promotionAuthority,false);});
test('material workforce-law change always requires qualified review',()=>{const r=createRegulatoryChangeCandidate({sourceAssessment,previousSnapshotDigest:'a',nextSnapshotDigest:'b',changes:[{id:'c1',domain:'working-time',jurisdiction:'GB',summary:'changed limit',confidence:1,ambiguity:'LOW',sourceRefs:['official:gb']}],sites:[{id:'s1',country:'GB'}]});assert.equal(r.state,'QUALIFIED_REVIEW_REQUIRED');assert.deepEqual(r.affectedSites,['s1']);assert.equal(r.executionAuthority,false);});
test('stale source evidence cannot create a candidate',()=>{assert.throws(()=>createRegulatoryChangeCandidate({sourceAssessment:{sourceId:'x',state:'STALE',usable:false},previousSnapshotDigest:'a',nextSnapshotDigest:'b',changes:[{domain:'working-time',jurisdiction:'GB',sourceRefs:['x']}]}),/Current authoritative source evidence/);});
test('low-ambiguity non-material change can be prepared automatically but never promoted automatically',()=>{const r=createRegulatoryChangeCandidate({sourceAssessment,previousSnapshotDigest:'a',nextSnapshotDigest:'b',changes:[{id:'c1',domain:'informational',jurisdiction:'GB',summary:'wording metadata',confidence:0.99,ambiguity:'LOW',sourceRefs:['official:gb']} ]});assert.equal(r.state,'STRUCTURED_LOW_AMBIGUITY_CANDIDATE');assert.equal(r.reviewRequired,false);assert.equal(r.promotionAuthority,false);assert.equal(r.generatedTestsRequired,true);});

