function rng(seed=26092026){let s=seed>>>0;return()=>((s=(1664525*s+1013904223)>>>0)/4294967296);}
function randInt(r,min,max){return Math.floor(r()*(max-min+1))+min;}
function triangular(r,min,max,mode){const u=r(),c=(mode-min)/(max-min);return u<c?min+Math.sqrt(u*(max-min)*(mode-min)):max-Math.sqrt((1-u)*(max-min)*(max-mode));}
function median(values){const a=[...values].sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}

const r=rng();
const scales=[1,5,20,200,10000];
const outcomes=[];
for(let i=0;i<5000;i++){
  const headcount=scales[randInt(r,0,scales.length-1)];
  const controlHeadcount=headcount===1?1:randInt(r,1,Math.min(4,Math.max(1,Math.floor(headcount/2))));
  const delay=randInt(r,0,300);
  const displacement=Math.floor(triangular(r,0,600*(headcount<=5?1.5:1),120*(headcount<=5?1.5:1)));
  const released=controlHeadcount*delay;
  const net=released-displacement;
  const qualifies=delay>0&&net>=0&&headcount>controlHeadcount;
  outcomes.push({headcount,controlHeadcount,delay,displacement,released,net,qualifies});
}
const qualified=outcomes.filter(x=>x.qualifies);
const scale={};
for(const size of scales){
  const rows=outcomes.filter(x=>x.headcount===size),wins=rows.filter(x=>x.qualifies);
  scale[size]={scenarios:rows.length,qualifiedRate:wins.length/rows.length,medianNetProductiveMinutes:median(wins.map(x=>x.net)),medianExposureMinutesReduced:median(wins.map(x=>x.delay))};
}

const enterpriseR=rng(26092027);
const enterprise=[];
let unsafeQualifications=0,coverageGaps=0;
for(let run=0;run<500;run++){
  let netMinutes=0,exposureMinutes=0,qualifyingSites=0,restrictedSites=0;
  for(let site=0;site<50;site++){
    const controlHeadcount=randInt(enterpriseR,1,4),delay=randInt(enterpriseR,0,300),displacement=Math.floor(triangular(enterpriseR,0,600,120));
    const coverageOk=enterpriseR()>=0.03;
    if(!coverageOk){coverageGaps++;restrictedSites++;continue;}
    const net=controlHeadcount*delay-displacement;
    if(delay>0&&net>=0){qualifyingSites++;netMinutes+=net;exposureMinutes+=delay;}
    if(!coverageOk&&delay>0&&net>=0)unsafeQualifications++;
  }
  enterprise.push({qualifyingSites,restrictedSites,netMinutes,exposureMinutes});
}

const report={
  version:'loss-prevention-workforce-simulation-v0.1.0',
  scenarioCount:outcomes.length,
  qualificationRate:qualified.length/outcomes.length,
  qualifiedMedianExposureMinutesReduced:median(qualified.map(x=>x.delay)),
  qualifiedMedianControlPersonMinutesReleased:median(qualified.map(x=>x.released)),
  qualifiedMedianNetProductiveMinutes:median(qualified.map(x=>x.net)),
  scale,
  enterprise50Site:{runs:enterprise.length,medianQualifyingSites:median(enterprise.map(x=>x.qualifyingSites)),medianNetProductiveMinutes:median(enterprise.map(x=>x.netMinutes)),medianExposureMinutesReduced:median(enterprise.map(x=>x.exposureMinutes)),coverageGaps,unsafeQualifications},
  boundary:'Synthetic stress test only. No loss probability, insurance saving, customer result or legal compliance claim.'
};
console.log(JSON.stringify(report,null,2));
