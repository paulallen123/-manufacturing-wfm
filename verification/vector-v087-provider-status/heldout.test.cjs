'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Extract to a disposable directory. The sealed archive is never changed.
const archive = process.env.VECTOR_TEST_ARCHIVE || path.resolve(__dirname, '../../artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
const directory = mkdtempSync(path.join(os.tmpdir(), 'vector-v087-'));
after(() => rmSync(directory, { recursive: true, force: true }));
execFileSync('tar', [
  '-xzf', archive, '-C', directory,
  'lib/sap-event-audit-reconciliation.cjs',
  'lib/payroll-handoff-reconciliation.cjs',
  'public'
]);

const SAP = require(path.join(directory, 'lib/sap-event-audit-reconciliation.cjs'));
const Oracle = require(path.join(directory, 'lib/payroll-handoff-reconciliation.cjs'));
const observedAt = '2026-10-29T10:00:00.000Z';
const eventId = 'EVT-12345678';
const eventType = 'Payroll.Run';
const providerRow = status => ({ externalEventId: eventId, eventType, status, observedAt });
const localRow = type => ({ externalEventIdHash: SAP.hashEventId(eventId), eventType: type, receivedAt: observedAt, gatewayStatus: 'received' });
const reconcile = (providerRows, localRows) => SAP.reconcile({ providerRows, localRows, now: Date.parse(observedAt) + 1000 });

test('SAP equal-time provider conflict cannot become healthy by lexical tie selection', () => {
  for (const rows of [
    [providerRow('delivered'), providerRow('published')],
    [providerRow('published'), providerRow('delivered')]
  ]) {
    const result = reconcile(rows, [localRow(eventType)]);
    assert.equal(result.healthy, false);
    assert.ok(result.divergent > 0);
  }
});

test('SAP equal-time local conflict is independent of input row order', () => {
  const providerRows = [providerRow('delivered')];
  const first = reconcile(providerRows, [localRow(eventType), localRow('Different.Type')]);
  const second = reconcile(providerRows, [localRow('Different.Type'), localRow(eventType)]);
  assert.equal(first.healthy, false);
  assert.equal(second.healthy, false);
  assert.deepEqual(first.counts, second.counts);
});

test('Oracle completed-with-warning acknowledgement cannot become accepted', () => {
  const result = Oracle.normalizeOracleHcmDataSet({
    DataSetStatusCode: 'COMPLETED',
    DataSetStatusMeaning: 'Completed with warning',
    RequestId: 'synthetic-job-1'
  });
  assert.notEqual(result.status, 'accepted');
});
