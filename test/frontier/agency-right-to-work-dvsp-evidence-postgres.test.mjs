import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AGENCY_RIGHT_TO_WORK_DVSP_EVIDENCE_DDL,
  createAgencyRightToWorkDvspEvidenceVersion,
  createPostgresAgencyRightToWorkDvspEvidenceStore,
} from '../../src/frontier/agency-right-to-work-dvsp-evidence.mjs';

const execFileAsync = promisify(execFile);
const POSTGRES_IMAGE = 'postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED = process.env.AGENCY_POSTGRES_PROOF_REQUIRED === '1';
const CONTAINER = `wfm-agency-dvsp-pg-${process.pid}-${Date.now()}`;
let started = false;

async function docker(args, options = {}) {
  return execFileAsync('docker', args, { maxBuffer:8 * 1024 * 1024, timeout:options.timeout ?? 30000, encoding:'utf8' });
}
function lit(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replaceAll("'", "''")}'`;
}
function interpolate(sql, values = []) {
  return sql.replace(/\$(\d+)/g, (_, n) => `${lit(values[Number(n)-1])}`);
}
function normalize(value) {
  if (value === '__NULL__') return null;
  if (value === 't') return true;
  if (value === 'f') return false;
  return value;
}
function parseRows(stdout) {
  const lines = stdout.split(/\r?\n/).map(x => x.trimEnd()).filter(Boolean).filter(x => !/^(INSERT|UPDATE|DELETE|SELECT|CREATE|ALTER|DROP)\b/.test(x));
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map(line => Object.fromEntries(headers.map((h,i) => [h, normalize(line.split('\t')[i] ?? '')])));
}
async function psql(sql) {
  const { stdout } = await docker(['exec', CONTAINER, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-A', '-F', '\t', '-P', 'footer=off', '-P', 'null=__NULL__', '-c', sql]);
  return stdout;
}
async function query(sql, values = []) {
  const rows = parseRows(await psql(interpolate(sql, values)));
  return { rows, rowCount:rows.length };
}
async function waitReady() {
  let initialized = false;
  let last = '';
  for (let i=0; i<80; i++) {
    try {
      const logs = await docker(['logs', CONTAINER], { timeout:5000 });
      last = `${logs.stdout ?? ''}\n${logs.stderr ?? ''}`;
      initialized ||= last.includes('PostgreSQL init process complete; ready for start up.');
      if (initialized) {
        const { stdout } = await docker(['exec', CONTAINER, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-c', 'SELECT 1;'], { timeout:5000 });
        if (stdout.trim() === '1') return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`postgres did not reach final ready state: ${last.slice(-2000)}`);
}

before(async () => {
  try {
    await docker(['version'], { timeout:5000 });
  } catch (error) {
    if (REQUIRED) throw new Error(`Docker required for DVSP PostgreSQL proof: ${error.message}`);
    return;
  }
  await docker(['run', '--rm', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=agency-proof-only-not-a-secret', POSTGRES_IMAGE]);
  started = true;
  await waitReady();
  await psql(AGENCY_RIGHT_TO_WORK_DVSP_EVIDENCE_DDL);
});

after(async () => {
  if (started) await docker(['rm', '-f', CONTAINER]).catch(() => {});
});

const base = (overrides={}) => ({
  tenantId:'T1', agencyId:'A1', providerId:'DVSP-1', registryStatus:'registered',
  trustFrameworkCertified:true, rightToWorkSupplementaryCodeCertified:true,
  rightToWorkSupplementaryCodeVersion:'1.1', exclusiveForAgencyRightToWork:true,
  effectiveAt:'2026-09-02T00:00:00.000Z', expiresAt:'2027-09-02T00:00:00.000Z',
  registryVerifiedAt:'2026-09-18T09:00:00.000Z', registryEvidenceRef:'private-register-evidence-1',
  evidenceSource:'ofdia_statutory_dvs_register', recordedAt:'2026-09-18T09:01:00.000Z',
  ...overrides,
});

test('32 concurrent appends of one evidence version produce one durable row', async (t) => {
  if (!started) return t.skip('Docker unavailable and PostgreSQL proof is not required in this environment');
  const record = createAgencyRightToWorkDvspEvidenceVersion(base());
  const results = await Promise.all(Array.from({ length:32 }, () => createPostgresAgencyRightToWorkDvspEvidenceStore({ query }).recordOnce(record)));
  assert.equal(results.filter(r => r.recorded).length, 1);
  assert.equal(results.filter(r => r.reason === 'already_recorded').length, 31);
  const rows = await query('SELECT tenant_id, agency_id, provider_id, evidence_version_id, registry_evidence_fingerprint FROM wfm_agency_rtw_dvsp_provider_evidence WHERE tenant_id=$1 AND agency_id=$2 AND provider_id=$3;', ['T1','A1','DVSP-1']);
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].evidence_version_id, record.evidenceVersionId);
  assert.equal(rows.rows[0].registry_evidence_fingerprint, record.registryEvidenceFingerprint);
});

test('check-time resolution selects the latest evidence known and effective at that exact check', async (t) => {
  if (!started) return t.skip('Docker unavailable and PostgreSQL proof is not required in this environment');
  const store = createPostgresAgencyRightToWorkDvspEvidenceStore({ query });
  const old = createAgencyRightToWorkDvspEvidenceVersion(base({
    providerId:'DVSP-2', registryEvidenceRef:'old-register-record', registryVerifiedAt:'2026-09-10T08:00:00.000Z', recordedAt:'2026-09-10T08:01:00.000Z',
  }));
  const newer = createAgencyRightToWorkDvspEvidenceVersion(base({
    providerId:'DVSP-2', registryEvidenceRef:'new-register-record', registryStatus:'suspended', registryVerifiedAt:'2026-09-20T08:00:00.000Z', recordedAt:'2026-09-20T08:01:00.000Z',
  }));
  await store.recordOnce(old);
  await store.recordOnce(newer);

  const beforeNewEvidence = await store.resolveForCheck({ tenantId:'T1', agencyId:'A1', providerId:'DVSP-2', checkedAt:'2026-09-18T10:00:00.000Z' });
  assert.equal(beforeNewEvidence.found, true);
  assert.equal(beforeNewEvidence.evidence.evidenceVersionId, old.evidenceVersionId);
  assert.equal(beforeNewEvidence.evidence.registryStatus, 'registered');

  const afterNewEvidence = await store.resolveForCheck({ tenantId:'T1', agencyId:'A1', providerId:'DVSP-2', checkedAt:'2026-09-21T10:00:00.000Z' });
  assert.equal(afterNewEvidence.found, true);
  assert.equal(afterNewEvidence.evidence.evidenceVersionId, newer.evidenceVersionId);
  assert.equal(afterNewEvidence.evidence.registryStatus, 'suspended');
});
