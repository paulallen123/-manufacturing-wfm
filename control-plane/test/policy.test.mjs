import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueFailureDomainIds } from '../lib/policy.js';

test('multiple Railway services count as one failure domain', () => {
  assert.deepEqual(
    uniqueFailureDomainIds(['railway-proof-workers', 'northstar-railway']),
    ['railway-proof-workers'],
  );
});

test('a genuinely separate provider lane increases unique failure-domain count', () => {
  assert.equal(
    uniqueFailureDomainIds(['railway-proof-workers', 'github-actions']).length,
    2,
  );
});
