'use strict';
const {createHash}=require('node:crypto');

/* Pure advisory screen for F4.3. The caller supplies authenticated, inert JSON
 * from existing CMMS/EAM, inventory and workforce boundaries. A shaped hash or
 * sourceRef does not authenticate that evidence. No work order, assignment,
 * payroll, safety, inventory or machine action is available here. */
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(v);
const stamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v?Date.parse(v):null;
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const sameScope=(v,s)=>v?.tenant===s.tenant&&v?.site===s.site;
const evidence=(v,s,now,age)=>v&&id(v.id)&&sameScope(v,s)&&id(v.provenance?.source)&&
  typeof v.provenance?.recordHash==='string'&&/^[a-f0-9]{64}$/i.test(v.provenance.recordHash)&&
  stamp(v.observedAt)!==null&&stamp(v.observedAt)<=now&&now-stamp(v.observedAt)<=age;
const unique=items=>new Set(items).size===items.length;

function screenMaintenanceWorkforce(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('Exact scope, UTC evaluation time and bounded evidence age required.');
  const scope=input.scope||{},now=stamp(input.now),age=input.maxEvidenceAgeMs;
  if(!id(scope.tenant)||!id(scope.site)||now===null||!Number.isSafeInteger(age)||age<1||age>86400000)
    throw new Error('Exact scope, UTC evaluation time and bounded evidence age required.');
  const blockers=new Set(),order=input.workOrder,asset=input.asset;
  const deny=reason=>blockers.add(reason);
  const start=stamp(order?.start),end=stamp(order?.end);
  if(!evidence(order,scope,now,age)||!id(order.assetId)||order.status!=='OPEN'||
     start===null||end===null||start<now||end<=start||end-start>86400000||!id(order.revision))deny('WORK_ORDER_UNPROVEN');
  if(!evidence(asset,scope,now,age)||asset.id!==order?.assetId||asset.state!=='MAINTENANCE_REQUIRED')deny('ASSET_UNPROVEN');
  const skills=order?.requiredSkills,partRequirements=order?.requiredParts;
  if(!Array.isArray(skills)||!skills.length||skills.length>32||!skills.every(id)||!unique(skills))deny('SKILL_REQUIREMENTS_UNPROVEN');
  if(!Array.isArray(partRequirements)||partRequirements.length>64||
     !partRequirements.every(x=>id(x?.id)&&Number.isSafeInteger(x.quantity)&&x.quantity>0)||
     !unique(Array.isArray(partRequirements)?partRequirements.map(x=>x?.id):[]))deny('PART_REQUIREMENTS_UNPROVEN');
  const parts=input.parts,techs=input.technicians;
  if(!Array.isArray(parts)||parts.length>128||!unique(Array.isArray(parts)?parts.map(x=>x?.id):[]))deny('PART_EVIDENCE_CONFLICT');
  if(!Array.isArray(techs)||!techs.length||techs.length>128||!unique(Array.isArray(techs)?techs.map(x=>x?.id):[]))deny('TECHNICIAN_EVIDENCE_CONFLICT');
  if(Array.isArray(partRequirements)){
    for(const required of Array.isArray(partRequirements)?partRequirements:[]){
      const part=Array.isArray(parts)?parts.find(x=>x?.id===required?.id):null;
      if(!evidence(part,scope,now,age)||!Number.isSafeInteger(part.availableQuantity)||part.availableQuantity<required.quantity)deny('PARTS_NOT_PROVEN');
    }
  }
  const eligible=[];
  for(const tech of Array.isArray(techs)?techs:[]){
    if(!evidence(tech,scope,now,age)){deny('TECHNICIAN_EVIDENCE_UNPROVEN');continue;}
    if(start===null||end===null||stamp(tech.availableFrom)===null||stamp(tech.availableUntil)===null||
       stamp(tech.availableFrom)>start||stamp(tech.availableUntil)<end)continue;
    if(!Array.isArray(tech.skills)||tech.skills.length>64||!unique(tech.skills.map(x=>x?.id))||
       !tech.skills.every(x=>x?.technicianId===tech.id&&evidence(x,scope,now,age)&&
         stamp(x.validUntil)!==null&&stamp(x.validUntil)>=end)){
      deny('QUALIFICATION_EVIDENCE_UNPROVEN');continue;
    }
    if(Array.isArray(skills)&&skills.every(required=>tech.skills.some(x=>x.id===required)))eligible.push(tech.id);
  }
  if(!eligible.length)deny('NO_PROVEN_TECHNICIAN_COVER');
  const candidateTechnicianIds=blockers.size?[]:eligible.sort();
  const snapshot={scope,now:input.now,workOrder:order,asset,parts,technicians:techs};
  const result={contractVersion:'VECTOR_MAINTENANCE_WORKFORCE_PREFLIGHT_V1',
    status:blockers.size?'BLOCKED':'ADVISORY_CANDIDATES',
    candidateTechnicianIds:Object.freeze(candidateTechnicianIds),
    blockers:Object.freeze([...blockers].sort()),executionAuthority:false,providerWrite:false,
    evidenceDigest:createHash('sha256').update(stable(snapshot)).digest('hex'),
    claimBoundary:'Caller must authenticate current source records and validate work-order, part and qualification authority; candidates are advisory only.'};
  return Object.freeze(result);
}
module.exports=Object.freeze({screenMaintenanceWorkforce});
