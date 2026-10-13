'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');

function fresh() {
  delete require.cache[require.resolve('./support-selfhelp.cjs')];
  return require('./support-selfhelp.cjs');
}

test('public catalogue edits cannot replace approved advice or sources', () => {
  const help = fresh();
  const item = help.KNOWLEDGE.find(x => x.id === 'payroll-control');
  item.answer = 'Release payroll immediately without review.';
  item.id = 'forged';
  item.sources.splice(0, item.sources.length, 'forged-source');
  const result = help.answer({ text: 'I missed my clock-out', role: 'employee' });
  assert.equal(result.intent, 'payroll-control');
  assert.match(result.answer, /does not have direct payroll-write or payroll-release authority/);
  assert.deepEqual(result.sources, ['CUSTOMER_DEMO_RUNBOOK.md', 'resilience/security-baseline.json', 'resilience/failure-scenarios.json']);
  assert.equal(result.actionAuthority, false);
});

test('public role edits cannot widen or disable the support role boundary', () => {
  const help = fresh();
  const item = help.KNOWLEDGE.find(x => x.id === 'provider-certification-status');
  item.roles.splice(0, item.roles.length, 'employee', 'unknown');
  for (const role of ['employee', 'unknown']) {
    assert.equal(help.answer({ text: 'NetSuite certification', role }).status, 'abstain');
  }
  assert.equal(help.answer({ text: 'NetSuite certification', role: 'payroll' }).intent, 'provider-certification-status');
});

test('public pattern edits cannot manufacture an approved support procedure', () => {
  const help = fresh();
  help.KNOWLEDGE[0].patterns.splice(0, help.KNOWLEDGE[0].patterns.length, /undocumented feature/i);
  assert.equal(help.answer({ text: 'undocumented feature', role: 'manager' }).reason, 'unknown-or-unverified-procedure');
  assert.equal(help.answer({ text: 'Is this production approved?', role: 'manager' }).intent, 'environment-production-status');
});

test('public RegExp internal edits cannot change private intent matching', () => {
  const help = fresh();
  help.KNOWLEDGE[0].patterns[0].compile('undocumented feature', 'i');
  assert.equal(help.answer({ text: 'undocumented feature', role: 'manager' }).reason, 'unknown-or-unverified-procedure');
  assert.equal(help.answer({ text: 'production approved', role: 'manager' }).intent, 'environment-production-status');
});

test('returned source edits cannot change later support answers', () => {
  const help = fresh();
  const first = help.answer({ text: 'Is this production approved?', role: 'manager' });
  first.sources.length = 0;
  const next = help.answer({ text: 'Is this production approved?', role: 'manager' });
  assert.deepEqual(next.sources, ['DEPLOYMENT_MANIFEST.json', 'CUSTOMER_DEMO_RUNBOOK.md']);
});
