import {createSemanticEnvelope} from './semantic-envelope.mjs';

function required(value,name){
  if(typeof value!=='string'||!value.trim()||value!==value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function nonNegative(value,name){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0) throw new TypeError(`${name} must be a non-negative finite number`);
  return value;
}

const boundary=Object.freeze({
  admissionStatus:'blocked',
  decisionAllowed:false,
  writeBackAllowed:false,
  claimBoundary:'Meter delta is an untrusted source candidate, not condition diagnosis, predictive maintenance, work-order authority or realised savings.'
});

/** Read-only source-window assessment; a trusted source adapter must admit the result separately. */
export function assessMaintenanceMeterWindow({tenantId,siteId,assetId,meterId,meterKind,sourceSystem,unit,readings,asOf,maxAgeMs}={}){
  for(const [name,value] of Object.entries({tenantId,siteId,assetId,meterId,meterKind,sourceSystem,unit})) required(value,name);
  if(meterKind!=='cumulative') throw new TypeError('only a cumulative meter can produce a delta');
  if(!Array.isArray(readings)||readings.length<2||readings.length>10000) throw new TypeError('readings must contain 2 to 10000 observations');
  if(typeof maxAgeMs!=='number'||!Number.isFinite(maxAgeMs)||maxAgeMs<=0) throw new TypeError('maxAgeMs must be positive and finite');
  const assessed=createSemanticEnvelope({sourceSystem:'vector-assessment',sourceRecordId:'meter-window-as-of',sourceObservedAt:asOf,ingestedAt:asOf});
  const asOfMs=Date.parse(assessed.source.observedAt);
  const seen=new Set();
  const values=readings.map((reading,index)=>{
    if(!reading||typeof reading!=='object'||Array.isArray(reading)) throw new TypeError(`readings[${index}] must be an observation`);
    for(const name of ['tenantId','siteId','assetId','meterId','meterKind','sourceSystem','unit']){
      if(reading[name]!==({tenantId,siteId,assetId,meterId,meterKind,sourceSystem,unit})[name]) throw new TypeError(`readings[${index}].${name} differs from window scope`);
    }
    const recordId=required(reading.recordId,`readings[${index}].recordId`);
    const revision=required(reading.revision,`readings[${index}].revision`);
    if(seen.has(recordId)) throw new TypeError('duplicate source record id');
    seen.add(recordId);
    const value=nonNegative(reading.value,`readings[${index}].value`);
    if(reading.ingestedAt===undefined||reading.ingestedAt===null||reading.ingestedAt==='') throw new TypeError(`readings[${index}].ingestedAt is required`);
    const envelope=createSemanticEnvelope({sourceSystem,sourceRecordId:recordId,sourceObservedAt:reading.observedAt,
      ingestedAt:reading.ingestedAt,sourceUnit:unit,canonicalUnit:unit,authority:'operational-evidence'});
    const observedMs=Date.parse(envelope.source.observedAt),ingestedMs=Date.parse(envelope.ingestion.ingestedAt);
    if(ingestedMs<observedMs) throw new TypeError('meter ingestion before observation requires source clock review');
    if(observedMs>asOfMs||ingestedMs>asOfMs) throw new TypeError('future meter observation is not admissible');
    return {recordId,revision,value,observedAt:envelope.source.observedAt,observedMs};
  }).sort((a,b)=>a.observedMs-b.observedMs||a.recordId.localeCompare(b.recordId));
  for(let index=1;index<values.length;index++){
    if(values[index].observedMs===values[index-1].observedMs) throw new TypeError('conflicting meter observations at one source time');
    if(values[index].value<values[index-1].value) throw new TypeError('cumulative meter decreased; reset or replacement evidence is required');
  }
  const first=values[0],last=values.at(-1);
  if(asOfMs-last.observedMs>maxAgeMs) throw new TypeError('latest meter observation is stale');
  const delta=last.value-first.value;
  if(!Number.isFinite(delta)) throw new TypeError('meter delta overflowed');
  return Object.freeze({...boundary,tenantId,siteId,assetId,meterId,meterKind,sourceSystem,unit,
    first:Object.freeze({recordId:first.recordId,revision:first.revision,observedAt:first.observedAt,value:first.value}),
    last:Object.freeze({recordId:last.recordId,revision:last.revision,observedAt:last.observedAt,value:last.value}),
    observationCount:values.length,deltaCandidate:delta,blockedReason:'trusted-meter-source-admission-unavailable'});
}
