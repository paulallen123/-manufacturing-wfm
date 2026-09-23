'use strict';

const STAGES=Object.freeze([
  'SOURCE_APPROVAL','AUTHOR','REVIEW','MANIFEST','MEDIA_PLAN','NARRATE',
  'CAPTURE','COMPOSE','QUALITY','PUBLISH','MEASURE'
]);

function state(value){return String(value||'MISSING').toUpperCase();}
function planTrainingFactoryRun(input={}){
  const evidence=input.evidence||{};
  const highRisk=input.highRisk===true;
  const stages=[];
  function add(id,status,reason,tool,blocking=true){
    stages.push(Object.freeze({id,status,reason,tool,blocking}));
  }

  const sources=state(evidence.sources);
  add('SOURCE_APPROVAL',sources==='APPROVED'?'PASS':'BLOCKED',
    sources==='APPROVED'?'Approved source lineage is present.':'Approved, versioned source evidence is required.',
    'SOURCE_REGISTRY');

  const authoring=state(evidence.authoring);
  add('AUTHOR',sources==='APPROVED'?(authoring==='APPROVED'?'PASS':'READY'):'BLOCKED',
    sources==='APPROVED'?'Generate source-grounded training draft.':'Authoring cannot start without approved sources.',
    'AI_AUTHORING');

  const reviewed=!highRisk||state(evidence.humanReview)==='APPROVED';
  add('REVIEW',reviewed?'PASS':(authoring==='APPROVED'?'READY':'BLOCKED'),
    highRisk?'High-risk training requires explicit human approval.':'Standard-risk content can proceed through automated quality admission.',
    highRisk?'HUMAN_REVIEW':'POLICY_GATE');

  const manifest=state(evidence.manifest);
  add('MANIFEST',reviewed?(manifest==='READY'?'PASS':'READY'):'BLOCKED',
    'Bind content to role, permission class, locale, workflow revision and exact product identity.',
    'WORKFLOW_MANIFEST');

  const media=state(evidence.mediaPlan);
  add('MEDIA_PLAN',manifest==='READY'?(media==='READY'?'PASS':'READY'):'BLOCKED',
    'Create scenes, focus strategy, captions, transcript and narration plan.',
    'MEDIA_DIRECTOR');

  const narration=state(evidence.narration);
  add('NARRATE',media==='READY'?(narration==='READY'?'PASS':'READY'):'BLOCKED',
    'Generate timing-bound VECTOR Guide narration and validate content/privacy.',
    'VOICE_ENGINE');

  const capture=state(evidence.capture);
  add('CAPTURE',manifest==='READY'?(capture==='READY'?'PASS':'READY'):'BLOCKED',
    'Capture the exact verified VECTOR workflow using synthetic data.',
    'UI_CAPTURE');

  const compose=state(evidence.composition);
  add('COMPOSE',narration==='READY'&&capture==='READY'?(compose==='READY'?'PASS':'READY'):'BLOCKED',
    'Synchronise voice, scenes, overlays, captions and transcript.',
    'MEDIA_COMPOSER');

  const quality=state(evidence.quality);
  add('QUALITY',compose==='READY'?(quality==='PUBLISHABLE'?'PASS':'READY'):'BLOCKED',
    'Run pedagogy, source, accessibility, privacy, media and tutor evaluations.',
    'QUALITY_GATE');

  const published=state(evidence.publication);
  add('PUBLISH',quality==='PUBLISHABLE'?(published==='READY'?'PASS':'READY'):'BLOCKED',
    'Publish only durable exact-version artifacts after every admission gate passes.',
    'ARTIFACT_PUBLISHER');

  const measured=state(evidence.measurement);
  add('MEASURE',published==='READY'?(measured==='ACTIVE'?'PASS':'READY'):'BLOCKED',
    'Measure independent task success, retention, errors and assistance dependence.',
    'LEARNING_ANALYTICS',false);

  const blockers=stages.filter(x=>x.blocking&&x.status==='BLOCKED').map(x=>x.id);
  const next=stages.find(x=>x.status==='READY')||null;
  return Object.freeze({
    contractVersion:'VECTOR_TRAINING_FACTORY_PLAN_V1',
    stages:Object.freeze(stages),
    blockers:Object.freeze(blockers),
    next,
    publishable:blockers.length===0&&state(evidence.quality)==='PUBLISHABLE',
    tools:Object.freeze([...new Set(stages.map(x=>x.tool))]),
    autonomousBoundary:'Automation may generate and validate training, but cannot bypass source approval, high-risk review, exact-version proof or competence evidence.'
  });
}

module.exports=Object.freeze({STAGES,planTrainingFactoryRun});
