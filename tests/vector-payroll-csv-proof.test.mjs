import assert from 'node:assert/strict';
import test from 'node:test';

import { authoritativePayrollCsv } from '../scripts/vector-payroll-csv-proof.mjs';

test('authoritative payroll CSV reproduces the server export contract byte for byte', () => {
  const actual = authoritativePayrollCsv('batch-1', {
    schema: 'reviewed-pay-v3-reconciled',
    start: '2026-09-07',
    end: '2026-09-13',
    lines: [{
      employee: 'e1',
      payrollId: 'PAY-1',
      name: 'Ada "A"',
      team: 'Assembly',
      date: '2026-09-07',
      code: 'WORKED_BASIC',
      minutes: 450,
      hours: '7.5000',
      rate: '20.00',
      multiplier: 1,
      allowance: '0.00',
      gross: '150.00',
      approvedBy: 'm1',
      approvedAt: '2026-09-14T09:00:00.000Z',
      sources: 'wr-e1-2026-09-07'
    }]
  });

  const expected = '"batch_id","schema_version","period_start","period_end","employee_id","payroll_id","employee_name","team","work_date","pay_code","minutes","hours","basic_hourly_rate_gbp","pay_multiplier","hourly_allowance_gbp","gross_amount_gbp","manager_approved_by","manager_approved_at","source_record_ids"\r\n'
    + '"batch-1","reviewed-pay-v3-reconciled","2026-09-07","2026-09-13","e1","PAY-1","Ada ""A""","Assembly","2026-09-07","WORKED_BASIC","450","7.5000","20.00","1","0.00","150.00","m1","2026-09-14T09:00:00.000Z","wr-e1-2026-09-07"\r\n';

  assert.equal(actual, expected);
});

test('authoritative payroll CSV refuses spreadsheet-formula fields', () => {
  assert.throws(() => authoritativePayrollCsv('batch-1', {
    schema: 'reviewed-pay-v3-reconciled',
    start: '2026-09-07',
    end: '2026-09-13',
    lines: [{
      employee: 'e1',
      payrollId: 'PAY-1',
      name: '=IMPORTDATA("https://example.invalid")',
      team: 'Assembly',
      date: '2026-09-07',
      code: 'WORKED_BASIC',
      minutes: 450,
      hours: '7.5000',
      rate: '20.00',
      multiplier: 1,
      allowance: '0.00',
      gross: '150.00',
      approvedBy: 'm1',
      approvedAt: '2026-09-14T09:00:00.000Z',
      sources: 'wr-e1-2026-09-07'
    }]
  }), /spreadsheet formula prefix/);
});
