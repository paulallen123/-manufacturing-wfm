'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, writeFileSync, readFileSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {resolve, join} = require('node:path');
const {spawnSync} = require('node:child_process');
const root = resolve(__dirname, '../..');
const reporter = resolve(root, 'scripts/staffology-build-diagnostics.cjs');
const secret = 'DIAGNOSTIC_PRIVATE_SENTINEL_7342';
const wrapper = `set +e; printf 'STAFFOLOGY_ADMISSION stage=start\\n' >&2; "$@" 3>&2 > "$STAFFOLOGY_CONTROL_LOG" 2>&1; status=$?; printf 'STAFFOLOGY_ADMISSION stage=exit status=%s\\n' "$status" >&2; exit "$status"`;
function inTemporaryDirectory(run) {
 const directory = mkdtempSync(join(tmpdir(), 'staffology-diagnostics-'));
 try { run(directory); } finally { rmSync(directory, {recursive:true, force:true}); }
}
function execute(directory, args) {
 const env = {...process.env, STAFFOLOGY_CONTROL_LOG:join(directory, 'runner-private.log')};
 delete env.NODE_TEST_CONTEXT;
 return spawnSync('/bin/sh', ['-c', wrapper, 'staffology-control', process.execPath, ...args], {
  cwd:root, encoding:'utf8', env, timeout:10000
 });
}
for (const code of [0, 1, 137]) test('admission shell preserves exit '+code+' and keeps raw output private', () => inTemporaryDirectory(directory => {
 const result = execute(directory, ['-e', `console.log('${secret}'); console.error('${secret}'); process.exit(${code})`]);
 assert.equal(result.status, code, result.stderr);
 assert.equal(result.signal, null);
 assert.doesNotMatch(result.stdout+result.stderr, new RegExp(secret));
 assert.match(result.stderr, new RegExp('stage=exit status='+code));
 assert.match(readFileSync(join(directory, 'runner-private.log'), 'utf8'), new RegExp(secret));
}));
test('admission shell preserves signal-derived exit137', () => inTemporaryDirectory(directory => {
 const result = execute(directory, ['-e', `console.log('${secret}'); process.kill(process.pid, 'SIGKILL')`]);
 assert.equal(result.status, 137, result.stderr);
 assert.match(result.stderr, /stage=exit status=137/);
 assert.doesNotMatch(result.stdout+result.stderr, new RegExp(secret));
}));
test('dual reporters keep a passing test successful and full TAP private', () => inTemporaryDirectory(directory => {
 const fixture = join(directory, 'pass.test.cjs'), tap = join(directory, 'private.tap');
 writeFileSync(fixture, `require('node:test')('${secret}',()=>{console.log('${secret}');console.error('${secret}');});`);
 const result = execute(directory, ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-reporter-destination='+tap, '--test-reporter='+reporter, '--test-reporter-destination=stdout', fixture]);
 assert.equal(result.status, 0, result.stderr);
 assert.match(result.stderr, /reporter=ready/);
 assert.match(result.stderr, /summary tests=1 passed=1 failed=0/);
 assert.doesNotMatch(result.stdout+result.stderr, new RegExp(secret));
 assert.match(readFileSync(tap,'utf8'), new RegExp(secret));
}));
test('first assertion failure streams only safe metadata and preserves exit1', () => inTemporaryDirectory(directory => {
 const fixture = join(directory, 'fail.test.cjs'), tap = join(directory, 'private.tap');
 writeFileSync(fixture, `require('node:test')('${secret}',()=>{console.log('${secret}');require('node:assert/strict').equal('${secret}', 'different', '${secret}');});`);
 const result = execute(directory, ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-reporter-destination='+tap, '--test-reporter='+reporter, '--test-reporter-destination=stdout', fixture]);
 assert.equal(result.status, 1, result.stderr);
 assert.match(result.stderr, /first_failure=unavailable:\d+:\d+ code=ERR_ASSERTION operator=strictEqual failure_type=testCodeFailure/);
 assert.equal((result.stderr.match(/first_failure=/g)||[]).length, 1);
 assert.doesNotMatch(result.stdout+result.stderr, new RegExp(secret));
 assert.match(readFileSync(tap,'utf8'), new RegExp(secret));
}));
test('fatal runner startup stays private while its failure status remains public', () => inTemporaryDirectory(directory => {
 const preload = join(directory, 'fatal.cjs');
 writeFileSync(preload, `throw Error('${secret}');`);
 const result = execute(directory, ['--require', preload, '--test', '--test-reporter='+reporter, '--test-reporter-destination=stdout', join(directory, 'absent.test.cjs')]);
 assert.equal(result.status, 1);
 assert.doesNotMatch(result.stdout+result.stderr, new RegExp(secret));
 assert.match(result.stderr, /stage=exit status=1/);
 assert.match(readFileSync(join(directory,'runner-private.log'),'utf8'), new RegExp(secret));
}));
test('diagnostics reject arbitrary event strings and emit known assertion coordinates', () => {
 const known = resolve(__dirname, 'staffology-adapter.test.cjs');
 const events = [
  {type:'test:stdout', data:{message:secret}},
  {type:'test:stderr', data:{message:secret}},
  {type:'test:diagnostic', data:{message:secret}},
  {type:'test:fail', data:{name:secret, file:known, line:2, column:3, details:{error:{failureType:secret, cause:{code:secret, operator:secret, message:secret, actual:secret, expected:secret, stack:secret+' '+known+':123:4\n    at TestContext.<anonymous> ('+known+':72:9)'}}}}},
  {type:'test:fail', data:{name:secret}},
  {type:'test:summary', data:{counts:{tests:2, passed:1, failed:1, cancelled:secret, skipped:-1}}}
 ];
 const script = `const reporter=require(process.argv[1]); const events=JSON.parse(process.argv[2]); (async()=>{for await (const ignored of reporter((async function*(){yield* events})())){}})().catch(()=>process.exit(1));`;
 const result = spawnSync(process.execPath, ['-e', script, reporter, JSON.stringify(events)], {encoding:'utf8', stdio:['ignore','pipe','pipe','pipe'], timeout:10000});
 assert.equal(result.status, 0, result.stderr);
 const publicOutput = result.output[3];
 assert.match(publicOutput, /first_failure=integrations\/staffology\/staffology-adapter.test.cjs:72:9 code=unavailable operator=unavailable failure_type=unavailable/);
 assert.equal((publicOutput.match(/first_failure=/g)||[]).length, 1);
 assert.match(publicOutput, /summary tests=2 passed=1 failed=1 cancelled=0 skipped=0/);
 assert.doesNotMatch(publicOutput, new RegExp(secret));
});
