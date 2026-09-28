import { spawnSync } from 'node:child_process';

const cases = [
  ['24x7-soak', 'clocking-security-v2/attendance-24x7-soak.test.mjs'],
  ['enterprise-scale', 'clocking-security-v2/attendance-enterprise-scale.test.mjs'],
  ['live-certification', 'clocking-security-v2/attendance-certification-live.test.mjs'],
];

const results = [];
let failed = false;

for (const [name, file] of cases) {
  console.log('VECTOR_CRITICAL_ATTENDANCE_ASSAULT_START=' + name + '|file=' + file);
  const run = spawnSync(process.execPath, ['--test', file], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = String(run.stdout || '');
  const stderr = String(run.stderr || '');
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  const ok = run.status === 0;
  failed ||= !ok;
  results.push({ name, file, status: ok ? 'PASS' : 'FAIL', exitCode: run.status });
  console.log('VECTOR_CRITICAL_ATTENDANCE_ASSAULT_RESULT=' + JSON.stringify(results.at(-1)));
}

console.log('VECTOR_CRITICAL_ATTENDANCE_ASSAULT_SUMMARY=' + JSON.stringify(results));
if (failed) process.exit(1);
