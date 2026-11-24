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

test('swap rejects an explicitly conflicting outgoing site on either leg',()=>{
 for(const leg of [0,1]){
  const x=swapInput();x.currentAssignments[leg].site='birmingham';
  assert.throws(()=>evaluateSwap(x),/outgoing.*site/i,'leg '+leg);
 }
});
test('swap rejects malformed declared outgoing sites without coercion or mutation',()=>{
 for(const leg of [0,1])for(const site of [null,'',' tamworth','tamworth ',42,{},[],undefined]){
  const x=swapInput();x.currentAssignments[leg].site=site;freezeDeep(x);
  assert.throws(()=>evaluateSwap(x),/outgoing.*site/i,'leg '+leg+' type '+typeof site);
  assert.equal(x.currentAssignments[leg].site,site);
 }
});
test('swap accepts matching declared sites and preserves advisory and frozen-input boundaries',()=>{
 const x=swapInput();for(const row of x.currentAssignments)row.site='tamworth';
 const before=JSON.stringify(x);freezeDeep(x);const r=evaluateSwap(x);
 assert.equal(r.eligible,true);assert.equal(r.mode,'EVALUATE_ONLY');assert.equal(r.executionPermitted,false);
 assert.equal(JSON.stringify(x),before);
});
test('swap checks each outgoing site against its own requirement for a valid cross-site exchange',()=>{
 const x=swapInput();x.requirementB.site='birmingham';x.workerB.homeSite='birmingham';
 for(const w of [x.workerA,x.workerB]){w.eligibleSites=['tamworth','birmingham'];w.travelMinutesBySite={tamworth:30,birmingham:30};}
 x.currentAssignments[0].site='tamworth';x.currentAssignments[1].site='birmingham';
 const r=evaluateSwap(x);assert.equal(r.eligible,true);assert.equal(r.executionPermitted,false);
});
test('swap preserves omitted-site and omitted-schedule legacy evaluation contracts',()=>{
 for(const suppliedSites of [[],[0],[1],[0,1]]){
  const x=swapInput();for(const leg of suppliedSites)x.currentAssignments[leg].site='tamworth';
  const r=evaluateSwap(x);assert.equal(r.eligible,true);assert.equal(r.executionPermitted,false);
 }
 const x=swapInput();delete x.currentAssignments;const r=evaluateSwap(x);
 assert.equal(r.eligible,true);assert.equal(r.mode,'EVALUATE_ONLY');assert.equal(r.executionPermitted,false);
});
test('swap canonicalizes equivalent outgoing timestamps while retaining exact declared-site checks',()=>{
 const x=swapInput();for(const row of x.currentAssignments)row.site='tamworth';
 x.currentAssignments[0].start='2026-09-24T07:00:00+01:00';x.currentAssignments[0].end='2026-09-24T16:00:00+02:00';
 assert.equal(evaluateSwap(x).eligible,true);x.currentAssignments[0].site='birmingham';
 assert.throws(()=>evaluateSwap(x),/outgoing.*site/i);
});
test('swap outgoing-site conflict cannot be hidden by unrelated rows or assignment order',()=>{
 const x=swapInput();x.currentAssignments[0].site='birmingham';
 x.currentAssignments.push({...assignment(shift('other-site','2026-09-26T06:00:00Z','2026-09-26T14:00:00Z'),'c'),site:'birmingham'});
 for(const rows of [x.currentAssignments,x.currentAssignments.slice().reverse()])assert.throws(()=>evaluateSwap({...x,currentAssignments:rows}),/outgoing.*site/i);
});

// V029: declared availability is the union of its valid absolute intervals.
// These controls add no source authentication or scheduling execution authority.
function v029Touching(){return [
 {start:'2026-09-24T06:00:00Z',end:'2026-09-24T10:00:00Z'},
 {start:'2026-09-24T10:00:00Z',end:'2026-09-24T14:00:00Z'}
];}
function v029Open(workers,requirement={...baseReq},policy={}){
 return evaluateOpenShift({requirement,workers,policy});
}
test('V029 touching availability covers the full open shift without execution authority',()=>{
 const workers=[wideWorker('union',{availability:v029Touching()})];freezeDeep(workers);
 const result=v029Open(workers);
 assert.equal(result.ranked[0].eligible,true);
 assert.equal(result.mode,'EVALUATE_ONLY');assert.equal(result.executionPermitted,false);
});
test('V029 overlapping availability chains cover a shift independently of input order',()=>{
 const windows=[{start:'2026-09-24T06:00:00Z',end:'2026-09-24T09:00:00Z'},
  {start:'2026-09-24T08:00:00Z',end:'2026-09-24T12:00:00Z'},
  {start:'2026-09-24T11:00:00Z',end:'2026-09-24T14:00:00Z'}];
 for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]){
  const workers=[wideWorker('union',{availability:order.map(i=>({...windows[i]}))})];
  const before=JSON.stringify(workers);freezeDeep(workers);
  assert.equal(v029Open(workers).ranked[0].eligible,true,'window order '+order);
  assert.equal(JSON.stringify(workers),before);
 }
});
test('V029 explicit offset windows join by absolute instants across a clock change',()=>{
 const requirement={...baseReq,id:'offset-union',start:'2026-10-25T01:00:00+01:00',end:'2026-10-25T02:00:00Z'};
 const workers=[wideWorker('offset',{availability:[
  {start:'2026-10-25T02:00:00+01:00',end:'2026-10-25T02:00:00Z'},
  {start:'2026-10-25T01:00:00+01:00',end:'2026-10-25T01:00:00Z'}
 ]})];freezeDeep(workers);
 const result=v029Open(workers,requirement);
 assert.equal(result.ranked[0].eligible,true);
 assert.equal(result.slot.start,'2026-10-25T00:00:00.000Z');
 assert.equal(result.slot.end,'2026-10-25T02:00:00.000Z');
});
test('V029 a one millisecond availability gap remains unavailable despite favorable preferences',()=>{
 const availability=v029Touching();availability[1].start='2026-09-24T10:00:00.001Z';
 const result=v029Open([wideWorker('gap',{availability,hourlyCost:0,
  preferences:{preferredSites:['tamworth'],preferredLines:['line-4'],preferredTags:['DAY']}})]);
 assert.equal(result.ranked[0].eligible,false);
 assert.ok(result.ranked[0].failures.includes('NOT_AVAILABLE'));
 assert.equal(result.executionPermitted,false);
});
test('V029 empty and partial availability never become full coverage',()=>{
 for(const availability of [[],[v029Touching()[0]],
  [{start:'2026-09-24T06:00:00Z',end:'2026-09-24T10:00:00Z'},
   {start:'2026-09-24T10:00:00Z',end:'2026-09-24T13:59:59.999Z'}]]){
  const result=v029Open([wideWorker('partial',{availability})]);
  assert.equal(result.ranked[0].eligible,false);assert.ok(result.ranked[0].failures.includes('NOT_AVAILABLE'));
 }
});
test('V029 certification valid through the exact shift end remains sufficient with union availability',()=>{
 const result=v029Open([wideWorker('exact-expiry',{availability:v029Touching(),
  certifications:[{name:'weld-cert',expiresAt:baseReq.end}]})]);
 assert.equal(result.ranked[0].eligible,true);assert.equal(result.executionPermitted,false);
});
test('V029 hard skill and certification failures override favorable soft preferences',()=>{
 const bad=[{skills:[],reason:'MISSING_SKILL:welding-l3'},
  {certifications:[],reason:'CERTIFICATION_INVALID:weld-cert'},
  {certifications:[{name:'weld-cert',expiresAt:'2026-09-24T13:59:59.999Z'}],reason:'CERTIFICATION_INVALID:weld-cert'}];
 for(const {reason,...override} of bad){
  const result=v029Open([wideWorker('unqualified',{availability:v029Touching(),hourlyCost:0,
   preferences:{preferredSites:['tamworth'],preferredLines:['line-4'],preferredTags:['DAY']},...override})]);
  assert.equal(result.ranked[0].eligible,false);assert.ok(result.ranked[0].failures.includes(reason));
 }
});
test('V029 preferences rank eligible union-covered workers without admitting an unqualified favorite',()=>{
 const workers=[wideWorker('other',{availability:v029Touching(),preferences:{avoidedTags:['DAY']}}),
  wideWorker('wanted',{availability:v029Touching(),preferences:{preferredTags:['DAY']}}),
  wideWorker('unqualified',{availability:v029Touching(),hourlyCost:0,skills:[],preferences:{preferredTags:['DAY']}})];
 const result=v029Open(workers);
 assert.equal(result.ranked[0].workerId,'wanted');assert.equal(result.ranked[0].eligible,true);
 assert.equal(result.ranked.find(x=>x.workerId==='other').eligible,true);
 assert.equal(result.ranked.find(x=>x.workerId==='unqualified').eligible,false);
 assert.equal(result.executionPermitted,false);
});
test('V029 exact and greedy plans consume union coverage while preserving real gaps between days',()=>{
 const next={...baseReq,id:'next-day',start:'2026-09-25T06:00:00Z',end:'2026-09-25T14:00:00Z'};
 const availability=v029Touching().concat([
  {start:'2026-09-25T06:00:00Z',end:'2026-09-25T10:00:00Z'},
  {start:'2026-09-25T10:00:00Z',end:'2026-09-25T14:00:00Z'}]);
 for(const exactSlotLimit of [1,10]){
  const proposed=input({workers:[wideWorker('union',{availability})],requirements:[{...baseReq},next],
   policy:{minRestHours:11,maxWeeklyHours:48,maxOvertimeHours:8,exactSlotLimit}});
  const before=JSON.stringify(proposed);freezeDeep(proposed);const plan=createSchedulingPlan(proposed);
  assert.equal(plan.quality.filledSlots,2);assert.equal(plan.validation.valid,true);
  assert.equal(plan.mode,'SHADOW');assert.equal(plan.executionPermitted,false);
  assert.equal(plan.solve.method,exactSlotLimit===1?'DETERMINISTIC_GREEDY_REPAIR':'BOUNDED_EXACT_SEARCH');
  assert.equal(JSON.stringify(proposed),before);
 }
});
test('V029 shadow repair can use a union-covered replacement without mutating input',()=>{
 const prior=createSchedulingPlan(input({workers:[wideWorker('a')]}));
 const proposed={priorPlan:prior,workers:[wideWorker('a'),wideWorker('b',{availability:v029Touching()})],
  event:{type:'ABSENCE',unavailableWorkerIds:['a'],evidenceRef:'synthetic:absence'},
  sourceEvidence:['synthetic:availability'],contextRevision:'union:repair',createdAt:'2026-09-23T13:00:00Z'};
 const before=JSON.stringify(proposed);freezeDeep(proposed);const result=repairSchedulingPlan(proposed);
 assert.equal(result.repairedPlan.assignments[0].workerId,'b');assert.equal(result.repairedPlan.validation.valid,true);
 assert.equal(result.executionPermitted,false);assert.equal(result.repairedPlan.executionPermitted,false);
 assert.equal(JSON.stringify(proposed),before);
});
test('V029 swaps consume union coverage and retain the V031 declared outgoing-site refusal',()=>{
 const proposed=swapInput();const availability=v029Touching().concat([
  {start:'2026-09-24T15:00:00Z',end:'2026-09-24T19:00:00Z'},
  {start:'2026-09-24T19:00:00Z',end:'2026-09-24T23:00:00Z'}]);
 proposed.workerA.availability=availability;proposed.workerB.availability=availability.map(x=>({...x}));
 for(const row of proposed.currentAssignments)row.site='tamworth';
 const before=JSON.stringify(proposed);freezeDeep(proposed);const result=evaluateSwap(proposed);
 assert.equal(result.eligible,true);assert.equal(result.mode,'EVALUATE_ONLY');assert.equal(result.executionPermitted,false);
 assert.equal(JSON.stringify(proposed),before);
 const mismatch=structuredClone(proposed);mismatch.currentAssignments[0].site='birmingham';
 assert.throws(()=>evaluateSwap(mismatch),/outgoing.*site/i);
});
test('V029 single-window compatibility and mutable caller ownership are preserved',()=>{
 const workers=[wideWorker('single')],before=JSON.stringify(workers);
 const first=v029Open(workers);assert.equal(first.ranked[0].eligible,true);assert.equal(JSON.stringify(workers),before);
 assert.equal(Object.isFrozen(workers),false);assert.equal(Object.isFrozen(workers[0].availability),false);
 assert.equal(Object.isFrozen(workers[0].availability[0]),false);
 workers[0].availability[0].end='2026-09-24T07:00:00Z';
 assert.equal(v029Open(workers).ranked[0].eligible,false);assert.equal(first.ranked[0].eligible,true);
});

// V030/#353: a supplied per-shift cap is advisory policy, with no legal default.
function v030Worker(id,o={}){return wideWorker(id,{consecutiveShifts:0,consecutiveNights:0,...o});}
test('V030 configured shift cap permits the exact elapsed boundary and refuses one millisecond over',()=>{
 const exact={...early,end:'2026-09-24T18:00:00Z'},over={...exact,end:'2026-09-24T18:00:00.001Z'};
 const args={workers:[v030Worker('a')],policy:{maxShiftHours:12}};
 assert.equal(evaluateOpenShift({...args,requirement:exact}).ranked[0].eligible,true);
 const denied=evaluateOpenShift({...args,requirement:over});
 assert.equal(denied.ranked[0].eligible,false);assert.ok(denied.ranked[0].failures.includes('MAX_SHIFT_HOURS_BREACH'));
 assert.equal(denied.mode,'EVALUATE_ONLY');assert.equal(denied.executionPermitted,false);
 assert.equal(evaluateOpenShift({workers:args.workers,requirement:over}).ranked[0].eligible,true);
});
test('V030 shift cap uses absolute elapsed hours across overnight DST offsets',()=>{
 const requirement=shift('v030-night','2026-10-24T22:00:00+01:00','2026-10-25T10:00:00Z');
 const workers=[v030Worker('a',{availability:[{start:'2026-10-24T00:00:00Z',end:'2026-10-26T00:00:00Z'}]})];
 assert.equal(evaluateOpenShift({requirement,workers,policy:{maxShiftHours:13}}).ranked[0].eligible,true);
 const denied=evaluateOpenShift({requirement,workers,policy:{maxShiftHours:12}}).ranked[0];
 assert.equal(denied.eligible,false);assert.ok(denied.failures.includes('MAX_SHIFT_HOURS_BREACH'));
});
test('V030 malformed supplied shift caps are refused and positive fractional hours are supported',()=>{
 for(const maxShiftHours of [null,0,-1,NaN,Infinity,-Infinity,'12',true,false,[],{},new Number(12)])
  assert.throws(()=>evaluateOpenShift({requirement:early,workers:[v030Worker('a')],policy:{maxShiftHours}}),/maxShiftHours/);
 assert.equal(evaluateOpenShift({requirement:{...early,end:'2026-09-24T06:30:00Z'},workers:[v030Worker('a')],policy:{maxShiftHours:0.5}}).ranked[0].eligible,true);
});
test('V030 exact and greedy planners retain overlong slots as explained shortfalls',()=>{
 for(const exactSlotLimit of [1,10]){
  const requirements=[early,{...early,id:'v030-long',start:'2026-09-25T06:00:00Z',end:'2026-09-25T19:00:00Z'}];
  const plan=createSchedulingPlan(input({workers:[v030Worker('a')],requirements,policy:{maxShiftHours:12,exactSlotLimit}}));
  assert.equal(plan.quality.filledSlots,1);assert.equal(plan.validation.valid,true);assert.equal(plan.policy.maxShiftHours,12);
  assert.ok(plan.unfilled[0].topReasons.some(r=>r.reason==='MAX_SHIFT_HOURS_BREACH'));
  assert.equal(plan.mode,'SHADOW');assert.equal(plan.executionPermitted,false);
 }
});
test('V030 independent schedule validation refuses an assigned overlong slot',()=>{
 const long={...early,end:'2026-09-24T19:00:00Z'};
 const result=validate([long],[assignment(long,'a')],{maxShiftHours:12});
 assert.equal(result.valid,false);assert.ok(result.violations[0].reasons.includes('MAX_SHIFT_HOURS_BREACH'));
});
test('V030 both hypothetical swap legs obey the shift cap without changing caller data',()=>{
 for(const leg of ['requirementA','requirementB']){
  const x=swapInput();delete x.currentAssignments;x.workerA=v030Worker('a');x.workerB=v030Worker('b');
  x[leg].end=new Date(Date.parse(x[leg].start)+13*3600000).toISOString();x.policy.maxShiftHours=12;
  const before=JSON.stringify(x);freezeDeep(x);const result=evaluateSwap(x);
  assert.equal(result.eligible,false);assert.ok(result.reasons.includes('MAX_SHIFT_HOURS_BREACH'));
  assert.equal(result.executionPermitted,false);assert.equal(JSON.stringify(x),before);
 }
});
test('V030 shadow repair inherits the exact stored shift cap and never executes',()=>{
 const prior=createSchedulingPlan(input({workers:[v030Worker('a')],policy:{maxShiftHours:12}}));
 const result=repairSchedulingPlan({priorPlan:prior,workers:[v030Worker('a')],requirements:[{...early,end:'2026-09-24T19:00:00Z'}],
  createdAt:'2026-09-23T13:00:00Z',event:{type:'DEMAND_CHANGE',evidenceRef:'synthetic:v030'}});
 assert.equal(result.repairedPlan.policy.maxShiftHours,12);assert.equal(result.repairedPlan.quality.filledSlots,0);
 assert.ok(result.repairedPlan.unfilled[0].topReasons.some(r=>r.reason==='MAX_SHIFT_HOURS_BREACH'));
 assert.equal(result.executionPermitted,false);assert.equal(result.repairedPlan.executionPermitted,false);
});
test('V030 configured shift caps bind plan identity while missing and undefined policy remain identical',()=>{
 const args=input({workers:[v030Worker('a')]}),unset=createSchedulingPlan(args);
 const undefinedValue=createSchedulingPlan({...args,policy:{...args.policy,maxShiftHours:undefined}});
 assert.equal(Object.hasOwn(unset.policy,'maxShiftHours'),false);assert.deepEqual(undefinedValue,unset);
 const configured=createSchedulingPlan({...args,policy:{...args.policy,maxShiftHours:12}});
 assert.notEqual(configured.planId,unset.planId);assert.notEqual(configured.planId,createSchedulingPlan({...args,policy:{...args.policy,maxShiftHours:10}}).planId);
});
test('V030 configured maximum shift hours is advertised by the existing capability contract',()=>{
 assert.equal(capabilityContract().tableStakes.configuredMaximumShiftHours,true);
});
test('V030 cap preserves V029 touching availability and real-gap denials with frozen supplied data',()=>{
 const workers=[v030Worker('a',{availability:[{start:'2026-09-24T06:00:00Z',end:'2026-09-24T10:00:00Z'},
  {start:'2026-09-24T10:00:00Z',end:'2026-09-24T14:00:00Z'}]})];
 const before=JSON.stringify(workers);freezeDeep(workers);
 const exact=evaluateOpenShift({requirement:early,workers,policy:{maxShiftHours:8}});assert.equal(exact.ranked[0].eligible,true);assert.equal(exact.executionPermitted,false);
 assert.equal(JSON.stringify(workers),before);
 const gap=JSON.parse(before);gap[0].availability[1].start='2026-09-24T10:00:00.001Z';
 const denied=evaluateOpenShift({requirement:early,workers:gap,policy:{maxShiftHours:8}}).ranked[0];
 assert.equal(denied.eligible,false);assert.ok(denied.failures.includes('NOT_AVAILABLE'));
});

test('V031 same-site requirement identity: rejects a contradictory declaration on either outgoing leg',()=>{
 for(const leg of [0,1]){
  const x=swapInput();x.currentAssignments[leg].requirementId='different-requirement';
  const before=structuredClone(x);freezeDeep(x);
  assert.throws(()=>evaluateSwap(x),/outgoing.*requirement/i,'leg '+leg);
  assert.deepEqual(x,before);
 }
});
test('V031 same-site requirement identity: rejects malformed explicit declarations without coercion',()=>{
 for(const leg of [0,1])for(const value of [undefined,null,false,true,0,1,'',' ',[],{},['early']]){
  const x=swapInput();x.currentAssignments[leg].requirementId=value;
  const before=structuredClone(x);freezeDeep(x);
  assert.throws(()=>evaluateSwap(x),/outgoing.*requirement/i,'leg '+leg+' type '+typeof value);
  assert.deepEqual(x,before);
 }
});
test('V031 same-site requirement identity: checks declarations independently of assignment order',()=>{
 for(const leg of [0,1])for(const reverse of [false,true]){
  const x=swapInput();x.currentAssignments[leg].requirementId='different-requirement';
  x.currentAssignments.push(assignment(shift('unrelated','2026-09-26T06:00:00Z','2026-09-26T14:00:00Z'),'a'));
  if(reverse)x.currentAssignments.reverse();
  const before=structuredClone(x);freezeDeep(x);
  assert.throws(()=>evaluateSwap(x),/outgoing.*requirement/i,'leg '+leg+' reversed '+reverse);
  assert.deepEqual(x,before);
 }
});
test('V031 same-site requirement identity: accepts matching declarations and preserves frozen inputs',()=>{
 const x=swapInput();const before=structuredClone(x);freezeDeep(x);
 const result=evaluateSwap(x);
 assert.equal(result.eligible,true);assert.equal(result.mode,'EVALUATE_ONLY');assert.equal(result.executionPermitted,false);
 assert.deepEqual(x,before);
});
test('V031 same-site requirement identity: preserves omission on either or both outgoing legs',()=>{
 for(const omitted of [[0],[1],[0,1]]){
  const x=swapInput();for(const leg of omitted)delete x.currentAssignments[leg].requirementId;
  const before=structuredClone(x);freezeDeep(x);const result=evaluateSwap(x);
  assert.equal(result.eligible,true);assert.equal(result.mode,'EVALUATE_ONLY');assert.equal(result.executionPermitted,false);
  assert.deepEqual(x,before);
 }
});
test('V031 same-site requirement identity: preserves an omitted hypothetical schedule',()=>{
 const x=swapInput();delete x.currentAssignments;const before=structuredClone(x);freezeDeep(x);
 const result=evaluateSwap(x);
 assert.equal(result.eligible,true);assert.equal(result.mode,'EVALUATE_ONLY');assert.equal(result.executionPermitted,false);
 assert.deepEqual(x,before);
});
