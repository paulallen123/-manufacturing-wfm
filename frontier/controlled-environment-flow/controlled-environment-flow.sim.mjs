import {compareControlledEnvironmentPlans} from './controlled-environment-flow.mjs';

let seed=987654321;
const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
const pick=a=>a[Math.floor(rnd()*a.length)];
const zones=['D','C','B'];
const skills=['fill','inspect','sample','clean','maint','weigh'];

function scenario(id,workersN=18,tasksN=45){
 const siteId='S'+id;
 const policy={
  authoritative:true,siteId,version:'v1',ref:'sim:policy:'+id,observedAt:'2026-09-20T21:30:00Z',maxAgeMinutes:60,defaultOutsideZone:'OUT',
  zones:{D:{maxPersonnel:999},C:{maxPersonnel:999},B:{maxPersonnel:999}},transitions:[]
 };
 for(const to of zones)policy.transitions.push({from:'OUT',to,allowed:true,gowningCycle:true,controlMinutes:{D:4,C:7,B:10}[to],controlCost:0});
 for(const from of zones)for(const to of zones)if(from!==to)policy.transitions.push({from,to,allowed:true,gowningCycle:(zones.indexOf(to)>zones.indexOf(from)),controlMinutes:3,controlCost:0});

 const workers=Array.from({length:workersN},(_,i)=>{
   const n=2+Math.floor(rnd()*3);
   const shuffled=skills.slice().sort(()=>rnd()-.5);
   return {id:'W'+i,siteId,skills:shuffled.slice(0,n),qualifiedZones:[...zones],currentZone:'OUT'};
 });
 for(let s=0;s<skills.length;s++)if(!workers.some(w=>w.skills.includes(skills[s])))workers[s%workersN].skills.push(skills[s]);

 const tasks=Array.from({length:tasksN},(_,i)=>({id:'T'+i,siteId,slot:i,zone:pick(zones),skill:pick(skills),requiredHeadcount:1}));

 const baselineState=new Map(workers.map(w=>[w.id,{load:0}]));
 const baselineAssignments=[];
 for(const task of tasks){
   const eligible=workers.filter(w=>w.skills.includes(task.skill)).sort((a,b)=>baselineState.get(a.id).load-baselineState.get(b.id).load||a.id.localeCompare(b.id));
   const w=eligible[0];baselineAssignments.push({taskId:task.id,workerId:w.id});baselineState.get(w.id).load++;
 }
 const baseline={id:'baseline',assignments:baselineAssignments};

 const flowState=new Map(workers.map(w=>[w.id,{zone:'OUT',load:0}]));
 const flowAssignments=[];
 for(const task of tasks){
   const eligible=workers.filter(w=>w.skills.includes(task.skill)).sort((a,b)=>{
     const sa=flowState.get(a.id),sb=flowState.get(b.id);
     const ca=sa.zone===task.zone?0:1,cb=sb.zone===task.zone?0:1;
     return ca-cb||sa.load-sb.load||a.id.localeCompare(b.id);
   });
   const w=eligible[0];flowAssignments.push({taskId:task.id,workerId:w.id});
   const s=flowState.get(w.id);s.zone=task.zone;s.load++;
 }
 const flow={id:'flow',assignments:flowAssignments};
 return compareControlledEnvironmentPlans({policy,workers,tasks,plans:[baseline,flow],now:'2026-09-20T21:31:00Z'});
}

let total=0,better=0,equal=0,baseG=0,flowG=0,baseT=0,flowT=0;
for(let i=0;i<2000;i++){
 const r=scenario(i);
 const b=r.safe.find(x=>x.planId==='baseline'),f=r.safe.find(x=>x.planId==='flow');
 if(!b||!f)continue;
 total++;
 if(f.metrics.gowningCycles<b.metrics.gowningCycles)better++;
 if(f.metrics.gowningCycles===b.metrics.gowningCycles)equal++;
 baseG+=b.metrics.gowningCycles;flowG+=f.metrics.gowningCycles;baseT+=b.metrics.transitions;flowT+=f.metrics.transitions;
}
console.log(JSON.stringify({
 total,betterRate:better/total,equalRate:equal/total,
 meanBaselineGowning:baseG/total,meanFlowGowning:flowG/total,
 meanBaselineTransitions:baseT/total,meanFlowTransitions:flowT/total,
 allCandidatePlansSafe:total===2000,
 claimBoundary:'Synthetic sequential-task comparison only; not customer contamination, quality, labour-cost or energy proof.'
},null,2));
