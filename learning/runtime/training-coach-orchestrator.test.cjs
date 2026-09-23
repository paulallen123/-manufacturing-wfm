'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planCoachIntervention}=require('./training-coach-orchestrator.cjs');

test('mastered users are left alone until retention is due',()=>{
  const plan=planCoachIntervention({competency:{status:'MASTERED',score:92,recentHelp:0},context:{voiceAvailable:true,videoAvailable:true}});
  assert.equal(plan.intervention,'NONE');
});
test('novices get a worked example when verified video exists',()=>{
  const plan=planCoachIntervention({competency:{status:'DUE',score:0},context:{videoAvailable:true,voiceAvailable:true}});
  assert.equal(plan.intervention,'WORKED_EXAMPLE');
  assert.equal(plan.modality,'VIDEO');
});
test('training never awards mastery from guided support',()=>{
  const plan=planCoachIntervention({competency:{status:'DUE',score:40,recentHelp:4},context:{simulationAvailable:true,realTaskAvailable:true}});
  assert.equal(plan.intervention,'SIMULATION');
  assert.equal(plan.masteryCanBeAwarded,false);
});
