import {compareWaterResiliencePlans} from './water-resilience-orchestration.mjs';
let seed=246813579;
const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
const pick=a=>a[Math.floor(rnd()*a.length)];

function scenario(id,workersN=18,tasksN=28){
 const siteId='S'+id;
 const slots=Array.from({length:8},(_,i)=>{
  const stressed=i===2||i===3;
  return {slot:i,authoritative:true,waterSource:'fresh',freshWaterAvailableM3:stressed?32:80,minimumReserveM3:8,effluentCapacityM3:stressed?28:70,scarcityWeight:stressed?4:1,waterTariffPerM3:stressed?3.5:1.1,restrictionActive:stressed};
 });
 const policy={authoritative:true,siteId,version:'v1',ref:'sim:water:'+id,observedAt:'2026-09-20T22:00:00Z',maxAgeMinutes:240,slots};
 const skills=['mix','wash','inspect','pack'];
 const workers=Array.from({length:workersN},(_,i)=>({id:'W'+i,siteId,skills:skills.filter(()=>rnd()>.35)}));
 for(const s of skills)if(!workers.some(w=>w.skills.includes(s)))workers[Math.floor(rnd()*workers.length)].skills.push(s);
 const tasks=[];
 for(let i=0;i<tasksN;i++){
  const skill=pick(skills),water=skill==='pack'?0.5+2*rnd():3+8*rnd();
  const earliest=Math.floor(rnd()*6),latest=Math.min(7,earliest+1+Math.floor(rnd()*3));
  tasks.push({id:'T'+i,siteId,skill,freshWaterM3:water,effluentM3:water*(0.5+0.3*rnd()),earliestSlot:earliest,latestSlot:latest,preferredSlot:earliest,latePenalty:0.2,allowedWaterSources:['fresh'],allowedDuringRestriction:true});
 }
 const assign=(waterAware)=>{
  const workerUse=new Set(),slotWater=new Map(),slotEff=new Map(),assignments=[];
  for(const task of tasks){
   const candidates=[];
   for(let slot=task.earliestSlot;slot<=task.latestSlot;slot++){
    const ps=slots[slot];
    for(const w of workers){
     if(!w.skills.includes(task.skill)||workerUse.has(w.id+'@'+slot))continue;
     const projectedW=(slotWater.get(slot)||0)+task.freshWaterM3;
     const projectedE=(slotEff.get(slot)||0)+task.effluentM3;
     if(projectedW>ps.freshWaterAvailableM3-ps.minimumReserveM3||projectedE>ps.effluentCapacityM3)continue;
     const score=waterAware?(ps.restrictionActive?100:0)+ps.scarcityWeight*10+ps.waterTariffPerM3+(slot-task.earliestSlot)*0.1:(slot-task.earliestSlot)*0.1;
     candidates.push({w,slot,score});
    }
   }
   candidates.sort((a,b)=>a.score-b.score||a.slot-b.slot||a.w.id.localeCompare(b.w.id));
   if(!candidates.length)return null;
   const c=candidates[0];
   assignments.push({taskId:task.id,workerId:c.w.id,slot:c.slot});
   workerUse.add(c.w.id+'@'+c.slot);slotWater.set(c.slot,(slotWater.get(c.slot)||0)+task.freshWaterM3);slotEff.set(c.slot,(slotEff.get(c.slot)||0)+task.effluentM3);
  }
  return {id:waterAware?'water-aware':'baseline',assignments};
 };
 const baseline=assign(false),aware=assign(true);
 if(!baseline||!aware)return null;
 return compareWaterResiliencePlans({policy,workers,tasks,plans:[baseline,aware],now:'2026-09-20T22:30:00Z'});
}

let total=0,awareBetter=0,baseScar=0,awareScar=0,baseExposure=0,awareExposure=0,baseCost=0,awareCost=0;
for(let i=0;i<3000;i++){
 const r=scenario(i);
 if(!r)continue;
 const b=r.safe.find(x=>x.planId==='baseline'),a=r.safe.find(x=>x.planId==='water-aware');
 if(!b||!a)continue;
 total++;
 if(a.metrics.scarcityWeightedWater<b.metrics.scarcityWeightedWater)awareBetter++;
 baseScar+=b.metrics.scarcityWeightedWater;awareScar+=a.metrics.scarcityWeightedWater;
 baseExposure+=b.metrics.restrictionExposureM3;awareExposure+=a.metrics.restrictionExposureM3;
 baseCost+=b.metrics.waterCost;awareCost+=a.metrics.waterCost;
}
console.log(JSON.stringify({total,awareBetterRate:awareBetter/total,meanBaselineScarcityWeightedWater:baseScar/total,meanAwareScarcityWeightedWater:awareScar/total,scarcityWeightedReduction:(baseScar-awareScar)/baseScar,meanBaselineRestrictionExposureM3:baseExposure/total,meanAwareRestrictionExposureM3:awareExposure/total,restrictionExposureReduction:(baseExposure-awareExposure)/baseExposure,meanBaselineWaterCost:baseCost/total,meanAwareWaterCost:awareCost/total,claimBoundary:'Synthetic candidate-plan comparison only; not customer water, production, resilience or financial proof.'},null,2));
