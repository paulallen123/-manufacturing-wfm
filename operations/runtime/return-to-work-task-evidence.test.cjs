'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {assessReturnToWorkTaskEvidence} = require('./return-to-work-task-evidence.cjs');

const assignment = Object.freeze({workerId:'synthetic-worker',taskId:'task-7',site:'site-2',assignmentRevision:'rev-4',start:'2026-10-14T08:00:00Z',end:'2026-10-14T16:00:00Z'});
const evidence = Object.freeze({...assignment,sourceRef:'synthetic-policy:123',approverRef:'synthetic-independent-reviewer',taskControlsConfirmed:true,restrictionsResolved:true,effectiveFrom:'2026-10-13T08:00:00Z',effectiveTo:'2026-10-15T00:00:00Z'});
const assess = (a=assignment,e=evidence,observedAt='2026-10-13T12:00:00Z') => assessReturnToWorkTaskEvidence({assignment:a,evidence:e,observedAt});

test('complete synthetic exact-task evidence is advisory and cannot grant assignment authority',()=>{
  const result=assess();
  assert.equal(result.evidenceGate,'EVIDENCE_COMPLETE_UNVERIFIED');
  assert.equal(result.assignmentPermitted,false);
  assert.deepEqual(result.reasons,[]);
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.reasons));
});

test('ended absence or active worker state alone never supplies task evidence',()=>{
  const result=assess(assignment,{absenceEnded:true,status:'ACTIVE'});
  assert.equal(result.evidenceGate,'BLOCKED');
  assert.ok(result.reasons.includes('TASK_CONTROLS_UNCONFIRMED'));
  assert.equal(result.assignmentPermitted,false);
});

test('a different worker, task, site or revision cannot reuse the evidence',()=>{
  for(const key of ['workerId','taskId','site','assignmentRevision']){
    const result=assess({...assignment,[key]:'different'});
    assert.ok(result.reasons.includes('EVIDENCE_SCOPE_MISMATCH_'+key.toUpperCase()),key);
  }
});

test('evidence must cover the full exact assignment and be observed inside its validity',()=>{
  for(const changed of [{effectiveTo:'2026-10-14T12:00:00Z'},{effectiveFrom:'2026-10-14T09:00:00Z'},{effectiveTo:'2026-10-13T00:00:00Z'}]){
    assert.ok(assess(assignment,{...evidence,...changed}).reasons.includes('TASK_EVIDENCE_NOT_CURRENT_FOR_ASSIGNMENT'));
  }
  assert.ok(assess(assignment,evidence,'2026-10-16T00:00:00Z').reasons.includes('INVALID_OBSERVATION_OR_ASSIGNMENT_TIME'));
  assert.ok(assess({...assignment,start:'2026-02-30T08:00:00Z'}).reasons.includes('INVALID_OBSERVATION_OR_ASSIGNMENT_TIME'));
});

test('unresolved restrictions, missing controls or self approval block the evidence gate',()=>{
  for(const changed of [{restrictionsResolved:false},{taskControlsConfirmed:false},{approverRef:assignment.workerId},{approverRef:' '+assignment.workerId},{approverRef:assignment.workerId+' '},{sourceRef:''}]){
    assert.equal(assess(assignment,{...evidence,...changed}).evidenceGate,'BLOCKED');
  }
});
