'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createZeroTouchCustomerFactory} = require('./zero-touch-customer-factory.cjs');
const pass = async job => ({status: 'PASS', evidence: {stage: job.id, customer: job.customerId}});

test('a missing executor cannot claim a customer is live', () => {
  assert.throws(() => createZeroTouchCustomerFactory(), /executor/i);
});

test('a factory cannot reuse another customer\'s completed work', async () => {
  const factory = createZeroTouchCustomerFactory({execute: pass});
  assert.equal((await factory.runUntilBlocked('customer-a')).state, 'LIVE');
  await assert.rejects(factory.runUntilBlocked('customer-b'), /customer.*bound|customer.*mismatch/i);
  assert.ok(factory.snapshot().every(job => job.customerId === 'customer-a'));
});

test('a failed integration connection blocks go-live', async () => {
  const factory = createZeroTouchCustomerFactory({execute: async job => job.id === 'CONNECTING'
    ? {status: 'FAIL', evidence: {reason: 'invalid credentials'}} : pass(job)});
  const result = await factory.runUntilBlocked('customer-a');
  assert.notEqual(result.state, 'LIVE');
  assert.notEqual(result.jobs.find(job => job.id === 'READY').status, 'PASS');
});

test('empty customer identity is refused before execution', async () => {
  let executed = 0;
  const factory = createZeroTouchCustomerFactory({execute: async job => { executed++; return pass(job); }});
  await assert.rejects(factory.runUntilBlocked(''), /customer/i);
  assert.equal(executed, 0);
});
