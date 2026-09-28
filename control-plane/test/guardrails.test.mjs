import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const readinessFiles = [
  'lib/engine.js',
  'workflows/candidate-control.js',
  'app/api/candidates/start/route.js',
  'app/api/ingest/route.js',
  'app/api/queues/control-events/route.js',
  'app/api/queues/control-tasks/route.js',
];

test('readiness orchestration contains no fixed sleep/timer readiness loops', () => {
  for (const relative of readinessFiles) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.doesNotMatch(source, /\b(?:setTimeout|setInterval|waitForTimeout)\s*\(/, `${relative} contains timer-based readiness`);
    assert.doesNotMatch(source, /\b(?:sleep|delay)\s*\(/, `${relative} contains fixed-delay readiness`);
  }
});

test('Phase A task consumer remains shadow-only and has no outbound mutation primitive', () => {
  const source = fs.readFileSync(path.join(root, 'app/api/queues/control-tasks/route.js'), 'utf8');
  assert.match(source, /SHADOW_WOULD_DISPATCH/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /child_process|execFile|spawn\s*\(/);
});
