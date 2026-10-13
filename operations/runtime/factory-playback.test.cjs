'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createFactoryPlayback,digest}=require('./factory-playback.cjs');
const {createDecisionOutcomeProof}=require('./decision-outcome-proof.cjs');

const episode={
  contractVersion:'VECTOR_DECISION_EPISODE_V1',episodeId:'ep-1',tenant:'alpha',site:'tamworth',decisionType:'absence-recovery',triggerId:'absence-9',triggeredAt:'2026-09-23T04:42:00Z',sourceEvidence:['absence:9'],recommendation:{optionId:'redeploy'},
  selection:{optionId:'redeploy',selectedAt:'2026-09-23T04:47:00Z',actorRef:'manager:1',authorityDecision:'HUMAN_APPROVED',executionPermitted:true},
  outcome:{observedAt:'2026-09-23T08:30:00Z',evidenceRefs:['output:line4'],notes:'Recovered'}
};

test('playback composes decision and realtime evidence chronologically',()=>{
  const playback=createFactoryPlayback({episode,realtimeEvents:[
    {topic:'schedule.updated',createdAt:'2026-09-23T04:48:00Z',payload:{tenant:'alpha',site:'tamworth',summary:'Schedule updated',sourceRef:'schedule:88'}},
    {topic:'integration.verified',createdAt:'2026-09-23T04:49:00Z',payload:{tenant:'alpha',site:'tamworth',summary:'Downstream confirmation',sourceRef:'erp:ack:4'}}
  ]});
  assert.equal(playback.readOnly,true);
  assert.equal(playback.executionPermitted,false);
  assert.equal(playback.timeline[0].kind,'DECISION_TRIGGERED');
  assert.ok(playback.timeline.some(x=>x.topic==='schedule.updated'));
  assert.ok(playback.timeline.some(x=>x.topic==='integration.verified'));
  assert.equal(playback.timeline.at(-1).kind,'OUTCOME_OBSERVED');
});

test('cross-tenant realtime event is excluded',()=>{
  const playback=createFactoryPlayback({episode,realtimeEvents:[{topic:'x',createdAt:'2026-09-23T04:50:00Z',payload:{tenant:'beta',summary:'Wrong tenant'}}]});
  assert.equal(playback.timeline.some(x=>x.title==='Wrong tenant'),false);
});

function sealedProof(overrides={}){
  const core={schemaVersion:1,recordType:'vector-decision-outcome-proof',classification:'REALISED_FINANCIAL',
    tenant:'alpha',site:'tamworth',episodeId:'ep-1',decisionType:'absence-recovery',selectedOptionId:'redeploy',
    metric:'labourCost',observed:{result:100},verifiedOperationalOutcome:true,realisedFinancialOutcome:true,
    evidence:{baseline:['payroll:before'],result:['payroll:after'],finance:['finance:1']},
    measurementWindow:{start:'2026-09-23T04:42:00Z',end:'2026-09-23T08:30:00Z'},...overrides};
  return {...core,proofDigest:digest(core)};
}

test('sealed same-site outcome proof appears once as verified value',()=>{
  const completed={...episode,options:[
    {id:'do-nothing',prediction:{labourCost:500}},
    {id:'redeploy',prediction:{labourCost:300}}],
    outcome:{...episode.outcome,actual:{labourCost:250}}};
  const proof=createDecisionOutcomeProof({episode:completed,metric:'labourCost',direction:'MINIMIZE',
    classification:'REALISED_FINANCIAL',baselineActual:500,baselineEvidenceRefs:['payroll:before'],
    financeEvidenceRefs:['finance:1'],currency:'GBP',measurementWindow:{start:'2026-09-23T04:42:00Z',end:'2026-09-23T08:30:00Z'}});
  const playback=createFactoryPlayback({episode:completed,outcomeProofs:[proof]});
  assert.equal(playback.timeline.filter(x=>x.kind==='FINANCIAL_VALUE_VERIFIED').length,1);
  assert.equal(playback.executionPermitted,false);
});

test('forged, altered, wrong-site and wrong-option proofs cannot claim verified value',()=>{
  const proof=sealedProof();
  const cases=[{...proof,realisedFinancialOutcome:false},
    {...proof,metric:'energyCost'},sealedProof({site:'another-site'}),sealedProof({selectedOptionId:'do-nothing'}),
    {recordType:'vector-decision-outcome-proof',tenant:'alpha',site:'tamworth',episodeId:'ep-1',realisedFinancialOutcome:true}];
  for(const candidate of cases){
    const playback=createFactoryPlayback({episode,outcomeProofs:[candidate]});
    assert.equal(playback.timeline.some(x=>x.kind==='FINANCIAL_VALUE_VERIFIED'),false);
  }
});
