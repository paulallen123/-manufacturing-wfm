'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const files = [
  'verification/vector-v017-source-handoff/source-to-implementation.test.cjs',
  'verification/vector-v019-source-change/source-change.test.cjs'
];
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-pr542-receiving-'));
fs.chmodSync(temporary, 0o700);
const env = {
  PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
  TMPDIR: temporary,
  TZ: 'UTC',
  LANG: 'C',
  LC_ALL: 'C'
};
let result;
let remaining = [];
let removed = false;
try {
  result = spawnSync(process.execPath,
    ['--test', '--test-timeout=30000', '--test-concurrency=1', ...files],
    { cwd: root, env, encoding: 'utf8', timeout: 100000, maxBuffer: 4 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  remaining = fs.readdirSync(temporary);
  process.exitCode = result.error || result.signal || result.status === null || remaining.length
    ? 1 : result.status;
} catch (error) {
  process.stderr.write(String(error && error.message || error) + '\n');
  process.exitCode = 1;
} finally {
  try {
    remaining = fs.readdirSync(temporary);
    // A timeout/error does not establish child cleanup. Retain that fixture.
    if (result && !result.error && !result.signal && result.status !== null && remaining.length === 0) {
      fs.rmdirSync(temporary);
      removed = true;
    } else {
      process.stderr.write('PR542 fixture retained: ' + temporary + '\n');
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write('PR542 fixture cleanup failed: ' + String(error && error.message || error) + '\n');
    process.exitCode = 1;
  }
  process.stdout.write('VECTOR_PR542_ISOLATED_RECEIVING=' + JSON.stringify({
    runtime: process.version,
    childExit: result && result.status,
    signal: result && result.signal,
    errorCode: result && result.error && result.error.code || null,
    environmentKeys: Object.keys(env).sort(),
    remaining,
    removed
  }) + '\n');
}
