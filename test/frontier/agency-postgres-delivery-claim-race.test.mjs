import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AGENCY_SUPPLIER_DELIVERY_DDL,
  createPostgresAgencySupplierDeliveryStore,
  prepareAgencySupplierDelivery,
} from '../../src/frontier/agency-supplier-delivery.mjs';

const execFileAsync = promisify(execFile);
const POSTGRES_IMAGE = 'postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED = process.env.AGENCY_POSTGRES_PROOF_REQUIRED === '1';
const CONTAINER = `wfm-agency-claim-race-${process.pid}-${Date.now()}`;
const DB_USER = 'postgres';
const DB_NAME = 'postgres';
const DB_PASSWORD = 'agency-claim-race-proof-only';
const ADVISORY_KEY = 938201;
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
    .filter(line => !/^(INSERT|UPDATE|DELETE|SELECT|CREATE|ALTER|DROP|BEGIN|COMMIT)\b/.test(line));
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map(line => {
    const cells = line.split('\t');
    return Object.fromEntries(headers.map((header, index) => [header, normalizeCell(cells[index] ?? '')]));
  });
}

async function psql(sql, timeout = 30000) {
  const { stdout } = await docker([
    'exec', CONTAINER,
    'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', DB_USER, '-d', DB_NAME,
    '-A', '-F', '\t', '-P', 'footer=off', '-P', 'null=__NULL__',
    '-c', sql,
  ], { timeout });
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
  let initComplete = false;
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const logs = await docker(['logs', CONTAINER], { timeout: 5000 });
      const text = `${logs.stdout ?? ''}\n${logs.stderr ?? ''}`;
      initComplete ||= text.includes('PostgreSQL init process complete; ready for start up.');
      if (initComplete) {
        const { stdout } = await docker([
          'exec', CONTAINER, 'psql', '-X', '-q', '-A', '-t',
          '-U', DB_USER, '-d', DB_NAME, '-c', 'SELECT 1;',
        ], { timeout: 5000 });
        if (stdout.trim() === '1') return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`postgres did not become ready: ${lastError?.message ?? 'unknown'}`);
}

async function waitForHolderLock() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const count = Number(await scalar(`SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=${ADVISORY_KEY} AND granted;`));
    if (count > 0) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('holder transaction did not reach the post-insert advisory-lock checkpoint');
}

before(async () => {
  if (!REQUIRED) return;
  await docker(['version', '--format', '{{.Server.Version}}'], { timeout: 10000 });
  await docker([
    'run', '-d', '--rm', '--name', CONTAINER,
    '-e', `POSTGRES_PASSWORD=${DB_PASSWORD}`,
    POSTGRES_IMAGE,
  ], { timeout: 120000 });
  started = true;
  await waitForPostgres();
  await psql(AGENCY_SUPPLIER_DELIVERY_DDL);
});

after(async () => {
  if (!started) return;
  try { await docker(['rm', '-f', CONTAINER], { timeout: 10000 }); } catch {}
  started = false;
});

const pgTest = (name, fn) => test(name, { skip: !REQUIRED }, fn);

function preparedRequest() {
  return prepareAgencySupplierDelivery({
    tenantId:'T-CLAIM-RACE', siteId:'S-CLAIM-RACE', requestId:'R-CLAIM-RACE', agencyId:'A-CLAIM-RACE',
    channel:'email', destination:'ops@agency.example',
    portalUrl:'https://wfm.example/agency/respond?token=claim-race-proof',
    responseDeadline:'2026-09-20T18:00:00.000Z', deliveryRevision:1,
    requestPack:{
      requestId:'R-CLAIM-RACE',
      hirer:{name:'Factory Ltd', businessNature:'Manufacturing'},
      assignment:{roleName:'Line Operator', location:'Plant 1', startAt:'2026-09-21T06:00:00.000Z', endAt:'2026-09-21T14:00:00.000Z', count:4, fairWorkAgencyGangmasterLicenceRequired:false},
    },
    supplierEligibility:{version:'agency-supplier-compliance-v0.1.0', agencyId:'A-CLAIM-RACE', eligible:true, failures:[], evidence:{licenceRequired:false, evidenceRule:'gangmaster_licence_not_required_by_request_policy'}},
  });
}

function recordFrom(prepared) {
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
    at:'2026-09-19T02:45:00.000Z',
  };
}

pgTest('claimOnce loser observes the committed winner after waiting on an uncommitted conflicting insert', async () => {
  const prepared = preparedRequest();
  assert.equal(prepared.ready, true);
  const record = recordFrom(prepared);
  const insertSql = `
BEGIN;
INSERT INTO wfm_agency_supplier_deliveries
  (tenant_id, idempotency_key, delivery_id, site_id, request_id, agency_id, channel,
   delivery_revision, destination_fingerprint, portal_fingerprint, status, attempt_count,
   provider_message_ref, created_at, updated_at)
VALUES (${sqlLiteral(record.tenantId)},${sqlLiteral(record.idempotencyKey)},${sqlLiteral(record.deliveryId)},${sqlLiteral(record.siteId)},${sqlLiteral(record.requestId)},${sqlLiteral(record.agencyId)},${sqlLiteral(record.channel)},${sqlLiteral(record.deliveryRevision)},${sqlLiteral(record.destinationFingerprint)},${sqlLiteral(record.portalFingerprint)},'dispatching',1,NULL,${sqlLiteral(record.at)}::timestamptz,${sqlLiteral(record.at)}::timestamptz);
SELECT pg_advisory_xact_lock(${ADVISORY_KEY});
SELECT pg_sleep(1.25);
COMMIT;`;

  const holder = psql(insertSql, 10000);
  await waitForHolderLock();

  const store = createPostgresAgencySupplierDeliveryStore({ query });
  const claimsPromise = Promise.all(Array.from({ length:32 }, () => store.claimOnce(record)));
  await holder;
  const claims = await claimsPromise;

  assert.equal(claims.length, 32);
  assert.equal(claims.filter(claim => claim.claimed === true).length, 0);
  assert.equal(claims.filter(claim => claim.claimed === false).length, 32);
  assert.ok(claims.every(claim => claim.status === 'dispatching' && claim.attemptCount === 1));
  assert.equal(Number(await scalar(`SELECT count(*) FROM wfm_agency_supplier_deliveries WHERE tenant_id='T-CLAIM-RACE' AND idempotency_key='${prepared.delivery.idempotencyKey}';`)), 1);
});
