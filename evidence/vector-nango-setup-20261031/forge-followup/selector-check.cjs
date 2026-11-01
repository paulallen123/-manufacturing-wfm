'use strict';
// Local proof of dispatch and failure propagation; no validation subprocess runs here.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const candidate = path.resolve(process.argv[2] || 'scripts/run-forge-ci.mjs');
const baseline = path.resolve(process.argv[3] || 'baseline/scripts/run-forge-ci.mjs');
const required = [
  'integration/runtime/nango-credential-provider.test.cjs',
  'integration/runtime/nango-metadata-broker.test.cjs',
  'scripts/nango-metadata-wiring.test.cjs'
];
const importLine = "import { spawnSync } from 'node:child_process';";
function inspect(file, failAt) {
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.split(importLine).length, 2, 'one process-boundary import');
  const calls = [], logs = [];
  let exitCode = 0;
  const stop = {};
  const context = {
    spawnSync(command, args, options) {
      calls.push({ command, args: Array.from(args), stdio: options.stdio });
      return { status: args[0] === failAt ? 17 : 0 };
    },
    process: { execPath: '/fixture/node', env: {}, exit(code) { exitCode = code; throw stop; } },
    console: { log: value => logs.push(String(value)), error: value => logs.push(String(value)) }
  };
  try { new vm.Script(raw.replace(importLine, ''), { filename: file }).runInNewContext(context); }
  catch (error) { if (error !== stop) throw error; }
  return { calls, logs, exitCode };
}
const before = inspect(baseline), after = inspect(candidate);
assert.equal(after.exitCode, 0);
for (const file of required) {
  assert.equal(after.calls.filter(call => call.command === '/fixture/node' && call.args.length === 1 && call.args[0] === file).length, 1,
    'required Nango source suite must be dispatched once: ' + file);
}
assert.deepEqual(after.calls.filter(call => !required.includes(call.args[0])), before.calls,
  'all existing command arguments, order, Node selection and inherited output remain unchanged');
assert.equal(after.logs.at(-1), '\nVECTOR_FORGE_CORE_CI=PASS');
for (const file of required) {
  const failed = inspect(candidate, file);
  assert.equal(failed.exitCode, 17, 'a failed Nango suite must fail the validation process');
  assert.equal(failed.calls.at(-1).args[0], file, 'stop dispatching at the failing suite');
  assert.equal(failed.logs.some(line => line.includes('VECTOR_FORGE_CORE_CI=PASS')), false,
    'a failed Nango suite must not publish the source-validation success marker');
}
console.log(JSON.stringify({
  scope: 'actual Forge dispatcher with only child-process execution stubbed',
  requiredSuites: required,
  requiredSuiteCalls: 3,
  priorCommandsPreserved: before.calls.length,
  failureCases: 3,
  failureExitCode: 17,
  successMarkerWithFailure: false,
  result: 'PASS'
}, null, 2));
