export const CASH_TO_CAPACITY_EVIDENCE_VERSION='cash-to-capacity-evidence-v0.1.0';

const TYPES=['productionPlan','workforceEligibility','customerCommitment','financialMilestone'];

function clean(v){return typeof v==='string'?v.trim():'';}
function observedAgeMinutes(observedAt,now){
  const a=Date.parse(String(observedAt??'')),b=Date.parse(String(now??''));
  if(!Number.isFinite(a)||!Number.isFinite(b)||a>b)return Infinity;
  return (b-a)/60000;
}

function same(a,b){return clean(a)&&clean(b)&&clean(a)===clean(b);}

export function buildCashToCapacityEvidenceBundle({context,sources,now=new Date().toISOString()}={}){
  const tenantId=clean(context?.tenantId),siteId=clean(context?.siteId),legalEntityId=clean(context?.legalEntityId),currency=clean(context?.currency).toUpperCase();
  if(!tenantId||!siteId||!legalEntityId||!/^[A-Z]{3}$/.test(currency)){
    return {status:'rejected',reason:'invalid_decision_scope'};
  }
  const bundle={};
  for(const type of TYPES){
    const source=sources?.[type];
    if(!source||source.authoritative!==true)return {status:'rejected',reason:'missing_authoritative_source',type};
    if(!same(source.tenantId,tenantId))return {status:'rejected',reason:'tenant_scope_mismatch',type};
    if(type==='productionPlan'||type==='workforceEligibility'){
      if(!same(source.siteId,siteId))return {status:'rejected',reason:'site_scope_mismatch',type};
    }
    if(type==='customerCommitment'||type==='financialMilestone'){
      if(!same(source.legalEntityId,legalEntityId))return {status:'rejected',reason:'legal_entity_scope_mismatch',type};
    }
    if(type==='financialMilestone'&&clean(source.currency).toUpperCase()!==currency){
      return {status:'rejected',reason:'currency_scope_mismatch',type};
    }
    const provider=clean(source.provider),revision=clean(source.revision),ref=clean(source.ref);
    if(!provider||!revision||!ref)return {status:'rejected',reason:'missing_source_provenance',type};
    const ageMinutes=observedAgeMinutes(source.observedAt,now);
    if(!Number.isFinite(ageMinutes))return {status:'rejected',reason:'invalid_source_time',type};
    bundle[type]={authoritative:true,provider,revision,ref,ageMinutes,observedAt:source.observedAt};
  }
  return {status:'accepted',scope:{tenantId,siteId,legalEntityId,currency},evidence:bundle};
}
