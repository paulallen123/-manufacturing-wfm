'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createFactoryPlayback}=require('./factory-playback.cjs');

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
