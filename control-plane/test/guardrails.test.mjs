import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const readinessFiles = [
  'lib/engine.js',
  'lib/dispatch.js',
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

test('task consumer delegates only to the bounded signed dispatcher', () => {
  const route = fs.readFileSync(path.join(root, 'app/api/queues/control-tasks/route.js'), 'utf8');
  const dispatcher = fs.readFileSync(path.join(root, 'lib/dispatch.js'), 'utf8');

  assert.match(route, /dispatchProofTask\(task\)/);
  assert.doesNotMatch(route, /\bfetch\s*\(/);
  assert.doesNotMatch(route, /child_process|execFile|spawn\s*\(/);

  assert.match(dispatcher, /VECTOR_CONTROL_PLANE_DISPATCH_MODE/);
  assert.match(dispatcher, /DISPATCH_ENDPOINT_REQUIRES_HTTPS/);
  assert.match(dispatcher, /createHmac\('sha256'/);
  assert.match(dispatcher, /LANE_DEFINITIONS\[task\.laneId\]/);
  assert.doesNotMatch(dispatcher, /task\.(?:url|endpoint|callbackUrl)/);
  assert.doesNotMatch(dispatcher, /child_process|execFile|spawn\s*\(/);
});
