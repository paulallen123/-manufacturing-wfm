import {buildInterventionTransitionLedger} from './intervention-transition-ledger.mjs';

let seed=135791113;
const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};

function iso(min){return new Date(Date.parse('2026-09-20T08:00:00Z')+min*60000).toISOString();}

function scenario(id){
 const siteId='S'+id,workerId='P'+id;
 const policy={
  authoritative:true,siteId,version:'v1',ref:'sim:policy:'+id,observedAt:'2026-09-20T08:00:00Z',maxAgeMinutes:1440,defaultOutsideZone:'OUT',
  zones:{B:{maxBundleGapMinutes:30,maxContinuousMinutes:180}},
  transitions:[{from:'OUT',to:'B',allowed:true,gowningCycle:true,controlMinutes:10,controlCost:15},{from:'B',to:'OUT',allowed:true,gowningCycle:false,controlMinutes:3,controlCost:2}]
 };
 const tasks=[],presenceEvents=[];
 let minute=30;
 const taskCount=4+Math.floor(rnd()*8);
 for(let i=0;i<taskCount;i++){
  const duration=10+Math.floor(rnd()*16);
  tasks.push({id:'T'+i,siteId,workerId,zone:'B',startAt:iso(minute),endAt:iso(minute+duration),authoritative:true,ref:'mes:T'+i,revision:'r1'});
  const entry=minute-3,exit=minute+duration+3;
  presenceEvents.push({id:'E'+i+'a',siteId,workerId,zone:'B',direction:'enter',observedAt:iso(entry),authoritative:true,ref:'acs:'+i+'a'});
  presenceEvents.push({id:'E'+i+'b',siteId,workerId,zone:'B',direction:'exit',observedAt:iso(exit),authoritative:true,ref:'acs:'+i+'b'});
  minute+=duration+Math.floor(rnd()*46);
 }
 return buildInterventionTransitionLedger({policy,tasks,presenceEvents,now:'2026-09-20T22:00:00Z'});
}

let total=0,candidates=0,entries=0,potentialEntries=0,gowning=0,potentialGowning=0,review=0;
for(let i=0;i<5000;i++){
 const r=scenario(i);
 if(r.status==='ledger_ready'){
  total++;candidates+=r.metrics.consolidationCandidates;entries+=r.metrics.observedEntries;potentialEntries+=r.metrics.potentialEntryReduction;gowning+=r.metrics.observedGowningCycles;potentialGowning+=r.metrics.potentialGowningReduction;
 }else review++;
}
console.log(JSON.stringify({
 total,review,
 meanObservedEntries:entries/total,
 meanConsolidationCandidates:candidates/total,
 meanPotentialEntryReduction:potentialEntries/total,
 meanObservedGowningCycles:gowning/total,
 meanPotentialGowningReduction:potentialGowning/total,
 claimBoundary:'Synthetic measurement/falsification only. Candidate reductions are not realised savings, contamination reduction or customer proof.'
},null,2));