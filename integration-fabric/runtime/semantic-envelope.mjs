const AUTHORITIES=new Set(['authoritative','operational-evidence','derived','inferred']);

function iso(value,name,{required=false}={}){
  if(value===null||value===undefined||value===''){
    if(required) throw new TypeError(`${name} is required`);
    return null;
  }
  const parsed=new Date(value);
  if(Number.isNaN(parsed.getTime())) throw new TypeError(`${name} must be an ISO-8601 timestamp`);
  return {raw:String(value),epochMs:parsed.getTime()};
}

function positiveNumber(value,name){
  const number=Number(value);
  if(!Number.isFinite(number)||number<=0) throw new TypeError(`${name} must be a positive finite number`);
  return number;
}

function boundedConfidence(value){
  const number=Number(value);
  if(!Number.isFinite(number)||number<0||number>1) throw new TypeError('confidence must be between 0 and 1');
  return number;
}

function nonEmpty(value,name){
  const normalized=String(value??'').trim();
  if(!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function normalizeUnitConversion(sourceUnit,canonicalUnit,conversion){
  if(!sourceUnit&&!canonicalUnit) return null;
  if(!sourceUnit||!canonicalUnit) throw new TypeError('sourceUnit and canonicalUnit must be supplied together');
  if(sourceUnit===canonicalUnit) return {sourceUnit,canonicalUnit,method:'identity',factor:1};
  if(!conversion) throw new TypeError('unitConversion is required when sourceUnit and canonicalUnit differ');
  return {
    sourceUnit,
    canonicalUnit,
    method:nonEmpty(conversion.method,'unitConversion.method'),
    factor:positiveNumber(conversion.factor,'unitConversion.factor')
  };
}

function normalizeCurrency(sourceCurrency,canonicalCurrency,fx){
  if(!sourceCurrency&&!canonicalCurrency) return null;
  if(!sourceCurrency||!canonicalCurrency) throw new TypeError('sourceCurrency and canonicalCurrency must be supplied together');
  const source=String(sourceCurrency).toUpperCase();
  const canonical=String(canonicalCurrency).toUpperCase();
  if(source===canonical) return {sourceCurrency:source,canonicalCurrency:canonical,method:'identity',rate:1,rateAsOf:null};
  if(!fx) throw new TypeError('fx conversion evidence is required when sourceCurrency and canonicalCurrency differ');
  const rateAsOf=iso(fx.rateAsOf,'fx.rateAsOf',{required:true});
  return {
    sourceCurrency:source,
    canonicalCurrency:canonical,
    method:nonEmpty(fx.method,'fx.method'),
    rate:positiveNumber(fx.rate,'fx.rate'),
    rateAsOf:rateAsOf.raw,
    source:nonEmpty(fx.source,'fx.source')
  };
}

function normalizeIntervention(intervention){
  if(!intervention) return null;
  const recommendationAt=iso(intervention.recommendationAt,'intervention.recommendationAt',{required:true});
  const actionEffectiveAt=iso(intervention.actionEffectiveAt,'intervention.actionEffectiveAt',{required:true});
  const baselineStart=iso(intervention.baselineStart,'intervention.baselineStart',{required:true});
  const baselineEnd=iso(intervention.baselineEnd,'intervention.baselineEnd',{required:true});
  const outcomeStart=iso(intervention.outcomeStart,'intervention.outcomeStart',{required:true});
  const outcomeEnd=iso(intervention.outcomeEnd,'intervention.outcomeEnd',{required:true});
  if(baselineEnd.epochMs<baselineStart.epochMs) throw new TypeError('intervention baseline window is inverted');
  if(outcomeEnd.epochMs<outcomeStart.epochMs) throw new TypeError('intervention outcome window is inverted');
  return {
    recommendationId:nonEmpty(intervention.recommendationId,'intervention.recommendationId'),
    recommendationAt:recommendationAt.raw,
    actionId:intervention.actionId?String(intervention.actionId):null,
    actionEffectiveAt:actionEffectiveAt.raw,
    baselineWindow:{start:baselineStart.raw,end:baselineEnd.raw},
    outcomeWindow:{start:outcomeStart.raw,end:outcomeEnd.raw},
    competingChanges:[...(intervention.competingChanges||[])].map(String)
  };
}

export function createSemanticEnvelope({
  sourceSystem,
  sourceRecordId,
  sourceEntityType,
  sourceObservedAt,
  effectiveFrom=null,
  effectiveTo=null,
  ingestedAt=new Date().toISOString(),
  sourceTimezone=null,
  locale=null,
  siteExternalId=null,
  entityExternalId=null,
  sourceUnit=null,
  canonicalUnit=null,
  unitConversion=null,
  sourceCurrency=null,
  canonicalCurrency=null,
  fx=null,
  authority='operational-evidence',
  confidence=1,
  schemaVersion=null,
  schemaFingerprint=null,
  lineage=[],
  staleAfterMs=null,
  intervention=null,
  extensions={}
}={}){
  const observed=iso(sourceObservedAt,'sourceObservedAt',{required:true});
  const ingested=iso(ingestedAt,'ingestedAt',{required:true});
  const start=iso(effectiveFrom,'effectiveFrom');
  const end=iso(effectiveTo,'effectiveTo');
  if(start&&end&&end.epochMs<start.epochMs) throw new TypeError('effective interval is inverted');
  if(!AUTHORITIES.has(authority)) throw new TypeError(`unsupported source authority: ${authority}`);
  const lateByMs=Math.max(0,ingested.epochMs-observed.epochMs);
  const staleThreshold=staleAfterMs===null||staleAfterMs===undefined?null:positiveNumber(staleAfterMs,'staleAfterMs');

  return {
    semanticVersion:1,
    source:{
      system:nonEmpty(sourceSystem,'sourceSystem'),
      recordId:nonEmpty(sourceRecordId,'sourceRecordId'),
      entityType:sourceEntityType?String(sourceEntityType):null,
      observedAt:observed.raw,
      effectiveFrom:start?.raw||null,
      effectiveTo:end?.raw||null,
      timezone:sourceTimezone?String(sourceTimezone):null,
      locale:locale?String(locale):null,
      siteExternalId:siteExternalId?String(siteExternalId):null,
      entityExternalId:entityExternalId?String(entityExternalId):null
    },
    ingestion:{
      ingestedAt:ingested.raw,
      lateByMs,
      stale:staleThreshold===null?null:lateByMs>staleThreshold,
      staleAfterMs:staleThreshold
    },
    normalization:{
      unit:normalizeUnitConversion(sourceUnit,canonicalUnit,unitConversion),
      currency:normalizeCurrency(sourceCurrency,canonicalCurrency,fx)
    },
    provenance:{
      authority,
      confidence:boundedConfidence(confidence),
      schemaVersion:schemaVersion===null||schemaVersion===undefined?null:String(schemaVersion),
      schemaFingerprint:schemaFingerprint?String(schemaFingerprint):null,
      lineage:[...lineage].map(String)
    },
    intervention:normalizeIntervention(intervention),
    extensions:structuredClone(extensions||{})
  };
}
