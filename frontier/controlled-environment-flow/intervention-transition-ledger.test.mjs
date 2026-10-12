import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInterventionTransitionLedger,reconcileSensitiveZoneOutcome} from './intervention-transition-ledger.mjs';

const now='2026-09-20T22:40:00Z';
const policy={
 authoritative:true,siteId:'S1',version:'ccs-13',ref:'qms:ccs:13',observedAt:'2026-09-20T22:00:00Z',maxAgeMinutes:120,defaultOutsideZone:'OUT',
 zones:{B:{maxBundleGapMinutes:30,maxContinuousMinutes:180}},
 transitions:[
  {from:'OUT',to:'B',allowed:true,gowningCycle:true,controlMinutes:12,controlCost:18},
  {from:'B',to:'OUT',allowed:true,gowningCycle:false,controlMinutes:4,controlCost:2}
 ]
};
const task=(id,startAt,endAt,extra={})=>({id,siteId:'S1',workerId:'PSEUDO-7',zone:'B',startAt,endAt,authoritative:true,ref:'mes:'+id,revision:'r1',...extra});
const ev=(id,direction,observedAt)=>({id,siteId:'S1',workerId:'PSEUDO-7',zone:'B',direction,observedAt,authoritative:true,ref:'acs:'+id});

test('builds an intervention ledger without treating badge evidence as task proof',()=>{
 const tasks=[task('T1','2026-09-20T10:00:00Z','2026-09-20T10:20:00Z')];
 const presenceEvents=[ev('E1','enter','2026-09-20T09:55:00Z'),ev('E2','exit','2026-09-20T10:25:00Z')];
 const r=buildInterventionTransitionLedger({policy,tasks,presenceEvents,now});
 assert.equal(r.status,'ledger_ready');
 assert.equal(r.metrics.observedEntries,1);
 assert.equal(r.sessions[0].attribution,'task_window_overlap');
 assert.match(r.sessions[0].claimBoundary,/does not prove/i);
});

test('finds a safe consolidation candidate only when two separately observed entries could fit one allowed session',()=>{
 const tasks=[
  task('T1','2026-09-20T10:00:00Z','2026-09-20T10:20:00Z'),
  task('T2','2026-09-20T10:40:00Z','2026-09-20T11:00:00Z')
 ];
 const presenceEvents=[
  ev('E1','enter','2026-09-20T09:55:00Z'),ev('E2','exit','2026-09-20T10:25:00Z'),
  ev('E3','enter','2026-09-20T10:35:00Z'),ev('E4','exit','2026-09-20T11:05:00Z')
 ];
 const r=buildInterventionTransitionLedger({policy,tasks,presenceEvents,now});
 assert.equal(r.metrics.consolidationCandidates,1);
 assert.equal(r.metrics.potentialEntryReduction,1);
 assert.equal(r.metrics.potentialGowningReduction,1);
 assert.equal(r.consolidationCandidates[0].status,'candidate_only');
});

test('mandatory exit or independent-entry rules suppress consolidation',()=>{
 const tasks=[
  task('T1','2026-09-20T10:00:00Z','2026-09-20T10:20:00Z',{mandatoryExitAfter:true}),
  task('T2','2026-09-20T10:40:00Z','2026-09-20T11:00:00Z')
 ];
 const presenceEvents=[
  ev('E1','enter','2026-09-20T09:55:00Z'),ev('E2','exit','2026-09-20T10:25:00Z'),
  ev('E3','enter','2026-09-20T10:35:00Z'),ev('E4','exit','2026-09-20T11:05:00Z')
 ];
 const r=buildInterventionTransitionLedger({policy,tasks,presenceEvents,now});
 assert.equal(r.metrics.consolidationCandidates,0);
});

test('broken access event sequences stop optimisation and request review',()=>{
 const tasks=[task('T1','2026-09-20T10:00:00Z','2026-09-20T10:20:00Z')];
 const presenceEvents=[ev('E1','exit','2026-09-20T10:25:00Z')];
 const r=buildInterventionTransitionLedger({policy,tasks,presenceEvents,now});
 assert.equal(r.status,'needs_review');
 assert.ok(r.dataQualityIssues.length>0);
 assert.equal(r.consolidationCandidates.length,0);
});

test('unattributed presence is surfaced for review, never labelled unnecessary',()=>{
 const presenceEvents=[ev('E1','enter','2026-09-20T09:00:00Z'),ev('E2','exit','2026-09-20T09:20:00Z')];
 const r=buildInterventionTransitionLedger({policy,tasks:[],presenceEvents,now});
 assert.equal(r.sessions[0].attribution,'needs_review');
 assert.equal(r.metrics.sessionsWithoutTaskOverlap,1);
 assert.equal(r.consolidationCandidates.length,0);
});

test('cross-site or non-authoritative evidence fails closed',()=>{
 const tasks=[task('T1','2026-09-20T10:00:00Z','2026-09-20T10:20:00Z')];
 const wrong=structuredClone(tasks);wrong[0].siteId='S2';
 assert.equal(buildInterventionTransitionLedger({policy,tasks:wrong,presenceEvents:[],now}).reason,'task_site_mismatch');
 const presence=[ev('E1','enter','2026-09-20T09:55:00Z')];presence[0].authoritative=false;
 assert.equal(buildInterventionTransitionLedger({policy,tasks,presenceEvents:presence,now}).reason,'event_not_authoritative');
});

test('outcome reconciliation keeps predicted and realised movement distinct',()=>{
 const r=reconcileSensitiveZoneOutcome({
  recommendation:{id:'R1',predictedEntries:2},
  decision:{status:'accepted'},
  observed:{authoritative:true,actualEntries:3},
  operations:{authoritative:true,productionCompleted:true},
  quality:{authoritative:true,eventCount:0},
  financial:{authoritative:true,realisedControlCost:42}
 });
 assert.equal(r.status,'reconciled');
 assert.equal(r.predicted.entries,2);
 assert.equal(r.realised.entries,3);
 assert.equal(r.calibration.entryError,1);
});

// Source-bound ambiguity regressions. These are structural checks, not safety approval.
const fixture=()=>({
 policy:structuredClone(policy),now,
 tasks:[task('T1','2026-09-20T10:00:00Z','2026-09-20T10:20:00Z'),task('T2','2026-09-20T10:40:00Z','2026-09-20T11:00:00Z')],
 presenceEvents:[ev('E1','enter','2026-09-20T09:55:00Z'),ev('E2','exit','2026-09-20T10:25:00Z'),ev('E3','enter','2026-09-20T10:35:00Z'),ev('E4','exit','2026-09-20T11:05:00Z')]
});
const reject=(input,reason)=>{
 const r=buildInterventionTransitionLedger(input);
 assert.notEqual(r.status,'ledger_ready');
 assert.equal(r.reason,reason);
 assert.equal(r.consolidationCandidates?.length??0,0);
 assert.notEqual(r.metrics?.potentialEntryReduction,1);
};
const addZone=(input,zone)=>{
 input.policy.zones[zone]={maxBundleGapMinutes:30,maxContinuousMinutes:180};
 input.policy.transitions.push({from:'OUT',to:zone,allowed:true},{from:zone,to:'OUT',allowed:true});
};
const freeze=value=>{
 if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
 return value;
};

for(const direction of ['entry','exit'])for(const mode of ['denied','missing']){
 test(`${mode} ${direction} remains visible and prevents consolidation`,()=>{
  const input=fixture(),index=direction==='entry'?0:1;
  if(mode==='denied')input.policy.transitions[index].allowed=false;
  else input.policy.transitions.splice(index,1);
  const r=buildInterventionTransitionLedger(input);
  assert.equal(r.status,'needs_review');
  assert.equal(r.movement.length,4,'both observed entries and exits must remain visible');
  assert.deepEqual(r.unapprovedMovement.map(m=>[m.from,m.to,m.at,m.approved]),direction==='entry'?[
   ['OUT','B','2026-09-20T09:55:00Z',false],['OUT','B','2026-09-20T10:35:00Z',false]
  ]:[['B','OUT','2026-09-20T10:25:00Z',false],['B','OUT','2026-09-20T11:05:00Z',false]]);
  assert.deepEqual(r.consolidationCandidates,[]);
  assert.equal(r.metrics.potentialEntryReduction,0);
 });
}
for(const direction of [0,1])for(const allowed of [true,false])for(const reverse of [false,true]){
 test(`duplicate transition direction=${direction} allowed=${allowed} reverse=${reverse} requires reconciliation`,()=>{
  const input=fixture();
  input.policy.transitions.push({...input.policy.transitions[direction],allowed});
  if(reverse)input.policy.transitions.reverse();
  reject(input,'duplicate_transition_rule');
 });
}
for(const transitions of [null,{},undefined])test(`invalid transition collection ${JSON.stringify(transitions)}`,()=>{
 const input=fixture();input.policy.transitions=transitions;reject(input,'transition_rules_invalid');
});
for(const row of [null,{from:' OUT',to:'B',allowed:true},{from:'OUT',to:'B',allowed:'true'},{from:'OUT',to:'',allowed:false}]){
 test(`malformed transition cannot be skipped: ${JSON.stringify(row)}`,()=>{
  const input=fixture();input.policy.transitions.push(row);reject(input,'transition_rule_invalid');
 });
}
for(const field of ['tasks','presenceEvents'])for(const identical of [false,true])for(const reverse of [false,true]){
 test(`duplicate ${field} identical=${identical} reverse=${reverse} cannot manufacture coverage`,()=>{
  const input=fixture();
  if(identical)input[field].push(structuredClone(input[field][0]));
  else input[field][1].id=input[field][0].id;
  if(reverse)input[field].reverse();
  reject(input,field==='tasks'?'duplicate_task_id':'duplicate_event_id');
 });
}
for(const field of ['tasks','presenceEvents']){
 test(`${field} must be an array`,()=>{
  const input=fixture();input[field]={};reject(input,field==='tasks'?'tasks_invalid':'presence_events_invalid');
 });
 for(const id of ['',1,' padded '])test(`${field} identity is canonical: ${JSON.stringify(id)}`,()=>{
  const input=fixture();input[field][0].id=id;reject(input,field==='tasks'?'task_invalid':'event_invalid');
 });
 test(`${field} worker and zone identities cannot be trimmed into another entity`,()=>{
  for(const key of ['workerId','zone']){
   const input=fixture();input[field][0][key]=' '+input[field][0][key];
   reject(input,field==='tasks'?'task_invalid':'event_invalid');
  }
 });
 test(`${field} unknown zone fails closed`,()=>{
  const input=fixture();input[field][0].zone='unknown';
  reject(input,field==='tasks'?'task_zone_unknown':'event_zone_unknown');
 });
}
test('transition to unknown zone is not a policy grant',()=>{
 const input=fixture();input.policy.transitions.push({from:'OUT',to:'unknown',allowed:true});
 reject(input,'transition_zone_unknown');
});
test('inherited object property is not a configured zone',()=>{
 const input=fixture();input.tasks[0].zone='toString';reject(input,'task_zone_unknown');
});
for(const outside of ['',1,' OUT ',false])test(`outside zone is a canonical identity: ${JSON.stringify(outside)}`,()=>{
 const input=fixture();input.policy.defaultOutsideZone=outside;reject(input,'outside_zone_invalid');
});
test('outside cannot alias the controlled zone to manufacture a self-transition approval',()=>{
 const input=fixture();input.policy.defaultOutsideZone='B';
 input.policy.transitions=[{from:'B',to:'B',allowed:true}];
 reject(input,'outside_zone_invalid');
});

test('delimiter pairs cannot cross-pair another worker and zone',()=>{
 const input=fixture();addZone(input,'A');addZone(input,'B|A');
 input.tasks=[];
 input.presenceEvents=[
  {...ev('X1','enter','2026-09-20T10:00:00Z'),workerId:'W|B',zone:'A'},
  {...ev('X2','exit','2026-09-20T10:20:00Z'),workerId:'W',zone:'B|A'}
 ];
 const r=buildInterventionTransitionLedger(input);
 assert.equal(r.status,'needs_review');
 assert.equal(r.sessions.length,0);
 assert.deepEqual(new Set(r.dataQualityIssues.map(x=>x.code)),new Set(['exit_without_enter','open_session_missing_exit']));
 assert.deepEqual(r.consolidationCandidates,[]);
});
test('distinct legitimate delimiter and Unicode pairs retain their own candidates and zone limits',()=>{
 const input=fixture(),second=fixture();
 addZone(input,'B|区');addZone(input,'区');
 for(const row of [...input.tasks,...input.presenceEvents]){row.workerId='工人';row.zone='B|区';}
 for(const row of [...second.tasks,...second.presenceEvents]){row.id+='-2';row.workerId='工人|B';row.zone='区';}
 input.tasks.push(...second.tasks);input.presenceEvents.push(...second.presenceEvents);
 const r=buildInterventionTransitionLedger(input);
 assert.equal(r.status,'ledger_ready');assert.equal(r.sessions.length,4);
 assert.deepEqual(r.consolidationCandidates.map(c=>[c.workerId,c.zone]),[['工人','B|区'],['工人|B','区']]);
 input.policy.zones['B|区'].maxBundleGapMinutes=0;
 const limited=buildInterventionTransitionLedger(input);
 assert.deepEqual(limited.consolidationCandidates.map(c=>[c.workerId,c.zone]),[['工人|B','区']]);
});
test('distinct transition tuples containing delimiters cannot alias a denial',()=>{
 const input=fixture();input.policy.defaultOutsideZone='OUT>B';
 input.policy.zones={'C':{maxBundleGapMinutes:30},'B>C':{},OUT:{}};
 input.policy.transitions=[{from:'OUT',to:'B>C',allowed:false},{from:'OUT>B',to:'C',allowed:true},{from:'C',to:'OUT>B',allowed:true}];
 for(const row of [...input.tasks,...input.presenceEvents])row.zone='C';
 const r=buildInterventionTransitionLedger(input);
 assert.equal(r.status,'ledger_ready');assert.equal(r.consolidationCandidates.length,1);
});

for(const reverse of [false,true])test(`overlapping worker zones cannot imply an ordered approved route reverse=${reverse}`,()=>{
 const input=fixture();addZone(input,'C');
 input.presenceEvents.push({...ev('C1','enter','2026-09-20T10:10:00Z'),zone:'C'},{...ev('C2','exit','2026-09-20T10:15:00Z'),zone:'C'});
 if(reverse)input.presenceEvents.reverse();
 const r=buildInterventionTransitionLedger(input);
 assert.equal(r.status,'needs_review');
 assert.ok(r.dataQualityIssues.some(x=>x.code==='overlapping_worker_sessions'));
 assert.deepEqual(r.consolidationCandidates,[]);
});
for(const source of ['task','presence','both'])test(`intervening other-zone ${source} prevents same-zone consolidation`,()=>{
 const input=fixture();addZone(input,'C');
 if(source!=='presence')input.tasks.push(task('C-task','2026-09-20T10:28:00Z','2026-09-20T10:32:00Z',{zone:'C'}));
 if(source!=='task')input.presenceEvents.push({...ev('C1','enter','2026-09-20T10:27:00Z'),zone:'C'},{...ev('C2','exit','2026-09-20T10:33:00Z'),zone:'C'});
 const r=buildInterventionTransitionLedger(input);
 assert.equal(r.status,'ledger_ready');assert.deepEqual(r.consolidationCandidates,[]);
});
for(const reverse of [false,true])test(`same-time exit/entry ordering cannot depend on event IDs reverse=${reverse}`,()=>{
 const input=fixture();input.presenceEvents[1].observedAt=input.presenceEvents[2].observedAt;
 input.presenceEvents[1].id=reverse?'Z-exit':'A-exit';input.presenceEvents[2].id=reverse?'A-enter':'Z-enter';
 const r=buildInterventionTransitionLedger(input);
 assert.equal(r.status,'ledger_ready');
 assert.equal(r.sessions.length,2);
 assert.equal(r.consolidationCandidates.length,1);
});
test('same-time entry and exit without a prior session cannot manufacture presence',()=>{
 const input=fixture();input.presenceEvents=input.presenceEvents.slice(0,2);
 input.presenceEvents[1].observedAt=input.presenceEvents[0].observedAt;
 const r=buildInterventionTransitionLedger(input);
 assert.equal(r.status,'needs_review');assert.equal(r.sessions.length,0);
 assert.deepEqual(r.consolidationCandidates,[]);
});
test('valid route results survive shuffled input and policy order',()=>{
 const input=fixture(),expected=buildInterventionTransitionLedger(input);
 input.tasks.reverse();input.presenceEvents.reverse();input.policy.transitions.reverse();
 assert.deepEqual(buildInterventionTransitionLedger(input),expected);
 assert.equal(expected.status,'ledger_ready');assert.equal(expected.movement.length,4);
 assert.equal(expected.consolidationCandidates.length,1);
});
for(const constraint of ['mandatoryExitAfter','requiresIndependentEntry','gap','duration']){
 test(`existing zone and task constraint is retained: ${constraint}`,()=>{
  const input=fixture();
  if(constraint==='mandatoryExitAfter')input.tasks[0].mandatoryExitAfter=true;
  if(constraint==='requiresIndependentEntry')input.tasks[1].requiresIndependentEntry=true;
  if(constraint==='gap')input.policy.zones.B.maxBundleGapMinutes=10;
  if(constraint==='duration')input.policy.zones.B.maxContinuousMinutes=30;
  const r=buildInterventionTransitionLedger(input);
  assert.equal(r.status,'ledger_ready');assert.deepEqual(r.consolidationCandidates,[]);
 });
}
test('unmatched worker presence remains observation, not fabricated task coverage or permission',()=>{
 const input=fixture();for(const row of input.presenceEvents)row.workerId='other-worker';
 const r=buildInterventionTransitionLedger(input);
 assert.ok(r.sessions.every(s=>s.attribution==='needs_review'&&s.matchedTaskIds.length===0));
 assert.deepEqual(r.consolidationCandidates,[]);
 assert.match(r.authorityBoundary,/never changes access/);
 assert.ok(r.sessions.every(s=>/does not prove/.test(s.claimBoundary)));
});
for(const limit of ['invalid',NaN,Infinity,-Infinity,null])test(`invalid explicit continuous-time limit cannot imply unlimited permission: ${String(limit)}`,()=>{
 const input=fixture();input.policy.zones.B.maxContinuousMinutes=limit;
 assert.deepEqual(buildInterventionTransitionLedger(input).consolidationCandidates,[]);
});
test('omitted continuous-time limit preserves the existing policy semantics',()=>{
 const input=fixture();delete input.policy.zones.B.maxContinuousMinutes;
 assert.equal(buildInterventionTransitionLedger(input).consolidationCandidates.length,1);
});
test('valid and rejected calls preserve deeply frozen inputs',()=>{
 for(const mode of ['allowed','denied','duplicate']){
  const input=fixture();
  if(mode==='denied')input.policy.transitions[1].allowed=false;
  if(mode==='duplicate')input.tasks[1].id=input.tasks[0].id;
  const before=structuredClone(input);freeze(input);
  const r=buildInterventionTransitionLedger(input);
  assert.equal(r.status,mode==='allowed'?'ledger_ready':mode==='denied'?'needs_review':'rejected');
  assert.deepEqual(input,before);
 }
});
test('authority and freshness gates still precede structural approval',()=>{
 for(const [field,value,reason] of [['authoritative',false,'policy_not_authoritative'],['ref','','policy_provenance_missing'],['observedAt','2026-09-19T00:00:00Z','policy_stale']]){
  const input=fixture();input.policy[field]=value;reject(input,reason);
 }
});

const chainFixture=(starts=[0,40,80],maxContinuousMinutes=60)=>{
 const input=fixture(),at=minutes=>new Date(Date.parse('2026-09-20T10:00:00Z')+minutes*60000).toISOString();
 input.policy.zones.B.maxContinuousMinutes=maxContinuousMinutes;
 input.tasks=starts.map((start,i)=>task('T'+(i+1),at(start),at(start+20)));
 input.presenceEvents=starts.flatMap((start,i)=>[ev('E'+i+'a','enter',at(start)),ev('E'+i+'b','exit',at(start+20))]);
 return input;
};
test('overlapping 60-minute alternatives cannot imply a 100-minute combined stay',()=>{
 const input=chainFixture(),before=structuredClone(input);
 const r=buildInterventionTransitionLedger(freeze(input));
 assert.equal(r.status,'ledger_ready');
 assert.deepEqual(r.consolidationCandidates.map(c=>[c.firstTaskId,c.secondTaskId]),[['T1','T2'],['T2','T3']]);
 assert.ok(r.consolidationCandidates.every(c=>c.potentialEntryReduction===1&&c.status==='candidate_only'));
 assert.equal(r.metrics.consolidationCandidates,2,'retain both alternatives individually');
 assert.equal(r.metrics.potentialEntryReduction,1,'report at most one candidate, not the pairwise sum');
 assert.equal(r.metrics.potentialGowningReduction,1);
 assert.equal(r.metrics.potentialReductionBasis,'largest_single_candidate');
 assert.match(r.consolidationBoundary,/not jointly validated/);
 assert.match(r.consolidationBoundary,/safety approval/);
 assert.deepEqual(input,before);
});
for(const [label,starts,limit,count] of [
 ['longer chain',[0,40,80,120],60,3],
 ['larger cap',[0,40,80],100,2],
 ['disjoint pairs',[0,40,140,180],60,2]
])test(`pairwise advice remains non-additive for ${label}`,()=>{
 const r=buildInterventionTransitionLedger(chainFixture(starts,limit));
 assert.equal(r.consolidationCandidates.length,count);
 assert.equal(r.metrics.potentialEntryReduction,1);
 assert.equal(r.metrics.potentialGowningReduction,1);
 assert.equal(r.metrics.potentialReductionBasis,'largest_single_candidate');
});
test('single-candidate summaries preserve zero, one and non-gowning reductions',()=>{
 for(const [starts,gowningCycle,entryReduction,gowningReduction] of [
  [[0],true,0,0],[[0,40],true,1,1],[[0,40,80],false,1,0]
 ]){
  const input=chainFixture(starts);input.policy.transitions[0].gowningCycle=gowningCycle;
  const r=buildInterventionTransitionLedger(input);
  assert.equal(r.metrics.potentialEntryReduction,entryReduction);
  assert.equal(r.metrics.potentialGowningReduction,gowningReduction);
  assert.equal(r.metrics.potentialReductionBasis,'largest_single_candidate');
 }
});
test('non-additive alternatives and their summary are stable under input reversal',()=>{
 const input=chainFixture(),r=buildInterventionTransitionLedger(input);
 input.tasks.reverse();input.presenceEvents.reverse();input.policy.transitions.reverse();
 assert.deepEqual(buildInterventionTransitionLedger(input),r);
 assert.equal(r.metrics.potentialEntryReduction,1);
});
