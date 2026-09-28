import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceCoverageAssurance } from './attendance-coverage-assurance.mjs';

const START=Date.parse('2026-09-18T06:00:00Z');
const END=Date.parse('2026-09-18T14:00:00Z');
class FakeEngine{
  constructor(){this.states=new Map();this.evidence=new Map();}
  getState({tenant,employee,site}){return this.states.get(`${tenant}:${employee}:${site}`)??{status:'outside',openAt:null,closeAt:null,lastDecision:null};}
  getEvidence({tenant,employee,site}){return this.evidence.get(`${tenant}:${employee}:${site}`)??[];}
  set(tenant,site,employee,state,evidence=[]){this.states.set(`${tenant}:${employee}:${site}`,state);this.evidence.set(`${tenant}:${employee}:${site}`,evidence);}
}
function setup(assignments=[{employee:'e1'},{employee:'e2',workerType:'agency'}]){
  const engine=new FakeEngine();
  const c=new AttendanceCoverageAssurance({engine,startGraceMs:5*60_000,endGraceMs:5*60_000});
  c.registerShift({tenant:'acme',site:'s1',shiftId:'day1',startAt:START,endAt:END,assignments});
  return {c,engine};
}

test('preflight exposes every person without sufficient zero-interaction routes',()=>{
  const {c}=setup();
  c.setCoveragePlan({tenant:'acme',site:'s1',employee:'e1',routes:[
    {domain:'physical_access',sourceId:'door',role:'anchor_in'},
    {domain:'physical_access',sourceId:'door',role:'departure_anchor'},
    {domain:'network_auth',sourceId:'wifi',role:'corroborator'}
  ]});
  const r=c.preflight({tenant:'acme',site:'s1',shiftId:'day1'});
  assert.equal(r.total,2); assert.equal(r.automaticReady,1); assert.equal(r.releaseTargetMet,false);
  assert.deepEqual(r.uncovered,['e2']);
});

test('fallback can make operations accountable without falsely claiming automatic capture',()=>{
  const {c}=setup([{employee:'e1'}]);
  c.setCoveragePlan({tenant:'acme',site:'s1',employee:'e1',routes:[{domain:'work_device',sourceId:'wef',role:'anchor_in'}],fallback:'manager_exception'});
  const r=c.preflight({tenant:'acme',site:'s1',shiftId:'day1'});
  assert.equal(r.operationalAccountabilityReady,true); assert.equal(r.releaseTargetMet,false); assert.deepEqual(r.partial,['e1']);
});

test('scheduled worker with no evidence becomes missing_in after grace, never silently omitted',()=>{
  const {c}=setup([{employee:'e1'}]);
  const r=c.evaluateShift({tenant:'acme',site:'s1',shiftId:'day1',nowMs:START+10*60_000});
  assert.equal(r.rows.length,1); assert.equal(r.rows[0].status,'missing_in'); assert.equal(r.unresolved,1); assert.equal(r.payrollReady,false);
});

test('partial evidence becomes evidence_pending rather than a guessed clock',()=>{
  const {c,engine}=setup([{employee:'e1'}]);
  engine.set('acme','s1','e1',{status:'outside',openAt:null,closeAt:null},[{observedAt:new Date(START+1000).toISOString(),kind:'wifi_authenticated'}]);
  const r=c.evaluateShift({tenant:'acme',site:'s1',shiftId:'day1',nowMs:START+10*60_000});
  assert.equal(r.rows[0].status,'evidence_pending'); assert.equal(r.payrollReady,false);
});

test('present worker is accounted during shift and missing_out after close grace',()=>{
  const {c,engine}=setup([{employee:'e1'}]);
  engine.set('acme','s1','e1',{status:'present',openAt:START+1000,closeAt:null},[]);
  assert.equal(c.evaluateShift({tenant:'acme',site:'s1',shiftId:'day1',nowMs:START+60*60_000}).rows[0].status,'confirmed_present');
  assert.equal(c.evaluateShift({tenant:'acme',site:'s1',shiftId:'day1',nowMs:END+10*60_000}).rows[0].status,'missing_out');
});

test('complete IN/OUT pair passes worker closeout',()=>{
  const {c,engine}=setup([{employee:'e1'}]);
  engine.set('acme','s1','e1',{status:'outside',openAt:START+1000,closeAt:END-1000},[]);
  const r=c.evaluateShift({tenant:'acme',site:'s1',shiftId:'day1',nowMs:END+10*60_000});
  assert.equal(r.rows[0].status,'complete'); assert.equal(r.payrollReady,true);
});

test('approved absence accounts for a scheduled person without manufacturing clock events',()=>{
  const {c}=setup([{employee:'e1'}]);
  c.recordExcuse({tenant:'acme',site:'s1',shiftId:'day1',employee:'e1',kind:'annual_leave',reasonCode:'LEAVE_APPROVED'});
  const r=c.evaluateShift({tenant:'acme',site:'s1',shiftId:'day1',nowMs:END+10*60_000});
  assert.equal(r.rows[0].status,'excused'); assert.equal(r.payrollReady,true);
});

test('mapped person observed onsite but not on roster is surfaced as unscheduled presence',()=>{
  const {c,engine}=setup([{employee:'e1'}]);
  engine.set('acme','s1','e1',{status:'outside',openAt:START+1000,closeAt:END-1000},[]);
  c.observeMapped({tenant:'acme',site:'s1',employee:'e99',sourceId:'door',at:START+2000});
  const r=c.evaluateShift({tenant:'acme',site:'s1',shiftId:'day1',nowMs:END+10*60_000});
  assert.equal(r.unexpectedCount,1); assert.equal(r.unexpected[0].employee,'e99'); assert.equal(r.payrollReady,false);
});

test('unmapped person-bound provider signal blocks silent closeout without storing identity',()=>{
  const {c,engine}=setup([{employee:'e1'}]);
  engine.set('acme','s1','e1',{status:'outside',openAt:START+1000,closeAt:END-1000},[]);
  c.observeUnmapped({tenant:'acme',site:'s1',sourceId:'access',eventId:'provider-event-1001',at:START+3000});
  const r=c.evaluateShift({tenant:'acme',site:'s1',shiftId:'day1',nowMs:END+10*60_000});
  assert.equal(r.unmappedSignalCount,1); assert.equal(r.payrollReady,false); assert.equal('employee' in r.unmapped[0],false);
});

test('tenant/site observations cannot leak into another shift',()=>{
  const {c,engine}=setup([{employee:'e1'}]);
  engine.set('acme','s1','e1',{status:'outside',openAt:START+1000,closeAt:END-1000},[]);
  c.observeMapped({tenant:'other',site:'s1',employee:'e99',sourceId:'door',at:START+2000});
  c.observeUnmapped({tenant:'acme',site:'s2',sourceId:'door',eventId:'event-other-site',at:START+2000});
  const r=c.evaluateShift({tenant:'acme',site:'s1',shiftId:'day1',nowMs:END+10*60_000});
  assert.equal(r.unexpectedCount,0); assert.equal(r.unmappedSignalCount,0); assert.equal(r.payrollReady,true);
});

test('duplicate scheduled assignment is rejected so nobody is double-counted',()=>{
  const engine=new FakeEngine(); const c=new AttendanceCoverageAssurance({engine});
  assert.throws(()=>c.registerShift({tenant:'acme',site:'s1',shiftId:'x',startAt:START,endAt:END,assignments:[{employee:'e1'},{employee:'e1'}]}),/Duplicate/);
});

test('10,000-person shift evaluation returns exactly 10,000 rows and exposes every missing person',()=>{
  const assignments=Array.from({length:10_000},(_,i)=>({employee:`e${i+1}`,workerType:i%5===0?'agency':'employee'}));
  const {c}=setup(assignments);
  const r=c.evaluateShift({tenant:'acme',site:'s1',shiftId:'day1',nowMs:START+10*60_000});
  assert.equal(r.totalScheduled,10_000); assert.equal(r.rows.length,10_000); assert.equal(r.unresolved,10_000);
  assert.equal(r.rows.every(x=>x.status==='missing_in'),true); assert.equal(r.accounted,0);
});
