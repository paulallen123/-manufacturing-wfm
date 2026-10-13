'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { DatabaseSync } = require('node:sqlite');
const { createDemandDecisionService } = require('./demand-decision-service.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('trusted demand ingress refuses impossible observation dates before persistence or publication', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-demand-numeric-'));
  const dbPath = path.join(dir, 'synthetic.sqlite');
  const db = new DatabaseSync(dbPath);
  let service;
  try {
    db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,role TEXT NOT NULL); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);');
    const events = [];
    service = createDemandDecisionService({ dbPath, internalToken: 'synthetic-internal', publishEvent: event => events.push(event) });
    const signal = {
      signalId: 'calendar-synthetic', accountRef: 'synthetic-account', decisionKey: 'absence-recovery',
      persona: 'plant-manager', sourceType: 'workaround', evidenceType: 'revealed',
      observedAt: '2026-10-13T08:00:00Z', outcomeKpis: ['decision-latency'],
      falsification: 'Reject unless approved replay improves the measured outcome.'
    };
    async function ingest(observedAt) {
      const req = Readable.from([Buffer.from(JSON.stringify({ tenant: 'synthetic-alpha', signal: { ...signal, observedAt, evidenceConfidence: 0.9 } }))]);
      req.method = 'POST'; req.url = '/api/operations/intelligence/demand/signal';
      req.headers = { 'x-wfm-demand-internal': 'synthetic-internal' };
      const res = { headersSent: false, writableEnded: false, statusCode: 200, setHeader() {}, end(body) { this.body = JSON.parse(body); this.headersSent = true; this.writableEnded = true; } };
      await service.handleRequest(req, res);
      return res;
    }
    for (const value of ['2026-02-29T08:00:00Z', '2026-02-30T08:00:00Z', '2026-04-31T08:00:00+01:00', '1900-02-29T08:00:00Z']) {
      const res = await ingest(value);
      assert.equal(res.statusCode, 500); // Preserve the existing generic ingress error contract.
      assert.deepEqual(res.body, { error: 'Decision intelligence failed safely.' });
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vector_demand_signals').get().n, 0);
      assert.equal(events.length, 0);
    }
    assert.equal((await ingest('2024-02-29T08:00:00+01:00')).statusCode, 201);
    assert.equal(events.length, 1);
    service.close(); service = null;
    service = createDemandDecisionService({ dbPath, internalToken: 'synthetic-internal', publishEvent: event => events.push(event) });
    const replay = await ingest('2024-02-29T08:00:00+01:00');
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.idempotent, true);
    assert.equal(replay.body.signal.observedAt, '2024-02-29T07:00:00.000Z');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vector_demand_signals').get().n, 1);
    assert.equal(events.length, 1);
    assert.equal(service.demandForTenant('synthetic-beta').signals.length, 0);
  } finally { service?.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
