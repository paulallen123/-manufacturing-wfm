import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function source(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('Workflow uses current createHook/resumeHook contract', () => {
  const workflow = source('workflows/candidate-control.js');
  const queueRoute = source('app/api/queues/control-events/route.js');

  assert.match(workflow, /import\s*\{\s*createHook\s*\}\s*from\s*['"]workflow['"]/);
  assert.doesNotMatch(workflow, /defineHook|controlEventHook/);
  assert.match(workflow, /createHook\(\{\s*token:\s*state\.candidateToken\s*\}\)/);

  assert.match(queueRoute, /import\s*\{\s*resumeHook\s*\}\s*from\s*['"]workflow\/api['"]/);
  assert.match(queueRoute, /resumeHook\(event\.candidateToken,\s*event\)/);
  assert.doesNotMatch(queueRoute, /controlEventHook/);
});

test('candidate initialization with Node crypto occurs only inside a step', () => {
  const workflow = source('workflows/candidate-control.js');
  assert.match(workflow, /let state = await initializeCandidate\(seed\.candidate\)/);
  assert.match(workflow, /async function initializeCandidate\(candidate\)\s*\{\s*['"]use step['"];\s*return createInitialState\(candidate\);/s);
  assert.doesNotMatch(workflow, /let state = createInitialState\(seed\.candidate\)/);
});

test('queue fan-out uses task idempotency keys', () => {
  const workflow = source('workflows/candidate-control.js');
  assert.match(workflow, /send\('vector-control-tasks',\s*task,\s*\{\s*idempotencyKey:\s*task\.idempotencyKey\s*\}\)/);
});

test('signed ingress uses event idempotency and bounds its key length', () => {
  const ingest = source('app/api/ingest/route.js');
  assert.match(ingest, /event\.eventId\.length > 256/);
  assert.match(ingest, /send\('vector-control-events',\s*event,\s*\{\s*idempotencyKey:\s*event\.eventId\s*\}\)/);
});
