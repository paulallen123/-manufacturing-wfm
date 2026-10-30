'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDecisionEpisode,selectDecisionOption,recordDecisionOutcome}=require('./decision-episode.cjs');
const {createDecisionOutcomeProof,toAdaptiveOutcomeInput}=require('./decision-outcome-proof.cjs');

function completed(metric='planAttainmentPct',labourCost=320){
  const episode=createDecisionEpisode({
    tenant:'alpha',site:'tamworth',decisionType:'absence-recovery',triggerId:'absence:42',
    triggeredAt:'2026-09-22T08:00:00Z',contextRevision:'twin:abc',mode:'HUMAN_APPROVAL',
    sourceEvidence:['absence:42','skills:line-4','plan:a'],
    objective:{labourCost:.25,planAttainmentPct:.55,riskScore:.2,uncertaintyPenalty:.1},
    options:[
      {id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.05,prediction:{labourCost:500,planAttainmentPct:80,riskScore:2},evidenceRefs:['sim:a']},
      {id:'redeploy',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.1,prediction:{labourCost:300,planAttainmentPct:98,riskScore:1},evidenceRefs:['sim:b']}
    ]
  });
  const selected=selectDecisionOption(episode,{optionId:'redeploy',selectedAt:'2026-09-22T08:05:00Z',actorRef:'manager:1',authorityDecision:'HUMAN_APPROVED'});
  const actual={labourCost,planAttainmentPct:97,riskScore:1};
  return recordDecisionOutcome(selected,{observedAt:'2026-09-22T16:00:00Z',evidenceRefs:['mes:shift:a','payroll:shift:a'],actual});
}

test('simulation can never become learning-eligible or verified value',()=>{
  const proof=createDecisionOutcomeProof({episode:completed(),metric:'planAttainmentPct',direction:'MAXIMIZE',classification:'SIMULATED'});
  assert.equal(proof.verifiedOperationalOutcome,false);
  assert.equal(proof.realisedFinancialOutcome,false);
  assert.equal(proof.learningEligible,false);
  assert.throws(()=>toAdaptiveOutcomeInput(proof),/verified decision outcome/);
});

test('operational proof requires independent baseline and result evidence',()=>{
  const episode=completed();
  assert.throws(()=>createDecisionOutcomeProof({episode,metric:'planAttainmentPct',direction:'MAXIMIZE',classification:'VERIFIED_OPERATIONAL',baselineActual:82,baselineEvidenceRefs:[]}),/Baseline and result evidence/);
  const proof=createDecisionOutcomeProof({
    episode,metric:'planAttainmentPct',direction:'MAXIMIZE',classification:'VERIFIED_OPERATIONAL',
    baselineActual:82,baselineEvidenceRefs:['mes:prior-comparable-shift']
  });
  assert.equal(proof.verifiedOperationalOutcome,true);
  assert.equal(proof.realisedFinancialOutcome,false);
  assert.equal(proof.observed.improvement,15);
  const learning=toAdaptiveOutcomeInput(proof);
  assert.equal(learning.result-learning.baseline,15);
  assert.equal(learning.verified,true);
});

test('cost improvement maps lower actual cost to positive learning delta',()=>{
  const proof=createDecisionOutcomeProof({
    episode:completed('labourCost'),metric:'labourCost',direction:'MINIMIZE',classification:'VERIFIED_OPERATIONAL',
    baselineActual:520,baselineEvidenceRefs:['payroll:baseline']
  });
  assert.equal(proof.observed.improvement,200);
  const learning=toAdaptiveOutcomeInput(proof);
  assert.equal(learning.result-learning.baseline,200);
});

test('realised financial value requires finance evidence currency and a bounded window',()=>{
  const episode=completed('labourCost');
  assert.throws(()=>createDecisionOutcomeProof({
    episode,metric:'labourCost',direction:'MINIMIZE',classification:'REALISED_FINANCIAL',
    baselineActual:520,baselineEvidenceRefs:['payroll:baseline'],financeEvidenceRefs:[]
  }),/Finance evidence/);
  const proof=createDecisionOutcomeProof({
    episode,metric:'labourCost',direction:'MINIMIZE',classification:'REALISED_FINANCIAL',
    baselineActual:520,baselineEvidenceRefs:['payroll:baseline'],financeEvidenceRefs:['finance:ledger:shift-a'],
    currency:'GBP',measurementWindow:{start:'2026-09-22T08:00:00Z',end:'2026-09-22T16:00:00Z'}
  });
  assert.equal(proof.realisedFinancialOutcome,true);
  assert.equal(proof.currency,'GBP');
  assert.equal(proof.observed.improvement,200);
});

test('non-financial KPI cannot be labelled realised financial value',()=>{
  assert.throws(()=>createDecisionOutcomeProof({
    episode:completed(),metric:'planAttainmentPct',direction:'MAXIMIZE',classification:'REALISED_FINANCIAL',
    baselineActual:82,baselineEvidenceRefs:['mes:baseline'],financeEvidenceRefs:['finance:x'],
    currency:'GBP',measurementWindow:{start:'2026-09-22T08:00:00Z',end:'2026-09-22T16:00:00Z'}
  }),/supported financial metric/);
});

test('changed nested settled result cannot be consumed under an issued proof digest',()=>{
  const proof=createDecisionOutcomeProof({episode:completed('labourCost'),metric:'labourCost',direction:'MINIMIZE',classification:'VERIFIED_OPERATIONAL',baselineActual:520,baselineEvidenceRefs:['payroll:baseline']});
  const original=toAdaptiveOutcomeInput(proof);
  const changed=structuredClone(proof);
  changed.observed.result=720;
  assert.equal(original.result-original.baseline,200);
  assert.equal(changed.proofDigest,proof.proofDigest);
  assert.throws(()=>toAdaptiveOutcomeInput(changed),/integrity/);
  changed.observed.result=320;
  changed.direction='MAXIMIZE';
  assert.throws(()=>toAdaptiveOutcomeInput(changed),/integrity/);
  assert.deepEqual(toAdaptiveOutcomeInput(structuredClone(proof)),original);
});

test('missing and substituted digest cannot label a proof verified for learning',()=>{
  const proof=createDecisionOutcomeProof({episode:completed(),metric:'planAttainmentPct',direction:'MAXIMIZE',classification:'VERIFIED_OPERATIONAL',baselineActual:82,baselineEvidenceRefs:['mes:baseline']});
  for(const substituted of [undefined,null,'0'.repeat(64)]){
    const changed=structuredClone(proof);changed.proofDigest=substituted;
    assert.throws(()=>toAdaptiveOutcomeInput(changed),/integrity/);
  }
});


// Reviewed numeric-actual regressions run through the existing admission entry point.
{
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDecisionEpisode, selectDecisionOption, recordDecisionOutcome } = require('./decision-episode.cjs');
const { createDecisionOutcomeProof } = require('./decision-outcome-proof.cjs');

function episode() {
  const initial = createDecisionEpisode({
    tenant:'alpha',site:'tamworth',decisionType:'absence-recovery',triggerId:'absence:42',
    triggeredAt:'2026-09-22T08:00:00Z',contextRevision:'twin:abc',mode:'HUMAN_APPROVAL',
    sourceEvidence:['absence:42'],objective:{labourCost:.25,planAttainmentPct:.55,riskScore:.2,uncertaintyPenalty:.1},
    options:[
      {id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,prediction:{labourCost:500},evidenceRefs:['sim:a']},
      {id:'redeploy',feasible:true,policyAllowed:true,hardConstraintsPassed:true,prediction:{labourCost:300},evidenceRefs:['sim:b']}
    ]
  });
  const selected = selectDecisionOption(initial,{optionId:'redeploy',selectedAt:'2026-09-22T08:05:00Z',actorRef:'manager:1',authorityDecision:'HUMAN_APPROVED'});
  return recordDecisionOutcome(selected,{observedAt:'2026-09-22T16:00:00Z',evidenceRefs:['payroll:shift:a'],actual:{labourCost:320}});
}
function input(overrides={}) {
  return {episode:episode(),metric:'labourCost',direction:'MINIMIZE',classification:'REALISED_FINANCIAL',
    baselineActual:520,baselineEvidenceRefs:['payroll:baseline'],financeEvidenceRefs:['finance:ledger:shift-a'],
    currency:'GBP',measurementWindow:{start:'2026-09-22T08:00:00Z',end:'2026-09-22T16:00:00Z'},...overrides};
}
test('absent, null and string baseline actuals cannot be presented as realised financial value',()=>{
  for(const value of [undefined,null,'520','',false]) {
    assert.throws(()=>createDecisionOutcomeProof(input({baselineActual:value})),/baseline actual must be a finite number/);
  }
});
test('a forged nonnumeric or numeric-string result actual cannot become realised financial value',()=>{
  for(const value of [null,undefined,'320','',false]) {
    const mutated=structuredClone(episode());
    mutated.outcome.actual.labourCost=value;
    assert.throws(()=>createDecisionOutcomeProof(input({episode:mutated})),/result actual must be a finite number|Recorded actual result is required/);
  }
});
test('explicit numeric zero is measured rather than treated as absent',()=>{
  const proof=createDecisionOutcomeProof(input({baselineActual:0}));
  assert.equal(proof.observed.baseline,0);
  assert.equal(proof.observed.improvement,-320);
});
}

// Independently authored boundary cases; local target makes ordinary CI portable.
{
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('./decision-outcome-proof.cjs');
const { createDecisionOutcomeProof, toAdaptiveOutcomeInput } = require(modulePath);

function episode(actual = 320) {
  const finite=typeof actual==='number'&&Number.isFinite(actual);
  const candidate=structuredClone(completed('labourCost',finite?actual:320));
  candidate.outcome.actual.labourCost=actual;
  return candidate;
}

function input(override = {}) {
  return {
    episode: episode(), metric: 'labourCost', direction: 'MINIMIZE',
    classification: 'REALISED_FINANCIAL', baselineActual: 520,
    baselineEvidenceRefs: ['synthetic:baseline'], financeEvidenceRefs: ['synthetic:ledger'],
    currency: 'GBP',
    measurementWindow: { start: '2026-09-22T08:00:00Z', end: '2026-09-22T16:00:00Z' },
    ...override
  };
}

test('missing baseline actual cannot silently become a zero saving', () => {
  const candidate = input(); delete candidate.baselineActual;
  assert.throws(() => createDecisionOutcomeProof(candidate), /baseline actual/);
});

test('coercible baseline values cannot prove financial results', () => {
  for (const value of ['520', '', true, false, [], [520], new Number(520), NaN, Infinity, -Infinity]) {
    assert.throws(() => createDecisionOutcomeProof(input({ baselineActual: value })), /baseline actual/, String(value));
  }
});

test('coercible result values cannot prove financial results', () => {
  for (const value of ['320', '', true, false, [], [320], new Number(320), NaN, Infinity, -Infinity]) {
    assert.throws(() => createDecisionOutcomeProof(input({ episode: episode(value) })), /result actual/, String(value));
  }
});

test('missing result and missing baseline are rejected for verified operational evidence too', () => {
  const missing = episode(); delete missing.outcome.actual.labourCost;
  assert.throws(() => createDecisionOutcomeProof(input({ episode: missing, classification: 'VERIFIED_OPERATIONAL' })), /result actual|Recorded actual/);
  const noBaseline = input({ classification: 'VERIFIED_OPERATIONAL' }); delete noBaseline.baselineActual;
  assert.throws(() => createDecisionOutcomeProof(noBaseline), /baseline actual/);
});

test('explicit numeric zero is retained at both ends', () => {
  const zeroBaseline = createDecisionOutcomeProof(input({ baselineActual: 0 }));
  assert.equal(zeroBaseline.observed.baseline, 0);
  assert.equal(zeroBaseline.observed.improvement, -320);
  const zeroResult = createDecisionOutcomeProof(input({ episode: episode(0) }));
  assert.equal(zeroResult.observed.result, 0);
  assert.equal(zeroResult.observed.improvement, 520);
});

test('simulation remains unverified even with missing actual measurements', () => {
  const simulated = episode(); delete simulated.outcome.actual.labourCost;
  const proof = createDecisionOutcomeProof(input({ episode: simulated, classification: 'SIMULATED' }));
  assert.equal(proof.observed, null);
  assert.equal(proof.realisedFinancialOutcome, false);
  assert.equal(proof.learningEligible, false);
  assert.throws(() => toAdaptiveOutcomeInput(proof), /verified decision outcome/);
});

test('valid financial value keeps exact observed improvement and learning delta', () => {
  const proof = createDecisionOutcomeProof(input());
  assert.equal(proof.observed.baseline, 520);
  assert.equal(proof.observed.result, 320);
  assert.equal(proof.observed.improvement, 200);
  assert.equal(proof.realisedFinancialOutcome, true);
  assert.equal(toAdaptiveOutcomeInput(proof).result - toAdaptiveOutcomeInput(proof).baseline, 200);
});
}

// Custody, chronology and immutable-data regressions run in the ordinary proof CI entry point.
{
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const proofApi = require('./decision-outcome-proof.cjs');
const episodeApi = require('./decision-episode.cjs');
const { createDecisionOutcomeProof, toAdaptiveOutcomeInput, digest } = proofApi;
const { createDecisionEpisode, selectDecisionOption, recordDecisionOutcome } = episodeApi;
function initial() {
  return episodeApi.createDecisionEpisode({
    tenant: 'peer-synthetic', site: 'peer-site', decisionType: 'absence-recovery',
    triggerId: 'peer:absence', triggeredAt: '2026-09-22T08:00:00Z',
    contextRevision: 'peer:twin', mode: 'HUMAN_APPROVAL',
    sourceEvidence: ['peer:source'], objective: { labourCost: 1 },
    options: [
      { id: 'do-nothing', feasible: true, policyAllowed: true, hardConstraintsPassed: true,
        prediction: { labourCost: 500 }, evidenceRefs: ['peer:simulation-a'] },
      { id: 'redeploy', feasible: true, policyAllowed: true, hardConstraintsPassed: true,
        prediction: { labourCost: 300 }, evidenceRefs: ['peer:simulation-b'] }
    ]
  });
}
function selected(selectedAt = '2026-09-22T08:05:00Z') {
  return episodeApi.selectDecisionOption(initial(), {
    optionId: 'redeploy', selectedAt, actorRef: 'peer:manager', authorityDecision: 'HUMAN_APPROVED'
  });
}
function completed(observedAt = '2026-09-22T16:00:00Z', labourCost = 320) {
  return episodeApi.recordDecisionOutcome(selected(), {
    observedAt, evidenceRefs: ['peer:result'], actual: { labourCost }
  });
}
function input(overrides = {}) {
  return {
    episode: completed(), metric: 'labourCost', direction: 'MINIMIZE',
    classification: 'REALISED_FINANCIAL', baselineActual: 520,
    baselineEvidenceRefs: ['peer:baseline'], financeEvidenceRefs: ['peer:finance'],
    currency: 'GBP', measurementWindow: { start: '2026-09-22T08:00:00Z', end: '2026-09-22T16:00:00Z' },
    ...overrides
  };
}

test('P1 custody: changed recorded actual must not gain a new proof while retaining stale outcomeDigest', () => {
  const episode = structuredClone(completed());
  const issuedDigest = episode.outcomeDigest;
  episode.outcome.actual.labourCost = 0;
  assert.equal(episode.outcomeDigest, issuedDigest);
  assert.throws(() => createDecisionOutcomeProof(input({ episode })), /integrity|digest|custody/);
});

test('P1 TOCTOU: result getter must not switch after digest validation into verified nonfinite learning', () => {
  const proof = structuredClone(createDecisionOutcomeProof(input()));
  let reads = 0;
  Object.defineProperty(proof.observed, 'result', { enumerable: true, get() { return reads++ === 0 ? 320 : NaN; } });
  assert.throws(() => toAdaptiveOutcomeInput(proof), /integrity|finite|accessor|data/);
});

test('P1 TOCTOU: consumer must use the direction that was checked against the digest', () => {
  const issued = createDecisionOutcomeProof(input());
  const proof = structuredClone(issued);
  let reads = 0;
  Object.defineProperty(proof, 'direction', { enumerable: true, get() { return reads++ === 0 ? 'MINIMIZE' : 'MAXIMIZE'; } });
  assert.throws(() => toAdaptiveOutcomeInput(proof), /integrity|accessor|data/);
});

test('P2 chronology: selection must not precede trigger', () => {
  assert.throws(() => selectDecisionOption(initial(), { optionId: 'redeploy',
    selectedAt: '2026-09-22T07:59:00Z', actorRef: 'peer:manager', authorityDecision: 'HUMAN_APPROVED' }), /before|chronology|trigger/);
});

test('P2 chronology: observation must not precede selection', () => {
  assert.throws(() => recordDecisionOutcome(selected(), { observedAt: '2026-09-22T08:04:00Z',
    evidenceRefs: ['peer:result'], actual: { labourCost: 320 } }), /before|chronology|selection/);
});

test('P2 chronology: financial observation must belong to measurement window', () => {
  assert.throws(() => createDecisionOutcomeProof(input({ measurementWindow: {
    start: '2026-09-22T09:00:00Z', end: '2026-09-22T10:00:00Z'
  } })), /window|observed|chronology/);
});

test('P2 freeze: issued proof graph must be deeply frozen', () => {
  const proof = createDecisionOutcomeProof(input());
  assert.equal(Object.isFrozen(proof), true);
  for (const value of [proof.predicted, proof.observed, proof.evidence, proof.evidence.baseline,
    proof.evidence.result, proof.evidence.finance, proof.measurementWindow]) {
    assert.equal(Object.isFrozen(value), true);
  }
});

test('episode identity: stale base-option change is refused by selection, recording and proof', () => {
  const e = structuredClone(initial()); e.options[0].prediction.labourCost = 1;
  assert.throws(() => selectDecisionOption(e, { optionId: 'redeploy', selectedAt: '2026-09-22T08:05:00Z',
    actorRef: 'peer:manager', authorityDecision: 'HUMAN_APPROVED' }), /integrity/);
  const s = structuredClone(selected()); s.tenant = 'substituted';
  assert.throws(() => recordDecisionOutcome(s, { observedAt: '2026-09-22T16:00:00Z',
    evidenceRefs: ['peer:result'], actual: { labourCost: 320 } }), /integrity/);
  const c = structuredClone(completed()); c.contextRevision = 'substituted';
  assert.throws(() => createDecisionOutcomeProof(input({ episode: c })), /integrity/);
});

test('custody: unissued plain episode and missing recorded digest cannot verify', () => {
  const episode = structuredClone(completed()); delete episode.outcomeDigest;
  assert.throws(() => createDecisionOutcomeProof(input({ episode })), /integrity|digest/);
  const unissued = structuredClone(completed()); delete unissued.episodeId;
  assert.throws(() => createDecisionOutcomeProof(input({ episode: unissued })), /episode|integrity/i);
});

test('intake: producer and consumer reject getters and proxies without invoking traps', () => {
  let calls = 0;
  const hostile = input();
  Object.defineProperty(hostile, 'baselineActual', { enumerable: true, get() { calls++; return 520; } });
  assert.throws(() => createDecisionOutcomeProof(hostile), /accessor|data/);
  const proxy = new Proxy(input(), { ownKeys() { calls++; return []; }, get() { calls++; return undefined; } });
  assert.throws(() => createDecisionOutcomeProof(proxy), /proxy|data/);
  const proof = new Proxy(createDecisionOutcomeProof(input()), { ownKeys() { calls++; return []; }, get() { calls++; return undefined; } });
  assert.throws(() => toAdaptiveOutcomeInput(proof), /proxy|data/);
  assert.equal(calls, 0);
});

test('intake: inherited records and custom toJSON cannot supply evidence', () => {
  const inherited = Object.create(input());
  assert.throws(() => createDecisionOutcomeProof(inherited), /plain|data/);
  let calls = 0; const episode = structuredClone(completed());
  episode.toJSON = () => { calls++; return {}; };
  assert.throws(() => createDecisionOutcomeProof(input({ episode })), /data|function/);
  assert.equal(calls, 0);
});

test('freeze: episode lifecycle and proof remain portable after JSON serialization', () => {
  const s = selectDecisionOption(JSON.parse(JSON.stringify(initial())), { optionId: 'redeploy',
    selectedAt: '2026-09-22T08:05:00Z', actorRef: 'peer:manager', authorityDecision: 'HUMAN_APPROVED' });
  const c = recordDecisionOutcome(JSON.parse(JSON.stringify(s)), { observedAt: '2026-09-22T16:00:00Z',
    evidenceRefs: ['peer:result'], actual: { labourCost: 320 } });
  for (const value of [s.options, s.options[0], s.options[0].prediction, c.outcome, c.outcome.actual, c.outcome.evidenceRefs]) {
    assert.equal(Object.isFrozen(value), true);
  }
  const proof = createDecisionOutcomeProof(input({ episode: JSON.parse(JSON.stringify(c)) }));
  assert.equal(toAdaptiveOutcomeInput(JSON.parse(JSON.stringify(proof))).verified, true);
});

test('chronology: equal trigger/selection/observation timestamps and window endpoints remain valid', () => {
  const s = selected('2026-09-22T08:00:00Z');
  const c = recordDecisionOutcome(s, { observedAt: '2026-09-22T08:00:00Z', evidenceRefs: ['peer:result'], actual: { labourCost: 320 } });
  const proof = createDecisionOutcomeProof(input({ episode: c }));
  assert.equal(proof.observed.observedAt, '2026-09-22T08:00:00.000Z');
});

function settled({ baselinePrediction = 500, selectedPrediction = 300, actual = 320 } = {}) {
  const episode = createDecisionEpisode({
    tenant: 'peer-synthetic', site: 'peer-site', decisionType: 'absence-recovery',
    triggerId: 'peer:overflow', triggeredAt: '2026-09-22T08:00:00Z', contextRevision: 'peer:twin',
    mode: 'HUMAN_APPROVAL', sourceEvidence: ['peer:source'], objective: { labourCost: 1 },
    options: [
      { id: 'do-nothing', feasible: true, policyAllowed: true, hardConstraintsPassed: true, prediction: { labourCost: baselinePrediction } },
      { id: 'redeploy', feasible: true, policyAllowed: true, hardConstraintsPassed: true, prediction: { labourCost: selectedPrediction } }
    ]
  });
  const choice = selectDecisionOption(episode, { optionId: 'redeploy', selectedAt: '2026-09-22T08:05:00Z',
    actorRef: 'real:manager', authorityDecision: 'HUMAN_APPROVED' });
  return recordDecisionOutcome(choice, { observedAt: '2026-09-22T16:00:00Z', evidenceRefs: ['peer:result'], actual: { labourCost: actual } });
}

test('review custody: selected actor cannot change before recording under an issued selection seal', () => {
  const episode = structuredClone(selected()); episode.selection.actorRef = 'forged:manager';
  assert.throws(() => recordDecisionOutcome(episode, { observedAt: '2026-09-22T16:00:00Z',
    evidenceRefs: ['peer:result'], actual: { labourCost: 320 } }), /selection.*integrity/i);
  assert.throws(() => selectDecisionOption(episode, { optionId: 'redeploy', selectedAt: '2026-09-22T08:06:00Z',
    actorRef: 'real:manager', authorityDecision: 'HUMAN_APPROVED' }), /selection.*integrity/i);
});

test('review custody: missing selection seal and rewritten outcome digest cannot bypass selection integrity', () => {
  const episode = structuredClone(completed()); delete episode.selectionDigest;
  assert.throws(() => createDecisionOutcomeProof(input({ episode })), /selection.*integrity/i);
  const changed = structuredClone(completed()); changed.selection.actorRef = 'forged:manager';
  changed.outcomeDigest = digest({ episodeId: changed.episodeId, selection: changed.selection, outcome: changed.outcome });
  assert.throws(() => createDecisionOutcomeProof(input({ episode: changed })), /selection.*integrity/i);
});

test('review finite arithmetic: finite actual operands cannot issue an infinite observed improvement', () => {
  const episode = settled({ actual: -Number.MAX_VALUE });
  assert.throws(() => createDecisionOutcomeProof(input({ episode, baselineActual: Number.MAX_VALUE })), /improvement.*finite/i);
});

test('review finite arithmetic: finite predictions cannot issue an infinite predicted improvement', () => {
  assert.throws(() => createDecisionOutcomeProof(input({ episode: settled({ baselinePrediction: Number.MAX_VALUE,
    selectedPrediction: -Number.MAX_VALUE, actual: 0 }) })), /improvement.*finite/i);
});

test('review finite arithmetic: overflowing prediction error cannot be issued as a measured outcome', () => {
  assert.throws(() => createDecisionOutcomeProof(input({ episode: settled({ baselinePrediction: 0,
    selectedPrediction: -Number.MAX_VALUE, actual: Number.MAX_VALUE }) })), /prediction error.*finite/i);
});

test('review finite arithmetic: consumer rejects nonfinite derived fields even after a public checksum is recomputed', () => {
  for (const [section, field] of [['observed', 'improvement'], ['observed', 'predictionError'], ['predicted', 'improvement']]) {
    const proof = structuredClone(createDecisionOutcomeProof(input()));
    proof[section][field] = Infinity;
    const { proofDigest, ...core } = proof; proof.proofDigest = digest(core);
    assert.throws(() => toAdaptiveOutcomeInput(proof), /finite|integrity/i, section + '.' + field);
  }
});

for (const actual of ['320', true, null]) {
  test('provider actual: raw ' + String(actual) + ' is refused before a financial measurement is recorded', () => {
    assert.throws(() => recordDecisionOutcome(selected(), { observedAt: '2026-09-22T16:00:00Z',
      evidenceRefs: ['peer:result'], actual: { labourCost: actual } }), /actual.*finite/i);
  });
}

test('provider actual: every explicitly supplied metric requires a finite primitive number', () => {
  for (const actual of [undefined, false, '', [], [320], new Number(320), NaN, Infinity, -Infinity]) {
    assert.throws(() => recordDecisionOutcome(selected(), { observedAt: '2026-09-22T16:00:00Z',
      evidenceRefs: ['peer:result'], actual: { labourCost: actual } }), /actual|data/i);
  }
});

test('provider actual: omitted metric remains null and cannot verify the missing financial result', () => {
  const episode = recordDecisionOutcome(selected(), { observedAt: '2026-09-22T16:00:00Z',
    evidenceRefs: ['peer:result'], actual: { planAttainmentPct: 97 } });
  assert.equal(episode.outcome.actual.labourCost, null);
  assert.throws(() => createDecisionOutcomeProof(input({ episode })), /Recorded actual/);
  const omitted = recordDecisionOutcome(selected(), { observedAt: '2026-09-22T16:00:00Z', evidenceRefs: ['peer:result'] });
  assert.equal(omitted.outcome.actual.labourCost, null);
});

test('provider actual: explicit numeric zero and omitted other metrics remain valid financial measurements', () => {
  const episode = recordDecisionOutcome(selected(), { observedAt: '2026-09-22T16:00:00Z',
    evidenceRefs: ['peer:result'], actual: { labourCost: 0 } });
  assert.equal(episode.outcome.actual.riskScore, null);
  const proof = createDecisionOutcomeProof(input({ episode }));
  assert.equal(proof.observed.result, 0);
  assert.equal(proof.observed.improvement, 520);
});

}
