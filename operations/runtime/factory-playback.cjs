'use strict';

const { createHash } = require('node:crypto');

const CONTRACT_VERSION='VECTOR_FACTORY_PLAYBACK_V1';
const EPISODE_VERSION='VECTOR_DECISION_EPISODE_V1';

function stable(value){
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function digest(value){return createHash('sha256').update(stable(value)).digest('hex');}
function text(v,max=240){return String(v??'').trim().slice(0,max);}
function iso(v){const raw=text(v,80),ms=Date.parse(raw);return raw&&Number.isFinite(ms)?new Date(ms).toISOString():null;}
function list(v,max=20,maxLen=220){return Array.isArray(v)?[...new Set(v.map(x=>text(x,maxLen)).filter(Boolean))].slice(0,max):[];}

function safeRealtimeEvent(event,episode){
  if(!event||typeof event!=='object') return null;
  const createdAt=iso(event.createdAt);
  if(!createdAt) return null;
  const payload=event.payload&&typeof event.payload==='object'&&!Array.isArray(event.payload)?event.payload:{};
  if(payload.tenant&&String(payload.tenant)!==String(episode.tenant)) return null;
  if(payload.site&&episode.site&&String(payload.site)!==String(episode.site)) return null;
  const evidenceRefs=list(payload.evidenceRefs||payload.sourceEvidence||[],12,220);
  if(payload.sourceRef) evidenceRefs.push(text(payload.sourceRef,220));
  return {
    at:createdAt,
    kind:'REALTIME_EVENT',
    topic:text(event.topic,80)||'vector-change',
    title:text(payload.title||payload.summary||event.topic||'Operational event',180),
    summary:text(payload.summary||'',400)||null,
    entityRef:payload.entityRef?text(payload.entityRef,180):null,
    decisionRef:payload.decisionRef?text(payload.decisionRef,180):null,
    evidenceRefs:[...new Set(evidenceRefs)],
    sourceType:'realtime'
  };
}

function episodeEvents(episode){
  const events=[];
  const triggeredAt=iso(episode.triggeredAt);
  if(triggeredAt) events.push({
    at:triggeredAt,kind:'DECISION_TRIGGERED',topic:'decision.triggered',
    title:'Operational decision triggered',summary:text(episode.decisionType,180),
    entityRef:text(episode.triggerId,180)||null,decisionRef:episode.episodeId,evidenceRefs:list(episode.sourceEvidence,20,220),sourceType:'decision-episode'
  });
  if(triggeredAt&&episode.recommendation) events.push({
    at:triggeredAt,kind:'RECOMMENDATION_CREATED',topic:'decision.recommended',
    title:'VECTOR recommendation created',summary:episode.recommendation.optionId?'Recommended '+text(episode.recommendation.optionId,120):'No eligible recommendation',
    entityRef:null,decisionRef:episode.episodeId,evidenceRefs:list(episode.sourceEvidence,20,220),sourceType:'decision-episode'
  });
  if(episode.selection&&iso(episode.selection.selectedAt)) events.push({
    at:iso(episode.selection.selectedAt),kind:episode.selection.executionPermitted===true?'ACTION_AUTHORISED':'OPTION_SELECTED',topic:'decision.selected',
    title:episode.selection.executionPermitted===true?'Action authorised':'Option selected',
    summary:text(episode.selection.optionId,120)+' · '+text(episode.selection.authorityDecision,80),
    entityRef:episode.selection.actorRef?text(episode.selection.actorRef,180):null,decisionRef:episode.episodeId,evidenceRefs:[],sourceType:'decision-episode'
  });
  if(episode.outcome&&iso(episode.outcome.observedAt)) events.push({
    at:iso(episode.outcome.observedAt),kind:'OUTCOME_OBSERVED',topic:'decision.outcome',
    title:'Operational outcome observed',summary:episode.outcome.notes?text(episode.outcome.notes,400):'Outcome evidence recorded',
    entityRef:null,decisionRef:episode.episodeId,evidenceRefs:list(episode.outcome.evidenceRefs,30,220),sourceType:'decision-episode'
  });
  return events;
}

function proofEvents(proofs,episode){
  return (Array.isArray(proofs)?proofs:[]).filter(p=>p&&p.recordType==='vector-decision-outcome-proof'&&p.episodeId===episode.episodeId&&p.tenant===episode.tenant).map(proof=>{
    const at=iso(proof.measurementWindow?.end)||iso(episode.outcome?.observedAt)||iso(episode.triggeredAt);
    return {
      at,kind:proof.realisedFinancialOutcome?'FINANCIAL_VALUE_VERIFIED':'OUTCOME_PROOF_RECORDED',topic:'decision.proof',
      title:proof.realisedFinancialOutcome?'Realised value verified':'Outcome proof recorded',
      summary:text(proof.classification,40)+' · '+text(proof.metric,80),
      entityRef:null,decisionRef:episode.episodeId,evidenceRefs:list([...(proof.evidence?.baseline||[]),...(proof.evidence?.result||[]),...(proof.evidence?.finance||[])],30,220),sourceType:'outcome-proof'
    };
  }).filter(x=>x.at);
}

function createFactoryPlayback(input={}){
  const episode=input.episode;
  if(!episode||episode.contractVersion!==EPISODE_VERSION||!episode.episodeId) throw new Error('Valid decision episode is required.');
  const realtime=(Array.isArray(input.realtimeEvents)?input.realtimeEvents:[]).map(event=>safeRealtimeEvent(event,episode)).filter(Boolean);
  const timeline=[...episodeEvents(episode),...realtime,...proofEvents(input.outcomeProofs,episode)]
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.kind.localeCompare(b.kind)||String(a.topic).localeCompare(String(b.topic)));
  const core={
    contractVersion:CONTRACT_VERSION,
    tenant:text(episode.tenant,120),
    site:episode.site?text(episode.site,160):null,
    episodeId:episode.episodeId,
    decisionType:text(episode.decisionType,120),
    timeline,
    eventCount:timeline.length,
    readOnly:true,
    executionPermitted:false,
    claimBoundary:'Playback reconstructs evidence already recorded by authoritative VECTOR services. It does not create operational authority or invent missing events.'
  };
  return Object.freeze({...core,playbackDigest:digest(core)});
}

module.exports=Object.freeze({CONTRACT_VERSION,createFactoryPlayback,digest,stable});
