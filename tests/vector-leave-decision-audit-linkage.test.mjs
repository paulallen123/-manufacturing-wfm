import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = process.env.WFM_TEST_RUNTIME_ARCHIVE || path.join(root, 'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
const hardener = path.join(root, 'scripts/harden-leave-audit-linkage.mjs');

function runtimeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-leave-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const extracted = spawnSync('tar', ['--no-same-owner', '-xzf', archive, '-C', root], { encoding: 'utf8' });
  assert.equal(extracted.status, 0, extracted.stderr);
  if (fs.existsSync(hardener)) {
    const hardened = spawnSync(process.execPath, [hardener, path.join(root, 'public')], { encoding: 'utf8' });
    assert.equal(hardened.status, 0, hardened.stderr);
  }
  return root;
}

test('a leave decision domain audit is bound to the exact request', t => {
  const root = runtimeFixture(t);
  const rules = require(path.join(root, 'public/work-rules.js'));
  const state = {
    requests: [{
      id: 'leave-request-123',
      employee: 'employee-1',
      status: 'pending',
      start: '2026-10-05T06:00:00.000Z',
      end: '2026-10-05T14:00:00.000Z',
      hours: 7.5
    }],
    staff: [{ id: 'employee-1', manager: 'manager-1' }],
    org: [{ id: 'manager-1', parent: null }],
    audit: []
  };
  const actor = { personId: 'manager-1', role: 'manager' };

  const result = rules.decideLeave(state, actor, {
    id: 'leave-request-123',
    decision: 'declined',
    reviewed: true,
    reason: 'Synthetic coverage review evidence.'
  });

  assert.deepEqual(result, { id: 'leave-request-123', status: 'declined' });
  assert.equal(state.audit.length, 1);
  assert.deepEqual(
    {
      by: state.audit[0].by,
      employee: state.audit[0].employee,
      type: state.audit[0].type,
      note: state.audit[0].note
    },
    {
      by: 'manager-1',
      employee: 'employee-1',
      type: 'leave-decision',
      note: 'leave-request-123; declined'
    }
  );
});
