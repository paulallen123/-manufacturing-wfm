'use strict';

// Fail-first integration-support contract for the existing implementation owner.
// This file intentionally fails on canonical 48dce8f; do not relabel it a PASS.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  inferOrganisationModel,
  buildConfigurationProposal
} = require('../implementation/runtime/configuration-inference-engine.cjs');

const absentPopulations = [
  ['omitted', undefined],
  ['null', null],
  ['empty array', []],
  ['missing identity', [{ location: 'Synthetic site', department: 'Synthetic department' }]],
  ['blank identity', [{ employeeId: '   ', location: 'Synthetic site', department: 'Synthetic department' }]]
];

for (const [label, people] of absentPopulations) {
  test(`organisation inference reports zero people for ${label} source`, () => {
    const result = inferOrganisationModel(people);
    assert.equal(result.peopleCount, 0, label + ': a denominator guard must not invent a person');
    assert.deepEqual(result.sites, []);
  });

  test(`${label} workforce evidence cannot yield a confident automatic organisation proposal`, () => {
    const result = inferOrganisationModel(people);
    assert.equal(result.confidence, 0, label + ': no source observations means no confidence');
    assert.equal(result.autoApply, false, label + ': organisation review must remain required');
    assert.equal(result.status, 'EXCEPTION', label + ': use the existing exception contract');
  });

  test(`combined onboarding retains organisation review for ${label} source`, () => {
    const proposal = buildConfigurationProposal({ people });
    const decision = proposal.decisions.find(item => item.key === 'organisation-structure');
    assert.ok(decision, label + ': missing structure must reach the existing review queue');
    assert.equal(decision.reason, 'STRUCTURE_EXCEPTIONS');
    assert.equal(decision.detail.peopleCount, 0);
    assert.equal(decision.detail.autoApply, false);
    assert.equal(proposal.safety.payrollRulesAutoApplied, false);
  });
}

test('one evidenced synthetic employee retains existing proposed structure and source immutability', () => {
  const people = [{ employeeId: 'synthetic-1', managerId: null, location: 'Synthetic site',
    department: 'Synthetic department', jobTitle: 'Operator', employmentType: 'Full-time' }];
  const before = JSON.stringify(people);
  const result = inferOrganisationModel(people);
  assert.equal(result.peopleCount, 1);
  assert.equal(result.confidence, 1);
  assert.equal(result.autoApply, true);
  assert.equal(result.status, 'PROPOSED');
  assert.deepEqual(result.sites, [{ name: 'Synthetic site', departments: ['Synthetic department'] }]);
  const proposal = buildConfigurationProposal({ people });
  assert.equal(proposal.decisions.some(item => item.key === 'organisation-structure'), false);
  assert.equal(proposal.safety.payrollRulesAutoApplied, false);
  assert.equal(JSON.stringify(people), before);
});
