'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const assess = require('./critical-skill-bench.cjs');

const NOW = '2026-10-18T12:00:00.000Z';
const START = '2026-10-17T00:00:00.000Z';
const END = '2026-10-19T00:00:00.000Z';
function seal(x) {
  const canonical = rows => rows.map(row => Object.keys(row).sort().map(key => [key, row[key]]))
    .sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  x.snapshot.contentDigest = createHash('sha256').update(JSON.stringify({
    requirements: canonical(x.requirements), qualifications: canonical(x.qualifications)
  })).digest('hex');
  return x;
}
function fixture() {
  const scoped = { tenantId: 't1', siteId: 's1', sourceRevision: 'r1' };
  const skill = (id, requiredCount) => ({ ...scoped, skillId: id, requiredCount,
    observedAt: NOW, validFrom: START, validUntil: END, evidenceRef: `requirement:${id}:r1` });
  const credential = (workerRef, skillId) => ({ ...scoped, workerRef, skillId, status: 'VALID', validFrom: START, validUntil: END, observedAt: NOW, evidenceRef: `qual:${workerRef}:${skillId}` });
  return seal({ tenantId: 't1', siteId: 's1', asOf: NOW,
    snapshot: { ...scoped, complete: true, observedAt: NOW, validUntil: END, evidenceRef: 'skills:complete:r1' },
    requirements: [skill('setter', 2), skill('welder', 2)],
    qualifications: [credential('w1','setter'),credential('w2','setter'),credential('w3','setter'),credential('w1','welder'),credential('w2','welder')]
  });
}

test('counts distinct current qualifications and tests one-worker-loss resilience', () => {
  const result = assess(fixture());
  assert.equal(result.status, 'ASSESSED');
  assert.deepEqual(result.skills, [
    { skillId: 'setter', requiredCount: 2, qualifiedCount: 3, gapCount: 0, oneWorkerLossCovered: true },
    { skillId: 'welder', requiredCount: 2, qualifiedCount: 2, gapCount: 0, oneWorkerLossCovered: false }
  ]);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.sourceAuthenticated, false);
  assert.equal(JSON.stringify(result).includes('w1'), false);
});

test('revoked or expired qualifications never count as bench cover', () => {
  const x = fixture(); x.qualifications[2].status = 'REVOKED'; seal(x);
  assert.equal(assess(x).skills[0].oneWorkerLossCovered, false);
  const y = fixture(); y.qualifications[2].validUntil = NOW; seal(y);
  assert.equal(assess(y).skills[0].qualifiedCount, 2);
});

test('incomplete, foreign, future, duplicate and inconsistent evidence blocks assessment', () => {
  const tampered = fixture(); tampered.requirements[0].requiredCount = 3;
  assert.equal(assess(tampered).reason, 'SNAPSHOT_CONTENT_MISMATCH');
  const nullRow = fixture(); nullRow.requirements = [null];
  assert.equal(assess(nullRow).status, 'BLOCKED');
  const changes = [
    x => { x.snapshot.complete = false; },
    x => { x.snapshot.siteId = 's2'; },
    x => { x.snapshot.validUntil = NOW; },
    x => { x.snapshot.observedAt = END; },
    x => { x.qualifications[0].tenantId = 't2'; },
    x => { x.qualifications[0].sourceRevision = 'r2'; },
    x => { x.qualifications[0].observedAt = END; },
    x => { x.qualifications.push({...x.qualifications[0]}); },
    x => { x.qualifications[0].skillId = 'unknown'; },
    x => { x.requirements[0].requiredCount = 0; },
    x => { x.requirements[0].tenantId = 't2'; },
    x => { x.requirements[0].sourceRevision = 'r2'; },
    x => { x.requirements[0].validUntil = NOW; },
    x => { x.requirements[0].validFrom = 'bogus'; },
    x => { x.qualifications[0].observedAt = '2026-10-18T12:01:00.000Z'; x.asOf = '2026-10-18T12:02:00.000Z'; },
    x => { x.qualifications[0].workerName = 'private'; }
  ];
  for (const change of changes) { const x = fixture(); change(x); seal(x); assert.equal(assess(x).status, 'BLOCKED'); }
});
