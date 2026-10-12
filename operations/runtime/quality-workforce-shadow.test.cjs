'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { screenQualityWorkforceShadow, displayableWorkforceRecommendation, REQUIRED_CONFOUNDERS } = require('./quality-workforce-shadow.cjs');

const SCOPE = Object.freeze({
  tenant: 'tenant-a', site: 'site-a', workCentre: 'line-4',
  product: 'sku-a', order: 'order-a',
  windowStart: '2026-10-12T08:00:00.000Z',
  windowEnd: '2026-10-12T09:00:00.000Z'
});
const AS_OF = '2026-10-12T08:40:00.000Z';
const HASH = 'a'.repeat(64);
function record(id, extra = {}) {
  return {
    id, scope: { ...SCOPE }, contextRevision: 'context-r1',
    sourceRevision: 'source-r1', occurredAt: '2026-10-12T08:30:00.000Z',
    observedAt: '2026-10-12T08:35:00.000Z',
    provenance: { source: 'synthetic-qms', recordHash: HASH }, ...extra
  };
}
function fixture() {
  return {
    asOf: AS_OF,
    context: {
      scope: { ...SCOPE }, sourceRevision: 'context-r1',
      sourceRevisions: { 'synthetic-qms': 'source-r1', 'synthetic-scenario': 'scenario-r1' },
      observedAt: '2026-10-12T08:35:00.000Z',
      provenance: { source: 'synthetic-context', recordHash: HASH }
    },
    qualityEvents: [record('q1', { metric: 'defectRate', value: 0.08 })],
    confounders: REQUIRED_CONFOUNDERS.map(category =>
      record(category + '-1', { category, finding: 'ABSENT' })),
    workforceEvidence: record('skills-1', { finding: 'AGGREGATE_SKILL_GAP' }),
    policy: {
      version: 'quality-policy-r1', provenance: 'synthetic-policy',
      maxEvidenceAgeMs: 60 * 60 * 1000,
      metricLimits: { defectRate: { max: 0.05 } },
      allowedOptionKinds: ['ADD_VERIFIED_SKILL_COVER'],
      objective: { qualityRisk: 1, uncertaintyPenalty: 0 }
    },
    options: [
      { ...record('do-nothing', { sourceRevision: 'scenario-r1',
        provenance: { source: 'synthetic-scenario', recordHash: HASH } }),
        kind: 'DO_NOTHING', feasible: true,
        policyAllowed: true, hardConstraintsPassed: true, uncertainty: 0,
        prediction: { qualityRisk: 9 }, evidenceRefs: ['q1'] },
      { ...record('verified-skill-cover', { sourceRevision: 'scenario-r1',
        provenance: { source: 'synthetic-scenario', recordHash: HASH } }),
        kind: 'ADD_VERIFIED_SKILL_COVER',
        validFrom: '2026-10-12T08:40:00.000Z',
        validUntil: '2026-10-12T09:00:00.000Z',
        feasible: true, policyAllowed: true, hardConstraintsPassed: true,
        uncertainty: 0.1, prediction: { qualityRisk: 2 },
        evidenceRefs: ['q1', 'skills-1'] }
    ]
  };
}
function noWorkforceOption(result) {
  assert.equal(result.workforceContribution, 'UNKNOWN');
  assert.equal(result.episode.mode, 'SHADOW');
  assert.equal(result.episode.recommendation.executionPermitted, false);
  assert.equal(result.episode.options.some(o => o.id === 'verified-skill-cover'), false);
  assert.notEqual(result.episode.recommendation.optionId, 'verified-skill-cover');
}

test('a complete aggregate signal exposes a bounded option without claiming causality or authority', () => {
  const result = screenQualityWorkforceShadow(fixture());
  assert.equal(result.status, 'REVIEW_WORKFORCE_OPTIONS');
  assert.equal(result.workforceContribution, 'UNPROVEN');
  assert.equal(result.episode.recommendation.optionId, 'verified-skill-cover');
  assert.equal(result.episode.recommendation.authorityRequired, 'NO_EXECUTION');
  assert.equal(result.episode.options.find(o => o.id === 'do-nothing').feasible, true);
  assert.deepEqual(result.scope, SCOPE);
});

test('missing confounders prevent workforce options', () => {
  const input = fixture();
  input.confounders.pop();
  const result = screenQualityWorkforceShadow(input);
  assert.equal(result.evaluatedAt, '2026-10-12T08:40:00.000Z');
  assert.equal(result.status, 'INVESTIGATE');
  assert.ok(result.reasons.includes('MISSING_CONFOUNDER'));
  noWorkforceOption(result);
});

test('all scope dimensions, windows and context revision are bound independently', () => {
  const dimensions = ['tenant', 'site', 'workCentre', 'product', 'order', 'windowStart', 'windowEnd'];
  for (const dimension of dimensions) {
    const input = fixture();
    input.confounders[0].scope[dimension] = dimension.includes('window')
      ? '2026-10-12T07:00:00.000Z' : 'other';
    const result = screenQualityWorkforceShadow(input);
    assert.ok(result.reasons.includes('EVIDENCE_SCOPE_MISMATCH'), dimension);
    noWorkforceOption(result);
  }
  for (const target of ['qualityEvents', 'confounders', 'workforceEvidence']) {
    const input = fixture();
    const evidence = target === 'workforceEvidence' ? input[target] : input[target][0];
    evidence.contextRevision = 'context-r2';
    const result = screenQualityWorkforceShadow(input);
    assert.ok(result.reasons.includes('EVIDENCE_REVISION_MISMATCH'), target);
    noWorkforceOption(result);
  }
  for (const target of ['qualityEvents', 'confounders', 'workforceEvidence']) {
    const input = fixture();
    const evidence = target === 'workforceEvidence' ? input[target] : input[target][0];
    evidence.sourceRevision = 'source-r2';
    const result = screenQualityWorkforceShadow(input);
    assert.ok(result.reasons.includes('EVIDENCE_REVISION_MISMATCH'), target);
    noWorkforceOption(result);
  }
});

test('quality evidence outside the window and a changed context revision fail closed', () => {
  const input = fixture();
  input.qualityEvents[0].occurredAt = '2026-10-12T10:00:00.000Z';
  noWorkforceOption(screenQualityWorkforceShadow(input));
  const changed = fixture();
  changed.context.sourceRevision = 'context-r2';
  const result = screenQualityWorkforceShadow(changed);
  assert.ok(result.reasons.includes('EVIDENCE_REVISION_MISMATCH'));
  noWorkforceOption(result);
});

test('machine, tooling, material, product, process, inspection and environment findings block', () => {
  for (const category of REQUIRED_CONFOUNDERS) {
    for (const finding of ['PRESENT', 'DOMINANT', 'UNKNOWN']) {
      const input = fixture();
      input.confounders.find(x => x.category === category).finding = finding;
      const result = screenQualityWorkforceShadow(input);
      assert.equal(result.status, 'INVESTIGATE', category + ':' + finding);
      noWorkforceOption(result);
    }
  }
});

test('inspection-model drift blocks an otherwise complete signal', () => {
  const input = fixture();
  input.confounders.find(x => x.category === 'inspectionModel').finding = 'PRESENT';
  const result = screenQualityWorkforceShadow(input);
  assert.ok(result.reasons.includes('NON_WORKFORCE_EVIDENCE'));
  noWorkforceOption(result);
});

test('stale, outage, future and missing provenance evidence fail closed', () => {
  const stale = fixture();
  stale.policy.maxEvidenceAgeMs = 4 * 60 * 1000;
  assert.ok(screenQualityWorkforceShadow(stale).reasons.includes('STALE_EVIDENCE'));
  noWorkforceOption(screenQualityWorkforceShadow(stale));
  const outage = fixture();
  outage.qualityEvents = [];
  assert.ok(screenQualityWorkforceShadow(outage).reasons.includes('QUALITY_SOURCE_OUTAGE'));
  noWorkforceOption(screenQualityWorkforceShadow(outage));
  const future = fixture();
  future.qualityEvents[0].observedAt = '2026-10-12T09:11:00.000Z';
  assert.ok(screenQualityWorkforceShadow(future).reasons.includes('FUTURE_EVIDENCE'));
  noWorkforceOption(screenQualityWorkforceShadow(future));
  const unprovenanced = fixture();
  delete unprovenanced.qualityEvents[0].provenance.recordHash;
  assert.ok(screenQualityWorkforceShadow(unprovenanced).reasons.includes('INVALID_EVIDENCE'));
  noWorkforceOption(screenQualityWorkforceShadow(unprovenanced));
});

test('evidence is stale at the exact exclusive freshness boundary', () => {
  const input = fixture();
  input.policy.maxEvidenceAgeMs = 5 * 60 * 1000;
  const result = screenQualityWorkforceShadow(input);
  assert.equal(result.status, 'INVESTIGATE');
  assert.ok(result.reasons.includes('STALE_EVIDENCE'));
  noWorkforceOption(result);
});

test('retrospective windows and already elapsed options do not produce workforce advice', () => {
  const pastWindow = fixture();
  pastWindow.asOf = '2026-10-12T09:10:00.000Z';
  assert.ok(screenQualityWorkforceShadow(pastWindow).reasons.includes('WINDOW_NOT_ACTIONABLE'));
  noWorkforceOption(screenQualityWorkforceShadow(pastWindow));
  const elapsedOption = fixture();
  elapsedOption.options[1].validFrom = '2026-10-12T08:35:00.000Z';
  elapsedOption.options[1].validUntil = '2026-10-12T08:39:00.000Z';
  noWorkforceOption(screenQualityWorkforceShadow(elapsedOption));
});

test('exact option interval survives and a later card cannot show an expired workforce option', () => {
  const input = fixture();
  input.options[1].validUntil = '2026-10-12T08:45:00.000Z';
  const result = screenQualityWorkforceShadow(input);
  assert.deepEqual(result.optionValidity, [{
    optionId: 'verified-skill-cover',
    validFrom: '2026-10-12T08:40:00.000Z',
    validUntil: '2026-10-12T08:45:00.000Z'
  }]);
  assert.ok(Object.isFrozen(result.optionValidity));
  assert.ok(Object.isFrozen(result.optionValidity[0]));
  assert.equal(displayableWorkforceRecommendation(result, '2026-10-12T08:44:59.000Z').optionId,
    'verified-skill-cover');
  assert.equal(displayableWorkforceRecommendation(result, '2026-10-12T08:45:00.000Z'), null);
  assert.equal(displayableWorkforceRecommendation(result, '2026-10-12T08:46:00.000Z'), null);
  assert.equal(displayableWorkforceRecommendation(result, result.evaluatedAt).executionPermitted, false);
  const forgedAuthority = structuredClone(result);
  forgedAuthority.episode.recommendation.executionPermitted = true;
  assert.equal(displayableWorkforceRecommendation(forgedAuthority, result.evaluatedAt), null);
  const changed = fixture();
  changed.options[1].validUntil = '2026-10-12T08:50:00.000Z';
  const later = screenQualityWorkforceShadow(changed);
  assert.notDeepEqual(later.optionValidity, result.optionValidity);
  assert.notEqual(later.episode.episodeId, result.episode.episodeId);
  const ongoing = fixture();
  ongoing.asOf = '2026-10-12T08:42:00.000Z';
  ongoing.options[1].validUntil = '2026-10-12T08:45:00.000Z';
  assert.equal(screenQualityWorkforceShadow(ongoing).status, 'REVIEW_WORKFORCE_OPTIONS');
  assert.equal(displayableWorkforceRecommendation(result, '2026-10-12T08:39:59.000Z'), null);
  assert.throws(() => displayableWorkforceRecommendation(result), /current time/);
  const freshness = fixture();
  freshness.asOf = '2026-10-12T08:39:00.000Z';
  freshness.options[1].validFrom = '2026-10-12T08:39:00.000Z';
  freshness.policy.maxEvidenceAgeMs = 5 * 60 * 1000;
  const freshResult = screenQualityWorkforceShadow(freshness);
  assert.equal(freshResult.evidenceValidUntil, '2026-10-12T08:40:00.000Z');
  assert.equal(displayableWorkforceRecommendation(freshResult, '2026-10-12T08:39:59.000Z').optionId,
    'verified-skill-cover');
  assert.equal(displayableWorkforceRecommendation(freshResult, '2026-10-12T08:40:00.000Z'), null);
});

test('display refuses missing or malformed retained time bounds', () => {
  const result = screenQualityWorkforceShadow(fixture());
  for (const path of [
    ['evaluatedAt'], ['evidenceValidUntil'], ['scope', 'windowEnd'],
    ['optionValidity', 0, 'validFrom'], ['optionValidity', 0, 'validUntil']
  ]) {
    for (const replacement of [undefined, 'not-a-time']) {
      const changed = structuredClone(result);
      let target = changed;
      for (const key of path.slice(0, -1)) target = target[key];
      if (replacement === undefined) delete target[path.at(-1)];
      else target[path.at(-1)] = replacement;
      assert.equal(displayableWorkforceRecommendation(changed, result.evaluatedAt), null,
        path.join('.') + '=' + String(replacement));
    }
  }
});

test('negative, out-of-range and nonfinite scenario predictions block advice; valid boundaries survive', () => {
  const bad = [
    ['qualityRisk', -1], ['labourCost', -100], ['delayMinutes', -1],
    ['energyCost', -1], ['throughputUnits', -1], ['riskScore', -1],
    ['planAttainmentPct', 101], ['planAttainmentPct', -0.01],
    ['qualityRisk', Infinity], ['qualityRisk', NaN]
  ];
  for (const [metric, value] of bad) {
    const input = fixture();
    input.options[1].prediction[metric] = value;
    const result = screenQualityWorkforceShadow(input);
    noWorkforceOption(result);
  }
  const baseline = fixture();
  baseline.options[0].prediction.labourCost = -1;
  assert.throws(() => screenQualityWorkforceShadow(baseline), /do-nothing/);
  const valid = fixture();
  valid.options[1].prediction = {
    qualityRisk: 0, labourCost: 0, delayMinutes: 0,
    energyCost: 0, throughputUnits: 0, riskScore: 0, planAttainmentPct: 100
  };
  assert.equal(screenQualityWorkforceShadow(valid).status, 'REVIEW_WORKFORCE_OPTIONS');
});

test('workforce scenarios bind scope, revision, freshness, provenance and current evidence refs', () => {
  for (const tamper of [
    option => { option.scope.tenant = 'other'; },
    option => { option.contextRevision = 'context-r2'; },
    option => { option.sourceRevision = 'scenario-r2'; },
    option => { option.observedAt = '2026-10-12T07:00:00.000Z'; },
    option => { option.observedAt = '2026-10-12T09:00:00.000Z'; },
    option => { delete option.provenance.recordHash; },
    option => { option.evidenceRefs = ['other-order-q1']; }
  ]) {
    const input = fixture();
    tamper(input.options[1]);
    noWorkforceOption(screenQualityWorkforceShadow(input));
  }
  const baseline = fixture();
  baseline.options[0].scope.tenant = 'other';
  assert.throws(() => screenQualityWorkforceShadow(baseline), /do-nothing/);
  const noBaseline = fixture();
  noBaseline.options[0].prediction = {};
  assert.throws(() => screenQualityWorkforceShadow(noBaseline), /do-nothing/);
  const badBaselineRef = fixture();
  badBaselineRef.options[0].evidenceRefs = [null];
  assert.throws(() => screenQualityWorkforceShadow(badBaselineRef), /do-nothing/);
});

test('policy values are bound to the evidence digest even at the same policy version', () => {
  const first = screenQualityWorkforceShadow(fixture());
  const changed = fixture();
  changed.policy.metricLimits.defectRate.max = 0.1;
  const second = screenQualityWorkforceShadow(changed);
  assert.notEqual(first.evidenceDigest, second.evidenceDigest);
  noWorkforceOption(second);
});

test('out-of-range and reversed rate limits cannot manufacture a quality alert', () => {
  for (const invalid of [{ max: -1 }, { max: 2 }, { min: 0.001 }]) {
    const input = fixture();
    input.qualityEvents[0].value = 0.01;
    input.policy.metricLimits.defectRate = invalid;
    const result = screenQualityWorkforceShadow(input);
    assert.ok(result.reasons.includes('MISSING_POLICY_LIMIT'));
    noWorkforceOption(result);
  }
  const yieldCase = fixture();
  yieldCase.qualityEvents[0].metric = 'firstPassYield';
  yieldCase.policy.metricLimits = { firstPassYield: { max: 0.9 } };
  noWorkforceOption(screenQualityWorkforceShadow(yieldCase));
});

test('invalid rates, rollover dates and duplicate decision options cannot authorize advice', () => {
  for (const value of [-0.1, 1.1]) {
    const input = fixture();
    input.qualityEvents[0].value = value;
    assert.ok(screenQualityWorkforceShadow(input).reasons.includes('INVALID_EVIDENCE'));
    noWorkforceOption(screenQualityWorkforceShadow(input));
  }
  const rolled = fixture();
  rolled.qualityEvents[0].observedAt = '2026-02-30T08:35:00Z';
  noWorkforceOption(screenQualityWorkforceShadow(rolled));
  const duplicatedBaseline = fixture();
  duplicatedBaseline.options.push({ ...duplicatedBaseline.options[0], prediction: { qualityRisk: 1 } });
  assert.throws(() => screenQualityWorkforceShadow(duplicatedBaseline), /do-nothing/);
  const duplicatedCandidate = fixture();
  duplicatedCandidate.options.push({ ...duplicatedCandidate.options[1], prediction: { qualityRisk: 1 } });
  noWorkforceOption(screenQualityWorkforceShadow(duplicatedCandidate));
});

test('candidate refs include current quality and aggregate skill evidence without ID ambiguity', () => {
  const noSkillRef = fixture();
  noSkillRef.options[1].evidenceRefs = ['q1'];
  noWorkforceOption(screenQualityWorkforceShadow(noSkillRef));
  const noQualityRef = fixture();
  noQualityRef.options[1].evidenceRefs = ['skills-1'];
  noWorkforceOption(screenQualityWorkforceShadow(noQualityRef));
  const collidingId = fixture();
  collidingId.confounders[0].id = 'q1';
  assert.ok(screenQualityWorkforceShadow(collidingId).reasons.includes('CONFLICTING_DUPLICATE'));
  noWorkforceOption(screenQualityWorkforceShadow(collidingId));
});

test('exact duplicates do not change output; conflicting duplicates or category findings fail closed', () => {
  const base = screenQualityWorkforceShadow(fixture());
  const duplicate = fixture();
  duplicate.qualityEvents.push(structuredClone(duplicate.qualityEvents[0]));
  assert.deepEqual(screenQualityWorkforceShadow(duplicate), base);
  const conflict = fixture();
  conflict.qualityEvents.push({ ...structuredClone(conflict.qualityEvents[0]), value: 0.01 });
  const result = screenQualityWorkforceShadow(conflict);
  assert.ok(result.reasons.includes('CONFLICTING_DUPLICATE'));
  noWorkforceOption(result);
  const contradictory = fixture();
  contradictory.confounders.push(record('machine-2', { category: 'machine', finding: 'PRESENT' }));
  assert.ok(screenQualityWorkforceShadow(contradictory).reasons.includes('NON_WORKFORCE_EVIDENCE'));
  noWorkforceOption(screenQualityWorkforceShadow(contradictory));
});

test('a normal or mixed quality signal does not turn into workforce attribution', () => {
  const normal = fixture();
  normal.qualityEvents[0].value = 0.01;
  assert.equal(screenQualityWorkforceShadow(normal).status, 'NO_QUALITY_ALERT');
  noWorkforceOption(screenQualityWorkforceShadow(normal));
  const mixed = fixture();
  mixed.qualityEvents.push(record('q2', { metric: 'defectRate', value: 0.01 }));
  assert.ok(screenQualityWorkforceShadow(mixed).reasons.includes('CONTRADICTORY_QUALITY_EVENTS'));
  noWorkforceOption(screenQualityWorkforceShadow(mixed));
});

test('explicit policy, aggregate gap and precomputed feasible option are all required', () => {
  assert.ok(screenQualityWorkforceShadow(fixture()).episode.options
    .find(option => option.id === 'do-nothing').reasonCodes.includes('SUPPLIED_BASELINE'));
  const noPolicy = fixture();
  delete noPolicy.policy.metricLimits.defectRate;
  noWorkforceOption(screenQualityWorkforceShadow(noPolicy));
  const noGap = fixture();
  noGap.workforceEvidence.finding = 'NO_AGGREGATE_GAP';
  noWorkforceOption(screenQualityWorkforceShadow(noGap));
  const noApproval = fixture();
  noApproval.options[1].policyAllowed = false;
  noWorkforceOption(screenQualityWorkforceShadow(noApproval));
  const unbounded = fixture();
  delete unbounded.options[1].validUntil;
  noWorkforceOption(screenQualityWorkforceShadow(unbounded));
  const implicitPenalty = fixture();
  delete implicitPenalty.policy.objective.uncertaintyPenalty;
  assert.throws(() => screenQualityWorkforceShadow(implicitPenalty), /policy/);
  const unknownScenarioUncertainty = fixture();
  delete unknownScenarioUncertainty.options[1].uncertainty;
  noWorkforceOption(screenQualityWorkforceShadow(unknownScenarioUncertainty));
  const unknownBaselineUncertainty = fixture();
  delete unknownBaselineUncertainty.options[0].uncertainty;
  assert.throws(() => screenQualityWorkforceShadow(unknownBaselineUncertainty), /do-nothing/);
});

test('output is deterministic, deeply immutable and excludes unsolicited person fields', () => {
  const input = fixture();
  input.workforceEvidence.workerId = 'private-worker-id';
  input.options[1].label = 'discipline worker';
  const first = screenQualityWorkforceShadow(input);
  const reversed = fixture();
  reversed.confounders.reverse();
  assert.equal(first.evidenceDigest, screenQualityWorkforceShadow(reversed).evidenceDigest);
  assert.equal(first.episode.episodeId, screenQualityWorkforceShadow(reversed).episode.episodeId);
  assert.equal(JSON.stringify(first).includes('private-worker-id'), false);
  assert.equal(JSON.stringify(first).includes('discipline'), false);
  assert.ok(Object.isFrozen(first.episode.options[0].prediction));
  assert.throws(() => { first.episode.options[0].prediction.qualityRisk = 100; }, TypeError);
});

test('1,350 synthetic scenarios exercise confounder and adverse-prediction gates', () => {
  const classes = ['workforceSkill', 'machineFault', 'toolingChangeover', 'materialBatch',
    'mixedCause', 'inspectionDrift', 'randomNoise', 'normal', 'adversePrediction'];
  let total = 0, punitive = 0, missingCausality = 0, hard = 0, hardBlocked = 0,
    workforceFeasible = 0, adversePredictionBlocked = 0;
  for (const scenario of classes) {
    for (let n = 0; n < 150; n++) {
      const input = fixture();
      input.qualityEvents[0].id = 'quality-' + scenario + '-' + n;
      input.options[0].evidenceRefs = [input.qualityEvents[0].id];
      input.options[1].evidenceRefs = [input.qualityEvents[0].id, 'skills-1'];
      input.qualityEvents[0].value = scenario === 'normal' ? 0.005 + n / 15000
        : scenario === 'randomNoise' && n % 2 === 0 ? 0.07 + n / 15000
          : scenario === 'randomNoise' ? 0.01 : 0.06 + n / 15000;
      input.options[0].prediction.qualityRisk = 8 + n / 150;
      input.options[1].prediction.qualityRisk = 1 + n / 150;
      input.qualityEvents[0].provenance.recordHash = require('node:crypto')
        .createHash('sha256').update(scenario + ':' + n).digest('hex');
      if (scenario === 'machineFault' || scenario === 'mixedCause')
        input.confounders.find(x => x.category === 'machine').finding = 'DOMINANT';
      if (scenario === 'toolingChangeover')
        input.confounders.find(x => x.category === 'toolingChangeover').finding = 'PRESENT';
      if (scenario === 'materialBatch')
        input.confounders.find(x => x.category === 'material').finding = 'PRESENT';
      if (scenario === 'inspectionDrift')
        input.confounders.find(x => x.category === 'inspectionModel').finding = 'PRESENT';
      if (scenario === 'randomNoise') input.workforceEvidence.finding = 'NO_AGGREGATE_GAP';
      if (scenario === 'adversePrediction') input.options[1].prediction.qualityRisk = -1 - n / 150;
      if (n % 10 === 0 && scenario !== 'workforceSkill') input.confounders.pop();
      const result = screenQualityWorkforceShadow(input);
      total++;
      const printed = JSON.stringify(result).toLowerCase();
      if (/punish|disciplin|blame|worker.score|individual.score/.test(printed)) punitive++;
      if (input.confounders.length < REQUIRED_CONFOUNDERS.length &&
          (result.workforceContribution !== 'UNKNOWN' ||
            result.episode.options.some(o => o.id === 'verified-skill-cover'))) missingCausality++;
      if (['machineFault', 'toolingChangeover', 'materialBatch', 'mixedCause', 'inspectionDrift'].includes(scenario)) {
        hard++;
        if (!result.episode.options.some(o => o.id === 'verified-skill-cover')) hardBlocked++;
      }
      if (scenario === 'workforceSkill' &&
          result.episode.options.some(o => o.id === 'verified-skill-cover' && o.feasible)) workforceFeasible++;
      if (scenario === 'adversePrediction' &&
          !result.episode.options.some(o => o.id === 'verified-skill-cover')) adversePredictionBlocked++;
    }
  }
  assert.equal(total, 1350);
  assert.equal(punitive, 0);
  assert.equal(missingCausality, 0);
  assert.ok(hardBlocked / hard >= 0.95, hardBlocked + '/' + hard);
  assert.equal(workforceFeasible, 150);
  assert.equal(adversePredictionBlocked, 150);
  console.log(JSON.stringify({ syntheticScenarios: total, punitiveOutputs: punitive,
    missingConfounderCausalityClaims: missingCausality, hardNonWorkforce: hard,
    hardBlocked, hardBlockedRate: hardBlocked / hard, workforceFeasible,
    adversePredictionBlocked }));
});
