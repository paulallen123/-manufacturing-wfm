'use strict';
// Local API only: no adapters, network listeners, or due-schedule execution.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Readable} = require('node:stream');
const {createHash} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const Reporting = require('./vector-reporting-service.cjs');
const email = 'payroll-actor@v079.invalid';
const tenant = 'synthetic-v079';
const token = 'synthetic-v079-session';
const sha = value => createHash('sha256').update(value).digest('hex');
async function call(service, method, url, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, {method, url, headers: {cookie: 'wfm_session=' + token}});
  const res = {statusCode: 200, headersSent: false, writableEnded: false, body: '',
    setHeader() {}, end(value = '') {this.body = String(value); this.headersSent = true; this.writableEnded = true;}};
  const handled = await service.handleRequest(req, res);
  assert.equal(handled, true, method + ' ' + url + ' must be handled');
  return {status: res.statusCode, body: JSON.parse(res.body)};
}
function snapshot(db) {
  return Object.fromEntries([
    'vector_report_schedules', 'vector_report_schedule_events',
    'vector_report_delivery_intents', 'vector_report_deliveries',
    'vector_report_delivery_observations'
  ].map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]));
}
test('V079: payroll-to-director drift denies new payroll schedule without durable scheduling or delivery writes', {timeout: 15000}, async () => {
  // Create a unique private fixture; the finally block below removes it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v079-fixture-'));
  fs.chmodSync(dir, 0o700);
  let db, service;
  try {
    const dbPath = path.join(dir, 'synthetic.sqlite');
    db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
    db.prepare('INSERT INTO users VALUES(?,?,?)').run(email, tenant, 'payroll_admin');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(token), email, Date.now() + 3600000);
    service = Reporting.createVectorReportingService({dbPath, schedulerTickMs: 3600000});
    const reportResult = await call(service, 'POST', '/api/reporting/reports', {
      definition: {title: 'Synthetic V079 payroll definition', sourceId: 'payroll-control'}
    });
    assert.equal(reportResult.status, 201);
    const reportId = reportResult.body.report.id;
    assert.equal(typeof reportId, 'string');
    assert.ok(reportId.length > 0);
    const request = {reportId, cadence: 'daily', hour: 16, minute: 5, timeZone: 'UTC', delivery: 'in_app'};
    const positive = await call(service, 'POST', '/api/reporting/schedules', request);
    assert.equal(positive.status, 201);
    assert.equal(positive.body.schedule.schedule.reportId, reportId);
    assert.equal(positive.body.schedule.schedule.delivery, 'in_app');
    assert.equal(positive.body.schedule.enabled, true);
    const list = await call(service, 'GET', '/api/reporting/schedules');
    assert.equal(list.status, 200);
    assert.equal(list.body.schedules.length, 1);
    assert.equal(list.body.schedules[0].id, positive.body.schedule.id);
    const before = snapshot(db);
    assert.equal(before.vector_report_schedules.length, 1);
    assert.equal(before.vector_report_schedule_events.length, 1);
    assert.equal(before.vector_report_schedule_events[0].enabled, 1);
    assert.equal(before.vector_report_schedule_events[0].schedule_id, positive.body.schedule.id);
    assert.equal(JSON.parse(before.vector_report_schedules[0].schedule_json).reportId, reportId);
    for (const table of ['vector_report_delivery_intents', 'vector_report_deliveries', 'vector_report_delivery_observations']) assert.equal(before[table].length, 0);
    const changed = db.prepare('UPDATE users SET role=? WHERE email=? AND tenant=?').run('director', email, tenant);
    assert.equal(Number(changed.changes), 1);
    assert.equal(db.prepare('SELECT role FROM users WHERE email=?').get(email).role, 'director');
    const denied = await call(service, 'POST', '/api/reporting/schedules', request);
    // This exact API returns 404 when the report is no longer accessible.
    assert.equal(denied.status, 404);
    assert.equal(typeof denied.body.error, 'string');
    assert.ok(denied.body.error.length > 0);
    assert.equal(Object.hasOwn(denied.body, 'schedule'), false);
    // Full durable readback catches inserted, replaced, or modified records.
    // Audit rows are intentionally excluded: denied attempts may be audited.
    assert.deepEqual(snapshot(db), before);
  } finally {
    try { if (service) service.close(); }
    finally { try { if (db) db.close(); } finally { fs.rmSync(dir, {recursive: true, force: true}); } }
  }
});
