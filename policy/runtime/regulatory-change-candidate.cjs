'use strict';
const { createHash } = require('node:crypto');
function stable(v){if(Array.isArray(v)) return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
function digest(v){return createHash('sha256').update(stable(v)).digest('hex');}
function text(v,max=240){return String(v??'').trim().slice(0,max);}
function list(v,max=100,maxLen=240){return Array.isArray(v)?[...new Set(v.map(x=>text(x,maxLen)).filter(Boolean))].slice(0,max):[];}
function normaliseConfidence(v){
  if(v==null) return 0;
  if((typeof v!=='number'&&typeof v!=='string')||(typeof v==='string'&&!v.trim())) throw new Error('Candidate confidence must be finite between 0 and 1.');
  const value=Number(v);
  if(!Number.isFinite(value)||value<0||value>1) throw new Error('Candidate confidence must be finite between 0 and 1.');
  return value;
}
const MATERIAL_DOMAINS=new Set(['working-time','overtime','rest','absence','holiday','payroll','privacy','worker-category','certification','safety','ai-governance']);
function createRegulatoryChangeCandidate(input={}){
  const sourceAssessment=input.sourceAssessment||{};
  if(sourceAssessment.usable!==true||sourceAssessment.state!=='CURRENT') throw new Error('Current authoritative source evidence is required.');
  const previous=text(input.previousSnapshotDigest,128),next=text(input.nextSnapshotDigest,128);
  if(!previous||!next) throw new Error('Previous and next snapshot digests are required.');
  if(previous===next) return Object.freeze({contractVersion:'VECTOR_REGULATORY_CHANGE_CANDIDATE_V1',state:'NO_CHANGE',promotionAuthority:false,customerMutation:false});
  const changes=Array.isArray(input.changes)?input.changes:[];
  if(!changes.length) throw new Error('Changed snapshots require structured candidate changes.');
  const sites=Array.isArray(input.sites)?input.sites:[];
  const normalised=changes.map((c,i)=>({id:text(c.id,160)||'change-'+(i+1),domain:text(c.domain,80),summary:text(c.summary,500),effectiveFrom:text(c.effectiveFrom,80)||null,jurisdiction:text(c.jurisdiction,120),confidence:normaliseConfidence(c.confidence),sourceRefs:list(c.sourceRefs,20,300),ambiguity:text(c.ambiguity,40).toUpperCase()||'UNKNOWN'}));
  if(normalised.some(c=>!c.domain||!c.jurisdiction||!c.sourceRefs.length)) throw new Error('Every candidate change needs domain, jurisdiction and sourceRefs.');
  const material=normalised.some(c=>MATERIAL_DOMAINS.has(c.domain)),ambiguous=normalised.some(c=>c.ambiguity!=='LOW'||c.confidence<0.95);
  const affectedSites=[]; for(const site of sites){const jurisdiction=text(site.jurisdiction||site.country,120);if(normalised.some(c=>c.jurisdiction===jurisdiction)) affectedSites.push(text(site.id,160));}
  const reviewRequired=material||ambiguous;
  const payload={contractVersion:'VECTOR_REGULATORY_CHANGE_CANDIDATE_V1',state:reviewRequired?'QUALIFIED_REVIEW_REQUIRED':'STRUCTURED_LOW_AMBIGUITY_CANDIDATE',sourceId:text(sourceAssessment.sourceId,160),previousSnapshotDigest:previous,nextSnapshotDigest:next,changes:normalised,affectedSites:[...new Set(affectedSites)],reviewRequired,promotionAuthority:false,customerMutation:false,executionAuthority:false,generatedTestsRequired:true,historicalReplayRequired:true,shadowRequired:true,claimBoundary:'Candidate only. No legal interpretation, customer policy or production behaviour changes until independent verification and normal VECTOR release gates pass.'};
  for(const change of normalised){Object.freeze(change.sourceRefs);Object.freeze(change);}
  Object.freeze(normalised);Object.freeze(payload.affectedSites);
  return Object.freeze({...payload,candidateDigest:digest(payload)});
}
module.exports=Object.freeze({createRegulatoryChangeCandidate,MATERIAL_DOMAINS,digest,stable});
