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
  personId: 'd1', email: 'payroll-proposer@example.invalid', role: 'director',
  permissions: ['payroll.view', 'payroll.reopen', 'payroll.export'],
};
const approver = {
  personId: 'm1', email: 'payroll-approver@example.invalid', role: 'director',
  permissions: ['payroll.view', 'payroll.reopen', 'payroll.export'],
};

function releasedState() {
  const state = Payroll.decorate(Cost.decorate(Engine.decorate(Core.seed())));
  const period = state.payrollControl.periods[0];
  period.batches.push({ id: 'B-RELEASED', status: 'released', checksum: 'f'.repeat(64) });
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

function propose(state, period, record) {
  return Payroll.postReleaseAdjustment(state, proposer, proposalInput(period, record));
}

function approve(state, created) {
  return Payroll.approvePostReleaseAdjustment(state, approver, {
    id: created.id,
    revision: 1,
    checked: true,
    decision: 'approve',
    reason: 'Independent reviewer confirms the adjustment evidence was inspected.',
  });
}

test('proposal derives and stores authoritative monetary provenance from reviewed cost evidence', () => {
  const { state, period, record } = releasedState();
  const created = propose(state, period, record);
  const stored = state.payrollControl.adjustments.find((row) => row.id === created.id);
  assert.equal(stored.currency, 'GBP');
  assert.equal(stored.minorUnitExponent, 2);
  assert.equal(stored.currencySource, 'reviewed_cost_evidence');
  assert.equal(stored.grossMinorDelta, 900);
  assert.ok(Number.isSafeInteger(stored.grossMinorDelta));
});

test('proposal rejects pricing without authoritative currency evidence', () => {
  const { state, period, record } = releasedState();
  state.costing.rates[record.employee][0].currency = 'EUR';
  assert.throws(
    () => propose(state, period, record),
    /currency|minor unit|cost evidence|authoritative|priced/i,
  );
});

test('approval rejects a stored adjustment after monetary provenance is removed', () => {
  const { state, period, record } = releasedState();
  const created = propose(state, period, record);
  const stored = state.payrollControl.adjustments.find((row) => row.id === created.id);
  delete stored.currencySource;
  assert.throws(() => approve(state, created), /currency|minor unit|cost evidence|authoritative/i);
});

test('approval rejects an unsafe stored minor-unit amount', () => {
  const { state, period, record } = releasedState();
  const created = propose(state, period, record);
  const stored = state.payrollControl.adjustments.find((row) => row.id === created.id);
  stored.grossMinorDelta = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => approve(state, created), /currency|minor unit|cost evidence|authoritative/i);
});

test('export rejects a stored currency mismatch even after approval', () => {
  const { state, period, record } = releasedState();
  const created = propose(state, period, record);
  approve(state, created);
  state.payrollControl.adjustments.find((row) => row.id === created.id).currency = 'EUR';
  assert.throws(
    () => Payroll.exportPostReleaseAdjustments(state, approver, {
      period: period.id,
      checked: true,
    }, 'AB-MISMATCH'),
    /currency|minor unit|cost evidence|authoritative/i,
  );
});

test('export uses an explicit versioned minor-unit schema that reconciles exactly', () => {
  const { state, period, record } = releasedState();
  const created = propose(state, period, record);
  approve(state, created);
  Payroll.exportPostReleaseAdjustments(state, approver, {
    period: period.id,
    checked: true,
  }, 'AB-BOUND');
  const batch = Payroll.adjustmentBatch(state, approver, 'AB-BOUND');
  assert.equal(batch.schema, 'reviewed-pay-adjustment-v2-minor-units');
  assert.deepEqual(batch.reconciliation, {
    ok: true,
    rows: 1,
    storedGrossMinor: 900,
    exportedGrossMinor: 900,
  });
  const [header, row] = batch.csv.trim().split('\r\n').map((line) =>
    line.split(',').map((value) => value.slice(1, -1).replaceAll('""', '"'))
  );
  assert.deepEqual(header.slice(7, 11), [
    'gross_amount_delta_minor', 'currency', 'minor_unit_exponent', 'currency_source',
  ]);
  assert.deepEqual(row.slice(7, 11), ['900', 'GBP', '2', 'reviewed_cost_evidence']);
});
