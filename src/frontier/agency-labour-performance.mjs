export const AGENCY_PERFORMANCE_VERSION='agency-labour-performance-v0.1.0';
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const c=v=>Math.max(0,Math.min(1,n(v)));
const prior=(rate,sample,baseline=.5,weight=20)=>{sample=Math.max(0,n(sample));return (c(rate)*sample+c(baseline)*weight)/(sample+weight)};
const avg=(sum,count,fallback=0)=>count>0?sum/count:fallback;

function scoped(events,agencyId,request={}){
  const all=(Array.isArray(events)?events:[]).filter(e=>e&&e.agencyId===agencyId);
  const role=all.filter(e=>!request.roleId||e.roleId===request.roleId);
  const siteRole=role.filter(e=>!request.siteId||e.siteId===request.siteId);
  return siteRole.length>=5?siteRole:role.length>=8?role:all;
}

export function profileAgencyPerformance({agencyId,events=[],request={},now,responseTargetMinutes=15,maxChargePerHour=null}){
  if(typeof agencyId!=='string'||!agencyId)throw new TypeError('agencyId is required');
  const rows=scoped(events,agencyId,request);
  let requests=0,fill=0,preferred=0,noShows=0,completed=0,invoiceMatched=0,invoiceReviewed=0,responseCount=0,responseMinutes=0,totalCharge=0,chargeCount=0,replacements=0;
  for(const e of rows){
    if(e.type==='request_sent')requests++;
    if(e.type==='request_filled'){fill++;if(e.preferredWorker===true)preferred++;}
    if(e.type==='worker_no_show')noShows++;
    if(e.type==='shift_completed')completed++;
    if(e.type==='replacement_required')replacements++;
    if(e.type==='invoice_matched')invoiceMatched++;
    if(e.type==='invoice_review_required')invoiceReviewed++;
    if(e.type==='agency_response'&&n(e.responseMinutes,-1)>=0){responseCount++;responseMinutes+=n(e.responseMinutes);}
    if(e.type==='shift_completed'&&n(e.chargeRatePerHour,-1)>=0){chargeCount++;totalCharge+=n(e.chargeRatePerHour);}
  }
  const effectiveRequests=Math.max(requests,fill);
  const fillRate=effectiveRequests?fill/effectiveRequests:.5;
  const preferredRate=fill?preferred/fill:.5;
  const noShowRate=(completed+noShows)?noShows/(completed+noShows):.05;
  const invoiceCount=invoiceMatched+invoiceReviewed;
  const invoiceAccuracy=invoiceCount?invoiceMatched/invoiceCount:.5;
  const replacementRate=(completed+replacements)?replacements/(completed+replacements):.05;
  const meanResponse=avg(responseMinutes,responseCount,responseTargetMinutes);
  const responseScore=c(1-(meanResponse/Math.max(1,n(responseTargetMinutes,15))-.5)/2);
  const meanCharge=avg(totalCharge,chargeCount,maxChargePerHour===null?0:n(maxChargePerHour));
  const costScore=maxChargePerHour&&n(maxChargePerHour)>0?c(1-meanCharge/n(maxChargePerHour)):.5;
  const evidenceCount=Math.max(effectiveRequests,completed,invoiceCount,responseCount);
  const metrics={
    fillReliability:prior(fillRate,effectiveRequests,.5,20),
    preferredWorkerFulfilment:prior(preferredRate,fill,.5,20),
    attendanceReliability:1-prior(noShowRate,completed+noShows,.05,20),
    replacementAvoidance:1-prior(replacementRate,completed+replacements,.05,20),
    responseSpeed:prior(responseScore,responseCount,.5,20),
    invoiceAccuracy:prior(invoiceAccuracy,invoiceCount,.5,20),
    costEfficiency:prior(costScore,chargeCount,.5,20),
  };
  const weights={fillReliability:.28,preferredWorkerFulfilment:.22,attendanceReliability:.18,responseSpeed:.14,replacementAvoidance:.08,invoiceAccuracy:.06,costEfficiency:.04};
  const score=Object.entries(weights).reduce((s,[k,w])=>s+metrics[k]*w,0);
  return {version:AGENCY_PERFORMANCE_VERSION,agencyId,scope:rows.length>=5&&rows.every(e=>!request.siteId||e.siteId===request.siteId)?'site_role':rows.length>=8&&rows.every(e=>!request.roleId||e.roleId===request.roleId)?'role':'portfolio',sampleSize:rows.length,evidenceCount,score,metrics,weights,raw:{requests:effectiveRequests,filled:fill,preferredFilled:preferred,noShows,completed,replacements,invoiceMatched,invoiceReviewed,responseCount,meanResponseMinutes:meanResponse,meanChargeRatePerHour:meanCharge},evidenceConfidence:Math.min(1,evidenceCount/40),asOf:now??null};
}

export function rankAgenciesForRequest({agencies=[],events=[],request={},now,minimumEvidenceConfidence=0}){
  return (Array.isArray(agencies)?agencies:[])
    .filter(a=>a&&a.approved===true&&a.active!==false)
    .map(a=>profileAgencyPerformance({agencyId:a.agencyId,events,request:{...request,siteId:request.siteId},now,responseTargetMinutes:a.responseSlaMinutes??request.responseTargetMinutes??15,maxChargePerHour:request.maxChargePerHour??null}))
    .map(p=>({...p,lowEvidence:p.evidenceConfidence<minimumEvidenceConfidence}))
    .sort((a,b)=>b.score-a.score||b.evidenceConfidence-a.evidenceConfidence||a.agencyId.localeCompare(b.agencyId));
}

export function modelAgencyAutomationValue(input={}){
  const requests=Math.max(0,n(input.requestsPerMonth));
  const manualMinutes=Math.max(0,n(input.manualMinutesPerRequest));
  const automatedMinutes=Math.max(0,n(input.automatedMinutesPerRequest));
  const managerHourly=Math.max(0,n(input.managerHourlyCost));
  const manualInvoiceMinutes=Math.max(0,n(input.manualInvoiceMinutesPerWorker));
  const automatedInvoiceMinutes=Math.max(0,n(input.automatedInvoiceMinutesPerWorker));
  const workers=Math.max(0,n(input.agencyWorkersPerMonth));
  const avoidedNoShows=Math.max(0,n(input.avoidedNoShowsPerMonth));
  const noShowCost=Math.max(0,n(input.costPerNoShow));
  const requestHoursSaved=requests*Math.max(0,manualMinutes-automatedMinutes)/60;
  const invoiceHoursSaved=workers*Math.max(0,manualInvoiceMinutes-automatedInvoiceMinutes)/60;
  const adminHoursSaved=requestHoursSaved+invoiceHoursSaved;
  const adminCostSaved=adminHoursSaved*managerHourly;
  const noShowCostAvoided=avoidedNoShows*noShowCost;
  return {modelOnly:true,requestsPerMonth:requests,agencyWorkersPerMonth:workers,requestHoursSaved,invoiceHoursSaved,adminHoursSaved,adminCostSaved,noShowCostAvoided,totalModelledMonthlyValue:adminCostSaved+noShowCostAvoided,claimBoundary:'scenario_model_based_only_on_customer_supplied_assumptions'};
}
