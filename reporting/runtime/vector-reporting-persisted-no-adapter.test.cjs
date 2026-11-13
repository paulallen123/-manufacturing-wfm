'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createVectorReportingService } = require('./vector-reporting-service.cjs');

const sha = value => createHash('sha256').update(value).digest('hex');
async function call(service, method, url, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = { cookie: 'wfm_session=fictional-session' };
  const res = {
    statusCode: 200, headersSent: false, writableEnded: false, body: '',
    setHeader() {},
    end(value) { this.body = String(value); this.headersSent = true; this.writableEnded = true; }
  };
  assert.equal(await service.handleRequest(req, res), true);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
function inspect(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    const count = table => db.prepare('SELECT count(*) AS n FROM ' + table).get().n;
    return {
      intents: count('vector_report_delivery_intents'),
      observations: count('vector_report_delivery_observations'),
      deliveries: db.prepare('SELECT * FROM vector_report_deliveries ORDER BY delivery_key').all(),
      audit: db.prepare('SELECT * FROM vector_report_audit ORDER BY id').all(),
      reports: db.prepare('SELECT * FROM vector_report_definitions ORDER BY id').all(),
      schedules: db.prepare('SELECT * FROM vector_report_schedules ORDER BY id').all()
    };
  } finally { db.close(); }
}

for (const delivery of ['email_link', 'sftp']) {
  test('persisted unclaimed ' + delivery + ' stays blocked after clean reopen without adapter', async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-no-adapter-'));
    const dbPath = path.join(fixture, 'fictional.sqlite');
    let service;
    let authorizations = 0, sends = 0, readbacks = 0;
    const inertAdapter = {
      authorize() { authorizations++; return true; },
      deliver() { sends++; assert.fail('Fictional dispatch must never be invoked'); },
      readback() { readbacks++; assert.fail('Fictional readback must never be invoked'); }
    };
    try {
      const seed = new DatabaseSync(dbPath);
      try {
        seed.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
        seed.prepare('INSERT INTO users VALUES(?,?,?)').run('fictional-manager@example.test', 'fictional-tenant', 'manager');
        seed.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha('fictional-session'), 'fictional-manager@example.test', Date.now() + 3600000);
      } finally { seed.close(); }
      service = createVectorReportingService({ dbPath, schedulerTickMs: 600000, deliveryAdapter: inertAdapter });
      const report = await call(service, 'POST', '/api/reporting/reports', {
        definition: { title: 'Fictional readiness', sourceId: 'factory-readiness' }
      });
      assert.equal(report.status, 201);
      const schedule = await call(service, 'POST', '/api/reporting/schedules', {
        reportId: report.body.report.id, cadence: 'daily', hour: 16, minute: 5,
        timeZone: 'UTC', delivery,
        destination: delivery === 'email_link' ? 'fictional-recipient@example.test' : 'fictional-sftp-destination'
      });
      assert.equal(schedule.status, 201);
      assert.equal(schedule.body.schedule.enabled, true);
      assert.ok(authorizations > 0, 'creation uses only the inert local authorization hook');
      assert.equal(sends, 0);
      assert.equal(readbacks, 0);
      const before = inspect(dbPath);
      assert.equal(before.intents, 0);
      assert.equal(before.observations, 0);
      assert.equal(before.deliveries.length, 0);
      assert.equal(before.reports.length, 1);
      assert.equal(before.schedules.length, 1);
      assert.equal(before.audit.filter(row => row.event === 'BLOCKED_AUTHORITY_DRIFT').length, 0);
      const creationAuthorizations = authorizations;
      service.close();
      service = undefined;

      // Sequential ordinary reopen: no adapter and no previously attempted dispatch.
      service = createVectorReportingService({ dbPath, schedulerTickMs: 600000 });
      const slot = new Date('2026-09-24T16:05:00Z');
      const result = await service.runDueSchedules(slot);
      assert.equal(result.length, 1);
      assert.equal(result[0].status, 'BLOCKED_AUTHORITY_DRIFT');
      assert.equal(result[0].mode, delivery);
      assert.equal(result[0].scheduleId, schedule.body.schedule.id);
      assert.equal(result[0].reportId, report.body.report.id);
      assert.equal(result[0].externalReceipt, null);
      assert.equal(authorizations, creationAuthorizations);
      assert.equal(sends, 0);
      assert.equal(readbacks, 0);
      const after = inspect(dbPath);
      assert.equal(after.intents, 0);
      assert.equal(after.observations, 0);
      assert.equal(after.deliveries.length, 1);
      assert.equal(after.deliveries[0].status, 'BLOCKED_AUTHORITY_DRIFT');
      assert.equal(JSON.parse(after.deliveries[0].receipt_json).externalReceipt, null);
      const blockedAudit = after.audit.filter(row => row.event === 'BLOCKED_AUTHORITY_DRIFT');
      assert.equal(blockedAudit.length, 1);
      assert.equal(after.audit.length, before.audit.length + 1);
      assert.equal(blockedAudit[0].tenant, 'fictional-tenant');
      assert.equal(blockedAudit[0].actor, 'fictional-manager@example.test');
      assert.equal(blockedAudit[0].report_id, report.body.report.id);
      assert.equal(JSON.parse(blockedAudit[0].detail_json).scheduleId, schedule.body.schedule.id);
      assert.deepEqual(after.reports, before.reports);
      assert.deepEqual(after.schedules, before.schedules);
      assert.deepEqual(await service.runDueSchedules(slot), []);
      assert.deepEqual(inspect(dbPath), after, 'sequential same-slot evaluation adds nothing');
    } finally {
      service?.close();
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
}
