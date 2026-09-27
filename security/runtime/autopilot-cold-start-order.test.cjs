'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('fresh hosted bootstrap creates decision schema before Autopilot prepares its queries', () => {
  const source = fs.readFileSync(path.join(__dirname, 'bootstrap.cjs'), 'utf8');
  const demand = source.indexOf('demandDecisionService = createDemandDecisionService');
  const autopilot = source.indexOf('autopilotExecutionEngine = createAutopilotExecutionEngine');
  assert.notEqual(demand, -1, 'Decision Intelligence initialization missing.');
  assert.notEqual(autopilot, -1, 'Autopilot initialization missing.');
  assert.ok(demand < autopilot, 'Decision Intelligence must initialize before Autopilot on a fresh database.');
  assert.match(source, /WFM_AUTOPILOT_INIT_ERROR=/, 'Autopilot cold-start failures must be observable.');
});
