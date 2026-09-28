import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL,
  createPostgresAgencyPortalTokenStore,
} from '../../src/frontier/agency-portal-token-store.mjs';
import {
  AGENCY_SUPPLIER_DELIVERY_DDL,
  createPostgresAgencySupplierDeliveryStore,
  prepareAgencySupplierDelivery,
} from '../../src/frontier/agency-supplier-delivery.mjs';
import {
  AGENCY_SUPPLIER_DELIVERY_RECEIPT_DDL,
  createPostgresAgencySupplierDeliveryReceiptStore,
} from '../../src/frontier/agency-supplier-delivery-receipt.mjs';

const execFileAsync = promisify(execFile);
const POSTGRES_IMAGE = 'postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED = process.env.AGENCY_POSTGRES_PROOF_REQUIRED === '1';
const CONTAINER = `wfm-agency-pg-${process.pid}-${Date.now()}`;
const DB_USER = 'postgres';
const DB_NAME = 'postgres';
const DB_PASSWORD = 'agency-proof-only-not-a-secret';

let started = false;
let dockerServerVersion = null;
let postgresVersion = null;

async function docker(args, options = {}) {
  return execFileAsync('docker', args, {
    maxBuffer: 8 * 1024 * 1024,
    timeout: options.timeout ?? 30000,
    encoding: 'utf8',
    input: options.input,
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
    const { stdout } = await docker(['version', '--format', '{{.Server.Version}}'], { timeout: 10000 });
    dockerServerVersion = stdout.trim() || 'unknown';
  } catch (error) {
    throw new Error(`Docker is required for the agency PostgreSQL proof: ${error.message}`);
  }

  await docker([
    'run', '-d', '--rm', '--name', CONTAINER,
    '-e', `POSTGRES_PASSWORD=${DB_PASSWORD}`,
    POSTGRES_IMAGE,
  ], { timeout: 120000 });
  started = true;
  await waitForPostgres();
  postgresVersion = await scalar('SHOW server_version;');
  await psql(`${AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL}\n${AGENCY_SUPPLIER_DELIVERY_DDL}\n${AGENCY_SUPPLIER_DELIVERY_RECEIPT_DDL}`);
});

after(async () => {
  await stopContainer();
});

function pgTest(name, fn) {
  test(name, { skip: !REQUIRED }, fn);
}

const preparedBase = {
  tenantId:'T-PG', siteId:'S-PG', requestId:'R-PG', agencyId:'A-PG', channel:'email', destination:'ops@agency.example',
  portalUrl:'https://wfm.example/agency/respond?token=postgres-proof', responseDeadline:'2026-09-19T18:00:00.000Z', deliveryRevision:1,
  requestPack:{requestId:'R-PG', hirer:{name:'Factory Ltd', businessNature:'Food manufacturing'}, assignment:{roleName:'Line Operator', location:'Plant 1', startAt:'2026-09-20T06:00:00.000Z', endAt:'2026-09-20T14:00:00.000Z', count:4, fairWorkAgencyGangmasterLicenceRequired:false}},
  supplierEligibility:{version:'agency-supplier-compliance-v0.1.0', agencyId:'A-PG', eligible:true, failures:[], evidence:{licenceRequired:false, evidenceRule:'gangmaster_licence_not_required_by_request_policy'}},
};

function deliveryRecord(prepared, at) {
  return {
    tenantId:prepared.delivery.tenantId,
    idempotencyKey:prepared.delivery.idempotencyKey,
    deliveryId:prepared.delivery.deliveryId,
    siteId:prepared.delivery.siteId,
    requestId:prepared.delivery.requestId,
    agencyId:prepared.delivery.agencyId,
    channel:prepared.delivery.channel,
    deliveryRevision:prepared.delivery.deliveryRevision,
    destinationFingerprint:prepared.audit.destinationFingerprint,
    portalFingerprint:prepared.audit.portalFingerprint,
    at,
  };
}

pgTest('pinned PostgreSQL migration DDL applies cleanly and required tables/index exist', async () => {
  assert.ok(dockerServerVersion);
  assert.match(String(postgresVersion), /^16\./);
  const tableCount = Number(await scalar(`SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('wfm_agency_portal_token_consumptions','wfm_agency_supplier_deliveries','wfm_agency_supplier_delivery_receipts');`));
  const indexCount = Number(await scalar(`SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='ux_wfm_agency_supplier_deliveries_tenant_delivery';`));
  assert.equal(tableCount, 3);
  assert.equal(indexCount, 1);
});

pgTest('real PostgreSQL allows exactly one atomic portal-token consumption under 32 concurrent connections', async () => {
  const store = createPostgresAgencyPortalTokenStore({ query });
  const record = {
    tenantId:'T-PG', tokenId:'token-concurrent-1', siteId:'S-PG', requestId:'R-PG', agencyId:'A-PG',
    tokenFingerprint:'0123456789abcdef', action:'confirm_preferred', expiresAt:'2026-09-19T18:00:00Z', consumedAt:'2026-09-18T16:00:00Z',
  };
  const results = await Promise.all(Array.from({ length:32 }, () => store.consumeOnce(record)));
  assert.equal(results.filter(result => result.consumed === true).length, 1);
  assert.equal(results.filter(result => result.reason === 'already_consumed').length, 31);
  assert.equal(Number(await scalar(`SELECT count(*) FROM wfm_agency_portal_token_consumptions WHERE tenant_id='T-PG' AND token_id='token-concurrent-1';`)), 1);
});

pgTest('tenant/token composite key preserves tenant isolation while remaining one-time within each tenant', async () => {
  const store = createPostgresAgencyPortalTokenStore({ query });
  const base = {
    tokenId:'shared-token-id', siteId:'S-PG', requestId:'R-PG', agencyId:'A-PG', tokenFingerprint:'fedcba9876543210',
    action:'decline', expiresAt:'2026-09-19T18:00:00Z', consumedAt:'2026-09-18T16:01:00Z',
  };
  const [t1, t2, t1Replay] = await Promise.all([
    store.consumeOnce({ ...base, tenantId:'TENANT-A' }),
    store.consumeOnce({ ...base, tenantId:'TENANT-B' }),
    store.consumeOnce({ ...base, tenantId:'TENANT-A' }),
  ]);
  assert.equal([t1, t2, t1Replay].filter(result => result.consumed).length, 2);
  assert.equal([t1, t2, t1Replay].filter(result => result.reason === 'already_consumed').length, 1);
});

pgTest('real PostgreSQL supplier-delivery claim is single-winner under 32 concurrent connections', async () => {
  const prepared = prepareAgencySupplierDelivery(preparedBase);
  assert.equal(prepared.ready, true);
  const store = createPostgresAgencySupplierDeliveryStore({ query });
  const record = deliveryRecord(prepared, '2026-09-18T16:02:00Z');
  const claims = await Promise.all(Array.from({ length:32 }, () => store.claimOnce(record)));
  assert.equal(claims.filter(claim => claim.claimed === true).length, 1);
  assert.equal(claims.filter(claim => claim.claimed === false).length, 31);
  assert.ok(claims.every(claim => claim.status === 'dispatching' && claim.attemptCount === 1));
  assert.equal(Number(await scalar(`SELECT count(*) FROM wfm_agency_supplier_deliveries WHERE tenant_id='T-PG' AND idempotency_key='${prepared.delivery.idempotencyKey}';`)), 1);
});

pgTest('real PostgreSQL receipt reconciliation is idempotent and monotonic under 32 concurrent connections', async () => {
  const prepared = prepareAgencySupplierDelivery({ ...preparedBase, deliveryRevision:3 });
  const deliveryStore = createPostgresAgencySupplierDeliveryStore({ query });
  const claim = await deliveryStore.claimOnce(deliveryRecord(prepared, '2026-09-18T16:02:50Z'));
  assert.equal(claim.claimed, true);
  await deliveryStore.recordOutcome({
    tenantId:'T-PG', idempotencyKey:prepared.delivery.idempotencyKey, status:'unknown', providerMessageRef:null, at:'2026-09-18T16:03:00Z',
  });

  const receiptStore = createPostgresAgencySupplierDeliveryReceiptStore({ query });
  const record = {
    tenantId:'T-PG', providerKey:'mail-proof', providerEventId:'evt-concurrent-1', deliveryId:prepared.delivery.deliveryId,
    providerMessageRef:'provider-proof-1', attemptNumber:1, channel:'email', normalizedOutcome:'confirmed_sent',
    eventAt:'2026-09-18T16:03:01Z', receivedAt:'2026-09-18T16:03:02Z', eventFingerprint:'0123456789abcdef',
  };
  const receipts = await Promise.all(Array.from({ length:32 }, () => receiptStore.reconcileOnce(record)));
  assert.equal(receipts.filter(receipt => receipt.result === 'recorded').length, 1);
  assert.equal(receipts.filter(receipt => receipt.result === 'duplicate_event').length, 31);
  assert.ok(receipts.every(receipt => receipt.status === 'sent'));
  assert.equal(Number(await scalar(`SELECT count(*) FROM wfm_agency_supplier_delivery_receipts WHERE tenant_id='T-PG' AND provider_key='mail-proof' AND provider_event_id='evt-concurrent-1';`)), 1);
  assert.equal(await scalar(`SELECT status FROM wfm_agency_supplier_deliveries WHERE tenant_id='T-PG' AND delivery_id='${prepared.delivery.deliveryId}';`), 'sent');
});

pgTest('stale negative provider evidence cannot unlock a newer delivery attempt in real PostgreSQL', async () => {
  const prepared = prepareAgencySupplierDelivery({ ...preparedBase, deliveryRevision:2 });
  const deliveryStore = createPostgresAgencySupplierDeliveryStore({ query });
  const record = deliveryRecord(prepared, '2026-09-18T16:04:00Z');
  const claim = await deliveryStore.claimOnce(record);
  assert.equal(claim.claimed, true);
  await deliveryStore.recordOutcome({tenantId:'T-PG', idempotencyKey:prepared.delivery.idempotencyKey, status:'not_sent', providerMessageRef:null, at:'2026-09-18T16:04:01Z'});
  const retry = await deliveryStore.claimRetry({tenantId:'T-PG', idempotencyKey:prepared.delivery.idempotencyKey, at:'2026-09-18T16:04:02Z', maxAttempts:3});
  assert.equal(retry.attemptCount, 2);
  await deliveryStore.recordOutcome({tenantId:'T-PG', idempotencyKey:prepared.delivery.idempotencyKey, status:'unknown', providerMessageRef:'provider-proof-2', at:'2026-09-18T16:04:03Z'});

  const receiptStore = createPostgresAgencySupplierDeliveryReceiptStore({ query });
  const stale = await receiptStore.reconcileOnce({
    tenantId:'T-PG', providerKey:'mail-proof', providerEventId:'evt-stale-attempt', deliveryId:prepared.delivery.deliveryId,
    providerMessageRef:'provider-proof-2', attemptNumber:1, channel:'email', normalizedOutcome:'definitively_not_sent',
    eventAt:'2026-09-18T16:04:04Z', receivedAt:'2026-09-18T16:04:05Z', eventFingerprint:'aaaaaaaaaaaaaaaa',
  });
  assert.equal(stale.result, 'attempt_mismatch');
  assert.equal(stale.status, 'unknown');

  const current = await receiptStore.reconcileOnce({
    tenantId:'T-PG', providerKey:'mail-proof', providerEventId:'evt-current-attempt', deliveryId:prepared.delivery.deliveryId,
    providerMessageRef:'provider-proof-2', attemptNumber:2, channel:'email', normalizedOutcome:'definitively_not_sent',
    eventAt:'2026-09-18T16:04:06Z', receivedAt:'2026-09-18T16:04:07Z', eventFingerprint:'bbbbbbbbbbbbbbbb',
  });
  assert.equal(current.result, 'recorded');
  assert.equal(current.status, 'not_sent');
});
