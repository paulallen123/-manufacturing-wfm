import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateControlledEnvironmentPlan,compareControlledEnvironmentPlans} from './controlled-environment-flow.mjs';
import {buildInterventionTransitionLedger} from './intervention-transition-ledger.mjs';

const now='2026-09-20T22:00:00Z';
const policy=()=>({
  authoritative:true,siteId:'S1',version:'v1',ref:'qms:site-policy:1',observedAt:now,
  zones:{B:{maxPersonnel:2,maxBundleGapMinutes:30,maxContinuousMinutes:180}},
  transitions:[
    {from:'OUT',to:'B',allowed:true,gowningCycle:true,controlMinutes:5,controlCost:2},
    {from:'B',to:'OUT',allowed:true,gowningCycle:false,controlMinutes:1,controlCost:1}
  ]
});
function planInput(){return {
  policy:policy(),now,
  workers:[{id:'W1',siteId:'S1',skills:['fill'],qualifiedZones:['B'],currentZone:'OUT'}],
  tasks:[{id:'T1',siteId:'S1',zone:'B',skill:'fill',slot:1,requiredHeadcount:1}],
  plan:{id:'P1',assignments:[{workerId:'W1',taskId:'T1'}]}
};}
function ledgerInput(){return {
  policy:policy(),now,
  tasks:[{id:'T1',siteId:'S1',workerId:'W1',zone:'B',startAt:'2026-09-20T10:00:00Z',endAt:'2026-09-20T10:20:00Z',authoritative:true,ref:'mes:T1',revision:'1'}],
  presenceEvents:[
    {id:'E1',siteId:'S1',workerId:'W1',zone:'B',direction:'enter',observedAt:'2026-09-20T09:55:00Z',authoritative:true,ref:'acs:E1'},
    {id:'E2',siteId:'S1',workerId:'W1',zone:'B',direction:'exit',observedAt:'2026-09-20T10:25:00Z',authoritative:true,ref:'acs:E2'}
  ]
};}

test('duplicate task IDs cannot erase another required task from coverage',()=>{
  const input=planInput();
  input.tasks.unshift({...input.tasks[0],slot:2,skill:'unqualified-skill',requiredHeadcount:2});
  const result=evaluateControlledEnvironmentPlan(input);
  assert.equal(result.status,'rejected');
  assert.equal(result.reason,'duplicate_task_id');
  const compared=compareControlledEnvironmentPlans({...input,plans:[input.plan]});
  assert.equal(compared.status,'no_safe_candidate');
  assert.equal(compared.preferred,null);
});

for(const reverse of [false,true])test(`duplicate worker IDs cannot overwrite qualifications (reverse=${reverse})`,()=>{
  const input=planInput();
  input.workers.unshift({...input.workers[0],skills:[],qualifiedZones:[]});
  if(reverse)input.workers.reverse();
  assert.equal(evaluateControlledEnvironmentPlan(input).reason,'duplicate_worker_id');
});

for(const [name,field] of [['worker','workers'],['task','tasks']]){
  test(`whitespace aliases cannot introduce duplicate ${name} identities`,()=>{
    const input=planInput();
    input[field].push({...input[field][0],id:' '+input[field][0].id+' '});
    assert.equal(evaluateControlledEnvironmentPlan(input).reason,`duplicate_${name}_id`);
  });
  for(const invalid of [undefined,null,'',{},true])test(`invalid ${name} identifier ${JSON.stringify(invalid)} fails closed`,()=>{
    const input=planInput();
    input[field][0].id=invalid;
    input.plan.assignments[0][name+'Id']=invalid;
    assert.equal(evaluateControlledEnvironmentPlan(input).reason,`${name}_id_invalid`);
  });
}

for(const reverse of [false,true])test(`contradictory transition policy blocks planner and ledger (reverse=${reverse})`,()=>{
  const p=policy();
  p.transitions.unshift({...p.transitions[0],allowed:false});
  if(reverse)p.transitions.reverse();
  const planResult=evaluateControlledEnvironmentPlan({...planInput(),policy:p});
  const ledgerResult=buildInterventionTransitionLedger({...ledgerInput(),policy:p});
  for(const result of [planResult,ledgerResult]){
    assert.equal(result.status,'blocked');
    assert.equal(result.reason,'duplicate_transition_rule');
    assert.equal(result.metrics,undefined);
  }
});

test('even identical duplicate transition rows require authoritative resolution',()=>{
  const input=planInput();
  input.policy.transitions.push({...input.policy.transitions[0]});
  assert.equal(evaluateControlledEnvironmentPlan(input).reason,'duplicate_transition_rule');
});

test('transition pair keys do not confuse zone names containing separators',()=>{
  const input=planInput();
  input.workers[0].currentZone='OUT>B';
  input.workers[0].qualifiedZones=['C'];
  input.tasks[0].zone='C';
  input.policy.zones={C:{maxPersonnel:2}};
  input.policy.transitions=[{from:'OUT',to:'B>C',allowed:true}];
  assert.equal(evaluateControlledEnvironmentPlan(input).reason,'transition_not_approved');
});

test('ledger rejects duplicate task identities even across different task windows',()=>{
  const input=ledgerInput();
  input.tasks.push({...input.tasks[0],startAt:'2026-09-20T11:00:00Z',endAt:'2026-09-20T11:20:00Z'});
  assert.equal(buildInterventionTransitionLedger(input).reason,'duplicate_task_id');
});

test('ledger rejects an event identity reused for a different movement',()=>{
  const input=ledgerInput();
  input.presenceEvents[1].id=input.presenceEvents[0].id;
  assert.equal(buildInterventionTransitionLedger(input).reason,'duplicate_event_id');
});

for(const missing of [false,true])test(`unapproved exit remains visible and blocks recommendations (missing=${missing})`,()=>{
  const input=ledgerInput();
  if(missing)input.policy.transitions.pop();
  else input.policy.transitions[1].allowed=false;
  const result=buildInterventionTransitionLedger(input);
  assert.equal(result.status,'needs_review');
  assert.deepEqual(result.consolidationCandidates,[]);
  assert.equal(result.unapprovedMovement.length,1);
  assert.equal(result.unapprovedMovement[0].from,'B');
  assert.equal(result.unapprovedMovement[0].to,'OUT');
});

test('valid unique input remains advisory and deterministic',()=>{
  const input=planInput();
  assert.deepEqual(evaluateControlledEnvironmentPlan(input),evaluateControlledEnvironmentPlan(structuredClone(input)));
  assert.equal(evaluateControlledEnvironmentPlan(input).status,'safe_candidate');
  assert.equal(buildInterventionTransitionLedger(ledgerInput()).status,'ledger_ready');
});

test('zone names containing @ cannot evade occupancy limits',()=>{
  const input=planInput();
  input.workers[0].qualifiedZones=['B@east'];
  input.workers.push({...input.workers[0],id:'W2'});
  input.tasks[0].zone='B@east';
  input.tasks[0].requiredHeadcount=2;
  input.plan.assignments.push({workerId:'W2',taskId:'T1'});
  input.policy.zones={'B@east':{maxPersonnel:1}};
  input.policy.transitions=[{from:'OUT',to:'B@east',allowed:true}];
  const result=evaluateControlledEnvironmentPlan(input);
  assert.equal(result.reason,'zone_occupancy_exceeded');
  assert.equal(result.zone,'B@east');
});

test('separator-containing worker and zone IDs cannot pair different workers into one session',()=>{
  const input=ledgerInput();
  input.tasks=[];
  Object.assign(input.presenceEvents[0],{workerId:'W|B',zone:'C'});
  Object.assign(input.presenceEvents[1],{workerId:'W',zone:'B|C'});
  input.policy.transitions=[
    {from:'OUT',to:'B|C',allowed:true},
    {from:'B|C',to:'OUT',allowed:true}
  ];
  const result=buildInterventionTransitionLedger(input);
  assert.equal(result.status,'needs_review');
  assert.equal(result.sessions.length,0);
  assert.deepEqual(result.dataQualityIssues.map(x=>x.code).sort(),['exit_without_enter','open_session_missing_exit']);
  assert.deepEqual(result.consolidationCandidates,[]);
});

test('separator-containing identifiers retain legitimate consolidation candidates',()=>{
  const input=ledgerInput();
  const workerId='W|1',zone='B|controlled';
  Object.assign(input.tasks[0],{workerId,zone});
  for(const event of input.presenceEvents)Object.assign(event,{workerId,zone});
  input.tasks.push({...input.tasks[0],id:'T2',startAt:'2026-09-20T10:40:00Z',endAt:'2026-09-20T11:00:00Z'});
  input.presenceEvents.push(
    {...input.presenceEvents[0],id:'E3',observedAt:'2026-09-20T10:35:00Z'},
    {...input.presenceEvents[1],id:'E4',observedAt:'2026-09-20T11:05:00Z'}
  );
  input.policy.zones={[zone]:{maxBundleGapMinutes:30,maxContinuousMinutes:180}};
  input.policy.transitions=[{from:'OUT',to:zone,allowed:true},{from:zone,to:'OUT',allowed:true}];
  const result=buildInterventionTransitionLedger(input);
  assert.equal(result.status,'ledger_ready');
  assert.equal(result.consolidationCandidates.length,1);
  assert.equal(result.consolidationCandidates[0].workerId,workerId);
  assert.equal(result.consolidationCandidates[0].zone,zone);
});
