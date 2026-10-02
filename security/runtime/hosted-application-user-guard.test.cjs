'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { enforceHostedApplicationUser } = require('./hosted-application-user-guard.cjs');

test('hosted application rejects root and unavailable identity evidence', () => {
  assert.throws(() => enforceHostedApplicationUser({ hosted: true, geteuid: () => 0 }), /WFM_HOSTED_APPLICATION_ROOT_FORBIDDEN/);
  assert.throws(() => enforceHostedApplicationUser({ hosted: true, geteuid: null }), /WFM_HOSTED_APPLICATION_UID_UNAVAILABLE/);
  assert.throws(() => enforceHostedApplicationUser({ hosted: true, geteuid: () => '1000' }), /WFM_HOSTED_APPLICATION_ROOT_FORBIDDEN/);
});

test('hosted application accepts a real non-root uid and does not constrain build admission', () => {
  assert.deepEqual(enforceHostedApplicationUser({ hosted: true, geteuid: () => 1000 }), { enforced: true, uid: 1000 });
  assert.deepEqual(enforceHostedApplicationUser({ hosted: false, geteuid: () => 0 }), { enforced: false });
});
