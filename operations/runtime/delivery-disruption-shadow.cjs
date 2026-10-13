'use strict';
const {createDecisionEpisode,digest}=require('./decision-episode.cjs');
const VERSION='VECTOR_DELIVERY_DISRUPTION_SHADOW_V1';
const KINDS=['inventory','consumption','requirement','eta','economics'];
const SCOPE=['tenant','site','line','order','material','shipment'];
const FEASIBILITY=['safety','quality','qualifiedStaff','capacity','approvalRoute'];
const OPTION_KINDS=new Set(['RESEQUENCE','INTER_SITE_TRANSFER','EXPEDITE_REVIEW','ALTERNATE_MATERIAL_REVIEW']);
const str=v=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=180;
const utc=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const amount=v=>Number.isSafeInteger(v)&&v>=0&&v<=1e12;
const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
const scopeOK=s=>s&&SCOPE.every(k=>str(s[k]));
function deepFreeze(value){
  if(value&&typeof value==='object'){
    for(const nested of Object.values(value))deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
function blocked(input,reasons){const unique=[...new Set(reasons)].sort();return {contractVersion:VERSION,status:'INSUFFICIENT_EVIDENCE',reasons:unique,rankedOptions:[],episode:null,authority:'NO_EXECUTION',digest:digest({version:VERSION,scope:input?.scope,reasons:unique})};}
function evaluateDeliveryDisruption(raw){
  // The trusted caller must authenticate source records and retain the input
  // snapshot; this pure function never acquires evidence or executes a plan.
  const input=structuredClone(raw||{}),reasons=[];
  if(!scopeOK(input.scope)||!utc(input.asOf)||!input.policy||!str(input.policy.version)||
    !/^[A-Z]{3}$/.test(input.policy.currency||'')||!num(input.policy.maxAgeMinutes)||
    input.policy.maxAgeMinutes===0||!num(input.policy.minConfidence)||input.policy.minConfidence>1)
    return blocked(input,['INVALID_SCOPE_OR_POLICY']);
  if(!Array.isArray(input.evidence)||input.evidence.length>100)return blocked(input,['INVALID_EVIDENCE_LIST']);
  const byKind=new Map(),byId=new Map(),now=Date.parse(input.asOf),age=input.policy.maxAgeMinutes*60000;
  for(const e of input.evidence){
    if(!e||!KINDS.includes(e.kind)||!str(e.id)||!scopeOK(e.scope)||
      !SCOPE.every(k=>e.scope[k]===input.scope[k])||!str(e.source)||!str(e.sourceRevision)||
      !Number.isSafeInteger(e.revision)||e.revision<0||!/^[a-f0-9]{64}$/.test(e.recordHash)||
      !utc(e.observedAt)||!num(e.confidence)||e.confidence>1||
      !e.payload||typeof e.payload!=='object'||Array.isArray(e.payload)){
      reasons.push('INVALID_OR_WRONG_SCOPE_EVIDENCE');continue;
    }
    const identity=digest(e),previous=byId.get(e.id);
    if(previous&&previous!==identity){reasons.push('EVENT_ID_CONFLICT');continue;}
    if(previous)continue;
    byId.set(e.id,identity);
    const stream=byKind.get(e.kind)||[];stream.push(e);byKind.set(e.kind,stream);
  }
  const selected=new Map();
  for(const kind of KINDS){
    const stream=byKind.get(kind)||[];
    if(!stream.length){reasons.push('MISSING_'+kind.toUpperCase());continue;}
    if(new Set(stream.map(e=>`${e.source}:${e.id}`)).size>1)reasons.push('CONFLICTING_'+kind.toUpperCase());
    stream.sort((a,b)=>b.revision-a.revision||b.observedAt.localeCompare(a.observedAt)||a.id.localeCompare(b.id));
    const newest=stream[0];selected.set(kind,newest);
    if(stream.some(e=>e.revision===newest.revision&&digest(e)!==digest(newest)))reasons.push('REVISION_CONFLICT_'+kind.toUpperCase());
    if(newest.status&&newest.status!=='active')reasons.push('INACTIVE_'+kind.toUpperCase());
    if(Date.parse(newest.observedAt)>now||now-Date.parse(newest.observedAt)>=age)reasons.push('STALE_OR_FUTURE_'+kind.toUpperCase());
    if(newest.confidence<input.policy.minConfidence)reasons.push('LOW_CONFIDENCE_'+kind.toUpperCase());
  }
  if(reasons.length)return blocked(input,reasons);
  const inv=selected.get('inventory').payload,cons=selected.get('consumption').payload,
    req=selected.get('requirement').payload,eta=selected.get('eta').payload,econ=selected.get('economics').payload;
  if(!num(inv.quantityOnHand)||!num(inv.safetyStock)||inv.safetyStock>inv.quantityOnHand||
    !str(inv.unit)||inv.unit!==cons.unit||inv.unit!==req.unit||
    !num(cons.quantityPerHour)||cons.quantityPerHour===0||!utc(cons.startsAt)||
    !num(req.remainingQuantity)||!utc(req.requiredAt)||!utc(eta.arrivesAt)||
    econ.currency!==input.policy.currency||
    !['lostContributionPerHour','idleLabourPerHour','recoveryOvertimePerHour','customerPenalty'].every(k=>amount(econ[k]))||
    econ.componentsNonOverlapping!==true)return blocked(input,['INVALID_OR_OVERLAPPING_ECONOMICS_OR_PRODUCTION']);
  const start=Date.parse(cons.startsAt),need=Date.parse(req.requiredAt),arrival=Date.parse(eta.arrivesAt);
  if(start<now||need<now||arrival-start>30*86400000)return blocked(input,['INCONSISTENT_PRODUCTION_WINDOW']);
  const usable=inv.quantityOnHand-inv.safetyStock;
  const shortageHours=req.remainingQuantity<=usable?0:Math.min(
    (req.remainingQuantity-usable)/cons.quantityPerHour,
    Math.max(0,(arrival-(start+usable/cons.quantityPerHour*3600000))/3600000));
  if(!Number.isFinite(shortageHours)||shortageHours>720)return blocked(input,['INVALID_SHORTAGE']);
  const rate=econ.lostContributionPerHour+econ.idleLabourPerHour+econ.recoveryOvertimePerHour;
  const costAtRiskMinor=Math.ceil(shortageHours*rate)+(shortageHours>0?econ.customerPenalty:0);
  if(!Number.isSafeInteger(costAtRiskMinor))return blocked(input,['COST_OVERFLOW']);
  if(!Array.isArray(input.options)||input.options.length>20)return blocked(input,['INVALID_OPTIONS']);
  const rankedOptions=[],rejectedOptions=[],seen=new Set();
  for(const o of input.options){
    const failures=[];
    if(!o||!str(o.id)||o.id==='do-nothing'||seen.has(o.id)||!OPTION_KINDS.has(o.kind))failures.push('INVALID_OPTION');
    if(o?.id)seen.add(o.id);
    if(!num(o?.recoveredHours)||!amount(o?.costUpper)||!amount(o?.avoidedCostLower)||!str(o?.sourceRef))failures.push('INVALID_BOUNDS');
    for(const f of FEASIBILITY)if(o?.feasibility?.[f]!==true)failures.push('UNPROVEN_'+f.toUpperCase());
    if(o?.directPurchaseOrderWrite||o?.directScheduleWrite||o?.directStockTransfer||o?.directCarrierBooking)failures.push('DIRECT_ACTUATION');
    if(!failures.length&&o.recoveredHours>shortageHours)failures.push('RECOVERY_EXCEEDS_SHORTAGE');
    const supported=Math.ceil((o?.recoveredHours||0)*rate)+(o?.recoveredHours===shortageHours?econ.customerPenalty:0);
    if(!failures.length&&o.avoidedCostLower>supported)failures.push('UNSUPPORTED_AVOIDANCE');
    const benefit=failures.length?0:o.avoidedCostLower-o.costUpper;
    if(!failures.length&&benefit<=0)failures.push('NO_CONSERVATIVE_BENEFIT');
    const item={id:o?.id||null,kind:o?.kind||null,recoveredHours:o?.recoveredHours??null,
      conservativeNetBenefitMinor:benefit,failures,action:'WORKFLOW_REVIEW_ONLY'};
    (failures.length?rejectedOptions:rankedOptions).push(item);
  }
  rankedOptions.sort((a,b)=>b.conservativeNetBenefitMinor-a.conservativeNetBenefitMinor||a.id.localeCompare(b.id));
  const sourceEvidence=KINDS.map(kind=>{const e=selected.get(kind);return `${e.source}:${e.id}:${e.sourceRevision}:${e.recordHash}`;});
  const contextRevision=digest({version:VERSION,scope:input.scope,policy:input.policy,evidence:KINDS.map(k=>selected.get(k))});
  const options=[{id:'do-nothing',label:'Keep current plan',feasible:true,policyAllowed:true,hardConstraintsPassed:true,
    uncertainty:0,prediction:{disruptionCost:costAtRiskMinor},evidenceRefs:sourceEvidence},
    ...rankedOptions.map(o=>({id:o.id,label:o.kind.replaceAll('_',' ').toLowerCase(),
      feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0,
      prediction:{disruptionCost:costAtRiskMinor-o.conservativeNetBenefitMinor},
      evidenceRefs:[...sourceEvidence,input.options.find(x=>x.id===o.id).sourceRef]})),
    ...rejectedOptions.map((o,i)=>({id:'rejected-'+i,label:'Unavailable recovery',
      feasible:false,policyAllowed:false,hardConstraintsPassed:false,uncertainty:1,
      prediction:{disruptionCost:costAtRiskMinor},evidenceRefs:sourceEvidence,reasonCodes:o.failures}))];
  const episode=shortageHours>0&&options.length>=2?createDecisionEpisode({tenant:input.scope.tenant,site:input.scope.site,decisionType:'delivery-disruption',
    triggerId:`${input.scope.shipment}:${input.scope.order}`,triggeredAt:input.asOf,contextRevision,mode:'SHADOW',
    sourceEvidence,objective:{disruptionCost:1,uncertaintyPenalty:0},options}):null;
  const status=shortageHours===0?'NO_DISRUPTION':rankedOptions.length?'RECOVERY_OPTIONS':'NO_SAFE_RECOVERY';
  const result={contractVersion:VERSION,status,scope:input.scope,asOf:input.asOf,currency:input.policy.currency,
    shortageHours,costAtRiskMinor,rankedOptions:shortageHours?rankedOptions:[],rejectedOptions,
    contextRevision,sourceEvidence,episode:shortageHours?episode:null,
    claimBoundary:'REQUIRES_TRUSTED_SOURCE_ATTESTATION_SHADOW_ESTIMATE_NOT_REALISED_SAVING',authority:'NO_EXECUTION'};
  return deepFreeze({...result,digest:digest(result)});
}
module.exports=Object.freeze({evaluateDeliveryDisruption,VERSION});
