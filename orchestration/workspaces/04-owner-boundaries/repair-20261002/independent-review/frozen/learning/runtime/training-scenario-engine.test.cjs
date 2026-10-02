'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {scenarioFor,evaluateScenarioAnswer}=require('./training-scenario-engine.cjs');
test('practice scenario reuses Shadow Decision Episode and cannot execute',()=>{
  const s=scenarioFor('schedule.recover',{role:'manager'});
  assert.equal(s.episode.mode,'SHADOW');
  assert.equal(s.episode.recommendation.executionPermitted,false);
  assert.ok(s.episode.options.some(x=>x.id==='do-nothing'));
  assert.equal(s.episode.recommendation.optionId,null);
});
test('scenario answer gives feedback but never awards mastery',()=>{
  const s=scenarioFor('schedule.recover',{role:'manager',revealRecommendation:true});
  const r=evaluateScenarioAnswer('schedule.recover',s.episode.recommendation.optionId,{role:'manager'});
  assert.equal(r.practiceOnly,true);assert.equal(r.masteryAwarded,false);assert.equal(r.matchedRecommendation,true);
});
