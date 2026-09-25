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
