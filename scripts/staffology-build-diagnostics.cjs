'use strict';
// Public build output is an allowlist. Full messages, values, stacks and process
// output belong only in the discarded proof stage's private files.
const {readdirSync, writeSync} = require('node:fs');
const {resolve, relative} = require('node:path');
const root = resolve(__dirname, '..');
const directory = resolve(root, 'integrations/staffology');
const files = new Map([
 ...readdirSync(directory).filter(name => name.endsWith('.test.cjs')).map(name => resolve(directory, name)),
 ...['succession-regressions', 'current-authority-recovery-held-out', 'docker-admission-contract', 'generated-provider-preload', 'full-http-employee-journey'].map(name => resolve(directory, 'independent', name+'.test.cjs'))
].map(file => [file, relative(root, file)]));
const codes = new Set(['ERR_ASSERTION', 'ERR_TEST_FAILURE', 'MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_REQUIRE_ESM', 'ERR_UNKNOWN_BUILTIN_MODULE', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ERR_SQLITE_ERROR', 'SQLITE_ERROR', 'ENOENT', 'EACCES', 'EADDRINUSE', 'ECONNREFUSED', 'ETIMEDOUT']);
const operators = new Set(['fail', 'ok', 'equal', 'notEqual', 'strictEqual', 'notStrictEqual', 'deepEqual', 'notDeepEqual', 'deepStrictEqual', 'notDeepStrictEqual', 'match', 'doesNotMatch', 'throws', 'doesNotThrow', 'rejects', 'doesNotReject', 'ifError']);
const failureTypes = new Set(['testCodeFailure', 'subtestsFailed', 'cancelledByParent', 'testTimeoutFailure', 'testAborted']);
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const selected = file => typeof file === 'string' && files.has(file) ? files.get(file) : 'unavailable';
function assertionLocation(error, fallback) {
 // Extract only a known source filename followed by numeric coordinates. Never
 // emit any other part of the error stack, including its message or source text.
 const stack = typeof error?.stack === 'string' ? error.stack : '';
 for (const frame of stack.split('\n').filter(line => /^\s+at /.test(line))) {
  for (const [file, name] of files) {
   const at = frame.indexOf(file+':');
   if (at < 0) continue;
   const coordinates = /^(\d+):(\d+)\)?$/.exec(frame.slice(at+file.length+1));
   if (coordinates) return name+':'+number(Number(coordinates[1]))+':'+number(Number(coordinates[2]));
  }
 }
 return selected(fallback.file)+':'+number(fallback.line)+':'+number(fallback.column);
}
// FD3 is the shell's dedicated public channel; stdout/stderr remain private.
// Reporter destinations that open /dev/fd/3 fsync the pipe on Node 22 and can
// turn a passing admission into an EINVAL failure. Do not reopen this descriptor.
const emit = line => { try { writeSync(3, line); } catch {} };
module.exports = async function* staffologyBuildDiagnostics(source) {
 let failed = false;
 const started = new Set();
 emit('STAFFOLOGY_DIAGNOSTIC reporter=ready\n');
 for await (const {type, data} of source) {
  if (type === 'test:dequeue' && !started.has(data.file) && files.has(data.file)) {
   started.add(data.file);
   emit('STAFFOLOGY_DIAGNOSTIC file='+selected(data.file)+' stage=running\n');
  }
  if (type === 'test:fail' && !failed) {
   failed = true;
   const outer = data.details?.error;
   const error = outer?.cause || outer;
   emit('STAFFOLOGY_DIAGNOSTIC first_failure='+assertionLocation(error, data)
    +' code='+(codes.has(error?.code) ? error.code : 'unavailable')
    +' operator='+(operators.has(error?.operator) ? error.operator : 'unavailable')
    +' failure_type='+(failureTypes.has(outer?.failureType) ? outer.failureType : 'unavailable')+'\n');
  }
  if (type === 'test:summary' && data.file === undefined) {
   const counts = data.counts || {};
   emit('STAFFOLOGY_DIAGNOSTIC summary tests='+number(counts.tests)+' passed='+number(counts.passed)
    +' failed='+number(counts.failed)+' cancelled='+number(counts.cancelled)+' skipped='+number(counts.skipped)+'\n');
  }
 }
};
