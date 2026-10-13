'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const modulePath = path.join(__dirname, 'aggregate-productivity-context.cjs');
const sourceFields = ['tenant', 'site', 'line', 'product', 'periodStart', 'periodEnd', 'sourceRef', 'sourceRevision', 'observedAt'];
function hash(source, metricFields) {
  return createHash('sha256').update(JSON.stringify([...sourceFields, ...metricFields].map(field => source[field]))).digest('hex');
}
function evaluate(input) {
  assert.equal(fs.existsSync(modulePath), true, 'aggregate productivity module must exist');
  return require(modulePath).summarizeAggregateProductivity(input);
}
function requireImplementation() { assert.equal(fs.existsSync(modulePath), true, 'aggregate productivity module must exist'); }
function fixture() {
  const scope = { tenant: 'synthetic-tenant', site: 'tamworth', line: 'line-4', product: 'product-a',
    periodStart: '2026-10-12T06:00:00.000Z', periodEnd: '2026-10-12T14:00:00.000Z' };
  const base = { ...scope, observedAt: '2026-10-12T15:00:00.000Z' };
  const production = { ...base, sourceRef: 'synthetic:mes:1', sourceRevision: 'mes-r1', goodUnits: 160, rejectedUnits: 40 };
  const workforce = { ...base, sourceRef: 'synthetic:wfm:1', sourceRevision: 'wfm-r1', directHours: 80, workerCount: 10 };
  production.sourceHash = hash(production, ['goodUnits', 'rejectedUnits']);
  workforce.sourceHash = hash(workforce, ['directHours', 'workerCount']);
  return { scope, production, workforce, now: '2026-10-13T10:00:00.000Z', maxEvidenceAgeMs: 129600000 };
}

test('produces only a scoped aggregate with no individual score or execution authority', () => {
  const result = evaluate(fixture());
  assert.equal(result.status, 'AGGREGATE_CONTEXT');
  assert.equal(result.goodUnitsPerDirectHour, 2);
  assert.equal(result.goodUnitYield, 0.8);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.claimBoundary, 'SITE_LINE_PRODUCT_CONTEXT_NOT_PERSON_PERFORMANCE_OR_CAUSAL_SAVING');
  assert.equal(JSON.stringify(result).includes('workerCount'), false);
});

test('suppresses numeric output for a small worker group', () => {
  const input = fixture();
  input.workforce.workerCount = 4;
  input.workforce.sourceHash = hash(input.workforce, ['directHours', 'workerCount']);
  const result = evaluate(input);
  assert.equal(result.status, 'SUPPRESSED');
  assert.equal(result.goodUnitsPerDirectHour, undefined);
  assert.equal(result.goodUnitYield, undefined);
  assert.equal(result.scope, undefined);
  assert.equal(result.sourceRefs, undefined);
  assert.equal(result.sourceHashes, undefined);
});

test('rejects mismatched source scope, altered counts and stale evidence', () => {
  requireImplementation();
  for (const change of [
    x => { x.workforce.site = 'other'; },
    x => { x.production.goodUnits = 999; },
    x => { x.production.observedAt = '2026-10-10T00:00:00.000Z'; }
  ]) { const input = fixture(); change(input); assert.throws(() => evaluate(input)); }
});

test('rejects individual identifiers and unsafe numeric evidence', () => {
  requireImplementation();
  for (const change of [
    x => { x.workforce.workerIds = ['person-1']; },
    x => { x.workforce.directHours = 0; },
    x => { x.workforce.directHours = Number.MIN_VALUE; x.workforce.sourceHash = hash(x.workforce, ['directHours', 'workerCount']); },
    x => { x.production.rejectedUnits = -1; }
  ]) { const input = fixture(); change(input); assert.throws(() => evaluate(input)); }
});
