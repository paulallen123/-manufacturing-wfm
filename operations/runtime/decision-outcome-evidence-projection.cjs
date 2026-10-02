'use strict';
// Pure audit of supplied outcome declarations; DecisionOutcomeProof remains sole owner.
const {digest,CLASSIFICATIONS,DIRECTIONS,FINANCIAL_METRICS}=require('./decision-outcome-proof.cjs');
const {inertJsonCopy}=require('../../implementation/runtime/inert-finite-json.cjs');
function requireThat(ok,message){if(!ok)throw Error(message);}
function text(value,label){requireThat(typeof value==='string'&&value.trim().length>0,label+' must be nonempty text');}
function finite(value,label){requireThat(typeof value==='number'&&Number.isFinite(value),label+' must be finite');}
function canonicalIso(value,label){
 requireThat(typeof value==='string',label+' requires a canonical ISO timestamp');
 const ms=Date.parse(value);requireThat(Number.isFinite(ms)&&new Date(ms).toISOString()===value,label+' requires a valid canonical ISO timestamp');return ms;
}
function refs(value,label){requireThat(Array.isArray(value),label+' evidence refs required');for(const ref of value)text(ref,label);}
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function validateProof(proof,tenant){
 requireThat(proof&&proof.schemaVersion===1&&proof.recordType==='vector-decision-outcome-proof','Canonical outcome proof schema required');
 requireThat(proof.tenant===tenant,'Cross-tenant outcome proof denied');
 for(const key of ['episodeId','decisionType','selectedOptionId','metric'])text(proof[key],key);
 requireThat(CLASSIFICATIONS.includes(proof.classification)&&DIRECTIONS.includes(proof.direction),'Unsupported outcome classification or direction');
 const {proofDigest,...core}=proof;requireThat(typeof proofDigest==='string'&&/^[a-f0-9]{64}$/.test(proofDigest)&&digest(core)===proofDigest,'Outcome proof digest mismatch');
 requireThat(proof.predicted&&proof.evidence,'Prediction and evidence required');
 for(const key of ['baseline','selected','improvement'])finite(proof.predicted[key],'predicted.'+key);
 const improvement=(baseline,result)=>proof.direction==='MAXIMIZE'?result-baseline:baseline-result;
 requireThat(proof.predicted.improvement===improvement(proof.predicted.baseline,proof.predicted.selected),'Prediction improvement mismatch');
 for(const key of ['baseline','result','finance'])refs(proof.evidence[key],key);
 if(proof.classification==='SIMULATED'){
  requireThat(proof.observed===null&&proof.verifiedOperationalOutcome===false&&proof.realisedFinancialOutcome===false&&proof.learningEligible===false,'Simulation classification flags mismatch');
  requireThat(['baseline','result','finance'].every(key=>proof.evidence[key].length===0),'Simulation cannot declare observed evidence');
  requireThat(!Object.hasOwn(proof,'currency')&&!Object.hasOwn(proof,'measurementWindow'),'Simulation cannot carry financial currency/window metadata');
 }else{
  requireThat(proof.observed&&proof.verifiedOperationalOutcome===true&&proof.learningEligible===true&&proof.realisedFinancialOutcome===(proof.classification==='REALISED_FINANCIAL'),'Observed classification flags mismatch');
  for(const key of ['baseline','result','improvement'])finite(proof.observed[key],'observed.'+key);
  requireThat(proof.observed.improvement===improvement(proof.observed.baseline,proof.observed.result),'Observed improvement mismatch');
  finite(proof.observed.predictionError,'observed.predictionError');
  requireThat(proof.observed.predictionError===Number((proof.observed.result-proof.predicted.selected).toFixed(8)),'Observed prediction error mismatch');
  canonicalIso(proof.observed.observedAt,'observed.observedAt');
  requireThat(proof.evidence.baseline.length>0&&proof.evidence.result.length>0,'Observed baseline/result evidence required');
  if(proof.classification==='REALISED_FINANCIAL'){
   requireThat(FINANCIAL_METRICS.has(proof.metric)&&/^[A-Z]{3}$/.test(proof.currency)&&proof.evidence.finance.length>0,'Financial declaration contract mismatch');
   const start=canonicalIso(proof.measurementWindow?.start,'measurementWindow.start'),end=canonicalIso(proof.measurementWindow?.end,'measurementWindow.end');
   requireThat(Number.isFinite(start)&&Number.isFinite(end)&&start<end,'Financial declaration measurement window required');
  }else requireThat(proof.currency===null&&proof.measurementWindow===null,'Operational declaration cannot carry financial currency/window');
 }
 return proof;
}
function projectDecisionOutcomeEvidence(input={}){
 input=inertJsonCopy(input);text(input.tenant,'tenant');requireThat(Array.isArray(input.proofs),'Outcome proofs array required');
 const unique=new Map(),copies=new Map();
 for(const raw of input.proofs){const proof=validateProof(raw,input.tenant);copies.set(proof.proofDigest,(copies.get(proof.proofDigest)||0)+1);unique.set(proof.proofDigest,proof);}
 const groups=new Map(),declarations=new Map(),financeRefs=new Map();
 for(const proof of [...unique.values()].sort((a,b)=>a.proofDigest.localeCompare(b.proofDigest))){
  const groupKey=JSON.stringify([proof.classification,proof.metric,proof.currency??null]);
  if(!groups.has(groupKey))groups.set(groupKey,{declaredClassification:proof.classification,metric:proof.metric,currency:proof.currency??null,declarations:[]});
  groups.get(groupKey).declarations.push({sourceProofDigest:proof.proofDigest,episodeId:proof.episodeId,site:proof.site,selectedOptionId:proof.selectedOptionId,direction:proof.direction,predicted:proof.predicted,observed:proof.observed,evidence:proof.evidence,measurementWindow:proof.measurementWindow??null});
  const key=JSON.stringify([proof.episodeId,proof.metric,proof.classification,proof.measurementWindow?[proof.measurementWindow.start,proof.measurementWindow.end]:null]);
  if(!declarations.has(key))declarations.set(key,{episodeId:proof.episodeId,metric:proof.metric,declaredClassification:proof.classification,measurementWindow:proof.measurementWindow??null,proofDigests:[]});
  declarations.get(key).proofDigests.push(proof.proofDigest);
  if(proof.classification==='REALISED_FINANCIAL')for(const ref of new Set(proof.evidence.finance)){
   if(!financeRefs.has(ref))financeRefs.set(ref,[]);financeRefs.get(ref).push(proof.proofDigest);
  }
 }
 return freeze({tenant:input.tenant,suppliedRecordCount:input.proofs.length,uniqueDeclarationCount:unique.size,
  groups:[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,value])=>value),
  repeatedDeclarations:[...copies.entries()].filter(([,count])=>count>1).sort(([a],[b])=>a.localeCompare(b)).map(([proofDigest,count])=>({proofDigest,copies:count})),
  conflictingDeclarations:[...declarations.values()].filter(value=>value.proofDigests.length>1),
  potentialFinanceEvidenceOverlap:[...financeRefs.entries()].filter(([,digests])=>digests.length>1).sort(([a],[b])=>a.localeCompare(b)).map(([evidenceRef,proofDigests])=>({evidenceRef,proofDigests})),
  aggregateFinancialValue:null,executionAuthority:'NONE',financialAttributionAuthority:false,learningAuthority:false,
  sourceAuthentication:'NOT_ESTABLISHED_BY_THIS_PROJECTION',
  claimBoundary:'Supplied content-consistent declarations only. Shared finance references among realised-financial declarations flag possible overlap; no allocation or aggregate saving is computed. Evidence linkage does not prove causality or customer financial truth.'});
}
module.exports=Object.freeze({projectDecisionOutcomeEvidence});
