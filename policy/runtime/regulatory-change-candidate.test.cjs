'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {createRegulatoryChangeCandidate}=require('./regulatory-change-candidate.cjs');
const sourceAssessment={sourceId:'gb-law',state:'CURRENT',usable:true};
test('unchanged authoritative snapshot creates no change',()=>{const r=createRegulatoryChangeCandidate({sourceAssessment,previousSnapshotDigest:'a',nextSnapshotDigest:'a'});assert.equal(r.state,'NO_CHANGE');assert.equal(r.promotionAuthority,false);});
test('material workforce-law change always requires qualified review',()=>{const r=createRegulatoryChangeCandidate({sourceAssessment,previousSnapshotDigest:'a',nextSnapshotDigest:'b',changes:[{id:'c1',domain:'working-time',jurisdiction:'GB',summary:'changed limit',confidence:1,ambiguity:'LOW',sourceRefs:['official:gb']}],sites:[{id:'s1',country:'GB'}]});assert.equal(r.state,'QUALIFIED_REVIEW_REQUIRED');assert.deepEqual(r.affectedSites,['s1']);assert.equal(r.executionAuthority,false);});
test('stale source evidence cannot create a candidate',()=>{assert.throws(()=>createRegulatoryChangeCandidate({sourceAssessment:{sourceId:'x',state:'STALE',usable:false},previousSnapshotDigest:'a',nextSnapshotDigest:'b',changes:[{domain:'working-time',jurisdiction:'GB',sourceRefs:['x']}]}),/Current authoritative source evidence/);});
test('low-ambiguity non-material change can be prepared automatically but never promoted automatically',()=>{const r=createRegulatoryChangeCandidate({sourceAssessment,previousSnapshotDigest:'a',nextSnapshotDigest:'b',changes:[{id:'c1',domain:'informational',jurisdiction:'GB',summary:'wording metadata',confidence:0.99,ambiguity:'LOW',sourceRefs:['official:gb']} ]});assert.equal(r.state,'STRUCTURED_LOW_AMBIGUITY_CANDIDATE');assert.equal(r.reviewRequired,false);assert.equal(r.promotionAuthority,false);assert.equal(r.generatedTestsRequired,true);});

function confidenceInput(confidence,domain='informational'){
  return {sourceAssessment,previousSnapshotDigest:'a',nextSnapshotDigest:'b',changes:[{domain,jurisdiction:'ZZ',sourceRefs:['urn:fixture'],confidence,ambiguity:'LOW'}]};
}
for(const confidence of [NaN,Infinity,-Infinity,-0.01,1.01,2,'NaN','Infinity'])test('invalid confidence '+String(confidence)+' cannot avoid candidate review',()=>{
  assert.throws(()=>createRegulatoryChangeCandidate(confidenceInput(confidence)),/confidence/i);
});
test('finite probability normalization, threshold and default retain review and authority contracts',()=>{
  for(const [confidence,review] of [[0,true],[0.94,true],[0.95,false],[1,false],['0.99',false],[undefined,true],[null,true]]){
    const r=createRegulatoryChangeCandidate(confidenceInput(confidence));
    assert.equal(r.reviewRequired,review);
    assert.equal(r.promotionAuthority,false);
    assert.equal(r.executionAuthority,false);
    assert.equal(r.customerMutation,false);
  }
  assert.equal(createRegulatoryChangeCandidate(confidenceInput('1','working-time')).reviewRequired,true);
});
test('unchanged snapshots remain NO_CHANGE without using an unrelated invalid confidence',()=>{
  const input=confidenceInput(NaN);input.nextSnapshotDigest='a';
  assert.equal(createRegulatoryChangeCandidate(input).state,'NO_CHANGE');
});
