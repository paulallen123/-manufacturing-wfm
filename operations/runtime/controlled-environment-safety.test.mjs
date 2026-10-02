import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const component=await import(process.env.CLEANROOM_COMPONENT_UNDER_TEST?pathToFileURL(process.env.CLEANROOM_COMPONENT_UNDER_TEST).href:'./controlled-environment-safety.mjs');
const {assessControlledEnvironmentPlan:assess,projectControlledEnvironmentMovement:project}=component;
const NOW='2026-09-20T12:00:00.000Z';
const source=(extra={})=>({tenantId:'tenant-1',siteId:'site-1',authoritative:true,ref:'source-ref',revision:'revision-1',observedAt:NOW,...extra});
function context(){return {
  tenant:'tenant-1',siteId:'site-1',contextRevision:'context-1',now:NOW,
  policy:{...source({ref:'quality-policy'}),version:'policy-1',maxAgeMinutes:60,defaultOutsideZone:'OUT',zones:{B:{maxPersonnel:2}},transitions:[{from:'OUT',to:'B',allowed:true,gowningCycle:true,controlMinutes:3,controlCost:5},{from:'B',to:'OUT',allowed:true,gowningCycle:false,controlMinutes:2,controlCost:0}]}
};}
function planInput(){return {...context(),workers:[{...source({ref:'people-1'}),id:'person-1',skills:['inspection'],qualifiedZones:['B'],currentZone:'OUT'}],tasks:[{...source({ref:'task-1'}),id:'task-1',zone:'B',skill:'inspection',slot:1,requiredHeadcount:1}],plan:{id:'plan-1',assignments:[{workerId:'person-1',taskId:'task-1'}]}};}
function movementInput(){return {...context(),tasks:[{...source({ref:'task-1'}),id:'task-1',workerId:'person-1',zone:'B',policyVersion:'policy-1',startAt:'2026-09-20T11:20:00.000Z',endAt:'2026-09-20T11:40:00.000Z'}],presenceEvents:[{...source({ref:'access-1',observedAt:'2026-09-20T11:15:00.000Z'}),id:'event-1',workerId:'person-1',zone:'B',policyVersion:'policy-1',direction:'enter'},{...source({ref:'access-2',observedAt:'2026-09-20T11:45:00.000Z'}),id:'event-2',workerId:'person-1',zone:'B',policyVersion:'policy-1',direction:'exit'}]};}
const deniedPlan=r=>assert.notEqual(r.status,'safe_candidate');
const deniedMovement=r=>assert.notEqual(r.status,'movement_ready');

test('valid supplied plan retains hard coverage and remains non-executable',()=>{
  const r=assess(planInput());assert.equal(r.status,'safe_candidate');assert.equal(r.metrics.assignedPeople,1);assert.equal(r.metrics.controlMinutes,3);assert.equal(r.metrics.controlCost,5);assert.equal(r.executionPermitted,false);assert.match(r.evidenceDigest,/^[a-f0-9]{64}$/);assert.ok(Object.isFrozen(r.metrics));
});
test('evidence identity is stable, scoped and ignores unrelated hints',()=>{
  const a=planInput(),b=structuredClone(a);b.untrustedHint='SECRET_VALUE';assert.equal(assess(a).evidenceDigest,assess(b).evidenceDigest);
  const c=planInput();c.contextRevision='context-2';assert.notEqual(assess(a).evidenceDigest,assess(c).evidenceDigest);assert.ok(!JSON.stringify(assess(b)).includes('SECRET_VALUE'));
});
test('duplicate workers cannot manufacture unique people coverage',()=>{
  const x=planInput();x.workers.push({...x.workers[0]});x.tasks[0].requiredHeadcount=2;x.plan.assignments.push({...x.plan.assignments[0]});deniedPlan(assess(x));
});
test('duplicate tasks never erase independent required coverage',()=>{
  const x=planInput();x.tasks.push({...x.tasks[0],slot:2,skill:'unqualified'});deniedPlan(assess(x));
});
test('canonical IDs reject numeric, whitespace and alias records',()=>{
  for(const id of [1,' person-1 ','',null]){const x=planInput();x.workers[0].id=id;x.plan.assignments[0].workerId=id;deniedPlan(assess(x));}
});
test('required skills, zone qualification and task coverage remain mandatory',()=>{
  for(const mutate of [x=>x.workers[0].skills=[],x=>x.workers[0].qualifiedZones=[],x=>x.plan.assignments=[]]){const x=planInput();mutate(x);deniedPlan(assess(x));}
});
test('a person cannot fill simultaneous task slots twice',()=>{
  const x=planInput();x.tasks.push({...x.tasks[0],id:'task-2'});x.plan.assignments.push({workerId:'person-1',taskId:'task-2'});deniedPlan(assess(x));
});
test('occupancy remains mandatory and cannot be hidden by separator IDs',()=>{
  const x=planInput();x.policy.zones={};deniedPlan(assess(x));
  const y=planInput();y.policy.zones.B.maxPersonnel=0;deniedPlan(assess(y));
});
test('unapproved plan transition is never traded for an efficiency score',()=>{
  const x=planInput();x.policy.transitions[0].allowed=false;deniedPlan(assess(x));
});
test('contradictory and identical transition rows block both consumers',()=>{
  for(const allowed of [true,false]){const a=planInput();a.policy.transitions.push({...a.policy.transitions[0],allowed});deniedPlan(assess(a));const b=movementInput();b.policy.transitions.push({...b.policy.transitions[0],allowed});deniedMovement(project(b));}
});
test('missing policy revision, source provenance or authority blocks',()=>{
  for(const field of ['version','ref','authoritative']){const x=planInput();delete x.policy[field];deniedPlan(assess(x));}
  const x=movementInput();delete x.presenceEvents[0].revision;deniedMovement(project(x));
});
test('tenant and site mismatches cannot use another scope authority',()=>{
  for(const field of ['policy','worker','task','event']){
    const x=field==='event'?movementInput():planInput();const row=field==='policy'?x.policy:field==='worker'?x.workers[0]:field==='event'?x.presenceEvents[0]:x.tasks[0];row.tenantId='tenant-2';(field==='event'?deniedMovement:deniedPlan)(field==='event'?project(x):assess(x));
  }
  const x=movementInput();x.presenceEvents[0].siteId='site-2';deniedMovement(project(x));
});
test('negative or coerced evidence age cannot appear current',()=>{
  for(const ageMinutes of [-1,null,'0',NaN]){const x=planInput();x.workers[0].ageMinutes=ageMinutes;deniedPlan(assess(x));}
});
test('future and stale policy/source evidence cannot renew validity',()=>{
  for(const at of ['2026-09-20T12:01:00.000Z','2026-09-20T10:59:00.000Z']){
    const x=planInput();x.policy.observedAt=at;deniedPlan(assess(x));const y=planInput();y.workers[0].observedAt=at;deniedPlan(assess(y));
  }
});
test('malformed policy ages, occupancy and economics block without coercion',()=>{
  for(const maxAgeMinutes of [-1,'60',null,Infinity]){const x=planInput();x.policy.maxAgeMinutes=maxAgeMinutes;deniedPlan(assess(x));}
  for(const maxPersonnel of [-1,1.5,'2',NaN]){const x=planInput();x.policy.zones.B.maxPersonnel=maxPersonnel;deniedPlan(assess(x));}
  for(const controlCost of [-1,'5',NaN]){const x=planInput();x.policy.transitions[0].controlCost=controlCost;deniedPlan(assess(x));}
});
test('missing costs remain unknown and never become zero savings',()=>{
  const x=planInput();delete x.policy.transitions[0].controlCost;delete x.policy.transitions[0].controlMinutes;const r=assess(x);assert.equal(r.status,'safe_candidate');assert.equal(r.metrics.controlCost,null);assert.equal(r.metrics.controlMinutes,null);
});
test('presence projection explains overlap without asserting task completion',()=>{
  const r=project(movementInput());assert.equal(r.status,'movement_ready');assert.equal(r.metrics.observedSessions,1);assert.equal(r.metrics.observedControlMinutes,3);assert.equal(r.sessions[0].attribution,'task_window_overlap');assert.equal(r.taskCompletionProven,false);assert.equal(r.executionPermitted,false);assert.match(r.evidenceDigest,/^[a-f0-9]{64}$/);assert.equal(r.consolidationCandidates,undefined);
});
test('task and event duplicates invalidate observed movement',()=>{
  const x=movementInput();x.tasks.push({...x.tasks[0],startAt:'2026-09-20T11:00:00.000Z'});deniedMovement(project(x));
  const y=movementInput();y.presenceEvents[1].id=y.presenceEvents[0].id;deniedMovement(project(y));
});
test('unapproved and missing exits remain visible and force review',()=>{
  for(const missing of [false,true]){const x=movementInput();if(missing)x.policy.transitions.pop();else x.policy.transitions[1].allowed=false;const r=project(x);assert.equal(r.status,'needs_review');assert.equal(r.unapprovedMovement.length,1);assert.equal(r.unapprovedMovement[0].from,'B');assert.equal(r.unapprovedMovement[0].to,'OUT');assert.equal(r.executionPermitted,false);}
});
test('separator-containing identifiers never pair two people into one session',()=>{
  const x=movementInput();x.policy.zones={'b|c':{maxPersonnel:2},c:{maxPersonnel:2}};x.policy.transitions=[];x.tasks=[];x.presenceEvents[0].workerId='a';x.presenceEvents[0].zone='b|c';x.presenceEvents[1].workerId='a|b';x.presenceEvents[1].zone='c';const r=project(x);assert.equal(r.status,'needs_review');assert.equal(r.metrics.observedSessions,0);assert.equal(r.dataQualityIssues.length,2);
});
test('broken, overlapping and future access histories cannot be certified complete',()=>{
  const open=movementInput();open.presenceEvents.pop();assert.equal(project(open).status,'needs_review');
  const future=movementInput();future.presenceEvents[1].observedAt='2026-09-20T12:01:00.000Z';deniedMovement(project(future));
  const x=movementInput();x.presenceEvents.push({...x.presenceEvents[0],id:'event-3',observedAt:'2026-09-20T11:16:00.000Z'});assert.equal(project(x).status,'needs_review');
});
test('movement policy revision must match the authoritative tasks and events',()=>{
  for(const field of ['tasks','presenceEvents']){const x=movementInput();x[field][0].policyVersion='old-policy';deniedMovement(project(x));}
});
test('missing timestamps and malformed collections fail closed',()=>{
  const x=planInput();delete x.now;deniedPlan(assess(x));
  for(const workers of [null,{},'people']){const x=planInput();x.workers=workers;deniedPlan(assess(x));}
  const y=movementInput();y.presenceEvents={};deniedMovement(project(y));
});
test('accessor inputs and indexed getters are rejected without invocation',()=>{
  let calls=0;const x=planInput();Object.defineProperty(x.policy,'version',{enumerable:true,get(){calls++;return 'policy-1';}});deniedPlan(assess(x));
  const y=movementInput();Object.defineProperty(y.presenceEvents,'0',{enumerable:true,get(){calls++;return {};}});deniedMovement(project(y));assert.equal(calls,0);
});
test('coercion hooks and proxy traps cannot run',()=>{
  let calls=0;const x=planInput();x.policy.maxAgeMinutes={valueOf(){calls++;return 60;}};deniedPlan(assess(x));
  const y=new Proxy({}, {get(){calls++;return {};},getPrototypeOf(){calls++;return Object.prototype;}});deniedPlan(assess(y));assert.equal(calls,0);
});
test('bounded record counts fail closed rather than dropping required inputs',()=>{
  const x=planInput();x.workers=Array.from({length:1001},(_,i)=>({...x.workers[0],id:'person-'+i}));deniedPlan(assess(x));
});
test('plan and movement evaluation leave source inputs unchanged',()=>{
  for(const [fn,input] of [[assess,planInput()],[project,movementInput()]]){const before=JSON.stringify(input);fn(input);assert.equal(JSON.stringify(input),before);}
});
test('finite input costs cannot overflow plan or presence aggregates',()=>{
  const x=planInput();x.policy.zones.C={maxPersonnel:2};x.workers[0].qualifiedZones.push('C');x.policy.transitions[0].controlCost=1e308;x.policy.transitions.push({from:'B',to:'C',allowed:true,gowningCycle:false,controlMinutes:2,controlCost:1e308});x.tasks.push({...x.tasks[0],id:'task-2',slot:2,zone:'C'});x.plan.assignments.push({workerId:'person-1',taskId:'task-2'});deniedPlan(assess(x));
  const y=movementInput();y.policy.transitions[0].controlMinutes=1e308;y.presenceEvents.push({...y.presenceEvents[0],id:'event-3',workerId:'person-2'},{...y.presenceEvents[1],id:'event-4',workerId:'person-2'});deniedMovement(project(y));
});
