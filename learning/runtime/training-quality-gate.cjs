'use strict';

function bool(v){return v===true;}
function num(v){return Number.isFinite(Number(v))?Number(v):0;}

function evaluateTrainingQuality(input={}){
  const module=input.module||{};
  const authoring=input.authoring||{};
  const media=input.media||{};
  const voice=input.voice||{};
  const tutor=input.tutor||{};
  const gates={
    exactProductBound:Boolean(module.artifactFingerprint)&&module.artifactPublishable===true,
    noPassiveMastery:module.exposureOnly!==false||module.evidencePolicy==='OBSERVED_INDEPENDENT_TASK_REQUIRED'||module.evidencePolicy==='NO_MASTERY_FROM_DELIVERY',
    sourceGrounded:['APPROVED','NOT_REQUIRED'].includes(String(authoring.state||'NOT_REQUIRED')),
    retrievalPractice:num(authoring.retrievalItems||input.retrievalItems)>=1,
    independentTask:bool(authoring.independentTask||input.independentTask),
    explanatoryFeedback:bool(authoring.explanatoryFeedback||input.explanatoryFeedback),
    captions:bool(media.captionsAvailable),
    transcript:bool(media.transcriptAvailable),
    narrated:String(voice.state||media.narrationState)==='READY',
    privacySafe:media.privacySafe!==false,
    secretSafe:media.secretSafe!==false,
    tutorGrounded:tutor.enabled!==true||num(tutor.groundedRate)>=0.98,
    tutorHintFirst:tutor.enabled!==true||num(tutor.directAnswerLeakRate)<=0.02,
    tutorEscalation:tutor.enabled!==true||num(tutor.escalationAccuracy)>=0.95
  };
  const blockers=Object.entries(gates).filter(([,passed])=>!passed).map(([name])=>name);
  const mediaReady=gates.captions&&gates.transcript&&gates.narrated&&gates.privacySafe&&gates.secretSafe;
  const pedagogyReady=gates.sourceGrounded&&gates.retrievalPractice&&gates.independentTask&&gates.explanatoryFeedback&&gates.noPassiveMastery;
  const tutorReady=gates.tutorGrounded&&gates.tutorHintFirst&&gates.tutorEscalation;
  const publishable=gates.exactProductBound&&mediaReady&&pedagogyReady&&tutorReady;
  const state=publishable?'PUBLISHABLE':(gates.exactProductBound&&gates.privacySafe&&gates.secretSafe?'PROOF_ONLY':'BLOCKED');
  return Object.freeze({contractVersion:'VECTOR_TRAINING_QUALITY_GATE_V1',state,publishable,gates:Object.freeze(gates),blockers:Object.freeze(blockers)});
}

module.exports=Object.freeze({evaluateTrainingQuality});
