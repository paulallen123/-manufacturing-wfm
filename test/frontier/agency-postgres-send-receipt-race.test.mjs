import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AGENCY_SUPPLIER_DELIVERY_DDL,
  createPostgresAgencySupplierDeliveryStore,
  dispatchAgencySupplierRequest,
  prepareAgencySupplierDelivery,
} from '../../src/frontier/agency-supplier-delivery.mjs';
import {
  AGENCY_SUPPLIER_DELIVERY_RECEIPT_DDL,
  createPostgresAgencySupplierDeliveryReceiptStore,
} from '../../src/frontier/agency-supplier-delivery-receipt.mjs';

const execFileAsync = promisify(execFile);
const POSTGRES_IMAGE = 'postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED = process.env.AGENCY_POSTGRES_PROOF_REQUIRED === '1';
const CONTAINER = `wfm-agency-race-pg-${process.pid}-${Date.now()}`;
const DB_USER = 'postgres';
const DB_NAME = 'postgres';
const DB_PASSWORD = 'agency-race-proof-only-not-a-secret';

let started = false;

async function docker(args, options = {}) {
  return execFileAsync('docker', args, {
    maxBuffer: 8 * 1024 * 1024,
    timeout: options.timeout ?? 30000,
    encoding: 'utf8',
  });
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite SQL test value');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const string = String(value);
  if (string.includes('\0')) throw new TypeError('NUL is not permitted in SQL test values');
  return `'${string.replaceAll("'", "''")}'`;
}

function interpolate(sql, values = []) {
  return sql.replace(/\$(\d+)/g, (_, indexText) => {
    const index = Number(indexText) - 1;
    if (index < 0 || index >= values.length) throw new Error(`missing SQL test parameter $${indexText}`);
    return sqlLiteral(values[index]);
  });
}

function normalizeCell(value) {
  if (value === '__NULL__') return null;
  if (value === 't') return true;
  if (value === 'f') return false;
  return value;
}

function parseRows(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)
    .filter(line => !/^(INSERT|UPDATE|DELETE|SELECT|CREATE|ALTER|DROP)\b/.test(line));
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map(line => {
    const cells = line.split('\t');
    return Object.fromEntries(headers.map((header, index) => [header, normalizeCell(cells[index] ?? '')]));
  });
}

async function psql(sql) {
  const { stdout } = await docker([
    'exec', CONTAINER,
    'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', DB_USER, '-d', DB_NAME,
    '-A', '-F', '\t', '-P', 'footer=off', '-P', 'null=__NULL__',
    '-c', sql,
  ]);
  return stdout;
}

async function query(sql, values = []) {
  const stdout = await psql(interpolate(sql, values));
  const rows = parseRows(stdout);
  return { rows, rowCount: rows.length };
}

async function scalar(sql) {
  const stdout = await psql(sql);
  const lines = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.at(-1) ?? null;
}

async function waitForPostgres() {
  let lastError = null;
  let lastLogs = '';
  let initComplete = false;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const logs = await docker(['logs', CONTAINER], { timeout: 5000 });
      lastLogs = `${logs.stdout ?? ''}\n${logs.stderr ?? ''}`;
      initComplete ||= lastLogs.includes('PostgreSQL init process complete; ready for start up.');

      if (initComplete) {
        const { stdout } = await docker([
          'exec', CONTAINER,
          'psql', '-X', '-q', '-A', '-t',
          '-U', DB_USER, '-d', DB_NAME,
          '-c', 'SELECT 1;',
        ], { timeout: 5000 });
        if (stdout.trim() === '1') return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  const diagnostic = lastLogs.split(/\r?\n/).filter(Boolean).slice(-12).join('\n');
  throw new Error(`postgres final server did not become ready after init: ${lastError?.message ?? 'no psql success'}${diagnostic ? `\n${diagnostic}` : ''}`);
}

async function stopContainer() {
  if (!started) return;
  try { await docker(['rm', '-f', CONTAINER], { timeout: 10000 }); } catch {}
  started = false;
}

before(async () => {
  if (!REQUIRED) return;
  try {
    await docker(['version', '--format', '{{.Server.Version}}'], { timeout: 10000 });
  } catch (error) {
    throw new Error(`Docker is required for the agency PostgreSQL race proof: ${error.message}`);
  }

  await docker([
    'run', '-d', '--rm', '--name', CONTAINER,
    '-e', `POSTGRES_PASSWORD=${DB_PASSWORD}`,
    POSTGRES_IMAGE,
  ], { timeout: 120000 });
  started = true;
  await waitForPostgres();
  await psql(`${AGENCY_SUPPLIER_DELIVERY_DDL}\n${AGENCY_SUPPLIER_DELIVERY_RECEIPT_DDL}`);
});

after(async () => {
  await stopContainer();
});

function pgTest(name, fn) {
  test(name, { skip: !REQUIRED }, fn);
}

const preparedBase = {
  tenantId:'T-RACE', siteId:'S-RACE', requestId:'R-RACE', agencyId:'A-RACE', channel:'sms', destination:'+447700900123',
  portalUrl:'https://wfm.example/agency/respond?token=postgres-race-proof', responseDeadline:'2026-09-19T18:00:00.000Z', deliveryRevision:901,
  requestPack:{requestId:'R-RACE', hirer:{name:'Factory Ltd', businessNature:'Food manufacturing'}, assignment:{roleName:'Line Operator', location:'Plant 1', startAt:'2026-09-20T06:00:00.000Z', endAt:'2026-09-20T14:00:00.000Z', count:4, fairWorkAgencyGangmasterLicenceRequired:false}},
  supplierEligibility:{version:'agency-supplier-compliance-v0.1.0', agencyId:'A-RACE', eligible:true, failures:[], evidence:{licenceRequired:false, evidenceRule:'gangmaster_licence_not_required_by_request_policy'}},
};

pgTest('authenticated receipt can win the sender race without duplicate dispatch or sent-state downgrade', async () => {
  const prepared = prepareAgencySupplierDelivery(preparedBase);
  assert.equal(prepared.ready, true);

  const deliveryStore = createPostgresAgencySupplierDeliveryStore({ query });
  const receiptStore = createPostgresAgencySupplierDeliveryReceiptStore({ query });
  let sendCalls = 0;

  const sender = {
    async send({ deliveryId }) {
      sendCalls += 1;
      assert.equal(deliveryId, prepared.delivery.deliveryId);
      const reconciled = await receiptStore.reconcileOnce({
        tenantId:'T-RACE', providerKey:'sms-proof', providerEventId:'evt-race-confirmed-sent', deliveryId,
        providerMessageRef:'provider-race-901', attemptNumber:1, channel:'sms', normalizedOutcome:'confirmed_sent',
        eventAt:'2026-09-18T19:00:01Z', receivedAt:'2026-09-18T19:00:02Z', eventFingerprint:'9019019019019019',
      });
      assert.equal(reconciled.result, 'recorded');
      assert.equal(reconciled.priorStatus, 'dispatching');
      assert.equal(reconciled.status, 'sent');
      return { status:'unknown', providerMessageRef:'provider-race-901' };
    },
  };

  const results = await Promise.all(Array.from({ length:32 }, () => dispatchAgencySupplierRequest({
    prepared,
    deliveryStore,
    sender,
    now:'2026-09-18T19:00:00Z',
    maxAttempts:3,
  })));

  assert.equal(sendCalls, 1);
  assert.equal(results.filter(result => result.dispatched === true).length, 1);
  assert.ok(results.filter(result => result.dispatched !== true).every(result => ['delivery_outcome_unknown','already_sent'].includes(result.reason)));

  const winner = results.find(result => result.dispatched === true);
  assert.equal(winner.reason, null);
  assert.equal(winner.receipt.status, 'sent');
  assert.equal(winner.receipt.attemptCount, 1);
  assert.equal(winner.receipt.providerMessageRef, 'provider-race-901');
  assert.equal(winner.receipt.containsRawDestination, false);
  assert.equal(winner.receipt.containsRawPortalUrl, false);
  assert.equal(winner.receipt.containsWorkerPersonalData, false);

  assert.equal(await scalar(`SELECT status FROM wfm_agency_supplier_deliveries WHERE tenant_id='T-RACE' AND delivery_id='${prepared.delivery.deliveryId}';`), 'sent');
  assert.equal(await scalar(`SELECT provider_message_ref FROM wfm_agency_supplier_deliveries WHERE tenant_id='T-RACE' AND delivery_id='${prepared.delivery.deliveryId}';`), 'provider-race-901');
  assert.equal(Number(await scalar(`SELECT attempt_count FROM wfm_agency_supplier_deliveries WHERE tenant_id='T-RACE' AND delivery_id='${prepared.delivery.deliveryId}';`)), 1);
  assert.equal(Number(await scalar(`SELECT count(*) FROM wfm_agency_supplier_delivery_receipts WHERE tenant_id='T-RACE' AND provider_event_id='evt-race-confirmed-sent';`)), 1);
});

pgTest('conflicting late sender evidence fails closed while preserving stronger authenticated sent evidence', async () => {
  const prepared = prepareAgencySupplierDelivery({ ...preparedBase, deliveryRevision:902 });
  assert.equal(prepared.ready, true);

  const deliveryStore = createPostgresAgencySupplierDeliveryStore({ query });
  const receiptStore = createPostgresAgencySupplierDeliveryReceiptStore({ query });
  let sendCalls = 0;

  const sender = {
    async send({ deliveryId }) {
      sendCalls += 1;
      const reconciled = await receiptStore.reconcileOnce({
        tenantId:'T-RACE', providerKey:'sms-proof', providerEventId:'evt-race-authoritative-ref', deliveryId,
        providerMessageRef:'provider-authoritative-902', attemptNumber:1, channel:'sms', normalizedOutcome:'confirmed_sent',
        eventAt:'2026-09-18T19:01:01Z', receivedAt:'2026-09-18T19:01:02Z', eventFingerprint:'9029029029029029',
      });
      assert.equal(reconciled.status, 'sent');
      return { status:'unknown', providerMessageRef:'provider-conflict-902' };
    },
  };

  const result = await dispatchAgencySupplierRequest({
    prepared,
    deliveryStore,
    sender,
    now:'2026-09-18T19:01:00Z',
    maxAttempts:3,
  });

  assert.equal(sendCalls, 1);
  assert.equal(result.dispatched, false);
  assert.equal(result.reason, 'delivery_state_conflict_after_send_attempt');
  assert.equal(result.receipt.status, 'unknown');
  assert.equal(result.receipt.containsRawDestination, false);
  assert.equal(result.receipt.containsRawPortalUrl, false);

  assert.equal(await scalar(`SELECT status FROM wfm_agency_supplier_deliveries WHERE tenant_id='T-RACE' AND delivery_id='${prepared.delivery.deliveryId}';`), 'sent');
  assert.equal(await scalar(`SELECT provider_message_ref FROM wfm_agency_supplier_deliveries WHERE tenant_id='T-RACE' AND delivery_id='${prepared.delivery.deliveryId}';`), 'provider-authoritative-902');
  assert.equal(Number(await scalar(`SELECT attempt_count FROM wfm_agency_supplier_deliveries WHERE tenant_id='T-RACE' AND delivery_id='${prepared.delivery.deliveryId}';`)), 1);
});
