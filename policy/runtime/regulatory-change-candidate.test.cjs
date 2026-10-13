'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {createRegulatoryChangeCandidate}=require('./regulatory-change-candidate.cjs');
const PREVIOUS='a'.repeat(64),NEXT='b'.repeat(64);
const sourceAssessment={sourceId:'gb-law',state:'CURRENT',usable:true,snapshotDigest:NEXT};
test('assessment snapshot cannot change between identity validation and matching',()=>{
  let reads=0;
  const assessment={...sourceAssessment,get snapshotDigest(){reads++;return reads===1?'c'.repeat(64):NEXT;}};
  assert.throws(()=>createRegulatoryChangeCandidate({sourceAssessment:assessment,previousSnapshotDigest:PREVIOUS,nextSnapshotDigest:NEXT,changes:[{domain:'informational',jurisdiction:'GB',confidence:1,ambiguity:'LOW',sourceRefs:['synthetic:policy']}]}),/snapshot.*match/i);
  assert.equal(reads,1);
});
test('next snapshot cannot be replaced after its identity has been admitted',()=>{
  let reads=0;
  const input={sourceAssessment,previousSnapshotDigest:PREVIOUS,get nextSnapshotDigest(){reads++;return reads===1?'c'.repeat(64):NEXT;},changes:[{domain:'informational',jurisdiction:'GB',confidence:1,ambiguity:'LOW',sourceRefs:['synthetic:policy']}]};
  assert.throws(()=>createRegulatoryChangeCandidate(input),/snapshot.*match/i);assert.equal(reads,1);
});
test('current assessment cannot qualify a different next snapshot or hide drift as NO_CHANGE',()=>{
  for(const previousSnapshotDigest of [PREVIOUS,NEXT]){
    assert.throws(()=>createRegulatoryChangeCandidate({sourceAssessment:{...sourceAssessment,snapshotDigest:'c'.repeat(64)},previousSnapshotDigest,nextSnapshotDigest:NEXT,changes:[{domain:'informational',jurisdiction:'GB',confidence:1,ambiguity:'LOW',sourceRefs:['synthetic:policy']}]}),/snapshot.*match/i);
  }
});
for(const [field,value] of [['sourceId',undefined],['sourceId',''],['sourceId',{toString(){throw new Error('must not coerce source');}}],['snapshotDigest',undefined],['snapshotDigest',null],['snapshotDigest','not-a-sha256']]){
  test('missing or malformed assessed '+field+' cannot qualify source evidence '+String(typeof value),()=>{
    assert.throws(()=>createRegulatoryChangeCandidate({sourceAssessment:{...sourceAssessment,[field]:value},previousSnapshotDigest:NEXT,nextSnapshotDigest:NEXT}),/sourceId|snapshotDigest/i);
  });
}
for(const field of ['previousSnapshotDigest','nextSnapshotDigest']){
  test('malformed '+field+' cannot become snapshot identity through coercion or truncation',()=>{
    for(const value of ['short',NEXT+'suffix',[NEXT],{toString(){throw new Error('must not coerce digest');}}]){
      assert.throws(()=>createRegulatoryChangeCandidate({sourceAssessment,previousSnapshotDigest:PREVIOUS,nextSnapshotDigest:NEXT,[field]:value,changes:[{domain:'informational',jurisdiction:'GB',confidence:1,ambiguity:'LOW',sourceRefs:['synthetic:policy']}]}),/snapshot digests.*sha256/i);
    }
  });
}
test('exported material-domain deletion cannot suppress mandatory payroll review',()=>{
  const {MATERIAL_DOMAINS}=require('./regulatory-change-candidate.cjs');
  MATERIAL_DOMAINS.delete('payroll');
  try{const result=candidate(1,'payroll');assert.equal(result.reviewRequired,true);assert.equal(result.state,'QUALIFIED_REVIEW_REQUIRED');assert.equal(result.promotionAuthority,false);}
  finally{MATERIAL_DOMAINS.add('payroll');}
});
test('clearing exported material metadata cannot suppress any qualified review domain',()=>{
  const {MATERIAL_DOMAINS}=require('./regulatory-change-candidate.cjs'),original=[...MATERIAL_DOMAINS];
  Set.prototype.clear.call(MATERIAL_DOMAINS);
  try{for(const domain of original) assert.equal(candidate(1,domain).reviewRequired,true);}
  finally{for(const domain of original) MATERIAL_DOMAINS.add(domain);}
});
test('exported metadata additions do not alter informational candidate review decisions',()=>{
  const {MATERIAL_DOMAINS}=require('./regulatory-change-candidate.cjs');
  MATERIAL_DOMAINS.add('informational');
  try{assert.equal(candidate(1).reviewRequired,false);}
  finally{MATERIAL_DOMAINS.delete('informational');}
});
test('published candidate cannot change policy domain under its original review decision',()=>{
  const result=candidate(1),before=JSON.stringify(result);
  assert.throws(()=>{result.changes[0].domain='working-time';},TypeError);
  assert.throws(()=>result.changes.push({domain:'working-time'}),TypeError);
  assert.equal(JSON.stringify(result),before);assert.equal(result.reviewRequired,false);
});
test('published candidate source references cannot change under its original digest',()=>{
  const result=candidate(1),before=JSON.stringify(result);
  assert.throws(()=>result.changes[0].sourceRefs.push('unapproved:replacement'),TypeError);
  assert.throws(()=>{result.changes[0].sourceRefs[0]='unapproved:replacement';},TypeError);
  assert.equal(JSON.stringify(result),before);
});
test('published affected-site evidence cannot change after candidate admission',()=>{
  const result=candidate(1),before=JSON.stringify(result);
  assert.throws(()=>result.affectedSites.push('unapproved-site'),TypeError);
  assert.equal(JSON.stringify(result),before);
});
test('freezing published candidate keeps supplied change and site evidence detached and editable',()=>{
  const changes=[{id:'synthetic',domain:'informational',jurisdiction:'GB',confidence:1,ambiguity:'LOW',sourceRefs:['synthetic:policy']}],sites=[{id:'site1',country:'GB'}];
  const result=createRegulatoryChangeCandidate({sourceAssessment,previousSnapshotDigest:PREVIOUS,nextSnapshotDigest:NEXT,changes,sites}),before=JSON.stringify(result);
  changes[0].domain='working-time';changes[0].sourceRefs.push('caller:edit');sites[0].id='site2';sites.push({id:'site3',country:'GB'});
  assert.equal(JSON.stringify(result),before);assert.deepEqual(result.affectedSites,['site1']);
  assert.equal(result.promotionAuthority,false);assert.equal(result.executionAuthority,false);
});
function candidate(confidence,domain='informational'){
  return createRegulatoryChangeCandidate({sourceAssessment,previousSnapshotDigest:PREVIOUS,nextSnapshotDigest:NEXT,changes:[{id:'synthetic',domain,jurisdiction:'GB',confidence,ambiguity:'LOW',sourceRefs:['synthetic:policy']} ]});
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
  assert.throws(()=>createRegulatoryChangeCandidate({sourceAssessment,previousSnapshotDigest:PREVIOUS,nextSnapshotDigest:NEXT,changes}),/confidence/i);
  assert.deepEqual(changes,before);
});
test('unchanged authoritative snapshot creates no change',()=>{const r=createRegulatoryChangeCandidate({sourceAssessment:{...sourceAssessment,snapshotDigest:PREVIOUS},previousSnapshotDigest:PREVIOUS,nextSnapshotDigest:PREVIOUS});assert.equal(r.state,'NO_CHANGE');assert.equal(r.promotionAuthority,false);});
test('material workforce-law change always requires qualified review',()=>{const r=createRegulatoryChangeCandidate({sourceAssessment,previousSnapshotDigest:PREVIOUS,nextSnapshotDigest:NEXT,changes:[{id:'c1',domain:'working-time',jurisdiction:'GB',summary:'changed limit',confidence:1,ambiguity:'LOW',sourceRefs:['official:gb']}],sites:[{id:'s1',country:'GB'}]});assert.equal(r.state,'QUALIFIED_REVIEW_REQUIRED');assert.deepEqual(r.affectedSites,['s1']);assert.equal(r.executionAuthority,false);});
test('stale source evidence cannot create a candidate',()=>{assert.throws(()=>createRegulatoryChangeCandidate({sourceAssessment:{sourceId:'x',state:'STALE',usable:false},previousSnapshotDigest:PREVIOUS,nextSnapshotDigest:NEXT,changes:[{domain:'working-time',jurisdiction:'GB',sourceRefs:['x']}]}),/Current authoritative source evidence/);});
test('low-ambiguity non-material change can be prepared automatically but never promoted automatically',()=>{const r=createRegulatoryChangeCandidate({sourceAssessment,previousSnapshotDigest:PREVIOUS,nextSnapshotDigest:NEXT,changes:[{id:'c1',domain:'informational',jurisdiction:'GB',summary:'wording metadata',confidence:0.99,ambiguity:'LOW',sourceRefs:['official:gb']} ]});assert.equal(r.state,'STRUCTURED_LOW_AMBIGUITY_CANDIDATE');assert.equal(r.reviewRequired,false);assert.equal(r.promotionAuthority,false);assert.equal(r.generatedTestsRequired,true);});

