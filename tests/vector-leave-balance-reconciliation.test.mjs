import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { roleProofResult } from '../scripts/vector-proof-result.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = process.env.WFM_TEST_RUNTIME_ARCHIVE || path.join(root, 'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');

function runtimeOperations(t) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-leave-balance-'));
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  const extracted = spawnSync('tar', ['--no-same-owner', '-xzf', archive, '-C', runtime], { encoding: 'utf8' });
  assert.equal(extracted.status, 0, extracted.stderr);
  return require(path.join(runtime, 'public/operations-engine.js'));
}

const completeLeaveJourney = {
  employeeUiSubmitted: true,
  pendingStateReadBack: true,
  overlapRefusedInUi: true,
  refreshedUiRetainedPending: true,
  managerUiDecided: true,
  managerStateReadBack: true,
  requestAuditLinked: true,
  freshEmployeeLoginSawDecision: true
};

test('approved leave transfers the reserved minutes from pending to booked without a second balance debit', t => {
  const operations = runtimeOperations(t);
  const state = {
    org: [],
    staff: [{ id: 'e1', name: 'One Person', site: 'One Site', team: 'One Team' }],
    requests: [{ id: 'r1', employee: 'e1', date: '2026-10-01', hours: 7.5, status: 'pending' }],
    operations: {
      leaveOpenings: {
        e1: {
          yearStart: '2026-01-01',
          yearEnd: '2026-12-31',
          asOf: '2026-09-14',
          remainingMinutes: 5400,
          usedBeforeMinutes: 7200,
          annualMinutes: 12600,
          source: 'Synthetic reviewed opening',
          revision: 1
        }
      }
    },
    workRules: { leaveBalances: {}, roster: [] }
  };

  const pending = operations.leaveRow(state, 'e1');
  assert.deepEqual(
    {
      bookedMinutes: pending.bookedMinutes,
      pendingMinutes: pending.pendingMinutes,
      remainingMinutes: pending.remainingMinutes,
      availableMinutes: pending.availableMinutes
    },
    { bookedMinutes: 0, pendingMinutes: 450, remainingMinutes: 5400, availableMinutes: 4950 }
  );

  state.requests[0].status = 'approved';
  const approved = operations.leaveRow(state, 'e1');
  assert.deepEqual(
    {
      bookedMinutes: approved.bookedMinutes,
      pendingMinutes: approved.pendingMinutes,
      remainingMinutes: approved.remainingMinutes,
      availableMinutes: approved.availableMinutes
    },
    { bookedMinutes: 450, pendingMinutes: 0, remainingMinutes: 4950, availableMinutes: 4950 }
  );
});

test('leave proof rejects an approved fresh-login status without reconciled balance evidence', () => {
  const result = roleProofResult({ status: 'BOUND' }, completeLeaveJourney, null);
  assert.equal(result.scopedLeaveJourneyVerified, false);
  assert.ok(result.missingEvidence.includes('leave-balance-reconciliation'));
});

test('leave proof accepts the complete status, audit and balance transition together', () => {
  const result = roleProofResult(
    { status: 'BOUND' },
    { ...completeLeaveJourney, freshBalanceReconciled: true },
    null
  );
  assert.equal(result.scopedLeaveJourneyVerified, true);
  assert.equal(result.missingEvidence.includes('leave-balance-reconciliation'), false);
});
