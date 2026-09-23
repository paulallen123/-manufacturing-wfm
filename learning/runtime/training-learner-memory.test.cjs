'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildLearnerMemory}=require('./training-learner-memory.cjs');

test('authentic independent evidence produces demonstrated learner memory',()=>{
  const memory=buildLearnerMemory({
    assignment:{score:84,status:'DUE',due_at_ms:Date.now()+86400000},
    evidence:[{evidence_type:'INDEPENDENT_TASK',result:'PASS',created_at:'2026-09-23T10:00:00Z',detail_json:'{}'}],
    recentHelp:1,
    nowMs:Date.parse('2026-09-23T12:00:00Z')
  });
  assert.equal(memory.state,'DEMONSTRATED');
  assert.equal(memory.evidenceQuality,'HIGH');
  assert.equal(memory.independentSuccessCount,1);
});
test('mastered evidence becomes retention due without erasing prior competence',()=>{
  const memory=buildLearnerMemory({
    assignment:{score:92,status:'MASTERED',due_at_ms:Date.parse('2026-09-20T00:00:00Z')},
    evidence:[{evidence_type:'OBSERVED_SUCCESS',result:'PASS',created_at:'2026-08-20T10:00:00Z',detail_json:'{}'}],
    nowMs:Date.parse('2026-09-23T12:00:00Z')
  });
  assert.equal(memory.state,'RETENTION_DUE');
  assert.equal(memory.reviewDue,true);
});
test('failed evidence records recurring misconception codes',()=>{
  const memory=buildLearnerMemory({
    assignment:{score:30,status:'DUE',due_at_ms:Date.now()},
    evidence:[
      {evidence_type:'RETRIEVAL_CHECK',result:'FAIL',created_at:'2026-09-23T10:00:00Z',detail_json:'{"errorType":"POLICY_SCOPE"}'},
      {evidence_type:'RETRIEVAL_CHECK',result:'FAIL',created_at:'2026-09-23T10:05:00Z',detail_json:'{"errorType":"POLICY_SCOPE"}'}
    ],
    recentHelp:3
  });
  assert.equal(memory.commonErrors[0].errorType,'POLICY_SCOPE');
  assert.equal(memory.commonErrors[0].count,2);
});
