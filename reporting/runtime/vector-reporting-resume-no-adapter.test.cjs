'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createVectorReportingService } = require('./vector-reporting-service.cjs');

async function call(service, method, url, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method, url, headers: { cookie: 'wfm_session=fictional-session' } });
  const res = { statusCode: 200, headersSent: false, writableEnded: false, body: '',
    setHeader() {}, end(value) { this.body = String(value); this.headersSent = true; this.writableEnded = true; } };
  assert.equal(await service.handleRequest(req, res), true);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
function snapshot(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    const result = {};
    for (const table of ['users', 'sessions', 'vector_report_definitions', 'vector_report_schedules', 'vector_report_schedule_events', 'vector_report_audit', 'vector_report_delivery_intents', 'vector_report_delivery_observations', 'vector_report_deliveries']) {
      result[table] = db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all();
    }
    return result;
  } finally { db.close(); }
}

for (const delivery of ['email_link', 'sftp']) {
  test('paused fictional ' + delivery + ' cannot resume after clean reopen without adapter', async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-resume-no-adapter-'));
    const dbPath = path.join(fixture, 'fictional.sqlite');
    let service;
    let authorizations = 0, sends = 0, readbacks = 0;
    const adapter = {
      authorize() { authorizations++; return true; },
      deliver() { sends++; assert.fail('Dispatch must never be invoked'); },
      readback() { readbacks++; assert.fail('Readback must never be invoked'); }
    };
    try {
      const seed = new DatabaseSync(dbPath);
      try {
        seed.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
        seed.prepare('INSERT INTO users VALUES(?,?,?)').run('fictional-owner@example.test', 'fictional-tenant', 'manager');
        seed.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('fictional-session').digest('hex'), 'fictional-owner@example.test', Date.now() + 3600000);
      } finally { seed.close(); }
      service = createVectorReportingService({ dbPath, deliveryAdapter: adapter, schedulerTickMs: 600000 });
      const report = await call(service, 'POST', '/api/reporting/reports', { definition: { title: 'Fictional readiness', sourceId: 'factory-readiness' } });
      assert.equal(report.status, 201);
      const created = await call(service, 'POST', '/api/reporting/schedules', {
        reportId: report.body.report.id, cadence: 'daily', hour: 16, minute: 5, timeZone: 'UTC', delivery,
        destination: delivery === 'email_link' ? 'fictional-recipient@example.test' : 'fictional-sftp-destination'
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.schedule.enabled, true);
      const scheduleId = created.body.schedule.id;
      const stateUrl = '/api/reporting/schedules/' + scheduleId + '/state';
      const paused = await call(service, 'POST', stateUrl, { enabled: false });
      assert.equal(paused.status, 200);
      assert.equal(paused.body.schedule.enabled, false);
      const before = snapshot(dbPath);
      assert.equal(before.vector_report_schedules.length, 1);
      const events = before.vector_report_schedule_events;
      assert.equal(events.length, 2);
      assert.deepEqual(events.map(row => row.enabled), [1, 0]);
      assert.ok(events.every(row => row.tenant === 'fictional-tenant' && row.schedule_id === scheduleId && row.actor === 'fictional-owner@example.test'));
      const pauses = before.vector_report_audit.filter(row => row.event === 'REPORT_SCHEDULE_PAUSED');
      assert.equal(pauses.length, 1);
      assert.equal(JSON.parse(pauses[0].detail_json).scheduleId, scheduleId);
      assert.equal(before.vector_report_audit.filter(row => row.event === 'REPORT_SCHEDULE_RESUMED').length, 0);
      for (const table of ['vector_report_delivery_intents', 'vector_report_delivery_observations', 'vector_report_deliveries']) assert.equal(before[table].length, 0);
      assert.ok(authorizations > 0);
      assert.equal(sends, 0);
      assert.equal(readbacks, 0);
      const priorAuthorizations = authorizations;
      service.close();
      service = undefined;

      // No adapter, scheduler invocation, concurrent service, or attempted intent.
      service = createVectorReportingService({ dbPath, schedulerTickMs: 600000 });
      const reportReadback = await call(service, 'GET', '/api/reporting/reports/' + report.body.report.id);
      assert.equal(reportReadback.status, 200, 'unchanged owner is authenticated and retains report authority');
      // Report readback intentionally adds REPORT_VIEWED; freeze the mutation baseline afterward.
      const beforeResume = snapshot(dbPath);
      assert.deepEqual(beforeResume.vector_report_schedule_events, events);
      for (const table of ['vector_report_delivery_intents', 'vector_report_delivery_observations', 'vector_report_deliveries']) assert.equal(beforeResume[table].length, 0);
      const resumed = await call(service, 'POST', stateUrl, { enabled: true });
      assert.equal(resumed.status, 404);
      assert.equal(resumed.body.error, 'Schedule not found.');
      assert.deepEqual(snapshot(dbPath), beforeResume, 'refused resume leaves every selected persisted row unchanged');
      assert.equal(authorizations, priorAuthorizations);
      assert.equal(sends, 0);
      assert.equal(readbacks, 0);
    } finally {
      service?.close();
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
}
