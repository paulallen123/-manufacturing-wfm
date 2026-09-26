const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const artifact = process.env.WFM_SEALED_RUNTIME_ARTIFACT
  ? path.resolve(process.env.WFM_SEALED_RUNTIME_ARTIFACT)
  : path.resolve(__dirname, '..', 'artifact', 'wfm-0.6.76-hosted-staging-rc1.tar.gz');
const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-payroll-adjustment-'));
execFileSync('tar', ['--no-same-owner', '-xzf', artifact, '-C', extractRoot]);
after(() => fs.rmSync(extractRoot, { recursive: true, force: true }));

const Core = require(path.join(extractRoot, 'public', 'core.js'));
const Engine = require(path.join(extractRoot, 'public', 'engine.js'));
const Cost = require(path.join(extractRoot, 'public', 'cost-engine.js'));
const Payroll = require(path.join(extractRoot, 'public', 'payroll-control.js'));

const proposer = {
  personId: 'd1',
  email: 'payroll-proposer@example.invalid',
  role: 'director',
  permissions: ['payroll.view', 'payroll.reopen', 'payroll.export'],
};

const approver = {
  personId: 'm1',
  email: 'payroll-approver@example.invalid',
  role: 'director',
  permissions: ['payroll.view', 'payroll.reopen', 'payroll.export'],
};

function releasedState() {
  const state = Payroll.decorate(Cost.decorate(Engine.decorate(Core.seed())));
  const period = state.payrollControl.periods[0];
  period.batches.push({
    id: 'B-RELEASED',
    status: 'released',
    checksum: 'f'.repeat(64),
  });
  const record = period.records.find((row) => row.employee === 'e0' && row.raw.kind === 'worked');
  assert.ok(record, 'fixture must include a priced worked record');
  return { state, period, record };
}

function proposalInput(period, record) {
  return {
    period: period.id,
    record: record.id,
    clockIn: record.raw.clockIn,
    clockOut: new Date(Date.parse(record.raw.clockOut) + 30 * 60_000).toISOString(),
    breaks: record.raw.breaks,
    breaksConfirmed: true,
    reason: 'Independent synthetic test of a post-release payroll correction.',
  };
}

test('server rejects a post-release adjustment without authoritative currency provenance', () => {
  const { state, period, record } = releasedState();
  assert.throws(
    () => Payroll.postReleaseAdjustment(state, proposer, proposalInput(period, record)),
    /currency|minor unit|cost evidence|authoritative/i,
  );
});

test('server rejects approval when the stored adjustment lacks currency provenance', () => {
  const { state, period, record } = releasedState();
  const created = Payroll.postReleaseAdjustment(state, proposer, proposalInput(period, record));
  assert.throws(
    () => Payroll.approvePostReleaseAdjustment(state, approver, {
      id: created.id,
      revision: 1,
      checked: true,
      decision: 'approve',
      reason: 'Independent reviewer confirms the adjustment evidence was inspected.',
    }),
    /currency|minor unit|cost evidence|authoritative/i,
  );
});

test('server refuses to export an approved adjustment without currency provenance', () => {
  const { state, period, record } = releasedState();
  const created = Payroll.postReleaseAdjustment(state, proposer, proposalInput(period, record));
  Payroll.approvePostReleaseAdjustment(state, approver, {
    id: created.id,
    revision: 1,
    checked: true,
    decision: 'approve',
    reason: 'Independent reviewer confirms the adjustment evidence was inspected.',
  });
  assert.throws(
    () => Payroll.exportPostReleaseAdjustments(state, approver, {
      period: period.id,
      checked: true,
    }, 'AB-UNBOUND'),
    /currency|minor unit|cost evidence|authoritative/i,
  );
});
