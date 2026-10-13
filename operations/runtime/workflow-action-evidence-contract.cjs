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
function firstObject(...values){
  return values.find(isObject)||null;
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
    if(freshnessState==='current'&&observedAt&&validUntil&&Date.parse(validUntil)<=Date.parse(observedAt))
      errors.push('CURRENT_VALIDITY_BEFORE_OBSERVATION');
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

/*
 * First authoritative producer: Time Review open exceptions.
 *
 * This is intentionally fail-closed. It emits only records already present in the
 * source report with a stable source id, structured reason, observation timestamp,
 * explicit authority and an explicitly admitted team scope. It does not invent a
 * freshness SLA: when the source supplies no freshness contract the producer emits
 * `unknown`. The only inferred confirmation state is `action_required`, and only
 * from the source workflow's structured `status: open` state. Later lifecycle
 * states are unavailable: the sealed source has no bound decision/SLA/audit
 * confirmation protocol. The generic validator retains its formal lifecycle
 * for future independently reviewed source adapters.
 */
function trustedEnvelopeFreshness(observedAt,envelope){
  if(!isObject(envelope))return null;
  const asOf=iso(envelope.asOf),timeZone=text(envelope.timeZone,120),maxAgeMs=Number(envelope.maxAgeMs);
  if(!asOf||!timeZone||!Number.isFinite(maxAgeMs)||maxAgeMs<=0)return null;
  try{new Intl.DateTimeFormat('en-GB',{timeZone}).format(new Date(asOf));}catch{return null;}
  const observed=Date.parse(observedAt),current=Date.parse(asOf);
  if(!Number.isFinite(observed)||!Number.isFinite(current)||observed>current+30000)return null;
  const stale=current-observed>maxAgeMs;
  return Object.freeze({
    state:stale?'stale':'current',
    policyRef:'server-authoritative-tenant-calendar',
    validUntil:stale?null:new Date(observed+maxAgeMs).toISOString()
  });
}

function produceTimeReviewActionEvidence(report,{allowedTeamIds=[],freshnessEnvelope=null}={}){
  if(!isObject(report)) return Object.freeze([]);
  const allowed=new Set((Array.isArray(allowedTeamIds)?allowedTeamIds:[])
    .map(value=>text(value,160)).filter(Boolean));
  if(!allowed.size) return Object.freeze([]);

  const rows=[];
  const teams=Array.isArray(report.teams)?report.teams:[];
  for(const team of teams){
    if(!isObject(team)) continue;
    const teamId=text(team.id??team.teamId,160);
    if(!teamId||!allowed.has(teamId)) continue;
    const issues=Array.isArray(team.issues)?team.issues:[];
    for(const issue of issues){
      if(!isObject(issue)||text(issue.status,32).toLowerCase()!=='open') continue;
      const sourceId=text(issue.sourceId??issue.id,160);
      const issueType=text(issue.type,48).toLowerCase();
      const legacyAdjustmentShape=issueType==='adjustment'
        && text(issue.row,160)
        && text(issue.sourceFingerprint,240)
        && isObject(issue.proposed);
      const reasonCode=structuredReason(issue.reasonCode)
        || (legacyAdjustmentShape ? 'TIME_REVIEW_ADJUSTMENT' : '');
      const observedAt=iso(issue.observedAt)||iso(team.observedAt)||iso(report.observedAt)||iso(report.generatedAt);
      const authorityRequired=text(issue.authorityRequired??team.authorityRequired??report.authorityRequired,160);
      if(!sourceId||!reasonCode||!observedAt||!authorityRequired) continue;

      // Freshness is owned by the server envelope, never by issue/team/report input.
      const envelopeFreshness=trustedEnvelopeFreshness(observedAt,freshnessEnvelope);
      if(!envelopeFreshness) continue;
      // The current sealed source does not emit later confirmation states.
      // A request/click carrying formal contract fields is not source audit.
      if(issue.confirmation!=null&&(!isObject(issue.confirmation)||issue.confirmation.state!=='action_required'))continue;
      if((issue.workflow!=null&&issue.workflow!=='time-review')
        ||(issue.sourceId!=null&&issue.id!=null&&issue.sourceId!==issue.id))continue;
      const accepted=acceptSourceActionEvidence({
        workflow:'time-review',
        sourceId,
        reasonCode,
        observedAt,
        route:'time-review',
        authorityRequired,
        title:issue.title??issue.message,
        whyNow:issue.whyNow,
        recommendation:issue.recommendation,
        consequence:issue.consequence,
        alternatives:issue.alternatives,
        freshness:envelopeFreshness,
        confirmation:{state:'action_required'}
      });
      if(accepted) rows.push(accepted);
    }
  }
  return Object.freeze(rows);
}

// These adapters consume the sealed source shapes, not a presentation-owned
// confirmation extension. Absence currently cannot supply a request-bound audit
// or observation for pending requests. An unavailable record is NOT an action.
function sourceId(value){
  return typeof value==='string'&&value.length>0&&value.length<=160&&value===value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value)?value:'';
}
function sourceIso(value){
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)?iso(value):null;
}
function sourceReportMatches(report,workflow,{tenant,period}={}){
  return isObject(report)&&report.partial!==true&&report.complete!==false
    && (report.workflow==null||report.workflow===workflow)
    && (report.tenant==null||report.tenant===tenant)
    && (report.tenantId==null||report.tenantId===tenant)
    && (period==null||report.period===period);
}
function bindingFor(workflow,scope,teamId,id,period=null){
  return Object.freeze({workflow,tenant:scope.tenant,teamId,period,sourceId:id});
}
function unavailable(binding,missingFields){
  return Object.freeze({binding,reasonCode:'SOURCE_EVIDENCE_UNAVAILABLE',
    freshness:Object.freeze({state:'unknown',policyRef:null,validUntil:null}),
    missingFields:Object.freeze(missingFields)});
}
function production(items=[],missing=[]){
  return Object.freeze({items:Object.freeze(items),unavailable:Object.freeze(missing)});
}
function scopedTeams(scope){
  return sourceId(scope.tenant)&&sourceId(scope.personId)&&['manager','director','supervisor'].includes(scope.role)
    ? new Set((Array.isArray(scope.allowedTeamIds)?scope.allowedTeamIds:[]).filter(sourceId)):new Set();
}
function uniqueIds(rows){
  const ids=rows.map(row=>sourceId(row?.id));
  return ids.every(Boolean)&&new Set(ids).size===ids.length;
}
function produceAbsenceActionEvidence(report,scope={}){
  const allowed=scopedTeams(scope),state=report?.state;
  if(!allowed.size||!sourceReportMatches(report,'absence',{tenant:scope.tenant})||!isObject(state)
    ||!Array.isArray(state.requests)||!Array.isArray(state.staff)||!uniqueIds(state.requests)||!uniqueIds(state.staff))return production();
  const missing=[];
  for(const request of state.requests){
    const person=state.staff.find(row=>row.id===request.employee),teamId=sourceId(person?.manager);
    if(!allowed.has(teamId)||request.employee===scope.personId
      ||!sourceReportMatches(request,'absence',{tenant:scope.tenant})
      ||(request.teamId!=null&&request.teamId!==teamId))continue;
    const fields=['decisionId','confirmationSla','requestBoundAudit'];
    // date/start/end describe leave, never the time the source observed a request.
    if(request.status==='pending')fields.unshift('observedAt');
    else if(!sourceIso(request.reviewedAt))fields.unshift('observedAt');
    if(!['pending','approved','declined'].includes(request.status))fields.push('supportedStatus');
    missing.push(unavailable(bindingFor('absence',scope,teamId,request.id),fields));
  }
  // A sick flag and a clock-only reportedAt are not an absence episode identifier.
  for(const person of state.staff){
    if(person.sick===true&&allowed.has(person.manager))missing.push(unavailable(
      bindingFor('absence',scope,person.manager,null),['sourceId','observedAt','decisionId','confirmationSla','requestBoundAudit']));
  }
  return production([],missing);
}
function produceWeeklySignoffActionEvidence(report,scope={}){
  const allowed=scopedTeams(scope);
  if(!allowed.size||!sourceId(scope.period)||!sourceReportMatches(report,'weekly-signoff',scope)
    ||!Array.isArray(report.teams)||!uniqueIds(report.teams))return production();
  const items=[],missing=[],audit=Array.isArray(report.audit)?report.audit:[];
  for(const team of report.teams){
    if(!allowed.has(team.id)||team.period!==scope.period
      ||(team.sourceId!=null&&team.sourceId!==team.id)||(team.teamId!=null&&team.teamId!==team.id)
      ||!sourceReportMatches(team,'weekly-signoff',scope))continue;
    const binding=bindingFor('weekly-signoff',scope,team.id,team.id,scope.period);
    if(!Number.isSafeInteger(team.revision)||team.revision<0){missing.push(unavailable(binding,['sourceRevision']));continue;}
    const events=audit.filter(event=>sourceReportMatches(event,'weekly-signoff',scope)
      &&(event.sourceId==null||event.sourceId===team.id)&&sourceId(event.id)&&event.period===scope.period
      &&(event.teamId==null||event.teamId===team.id)
      &&event.team===team.id&&event.revision===team.revision&&sourceId(event.actor)&&sourceIso(event.at));
    let observedAt,confirmation,reasonCode;
    if(team.status==='signed'){
      const signature=team.signature;
      const matching=events.filter(event=>event.type==='team-signed'&&event.actor===signature?.by
        &&sourceIso(signature?.at)&&Date.parse(event.at)>=Date.parse(signature.at));
      const event=matching.length===1?matching[0]:null;
      if(!event||!sourceReportMatches(signature,'weekly-signoff',{tenant:scope.tenant})
        ||(signature.period!=null&&signature.period!==scope.period)||(signature.team!=null&&signature.team!==team.id)
        ||(signature.teamId!=null&&signature.teamId!==team.id)
        ||(signature.sourceId!=null&&signature.sourceId!==team.id)||signature.revision!==team.revision||team.canSign===true
        ||audit.filter(row=>row?.id===event.id).length!==1){
        missing.push(unavailable(binding,['matchingSignatureAndAudit']));continue;
      }
      const signatureFreshness=trustedEnvelopeFreshness(sourceIso(signature.at),scope.freshnessEnvelope);
      const auditFreshness=trustedEnvelopeFreshness(sourceIso(event.at),scope.freshnessEnvelope);
      if(!signatureFreshness||!auditFreshness||signatureFreshness.state!==auditFreshness.state){
        missing.push(unavailable(binding,['coherentSignatureObservation']));continue;
      }
      // Use the signing observation, never a newer unrelated audit timestamp to
      // refresh it. Matching durable historical evidence remains signed + stale;
      // no new transaction duration or business confirmation SLA is invented.
      observedAt=sourceIso(signature.at);
      // pa-* is the persisted identifier of this exact team-signing decision,
      // not a generated request ID or a signature inferred from a click.
      confirmation={state:'resolved',decisionId:event.id,confirmedAt:sourceIso(signature.at),auditRef:event.id};
      reasonCode='WEEKLY_SIGNOFF_CONFIRMED';
    }else if(['draft','returned'].includes(team.status)&&!team.signature){
      if(!Array.isArray(team.employees)||!uniqueIds(team.employees)||team.employees.some(person=>person?.id===scope.personId)){
        missing.push(unavailable(binding,['independentReviewer']));continue;
      }
      const observations=events.filter(event=>['review-data-changed','category-checked','employee-total-checked'].includes(event.type));
      observedAt=observations.map(event=>sourceIso(event.at)).sort().at(-1);
      if(!observedAt){missing.push(unavailable(binding,['observedAt']));continue;}
      confirmation={state:'action_required'};reasonCode='WEEKLY_SIGNOFF_REQUIRED';
    }else{missing.push(unavailable(binding,['currentRevisionObservation','sourceConfirmation']));continue;}
    const freshness=trustedEnvelopeFreshness(observedAt,scope.freshnessEnvelope);
    if(!freshness){
      missing.push(unavailable(binding,['currentObservation']));continue;
    }
    const accepted=acceptSourceActionEvidence({workflow:'weekly-signoff',sourceId:team.id,reasonCode,observedAt,
      route:'weekly-signoff',authorityRequired:'Operational manager in the reporting branch (payroll-control.reviewer)',
      title:'Weekly sign-off',whyNow:'Review the source team and period evidence.',freshness,confirmation});
    if(accepted)items.push(Object.freeze({...accepted,binding,sourceRevision:team.revision,
      authority:Object.freeze({rule:'payroll-control.reviewer',role:scope.role,personId:scope.personId})}));
  }
  return production(items,missing);
}

module.exports=Object.freeze({
  CONTRACT_VERSION,WORKFLOWS,FRESHNESS_STATES,CONFIRMATION_STATES,
  validateSourceActionEvidence,acceptSourceActionEvidence,produceTimeReviewActionEvidence,
  produceAbsenceActionEvidence,produceWeeklySignoffActionEvidence,sourceReportMatches
});
