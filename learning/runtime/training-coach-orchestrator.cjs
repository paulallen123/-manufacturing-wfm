'use strict';

const INTERVENTIONS=Object.freeze(['NONE','NUDGE','HINT','WORKED_EXAMPLE','GUIDED_PRACTICE','SIMULATION','INDEPENDENT_TEST','RETENTION_REFRESH']);

function clamp(v,min,max){return Math.max(min,Math.min(max,Number(v)||0));}

function planCoachIntervention(input={}){
  const item=input.competency||{};
  const context=input.context||{};
  const preferences=input.preferences||{};
  const intent=String(input.intent||'LEARN').toUpperCase();
  const score=clamp(item.score,0,100);
  const recentHelp=Math.max(0,Number(item.recentHelp||0));
  const status=String(item.status||'DUE').toUpperCase();
  const due=Boolean(input.reviewDue)||status==='REFRESH_DUE';
  const realTask=Boolean(context.realTaskAvailable);
  const simulation=Boolean(context.simulationAvailable);
  const voiceAvailable=Boolean(context.voiceAvailable);
  const videoAvailable=Boolean(context.videoAvailable);

  let intervention='GUIDED_PRACTICE';
  let reason='BUILD_COMPETENCE';
  if(status==='MASTERED'&&!due&&recentHelp<3){intervention='NONE';reason='NO_UNNECESSARY_TRAINING';}
  else if(due&&score>=80){intervention='RETENTION_REFRESH';reason='SPACED_RETRIEVAL_DUE';}
  else if(intent==='TEST'||preferences.skipExplanation===true||score>=80){intervention='INDEPENDENT_TEST';reason='PROVE_EXISTING_COMPETENCE';}
  else if(score<=0&&videoAvailable){intervention='WORKED_EXAMPLE';reason='NOVICE_NEEDS_MODEL';}
  else if(recentHelp>=3){intervention=simulation?'SIMULATION':'GUIDED_PRACTICE';reason='REPEATED_HELP_SIGNAL';}
  else if(score<55){intervention=simulation?'SIMULATION':'GUIDED_PRACTICE';reason='LOW_MASTERY_EVIDENCE';}
  else if(score<80){intervention=realTask?'INDEPENDENT_TEST':(simulation?'SIMULATION':'GUIDED_PRACTICE');reason='TRANSFER_TO_PERFORMANCE';}

  const modality=intervention==='NONE'?'NONE':
    intervention==='SIMULATION'?'SIMULATION':
    intervention==='WORKED_EXAMPLE'&&videoAvailable?'VIDEO':
    voiceAvailable?'VOICE_AND_TEXT':'TEXT';

  return Object.freeze({
    contractVersion:'VECTOR_TRAINING_COACH_PLAN_V1',
    intervention,
    modality,
    reason,
    hintFirst:intervention!=='INDEPENDENT_TEST',
    directAnswerDefault:false,
    masteryCanBeAwarded:['INDEPENDENT_TEST'].includes(intervention)&&realTask,
    assistanceCeiling:intervention==='INDEPENDENT_TEST'?0:(intervention==='HINT'?1:3),
    nextAction:intervention==='NONE'?'Continue normal work':'Present only the minimum support needed, then return the learner to an independent attempt.',
    allowedInterventions:INTERVENTIONS
  });
}

module.exports=Object.freeze({INTERVENTIONS,planCoachIntervention});
