import assert from 'node:assert/strict';

export const PAYROLL_CSV_COLUMNS = [
  'batch_id',
  'schema_version',
  'period_start',
  'period_end',
  'employee_id',
  'payroll_id',
  'employee_name',
  'team',
  'work_date',
  'pay_code',
  'minutes',
  'hours',
  'basic_hourly_rate_gbp',
  'pay_multiplier',
  'hourly_allowance_gbp',
  'gross_amount_gbp',
  'manager_approved_by',
  'manager_approved_at',
  'source_record_ids'
];

export function payrollCsvField(value) {
  const field = String(value ?? '');
  assert.equal(/[\t\r\n\x00-\x1f\x7f]/.test(field), false, 'Authoritative payroll line contains an unsafe control character.');
  assert.equal(/^\s*[=+\-@＝＋－＠]/u.test(field), false, 'Authoritative payroll line contains a spreadsheet formula prefix.');
  return `"${field.replaceAll('"', '""')}"`;
}

export function authoritativePayrollCsv(batchId, report) {
  const rows = report.lines.map(line => [
    batchId,
    report.schema,
    report.start,
    report.end,
    line.employee,
    line.payrollId,
    line.name,
    line.team,
    line.date,
    line.code,
    line.minutes,
    line.hours,
    line.rate,
    line.multiplier,
    line.allowance,
    line.gross,
    line.approvedBy,
    line.approvedAt,
    line.sources
  ]);
  return [PAYROLL_CSV_COLUMNS, ...rows]
    .map(row => row.map(payrollCsvField).join(','))
    .join('\r\n') + '\r\n';
}
