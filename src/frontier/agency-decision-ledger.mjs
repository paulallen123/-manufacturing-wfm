import crypto from 'node:crypto';

export const AGENCY_DECISION_LEDGER_VERSION='agency-decision-ledger-v0.1.0';

const stable=value=>Array.isArray(value)
  ? value.map(stable)
  : value&&typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]))
    : value;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

function decisionCore(input={}){
  return {
    version:AGENCY_DECISION_LEDGER_VERSION,
    tenantId:input.tenantId??null,
    decisionId:input.decisionId??null,
    decidedAt:input.decidedAt??null,
    context:structuredClone(input.context??{}),
    alternatives:structuredClone(input.alternatives??[]),
    selectedAlternativeId:input.selectedAlternativeId??null,
    evidence:structuredClone(input.evidence??{}),
    policy:structuredClone(input.policy??{}),
    modelVersions:structuredClone(input.modelVersions??{}),
    approval:structuredClone(input.approval??{}),
  };
}

export function createAgencyDecisionRecord(input={}){
  if(typeof input.tenantId!=='string'||!input.tenantId) throw new TypeError('tenantId is required');
  if(typeof input.decisionId!=='string'||!input.decisionId) throw new TypeError('decisionId is required');
  if(!Array.isArray(input.alternatives)||!input.alternatives.length) throw new TypeError('alternatives are required');
  if(typeof input.selectedAlternativeId!=='string'||!input.selectedAlternativeId) throw new TypeError('selectedAlternativeId is required');
  if(!input.alternatives.some(a=>a&&a.id===input.selectedAlternativeId)) throw new TypeError('selected alternative must exist');

  const core=decisionCore(input);
  const record={
    ...core,
    decisionHash:hash(core),
    outcome:null,
    outcomeHash:null,
    auditBoundary:'decision_evidence_is_append_only_outcome_is_recorded_separately',
  };
  return record;
}

export function verifyAgencyDecisionRecord(record={}){
  const core=decisionCore(record);
  const expected=hash(core);
  return {
    valid:typeof record.decisionHash==='string'&&record.decisionHash===expected,
    expectedDecisionHash:expected,
    actualDecisionHash:record.decisionHash??null,
    outcomeHashValid:record.outcome===null
      ? record.outcomeHash===null
      : record.outcomeHash===hash({decisionHash:record.decisionHash,outcome:record.outcome}),
  };
}

export function appendAgencyDecisionOutcome(record,outcome={}){
  const check=verifyAgencyDecisionRecord(record);
  if(!check.valid) throw new Error('decision_record_integrity_failed');
  if(record.outcome!==null) throw new Error('decision_outcome_already_recorded');

  const next=structuredClone(record);
  next.outcome={
    recordedAt:outcome.recordedAt??null,
    attendance:structuredClone(outcome.attendance??{}),
    production:structuredClone(outcome.production??{}),
    quality:structuredClone(outcome.quality??{}),
    safety:structuredClone(outcome.safety??{}),
    labourCost:structuredClone(outcome.labourCost??{}),
    invoice:structuredClone(outcome.invoice??{}),
    managerInterventionMinutes:Number.isFinite(Number(outcome.managerInterventionMinutes))?Number(outcome.managerInterventionMinutes):null,
    realisedValue:Number.isFinite(Number(outcome.realisedValue))?Number(outcome.realisedValue):null,
    attributionQuality:outcome.attributionQuality??'unrated',
    notes:outcome.notes??null,
  };
  next.outcomeHash=hash({decisionHash:next.decisionHash,outcome:next.outcome});
  return next;
}
