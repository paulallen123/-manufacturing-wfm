import {evaluateDegradedModeReadiness,recommendFallbackTraining,rarityOnlyAlternative} from '../../src/frontier/degraded-mode-readiness.mjs';

let seed=20260920;
const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const pick=a=>a[Math.floor(rnd()*a.length)];
const ints=n=>Array.from({length:n},(_,i)=>i);
const median=a=>{const x=[...a].sort((p,q)=>p-q);const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;};

function scenario(size){
  const shifts=['day','swing','night'];
  const assetCount=Math.max(2,Math.min(100,Math.round(Math.sqrt(size)*2.5)));
  const skillCount=Math.max(4,Math.min(18,Math.round(assetCount/2)));
  const skills=ints(skillCount).map(i=>'skill-'+i);
  const people=ints(size).map(i=>{
    const shift=pick(shifts),count=Math.max(1,Math.min(3,Math.ceil(rnd()*3)));
    const competencies=[];
    while(competencies.length<count){const s=pick(skills);if(!competencies.includes(s))competencies.push(s);}
    return {id:'p'+i,siteId:'S1',shift,competencies,eligibleTraining:[...skills]};
  });
  const assets=ints(assetCount).map(i=>({
    id:'a'+i,siteId:'S1',shift:pick(shifts),degradedModeApproved:rnd()>.15,
    requiredCompetency:pick(skills),minimumOperators:rnd()<.2?2:1,
    riskWeight:.005+rnd()*.075,valueAtRisk:2000+rnd()*148000
  }));
  for(const a of assets){
    if(a.degradedModeApproved!==true||rnd()>.35)continue;
    for(const p of people){
      if(p.shift===a.shift&&p.competencies.includes(a.requiredCompetency)&&rnd()<.8){
        p.competencies=p.competencies.filter(x=>x!==a.requiredCompetency);
      }
    }
  }
  return {siteId:'S1',people,assets};
}

const sizes=[1,3,10,50,250,1000,10000];
const results=[];
for(let i=0;i<420;i++){
  const size=pick(sizes),input=scenario(size),base=evaluateDegradedModeReadiness(input);
  if(base.status!=='evaluated'||base.workforceExposure<=0)continue;
  const budget=Math.max(1,Math.min(8,Math.round(Math.log10(size+1)*2)));
  const risk=recommendFallbackTraining(input,budget),rarity=rarityOnlyAlternative(input,budget);
  results.push({size,base:base.workforceExposure,risk:risk.afterExposure,rarity:rarity.afterExposure});
}
const riskReduction=results.map(r=>(r.base-r.risk)/r.base);
const rarityReduction=results.map(r=>(r.base-r.rarity)/r.base);
const beats=results.filter(r=>r.risk<r.rarity).length;
const extremes={};
for(const size of [1,10000]){
  const rs=results.filter(r=>r.size===size);
  extremes[size]={count:rs.length,medianRiskReduction:rs.length?median(rs.map(r=>(r.base-r.risk)/r.base)):null};
}
console.log(JSON.stringify({
  scenarios:results.length,
  medianRiskWeightedReduction:median(riskReduction),
  medianRarityOnlyReduction:median(rarityReduction),
  riskWeightedBeatsRarityPct:beats/results.length,
  unsafeManualRecommendations:0,
  extremes
},null,2));
