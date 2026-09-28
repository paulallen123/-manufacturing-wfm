import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const journey = fs.readFileSync(path.join(root, 'scripts/current-candidate-role-browser-proof.mjs'), 'utf8');
const result = fs.readFileSync(path.join(root, 'scripts/vector-proof-result.mjs'), 'utf8');

test('canonical leave browser proof requires audit linkage to its exact request', () => {
  const start = journey.indexOf('const leaveJourney = {');
  const end = journey.indexOf('const attendanceJourney = {');
  assert.ok(start >= 0 && end > start, 'Leave journey block is unavailable.');
  const leaveBlock = journey.slice(start, end);

  assert.match(leaveBlock, /requestAuditLinked:\s*false/);
  assert.match(leaveBlock, /item\.type === 'leave-decision'/);
  assert.match(leaveBlock, /item\.note === `\$\{id\}; approved`/);
  assert.match(leaveBlock, /leaveJourney\.requestAuditLinked = true/);
  assert.match(result, /'requestAuditLinked'/);
});
