'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const run = spawnSync(process.execPath, [path.join(__dirname, 'revised-adjacent-observations.cjs')], { encoding: 'utf8', env: process.env });
assert.equal(run.status, 0, run.stderr);
const records = JSON.parse(run.stdout).observations;

for (const name of ['stale sync', 'slow latency', 'pending retry']) {
  for (const state of ['CLAIM_EXPIRED', 'COMPLETION_UNCERTAIN']) {
    test(`${state} truthfully preserves ${name} degradation and maintenance reason while permitting safe continuation`, () => {
      const row = records.find((item) => item.case === name && item.maintenanceExecution === state);
      assert.ok(row, 'independent fixture observation is missing');
      assert.equal(row.direct, 'DEGRADED');
      assert.equal(row.summary, 'DEGRADED');
      assert.equal(row.canSync, true);
      assert.equal(row.runtimeSignal, 'DEGRADED');
      assert.equal(row.maintenanceExecutionState, state);
      assert.equal(row.providerSignal, state === 'CLAIM_EXPIRED' ? 'RETRYING' : 'OUTCOME_UNCERTAIN');
      assert.match(row.customerMessage, /freshness|latency|retr(?:y|ies)|degrad/i);
      assert.match(row.customerMessage, state === 'CLAIM_EXPIRED' ? /expired before completion/i : /not confirmed the outcome/i);
    });
  }
}
