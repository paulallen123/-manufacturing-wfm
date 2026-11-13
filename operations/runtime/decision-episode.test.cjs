'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDecisionEpisode,selectDecisionOption,recordDecisionOutcome}=require('./decision-episode.cjs');

const base={
  tenant:'alpha',site:'tamworth',decisionType:'absence-recovery',triggerId:'absence:42',
  triggeredAt:'2026-09-22T08:00:00Z',contextRevision:'twin:abc',mode:'SHADOW',
  sourceEvidence:['absence:42','skills:line-4','plan:shift-a'],
  objective:{labourCost:0.25,planAttainmentPct:0.55,riskScore:0.2,uncertaintyPenalty:0.1},
  options:[
    {id:'do-nothing',label:'Accept loss',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.05,prediction:{labourCost:0,planAttainmentPct:82,riskScore:2},evidenceRefs:['sim:1']},
    {id:'redeploy',label:'Redeploy qualified operator',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.1,prediction:{labourCost:120,planAttainmentPct:98,riskScore:1},evidenceRefs:['sim:2']},
    {id:'unsafe',label:'Use unqualified operator',feasible:true,policyAllowed:false,hardConstraintsPassed:false,uncertainty:0.01,prediction:{labourCost:10,planAttainmentPct:100,riskScore:0},evidenceRefs:['sim:3']}
  ]
};

test('episode is deterministic regardless of option order',()=>{
  const a=createDecisionEpisode(base);
  const b=createDecisionEpisode({...base,options:[...base.options].reverse()});
  assert.equal(a.episodeId,b.episodeId);
  assert.equal(a.recommendation.optionId,'redeploy');
  assert.equal(a.recommendation.executionPermitted,false);
  assert.equal(a.recommendation.authorityRequired,'NO_EXECUTION');
});
test('hard constraint or policy violating option is never recommended',()=>{
  const e=createDecisionEpisode(base);
  assert.notEqual(e.recommendation.optionId,'unsafe');
});
test('do-nothing option is mandatory',()=>{
  assert.throws(()=>createDecisionEpisode({...base,options:base.options.filter(o=>o.id!=='do-nothing')}),/do-nothing/);
});
test('shadow mode cannot create execution authority',()=>{
  const e=createDecisionEpisode(base);
  assert.throws(()=>selectDecisionOption(e,{optionId:'redeploy',selectedAt:'2026-09-22T08:01:00Z',authorityDecision:'HUMAN_APPROVED'}),/Shadow mode/);
  const selected=selectDecisionOption(e,{optionId:'redeploy',selectedAt:'2026-09-22T08:01:00Z',authorityDecision:'SHADOW_OBSERVED'});
  assert.equal(selected.selection.executionPermitted,false);
});
test('outcome records predicted versus actual delta with evidence',()=>{
  const e=createDecisionEpisode({...base,mode:'HUMAN_APPROVAL'});
  const selected=selectDecisionOption(e,{optionId:'redeploy',selectedAt:'2026-09-22T08:02:00Z',authorityDecision:'HUMAN_APPROVED',actorRef:'manager:hash'});
  const final=recordDecisionOutcome(selected,{observedAt:'2026-09-22T16:00:00Z',evidenceRefs:['mes:shift-a','payroll:shift-a'],actual:{labourCost:125,planAttainmentPct:97.5,riskScore:1}});
  assert.equal(final.outcome.predictionError.labourCost,5);
  assert.equal(final.outcome.predictionError.planAttainmentPct,-0.5);
  assert.ok(final.outcomeDigest);
});

{
'use strict';
// Fictional in-memory helper fixtures only. References below are labels, not authentication.
const test = require('node:test');
const assert = require('node:assert/strict');
const {createDecisionEpisode, selectDecisionOption, recordDecisionOutcome} = require('./decision-episode.cjs');
const metrics = ['throughputUnits', 'planAttainmentPct', 'labourCost', 'delayMinutes', 'riskScore', 'energyCost', 'qualityRisk'];
function option(id, prediction) {
  return {id, feasible: true, policyAllowed: true, hardConstraintsPassed: true, uncertainty: 0, prediction};
}
function episode(options, objective = {throughputUnits: 1}) {
  const result = createDecisionEpisode({
    tenant: 'fictional-v084', site: 'fictional-site', decisionType: 'fixture-only',
    triggerId: 'fictional-trigger', contextRevision: 'fictional-revision', mode: 'SHADOW',
    triggeredAt: '2026-11-03T12:00:00Z', sourceEvidence: ['fictional:unverified-input'],
    objective, options
  });
  assert.equal(result.mode, 'SHADOW');
  assert.equal(result.recommendation.executionPermitted, false);
  assert.equal(result.recommendation.authorityRequired, 'NO_EXECUTION');
  return result;
}
function prediction(result, id) { return result.options.find(o => o.id === id).prediction; }
for (const [label, blank] of [['empty', ''], ['ASCII whitespace', ' \t\r\n '], ['NBSP', '\u00a0']]) {
  test('V084 heldout: ' + label + ' is missing for every prediction metric', () => {
    const result = episode([
      option('do-nothing', Object.fromEntries(metrics.map(key => [key, blank]))),
      option('complete', {throughputUnits: 5})
    ]);
    for (const key of metrics) assert.equal(prediction(result, 'do-nothing')[key], null, key);
  });
}
test('V084 heldout: missing positive-weight cost excludes option before range calculation', () => {
  const result = episode([
    option('do-nothing', {throughputUnits: 1000, labourCost: ' '}),
    option('complete-a', {throughputUnits: 10, labourCost: 20}),
    option('complete-b', {throughputUnits: 20, labourCost: 10})
  ], {throughputUnits: 1, labourCost: 1, uncertaintyPenalty: 0});
  assert.equal(result.recommendation.reason, 'RANKED');
  assert.deepEqual(result.recommendation.ranking.map(r => r.optionId), ['complete-b', 'complete-a']);
  assert.deepEqual(result.recommendation.ranking.map(r => r.score), [1, 0]);
  assert.equal(result.recommendation.optionId, 'complete-b');
});
test('V084 heldout: every eligible option incomplete yields missing-metrics reason', () => {
  const result = episode([
    option('do-nothing', {throughputUnits: '', labourCost: 3}),
    option('alternative', {throughputUnits: 8, labourCost: '\t'})
  ], {throughputUnits: 1, labourCost: 1});
  assert.equal(result.recommendation.reason, 'MISSING_WEIGHTED_METRICS');
  assert.equal(result.recommendation.optionId, null);
  assert.deepEqual(result.recommendation.ranking, []);
});
test('V084 heldout: missing zero-weight metric permits ranking', () => {
  const result = episode([
    option('do-nothing', {throughputUnits: 0, labourCost: '\u00a0'}),
    option('alternative', {throughputUnits: 8, labourCost: ''})
  ], {throughputUnits: 1, labourCost: 0, uncertaintyPenalty: 0});
  assert.equal(prediction(result, 'do-nothing').labourCost, null);
  assert.equal(prediction(result, 'alternative').labourCost, null);
  assert.equal(result.recommendation.reason, 'RANKED');
  assert.equal(result.recommendation.ranking.length, 2);
  assert.equal(result.recommendation.optionId, 'alternative');
});
test('V084 heldout: numeric zero and nonblank numeric strings remain numbers', () => {
  const values = {throughputUnits: 0, planAttainmentPct: '0', labourCost: ' 37 ',
    delayMinutes: '1e2', riskScore: '-2.5', energyCost: 0, qualityRisk: '0.25'};
  const result = episode([option('do-nothing', values), option('alternative', {throughputUnits: 1})]);
  assert.deepEqual(prediction(result, 'do-nothing'), {
    throughputUnits: 0, planAttainmentPct: 0, labourCost: 37,
    delayMinutes: 100, riskScore: -2.5, energyCost: 0, qualityRisk: 0.25
  });
  assert.equal(result.recommendation.ranking.length, 2);
});
test('V084 heldout: fictional SHADOW outcome keeps missing prediction error null', () => {
  const result = episode([
    option('do-nothing', {throughputUnits: 0, labourCost: ' '}),
    option('alternative', {throughputUnits: 8, labourCost: 12})
  ]);
  const selected = selectDecisionOption(result, {
    optionId: 'do-nothing', selectedAt: '2026-11-03T12:01:00Z',
    authorityDecision: 'SHADOW_OBSERVED', actorRef: 'fictional:unauthenticated-observer'
  });
  assert.equal(selected.selection.executionPermitted, false);
  const recorded = recordDecisionOutcome(selected, {
    observedAt: '2026-11-03T12:02:00Z', evidenceRefs: ['fictional:unverified-outcome'],
    actual: {throughputUnits: 0, labourCost: 14}
  });
  assert.equal(recorded.outcome.actual.labourCost, 14);
  assert.equal(recorded.outcome.predictionError.labourCost, null);
  assert.equal(recorded.outcome.predictionError.throughputUnits, 0);
  assert.equal(recorded.selection.executionPermitted, false);
  assert.equal(recorded.recommendation.executionPermitted, false);
});
}
