'use strict';

/*
 * Shared authoritative evidence contract for Vector-facing workflow actions.
 *
 * This module deliberately does not calculate freshness, urgency or confirmation
 * transitions from wall-clock time. The owning source workflow must supply those
 * states from its own policy/SLA logic; presentation consumers may only validate
 * and display them.
 */

const CONTRACT_VERSION = 'WFM_WORKFLOW_ACTION_EVIDENCE_V1';
const WORKFLOWS = Object.freeze(['time-review','absence','weekly-signoff']);
const FRESHNESS_STATES = Object.freeze(['current','stale','unknown']);
const CONFIRMATION_STATES = Object.freeze([
  'action_required','decision_sent','confirming_source','needs_verification','resolved'
]);

function isObject(value){
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function text(value,max=240){
  const out=String(value??'').trim();
  return out ? out.slice(0,max) : '';
}
function iso(value){
  const raw=text(value,80);
  const ms=Date.parse(raw);
  return raw && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function structuredReason(value){
  const raw=text(value,80).toUpperCase();
  return /^[A-Z0-9_]+$/.test(raw) ? raw : '';
}
function freezeArray(values){
  return Object.freeze(values.map(v=>Object.freeze(v)));
}

function validateSourceActionEvidence(input){
  const errors=[];
  if(!isObject(input)) return Object.freeze({ok:false,errors:Object.freeze(['OBJECT_REQUIRED']),value:null});

  const workflow=text(input.workflow,40);
  const sourceId=text(input.sourceId,160);
  const reasonCode=structuredReason(input.reasonCode);
  const observedAt=iso(input.observedAt);
  const route=text(input.route,80)||workflow;
  const authorityRequired=text(input.authorityRequired,160);

  if(!WORKFLOWS.includes(workflow)) errors.push('WORKFLOW_UNSUPPORTED');
  if(!sourceId) errors.push('SOURCE_ID_REQUIRED');
  if(!reasonCode) errors.push('STRUCTURED_REASON_REQUIRED');
  if(!observedAt) errors.push('OBSERVED_AT_REQUIRED');
  if(!authorityRequired) errors.push('AUTHORITY_REQUIRED');

  const freshness=isObject(input.freshness)?input.freshness:null;
  const freshnessState=text(freshness?.state,24).toLowerCase();
  const freshnessPolicyRef=text(freshness?.policyRef,160);
  const validUntil=freshness?.validUntil==null?null:iso(freshness.validUntil);
  if(!freshness) errors.push('FRESHNESS_CONTRACT_REQUIRED');
  else {
    if(!FRESHNESS_STATES.includes(freshnessState)) errors.push('FRESHNESS_STATE_INVALID');
    if(freshnessState!=='unknown'&&!freshnessPolicyRef) errors.push('FRESHNESS_POLICY_REQUIRED');
    if(freshnessState==='current'&&!validUntil) errors.push('CURRENT_VALID_UNTIL_REQUIRED');
    if(freshness.validUntil!=null&&!validUntil) errors.push('FRESHNESS_VALID_UNTIL_INVALID');
  }

  const confirmation=isObject(input.confirmation)?input.confirmation:null;
  const confirmationState=text(confirmation?.state,32).toLowerCase();
  const decisionId=text(confirmation?.decisionId,160);
  const slaExpiresAt=confirmation?.slaExpiresAt==null?null:iso(confirmation.slaExpiresAt);
  const confirmedAt=confirmation?.confirmedAt==null?null:iso(confirmation.confirmedAt);
  const auditRef=text(confirmation?.auditRef,200);
  const slaExpired=confirmation?.slaExpired===true;
  if(!confirmation) errors.push('CONFIRMATION_CONTRACT_REQUIRED');
  else {
    if(!CONFIRMATION_STATES.includes(confirmationState)) errors.push('CONFIRMATION_STATE_INVALID');
    if(['decision_sent','confirming_source','needs_verification','resolved'].includes(confirmationState)&&!decisionId)
      errors.push('DECISION_ID_REQUIRED');
    if(['decision_sent','confirming_source','needs_verification'].includes(confirmationState)&&!slaExpiresAt)
      errors.push('CONFIRMATION_SLA_REQUIRED');
    if(confirmation?.slaExpiresAt!=null&&!slaExpiresAt) errors.push('CONFIRMATION_SLA_INVALID');
    if(confirmationState==='needs_verification'&&!slaExpired) errors.push('SOURCE_SLA_EXPIRY_REQUIRED');
    if(confirmationState==='confirming_source'&&slaExpired) errors.push('CONFIRMING_SOURCE_CANNOT_BE_EXPIRED');
    if(confirmationState==='resolved'&&(!confirmedAt||!auditRef)) errors.push('RESOLUTION_EVIDENCE_REQUIRED');
    if(confirmation?.confirmedAt!=null&&!confirmedAt) errors.push('CONFIRMED_AT_INVALID');
  }

  let consequence=null;
  if(input.consequence!=null){
    if(!isObject(input.consequence)||input.consequence.verified!==true||!text(input.consequence.summary,300))
      errors.push('VERIFIED_CONSEQUENCE_REQUIRED');
    else consequence=Object.freeze({summary:text(input.consequence.summary,300),verified:true,evidenceRef:text(input.consequence.evidenceRef,200)||null});
  }

  const alternatives=Array.isArray(input.alternatives)
    ? input.alternatives.map(v=>text(v,200)).filter(Boolean).slice(0,8).map(summary=>({summary}))
    : [];

  if(errors.length) return Object.freeze({ok:false,errors:Object.freeze([...new Set(errors)]),value:null});

  const value=Object.freeze({
    contractVersion:CONTRACT_VERSION,
    workflow,sourceId,reasonCode,observedAt,route,authorityRequired,
    title:text(input.title,200)||reasonCode,
    whyNow:text(input.whyNow,300)||'Review source workflow evidence.',
    recommendation:text(input.recommendation,240)||null,
    consequence,
    alternatives:freezeArray(alternatives),
    freshness:Object.freeze({
      state:freshnessState,
      policyRef:freshnessPolicyRef||null,
      validUntil
    }),
    confirmation:Object.freeze({
      state:confirmationState,
      decisionId:decisionId||null,
      slaExpiresAt,
      slaExpired,
      confirmedAt,
      auditRef:auditRef||null
    })
  });
  return Object.freeze({ok:true,errors:Object.freeze([]),value});
}

function acceptSourceActionEvidence(input){
  const result=validateSourceActionEvidence(input);
  return result.ok?result.value:null;
}

module.exports=Object.freeze({
  CONTRACT_VERSION,WORKFLOWS,FRESHNESS_STATES,CONFIRMATION_STATES,
  validateSourceActionEvidence,acceptSourceActionEvidence
});
