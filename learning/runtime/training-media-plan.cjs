'use strict';

const { createNarrationJob, DEFAULT_PROFILE } = require('./training-voice-contract.cjs');

const MEDIA_PLAN_VERSION='VECTOR_TRAINING_MEDIA_PLAN_V1';

function clean(v,max=1200){return String(v??'').trim().slice(0,max);}
function createTrainingMediaPlan(module,input={}){
  if(!module||module.contractVersion!=='VECTOR_TRAINING_WORKFLOW_MANIFEST_V1') throw new Error('Verified training module is required.');
  if(module.mode!=='SHOW_ME') throw new Error('Media plans are generated from SHOW_ME modules.');
  const voiceProfile={...DEFAULT_PROFILE,...(input.voiceProfile||{}),locale:module.locale};
  const scenes=[];
  scenes.push({id:'intro',type:'INTRO',title:module.title,narration:'In this short VECTOR guide, you will learn '+module.title.toLowerCase()+'. Watch the workflow, then practise it yourself.',holdMs:1800});
  for(const step of module.steps){
    scenes.push({
      id:step.id,
      type:'WORKFLOW_STEP',
      title:clean(step.title,200),
      instruction:clean(step.instruction,1000),
      narration:clean(step.title+'. '+step.instruction,1400),
      holdMs:Math.max(2800,Math.min(9000,2600+clean(step.instruction,1000).length*18)),
      calloutStrategy:'FOCUS_SAFE_SELECTOR_OR_OVERLAY'
    });
  }
  scenes.push({id:'recap',type:'RECAP',title:'Now do it yourself',narration:'Now complete the task in VECTOR without guidance. Watching this guide does not prove competence.',holdMs:2200});
  const segments=scenes.map(scene=>({id:scene.id,text:scene.narration,pauseAfterMs:scene.type==='WORKFLOW_STEP'?450:650}));
  const narrationJob=createNarrationJob({
    artifactFingerprint:module.artifactFingerprint,
    productSha:input.productSha||module.productSha||input.releaseSha,
    voiceProfile,
    segments
  });
  return Object.freeze({
    contractVersion:MEDIA_PLAN_VERSION,
    artifactFingerprint:module.artifactFingerprint,
    competencyKey:module.competencyKey,
    locale:module.locale,
    resolution:Object.freeze({width:1920,height:1080,fps:30}),
    audio:Object.freeze({sampleRateHz:48000,loudnessLufs:-16,truePeakDb:-1,stereo:false}),
    captions:Object.freeze({required:true,format:'webvtt',safeAreaPct:8,burnIn:false}),
    motion:Object.freeze({reducedMotionCompatible:true,zoom:'selector-bounded',transitions:'short-crossfade'}),
    scenes:Object.freeze(scenes),
    narrationJob,
    learningBoundary:'Passive media never awards mastery. Independent observed performance is required.'
  });
}

module.exports=Object.freeze({MEDIA_PLAN_VERSION,createTrainingMediaPlan});
