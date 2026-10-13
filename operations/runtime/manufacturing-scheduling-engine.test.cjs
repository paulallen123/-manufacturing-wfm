'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSchedulingPlan,evaluateOpenShift,evaluateSwap,repairSchedulingPlan,capabilityContract}=require('./manufacturing-scheduling-engine.cjs');

const baseReq={id:'line4-welder',site:'tamworth',line:'line-4',role:'welder',start:'2026-09-24T06:00:00Z',end:'2026-09-24T14:00:00Z',
  headcount:1,requiredSkills:['welding-l3'],requiredCertifications:['weld-cert'],tags:['DAY'],productionPriority:90,customerPriority:85,marginAtRisk:8000,evidenceRefs:['mes:44']};
function worker(id,o={}){
  return {id,type:'EMPLOYEE',status:'ACTIVE',homeSite:'tamworth',eligibleSites:['tamworth'],skills:['welding-l3'],
    certifications:[{name:'weld-cert',expiresAt:'2027-01-01T00:00:00Z'}],
    availability:[{start:'2026-09-24T05:00:00Z',end:'2026-09-24T23:00:00Z'}],
    previousShiftEnd:'2026-09-23T18:00:00Z',hoursWorkedWeek:24,contractedHours:40,hourlyCost:20,
    fairness:{},preferences:{},evidenceRefs:['hr:'+id],...o};
}
function input(o={}){
  return {tenant:'alpha',contextRevision:'twin:1',createdAt:'2026-09-23T12:00:00Z',sourceEvidence:['mes:44','hr:9','policy:uk'],
    policy:{minRestHours:11,maxWeeklyHours:48,maxOvertimeHours:8,ruleVersion:'uk-site-v3'},
    workers:[worker('a'),worker('b',{hourlyCost:24})],requirements:[baseReq],...o};
}
test('lower controllable cost wins without execution authority',()=>{
  const p=createSchedulingPlan(input());
  assert.equal(p.assignments[0].workerId,'a'); assert.equal(p.quality.coveragePct,100); assert.equal(p.executionPermitted,false); assert.equal(p.validation.valid,true);
});
test('hard constraints fail closed and explain shortfall',()=>{
  const bad=worker('bad',{skills:[],certifications:[{name:'weld-cert',expiresAt:'2026-09-24T08:00:00Z'}],
    availability:[{start:'2026-09-24T07:00:00Z',end:'2026-09-24T15:00:00Z'}],previousShiftEnd:'2026-09-24T01:00:00Z'});
  const p=createSchedulingPlan(input({workers:[bad]})),reasons=p.unfilled[0].topReasons.map(x=>x.reason);
  assert.equal(p.quality.coveragePct,0); assert.ok(reasons.includes('MISSING_SKILL:welding-l3')); assert.ok(reasons.includes('CERTIFICATION_INVALID:weld-cert')); assert.ok(reasons.includes('MINIMUM_REST_BREACH'));
});
test('cross-site internal labour competes economically with agency',()=>{
  const internal=worker('internal',{homeSite:'birmingham',eligibleSites:['birmingham','tamworth'],hourlyCost:21,travelCostBySite:{tamworth:15},travelMinutesBySite:{tamworth:45}});
  const agency=worker('agency',{type:'AGENCY',hourlyCost:19,agencyPremiumPerHour:14});
  const p=createSchedulingPlan(input({workers:[internal,agency]}));
  assert.equal(p.assignments[0].workerId,'internal'); assert.equal(p.quality.agencyHours,0);
});
test('open shift evaluation includes rejection reasons',()=>{
  const r=evaluateOpenShift({requirement:baseReq,workers:[worker('ok'),worker('no',{skills:[]})],policy:{}});
  assert.equal(r.ranked[0].workerId,'ok'); assert.ok(r.ranked.find(x=>x.workerId==='no').failures.includes('MISSING_SKILL:welding-l3'));
});
test('swap refuses a qualification breach',()=>{
  const packing={...baseReq,id:'packing',role:'packer',requiredSkills:['packing'],requiredCertifications:[]};
  const r=evaluateSwap({workerA:worker('a'),workerB:worker('b',{skills:['packing']}),requirementA:baseReq,requirementB:packing,policy:{}});
  assert.equal(r.eligible,false); assert.ok(r.reasons.includes('MISSING_SKILL:welding-l3'));
});
test('repair removes unavailable worker and remains shadow only',()=>{
  const reqs=[baseReq,{...baseReq,id:'second',start:'2026-09-24T14:00:00Z',end:'2026-09-24T22:00:00Z'}],workers=[worker('a'),worker('b',{hourlyCost:22})];
  const prior=createSchedulingPlan(input({workers,requirements:reqs})),lost=prior.assignments.find(x=>x.workerId).workerId;
  const r=repairSchedulingPlan({priorPlan:prior,workers,requirements:reqs,contextRevision:'twin:2',event:{type:'NO_SHOW',unavailableWorkerIds:[lost],evidenceRef:'clock:1'},sourceEvidence:['clock:1']});
  assert.equal(r.executionPermitted,false); assert.ok(r.changeCount>=1); assert.equal(r.repairedPlan.assignments.some(x=>x.workerId===lost),false);
});
test('uncertain forecast plans p90 without claiming forecasting model accuracy',()=>{
  const p=createSchedulingPlan(input({workers:[worker('a'),worker('b')],requirements:[{...baseReq,headcount:undefined,forecast:{p50Headcount:1,p90Headcount:2,confidence:0.5}}]}));
  assert.equal(p.assignments.length,2); assert.equal(p.quality.coveragePct,100);
});
test('capability contract is explicit about limits',()=>{
  const c=capabilityContract(); assert.equal(c.tableStakes.shiftSwapValidation,true); assert.equal(c.differentiation.marginAtRisk,true); assert.ok(c.notClaimed.includes('production-autonomous-scheduling'));
});

// F2/#233: deterministic interval and swap projection regressions.
const engine=require('./manufacturing-scheduling-engine.cjs');
function wideWorker(id,o={}){return worker(id,{availability:[{start:'2026-09-20T00:00:00Z',end:'2026-10-01T00:00:00Z'}],previousShiftEnd:null,hoursWorkedWeek:0,...o});}
function shift(id,start,end){return {...baseReq,id,start,end};}
function assignment(r,workerId){return {slotId:r.id+'#1',requirementId:r.id,workerId,start:r.start,end:r.end};}
const early=shift('early','2026-09-24T06:00:00Z','2026-09-24T14:00:00Z');
const late=shift('late','2026-09-24T15:00:00Z','2026-09-24T23:00:00Z');
function validate(reqs,as,policy={}){
 const ws=new Map(['a','b','c'].map(id=>[id,engine.normaliseWorker(wideWorker(id))]));
 const ss=new Map(reqs.map(r=>{const s=evaluateOpenShift({requirement:r,workers:[]}).slot;return [s.slotId,s];}));
 return engine.validateSchedule(as,ws,ss,engine.normalisePolicy(policy));
}
function freezeDeep(v){if(v&&typeof v==='object'){Object.freeze(v);for(const x of Object.values(v))freezeDeep(x);}return v;}
function swapInput(){return {workerA:wideWorker('a'),workerB:wideWorker('b'),requirementA:{...early},requirementB:{...late},policy:{minRestHours:11},currentAssignments:[assignment(early,'a'),assignment(late,'b')]};}
test('RED report: 06-14 then 15-23 fails independent minimum rest validation in either order',()=>{
 for(const reqs of [[early,late],[late,early]]){
  const r=validate(reqs,reqs.map(s=>assignment(s,'a')),{minRestHours:11});
  assert.equal(r.valid,false);assert.ok(r.violations.some(v=>v.reasons.includes('MINIMUM_REST_BREACH')));
 }
});
test('RED report: swap retains incoming worker unrelated overlapping assignment',()=>{
 const x=swapInput(),other=shift('other','2026-09-24T07:00:00Z','2026-09-24T10:00:00Z');
 x.currentAssignments.push(assignment(other,'b'));
 const r=evaluateSwap(x);assert.equal(r.eligible,false);assert.ok(r.reasons.includes('OVERLAPPING_ASSIGNMENT'));
});
test('exact minimum rest across midnight passes, one millisecond short fails',()=>{
 const exact=shift('next','2026-09-25T01:00:00Z','2026-09-25T09:00:00Z');
 assert.equal(validate([early,exact],[assignment(early,'a'),assignment(exact,'a')]).valid,true);
 const short={...exact,start:'2026-09-25T00:59:59.999Z'};
 assert.equal(validate([early,short],[assignment(early,'a'),assignment(short,'a')]).valid,false);
});
test('cross-midnight overlap fails even at zero rest; touching intervals respect policy',()=>{
 const night=shift('night','2026-09-24T22:00:00Z','2026-09-25T06:00:00Z');
 const touch=shift('touch','2026-09-25T06:00:00Z','2026-09-25T14:00:00Z');
 const overlap={...touch,start:'2026-09-25T05:59:59Z'};
 assert.equal(validate([night,touch],[assignment(night,'a'),assignment(touch,'a')],{minRestHours:0}).valid,true);
 assert.equal(validate([night,touch],[assignment(night,'a'),assignment(touch,'a')]).valid,false);
 assert.equal(validate([night,overlap],[assignment(overlap,'a'),assignment(night,'a')],{minRestHours:0}).valid,false);
});
test('three consecutive assignments check each gap regardless of order',()=>{
 const second=shift('second','2026-09-25T06:00:00Z','2026-09-25T14:00:00Z');
 const third=shift('third','2026-09-26T06:00:00Z','2026-09-26T14:00:00Z');
 assert.equal(validate([early,second,third],[third,early,second].map(r=>assignment(r,'a'))).valid,true);
 const bad={...third,start:'2026-09-25T20:00:00Z'};
 assert.equal(validate([early,second,bad],[bad,early,second].map(r=>assignment(r,'a'))).valid,false);
});
test('exact and greedy solvers cannot assign both insufficient-rest shifts to one worker',()=>{
 for(const exactSlotLimit of [1,10]){
  const p=createSchedulingPlan(input({workers:[wideWorker('a')],requirements:[early,late],policy:{minRestHours:11,exactSlotLimit}}));
  assert.equal(p.quality.filledSlots,1);assert.equal(p.validation.valid,true);
 }
});
test('valid swap retains unrelated assignments and never mutates frozen inputs',()=>{
 const x=swapInput();x.currentAssignments.push(assignment(shift('unrelated','2026-09-26T06:00:00Z','2026-09-26T14:00:00Z'),'a'));
 const before=JSON.stringify(x);freezeDeep(x);assert.equal(evaluateSwap(x).eligible,true);assert.equal(JSON.stringify(x),before);
});
test('swap retains unrelated rest and weekly hours constraints for both workers',()=>{
 for(const id of ['a','b']){
  const x=swapInput();x.currentAssignments.push(assignment(shift('other','2026-09-24T00:00:00Z','2026-09-24T05:00:00Z'),id));
  assert.equal(evaluateSwap(x).eligible,false);
  x.currentAssignments[2]=assignment(shift('other','2026-09-26T06:00:00Z','2026-09-26T14:00:00Z'),id);
  x.policy.maxWeeklyHours=12;assert.equal(evaluateSwap(x).eligible,false);
 }
});
test('self swap and same requirement swap are rejected',()=>{
 const x=swapInput();x.workerB=x.workerA;assert.equal(evaluateSwap(x).eligible,false);
 const y=swapInput();y.requirementB=y.requirementA;assert.equal(evaluateSwap(y).eligible,false);
});
test('duplicate, missing and mismatched swap assignment identities fail closed',()=>{
 for(const mutate of [x=>x.currentAssignments.push({...x.currentAssignments[0]}),x=>delete x.currentAssignments[0].slotId,x=>delete x.currentAssignments[0].workerId,x=>x.currentAssignments.pop(),x=>x.currentAssignments[0].workerId='c',x=>x.currentAssignments[0].start=late.start]){
  const x=swapInput();mutate(x);assert.throws(()=>evaluateSwap(x));
 }
 for(const mutate of [x=>delete x.workerA.id,x=>delete x.requirementA.id]){const x=swapInput();mutate(x);assert.throws(()=>evaluateSwap(x));}
});
test('independent validation rejects duplicate and missing IDs and time spoofing',()=>{
 const a=assignment(early,'a');
 for(const as of [[a,a],[{...a,slotId:undefined}],[{...a,workerId:undefined}],[{...a,start:late.start}],[{...a,start:'not-a-time'}]])assert.equal(validate([early],as).valid,false);
});
test('timestamps require explicit offsets and real calendar dates without silent normalization',()=>{
 for(const start of ['2026-09-24T06:00:00','2026-09-24','2026-02-30T06:00:00Z','2026-09-24T24:00:00Z','2026-09-24T06:00:00-00:00','2026-09-24T06:00:00.0001Z','2026-09-24T06:00:60Z'])assert.throws(()=>evaluateOpenShift({requirement:{...early,start},workers:[]}));
 for(const end of ['2026-09-20T00:00:00Z','2026-09-19T23:00:00Z'])assert.throws(()=>evaluateOpenShift({requirement:early,workers:[wideWorker('a',{availability:[{start:'2026-09-20T00:00:00Z',end}]})]}));
});
test('offsets compare actual instants across DST and day boundaries independent of host timezone',()=>{
 const before=shift('before','2026-10-24T22:00:00+01:00','2026-10-25T01:30:00+01:00');
 const after=shift('after','2026-10-25T11:30:00Z','2026-10-25T12:30:00Z');
 const w=wideWorker('a',{availability:[{start:'2026-10-24T00:00:00Z',end:'2026-10-26T00:00:00Z'}]});
 assert.equal(evaluateOpenShift({requirement:after,workers:[w],currentAssignments:[assignment(before,'a')]}).ranked[0].eligible,true);
 const short={...after,start:'2026-10-25T11:29:59Z'};
 assert.equal(evaluateOpenShift({requirement:short,workers:[w],currentAssignments:[assignment(before,'a')]}).ranked[0].eligible,false);
});
test('malformed current assignment times cannot disappear from open-shift checks',()=>{
 for(const a of [{...assignment(late,'a'),start:'invalid'},{...assignment(late,'a'),end:late.start}])assert.throws(()=>evaluateOpenShift({requirement:early,workers:[wideWorker('a')],currentAssignments:[a]}));
});
test('existing qualifications, availability, locks, counters and policy rules remain enforced',()=>{
 const cases=[{skills:[]},{availability:[]},{consecutiveShifts:6},{consecutiveNights:4},{ruleBlocks:['rule:1']},{previousShiftEnd:'2026-09-24T05:00:00Z'}];
 for(const o of cases){const r=evaluateOpenShift({requirement:{...early,tags:['NIGHT']},workers:[wideWorker('a',o)],policy:{requiredRuleRefs:['rule:1']}});assert.equal(r.ranked[0].eligible,false);}
 assert.equal(evaluateOpenShift({requirement:{...early,lockedWorkerIds:['b']},workers:[wideWorker('a')]}).ranked[0].eligible,false);
});
test('swap does not silently select slot one of an ambiguous multi-slot requirement',()=>{
 for(const changes of [{headcount:2},{planningHeadcount:2},{forecast:{p50Headcount:1,p90Headcount:2,confidence:0.5}}]){
  const x=swapInput();Object.assign(x.requirementA,changes);assert.throws(()=>evaluateSwap(x),/single-slot/);
 }
});
test('omitted schedule preserves hypothetical swap contract; explicit incomplete schedule is rejected',()=>{
 const x=swapInput();delete x.currentAssignments;assert.equal(evaluateSwap(x).eligible,true);
 for(const currentAssignments of [[],null,{},[assignment(early,'a')]])assert.throws(()=>evaluateSwap({...x,currentAssignments}));
});
test('frozen plan, validation and rejected swap inputs are unchanged',()=>{
 const p=input({workers:[wideWorker('a'),wideWorker('b')],requirements:[early,late]});
 const before=JSON.stringify(p);freezeDeep(p);assert.equal(createSchedulingPlan(p).validation.valid,true);assert.equal(JSON.stringify(p),before);
 const as=freezeDeep([assignment(early,'a'),assignment(late,'a')]),saved=JSON.stringify(as);
 assert.equal(validate([early,late],as).valid,false);assert.equal(JSON.stringify(as),saved);
 const x=swapInput();x.currentAssignments.push(assignment(shift('collision',early.start,early.end),'b'));
 const savedSwap=JSON.stringify(x);freezeDeep(x);assert.equal(evaluateSwap(x).eligible,false);assert.equal(JSON.stringify(x),savedSwap);
});
test('UTC and explicit offsets denote identical instants; reversed overnight dates are rejected',()=>{
 const offset={...early,start:'2026-09-24T07:00:00+01:00',end:'2026-09-24T16:00:00+02:00'};
 const r=evaluateOpenShift({requirement:offset,workers:[wideWorker('a')]});
 assert.equal(r.slot.start,'2026-09-24T06:00:00.000Z');assert.equal(r.slot.end,'2026-09-24T14:00:00.000Z');assert.equal(r.ranked[0].eligible,true);
 assert.throws(()=>evaluateOpenShift({requirement:shift('bad','2026-09-24T22:00:00Z','2026-09-24T06:00:00Z'),workers:[]}));
 assert.throws(()=>evaluateOpenShift({requirement:early,workers:[],currentAssignments:null}));
});

// #202 WFM depth: configured per-shift fatigue limits, shared by every evaluator.
test('maximum shift hours allows the exact boundary and rejects one millisecond over',()=>{
 const exact={...early,end:'2026-09-24T18:00:00Z'};
 const over={...exact,end:'2026-09-24T18:00:00.001Z'};
 const args={workers:[wideWorker('a')],policy:{maxShiftHours:12}};
 assert.equal(evaluateOpenShift({...args,requirement:exact}).ranked[0].eligible,true);
 const denied=evaluateOpenShift({...args,requirement:over}).ranked[0];
 assert.equal(denied.eligible,false);
 assert.ok(denied.failures.includes('MAX_SHIFT_HOURS_BREACH'));
 assert.equal(evaluateOpenShift({workers:[wideWorker('a')],requirement:over}).ranked[0].eligible,true);
});
test('maximum shift hours uses elapsed instants across overnight and DST offsets',()=>{
 const overnight=shift('overnight','2026-10-24T22:00:00+01:00','2026-10-25T10:00:00Z');
 const w=wideWorker('a',{availability:[{start:'2026-10-24T00:00:00Z',end:'2026-10-26T00:00:00Z'}]});
 assert.equal(evaluateOpenShift({requirement:overnight,workers:[w],policy:{maxShiftHours:13}}).ranked[0].eligible,true);
 assert.equal(evaluateOpenShift({requirement:overnight,workers:[w],policy:{maxShiftHours:12}}).ranked[0].eligible,false);
});
test('invalid explicit maximum shift hours is rejected rather than coerced or defaulted',()=>{
 for(const value of [null,0,-1,NaN,Infinity,-Infinity,'12',true,false,[],{},new Number(12)]){
  assert.throws(()=>evaluateOpenShift({requirement:early,workers:[wideWorker('a')],policy:{maxShiftHours:value}}),/maxShiftHours/);
 }
 assert.equal(evaluateOpenShift({requirement:{...early,end:'2026-09-24T06:30:00Z'},workers:[wideWorker('a')],policy:{maxShiftHours:0.5}}).ranked[0].eligible,true);
});
test('exact and greedy plans leave overlong shifts unfilled with an explicit reason',()=>{
 for(const exactSlotLimit of [1,10]){
  const requirements=[early,{...early,id:'overlong',start:'2026-09-25T06:00:00Z',end:'2026-09-25T19:00:00Z'}];
  const p=createSchedulingPlan(input({workers:[wideWorker('a')],requirements,policy:{maxShiftHours:12,exactSlotLimit}}));
  assert.equal(p.quality.filledSlots,1);assert.equal(p.validation.valid,true);
  assert.equal(p.policy.maxShiftHours,12);
  assert.ok(p.unfilled[0].topReasons.some(r=>r.reason==='MAX_SHIFT_HOURS_BREACH'));
  assert.equal(p.executionPermitted,false);
 }
});
test('independent schedule validation rejects an overlong assigned slot',()=>{
 const long={...early,end:'2026-09-24T19:00:00Z'};
 const r=validate([long],[assignment(long,'a')],{maxShiftHours:12});
 assert.equal(r.valid,false);assert.ok(r.violations[0].reasons.includes('MAX_SHIFT_HOURS_BREACH'));
});
test('swap rejects an overlong leg without mutating input',()=>{
 const x=swapInput();delete x.currentAssignments;x.requirementA.end='2026-09-24T19:00:00Z';x.policy.maxShiftHours=12;
 const before=JSON.stringify(x);freezeDeep(x);
 const r=evaluateSwap(x);assert.equal(r.eligible,false);assert.ok(r.reasons.includes('MAX_SHIFT_HOURS_BREACH'));
 assert.equal(JSON.stringify(x),before);assert.equal(r.executionPermitted,false);
});
test('repair inherits the persisted maximum shift hours policy',()=>{
 const prior=createSchedulingPlan(input({workers:[wideWorker('a')],policy:{maxShiftHours:12}}));
 const r=repairSchedulingPlan({priorPlan:prior,workers:[wideWorker('a')],requirements:[{...early,end:'2026-09-24T19:00:00Z'}],event:{type:'DEMAND_CHANGE',evidenceRef:'mes:45'}});
 assert.equal(r.repairedPlan.policy.maxShiftHours,12);assert.equal(r.repairedPlan.quality.filledSlots,0);
 assert.ok(r.repairedPlan.unfilled[0].topReasons.some(x=>x.reason==='MAX_SHIFT_HOURS_BREACH'));
});
test('maximum shift hours participates in plan identity only when configured',()=>{
 const x=input({workers:[wideWorker('a')]});
 const unset=createSchedulingPlan(x),configured=createSchedulingPlan({...x,policy:{...x.policy,maxShiftHours:12}});
 assert.equal(Object.hasOwn(unset.policy,'maxShiftHours'),false);
 assert.notEqual(configured.planId,unset.planId);
 assert.notEqual(configured.planId,createSchedulingPlan({...x,policy:{...x.policy,maxShiftHours:10}}).planId);
});
test('existing capability discovery advertises configured maximum shift hours',()=>{
 assert.equal(capabilityContract().tableStakes.configuredMaximumShiftHours,true);
});
