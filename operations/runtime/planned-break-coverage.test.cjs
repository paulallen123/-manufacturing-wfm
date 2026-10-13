'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSchedulingPlan}=require('./manufacturing-scheduling-engine.cjs');
const {assessPlannedBreakCoverage}=require('./planned-break-coverage.cjs');
function fixture(){
  const start='2026-10-13T08:00:00.000Z',end='2026-10-13T16:00:00.000Z';
  const plan=createSchedulingPlan({tenant:'synthetic-t',contextRevision:'r1',sourceEvidence:['synthetic:source'],
    workers:[{id:'w1',homeSite:'site1',skills:['operator'],availability:[{start,end}]}],
    requirements:[{id:'line1',site:'site1',role:'operator',headcount:1,start,end,requiredSkills:['operator']}],
    createdAt:'2026-10-12T12:00:00.000Z'});
  const assignment=plan.assignments[0];
  const pause={tenant:plan.tenant,contextRevision:plan.contextRevision,planId:plan.planId,
    slotId:assignment.slotId,workerId:assignment.workerId,site:'site1',start:'2026-10-13T12:00:00.000Z',end:'2026-10-13T12:30:00.000Z',
    evidenceRef:'synthetic:declared-break',revision:'break-r1'};
  return {plan,breaks:[pause]};
}
test('full shift assignment does not establish uninterrupted break coverage',()=>{
  const f=fixture();assert.equal(f.plan.quality.coveragePct,100);
  const r=assessPlannedBreakCoverage(f);
  assert.equal(r.status,'DECLARED_COVERAGE_GAPS');
  assert.deepEqual(r.gaps,[{requirementId:'line1',site:'site1',start:f.breaks[0].start,end:f.breaks[0].end,required:1,available:0,shortfall:1}]);
  assert.equal(r.executionPermitted,false);
});
test('explicit empty break list preserves declared coverage without readiness authority',()=>{
  const f=fixture();f.breaks=[];
  const r=assessPlannedBreakCoverage(f);
  assert.equal(r.status,'DECLARED_COVERAGE_COMPLETE_UNVERIFIED');assert.deepEqual(r.gaps,[]);
  assert.equal(r.executionPermitted,false);assert.equal(r.customerReady,false);
});
test('missing break declaration is unknown, not the same as explicit empty',()=>{
  const f=fixture();delete f.breaks;
  assert.equal(assessPlannedBreakCoverage(f).status,'INCOMPLETE');
});
test('break provenance must bind exact plan, tenant, revision, worker and slot',()=>{
  for(const field of ['tenant','contextRevision','planId','workerId','slotId','site','evidenceRef','revision']){
    for(const value of [undefined,'','other']){
      if(['evidenceRef','revision'].includes(field)&&value==='other')continue;
      const f=fixture();f.breaks[0][field]=value;
      assert.notEqual(assessPlannedBreakCoverage(f).status,'DECLARED_COVERAGE_COMPLETE_UNVERIFIED');
      assert.equal(assessPlannedBreakCoverage(f).status,'REJECTED');
    }
  }
});

test('hostile accessor/proxy data fails closed without calls',()=>{
  let calls=0;const f=fixture();
  Object.defineProperty(f.breaks[0],'workerId',{enumerable:true,get(){calls++;return 'w1';}});
  assert.equal(assessPlannedBreakCoverage(f).status,'REJECTED');
  const other=fixture();other.plan=new Proxy(other.plan,{get(){calls++;throw Error('trap');}});
  assert.equal(assessPlannedBreakCoverage(other).status,'REJECTED');assert.equal(calls,0);
});
test('one worker cannot establish simultaneous coverage of two declared slots',()=>{
  const f=structuredClone(fixture());f.breaks=[];
  f.plan.requirements[0].headcount=2;
  const a=structuredClone(f.plan.assignments[0]);a.slotId='line1#2';f.plan.assignments.push(a);
  const identity={...f.plan};delete identity.planId;delete identity.createdAt;
  f.plan.planId=require('./manufacturing-scheduling-engine.cjs').digest(identity);
  assert.equal(assessPlannedBreakCoverage(f).status,'REJECTED');
});
test('changed revision of same break receipt requires reconciliation',()=>{
  const f=fixture();const correction=structuredClone(f.breaks[0]);correction.revision='break-r2';f.breaks.push(correction);
  assert.equal(assessPlannedBreakCoverage(f).status,'REJECTED');
});

test('contradictory assignment site and missing source evidence reject rehashed plans',()=>{
  for(const mutate of [p=>{p.assignments[0].site='different-site';},p=>{p.sourceEvidence=[];},p=>{delete p.validation;},
    p=>{p.assignments[0].shortfall=true;},
    p=>{p.assignments[0].workerId=null;p.assignments[0].shortfall=true;p.assignments[0].site='different-site';}]){
    const f=structuredClone(fixture());f.breaks=[];mutate(f.plan);
    const identity={...f.plan};delete identity.planId;delete identity.createdAt;
    f.plan.planId=require('./manufacturing-scheduling-engine.cjs').digest(identity);
    assert.equal(assessPlannedBreakCoverage(f).status,'REJECTED');
  }
});

test('canonical explicit unfilled slot remains a coverage gap for the full period',()=>{
  const f=structuredClone(fixture());f.breaks=[];f.plan.assignments[0].workerId=null;f.plan.assignments[0].shortfall=true;
  const identity={...f.plan};delete identity.planId;delete identity.createdAt;
  f.plan.planId=require('./manufacturing-scheduling-engine.cjs').digest(identity);
  const r=assessPlannedBreakCoverage(f);
  assert.equal(r.status,'DECLARED_COVERAGE_GAPS');assert.equal(r.gaps[0].start,f.plan.requirements[0].start);
  assert.equal(r.gaps[0].end,f.plan.requirements[0].end);assert.equal(r.gaps[0].available,0);
});
test('invalid, impossible, outside-slot and reversed break instants reject',()=>{
  for(const [start,end] of [['2026-02-30T12:00:00.000Z','2026-10-13T12:30:00.000Z'],
    ['2026-10-13T12:00:00','2026-10-13T12:30:00.000Z'],
    ['2026-10-13T07:00:00.000Z','2026-10-13T12:30:00.000Z'],
    ['2026-10-13T12:00:00.000Z','2026-10-13T17:00:00.000Z'],
    ['2026-10-13T12:00:00.000Z','2026-10-13T12:00:00.000Z']]){
    const f=fixture();Object.assign(f.breaks[0],{start,end});assert.equal(assessPlannedBreakCoverage(f).status,'REJECTED');
  }
});
test('exact replayed break does not double subtract; conflicting evidence rejects',()=>{
  const f=fixture();f.breaks.push(structuredClone(f.breaks[0]));
  assert.equal(assessPlannedBreakCoverage(f).gaps[0].shortfall,1);
  f.breaks[1].end='2026-10-13T12:45:00.000Z';assert.equal(assessPlannedBreakCoverage(f).status,'REJECTED');
});
test('tampered plan digest and missing assignment reject even if quality says 100',()=>{
  for(const mutate of [f=>{f.plan.quality.coveragePct=0;},f=>{f.plan.assignments=[];}]){
    const f=structuredClone(fixture());mutate(f);assert.equal(assessPlannedBreakCoverage(f).status,'REJECTED');
  }
});
test('assessment preserves input and returns a detached immutable result',()=>{
  const f=fixture(),before=structuredClone(f),r=assessPlannedBreakCoverage(f);
  assert.deepEqual(f,before);assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.gaps[0]));
  f.breaks[0].start='changed';assert.notEqual(r.gaps[0].start,'changed');
});
