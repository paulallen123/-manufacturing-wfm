import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL,
  createAgencyRightToWorkAssuranceVersion,
  createPostgresAgencyRightToWorkAssuranceStore,
} from '../../src/frontier/agency-right-to-work-assurance-ledger.mjs';

const execFileAsync = promisify(execFile);
const POSTGRES_IMAGE = 'postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED = process.env.AGENCY_POSTGRES_PROOF_REQUIRED === '1';
const CONTAINER = `wfm-agency-rtw-assurance-pg-${process.pid}-${Date.now()}`;
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
  return sql.replace(/\$(\d+)(::[a-zA-Z_]+)?/g, (_, n, cast='') => `${lit(values[Number(n)-1])}${cast}`);
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
  const { stdout } = await docker(['exec', CONTAINER, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-A', '-F', '\t', '-P', 'footer=off', '-P', 'null=__NULL__', '-c', sql], { timeout:30000 });
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
  try { await docker(['version'], { timeout:5000 }); }
  catch (error) {
    if (REQUIRED) throw new Error(`Docker required for RTW assurance PostgreSQL proof: ${error.message}`);
    return;
  }
  await docker(['run', '--rm', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=agency-proof-only-not-a-secret', POSTGRES_IMAGE]);
  started = true;
  await waitReady();
  await psql(AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL);
});

after(async () => {
  if (started) await docker(['rm', '-f', CONTAINER]).catch(() => {});
});

const REQUEST = { roleId:'PACK-OP', location:'Plant 1, Birmingham', startAt:'2026-10-05T06:00:00.000Z', endAt:'2026-10-05T14:00:00.000Z' };
const AGENCY = { agencyId:'A1' };
const NOW = '2026-10-04T12:00:00.000Z';
const fingerprint = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);

function rightToWork(checkedAt, evidenceRef) {
  return {
    status:'verified', checkedByAgencyId:'A1', checkMethod:'home_office_online', checkedAt, evidenceRef,
    indefinite:false, validUntil:'2027-12-31T23:59:59.000Z', engagementType:'workers_contract', employmentCommencedAt:'2026-10-02T09:00:00.000Z',
    assignmentScope:{ roleId:REQUEST.roleId, location:REQUEST.location, startAt:REQUEST.startAt, endAt:REQUEST.endAt, restrictionsSatisfied:true },
  };
}
function evaluator(worker, request, agency) {
  const rtw = worker.rightToWork;
  const failures = [];
  if (rtw.checkedByAgencyId !== agency.agencyId) failures.push('right_to_work_checker_agency_mismatch');
  if (rtw.assignmentScope.roleId !== request.roleId || rtw.assignmentScope.location !== request.location) failures.push('right_to_work_assignment_scope_mismatch');
  return { eligible:failures.length === 0, failures, evidence:{ evidenceFingerprint:fingerprint(rtw.evidenceRef), checkMethod:rtw.checkMethod, checkedAt:rtw.checkedAt, lifecycle:{effectiveCoverageUntil:rtw.validUntil}, assignmentScope:rtw.assignmentScope } };
}
function built(checkedAt, evidenceRef, workerId='W1') {
  const ef = fingerprint(evidenceRef);
  const acceptedRefresh = { accepted:true, receipt:{ refreshRecorded:true, eligibleAfterRefresh:true, tenantId:'T1', siteId:'S1', requestId:'R1', agencyId:'A1', workerId, assignmentFingerprint:'c'.repeat(24), evidenceFingerprint:ef, checkMethod:'home_office_online', checkedAt } };
  const result = createAgencyRightToWorkAssuranceVersion({ acceptedRefresh, rightToWork:rightToWork(checkedAt, evidenceRef), request:REQUEST, agency:AGENCY, now:NOW, evaluateRightToWork:evaluator });
  assert.equal(result.valid, true);
  return result.version;
}

test('32 concurrent out-of-order promotions retain every history row while only the newest check becomes current', async (t) => {
  if (!started) return t.skip('Docker unavailable and PostgreSQL proof is not required in this environment');
  const store = createPostgresAgencyRightToWorkAssuranceStore({ query });
  const versions = Array.from({ length:32 }, (_, i) => built(`2026-10-04T10:${String(i).padStart(2,'0')}:00.000Z`, `private-evidence-${i}`));
  await Promise.all([...versions].reverse().map(version => store.promote(version)));
  const current = await query('SELECT assurance_version_id, checked_at, conflicted FROM wfm_agency_rtw_assurance_current WHERE tenant_id=$1 AND agency_id=$2 AND worker_id=$3;', ['T1','A1','W1']);
  assert.equal(current.rowCount, 1);
  assert.equal(current.rows[0].assurance_version_id, versions[31].assuranceVersionId);
  assert.equal(current.rows[0].conflicted, false);
  const count = await query('SELECT COUNT(*) AS count FROM wfm_agency_rtw_assurance_history WHERE tenant_id=$1 AND agency_id=$2 AND worker_id=$3;', ['T1','A1','W1']);
  assert.equal(Number(count.rows[0].count), 32);
});

test('same-time different evidence creates a fail-closed conflicted current state and later evidence clears it', async (t) => {
  if (!started) return t.skip('Docker unavailable and PostgreSQL proof is not required in this environment');
  const store = createPostgresAgencyRightToWorkAssuranceStore({ query });
  const a = built('2026-10-04T11:00:00.000Z', 'same-time-a', 'W2');
  const b = built('2026-10-04T11:00:00.000Z', 'same-time-b', 'W2');
  await Promise.all([store.promote(a), store.promote(b)]);
  let current = await query('SELECT assurance_version_id, checked_at, conflicted FROM wfm_agency_rtw_assurance_current WHERE tenant_id=$1 AND agency_id=$2 AND worker_id=$3;', ['T1','A1','W2']);
  assert.equal(current.rowCount, 1);
  assert.equal(current.rows[0].conflicted, true);

  const later = built('2026-10-04T11:30:00.000Z', 'later-unambiguous', 'W2');
  const promoted = await store.promote(later);
  assert.equal(promoted.current.assuranceVersionId, later.assuranceVersionId);
  assert.equal(promoted.current.conflicted, false);
  current = await query('SELECT assurance_version_id, conflicted FROM wfm_agency_rtw_assurance_current WHERE tenant_id=$1 AND agency_id=$2 AND worker_id=$3;', ['T1','A1','W2']);
  assert.equal(current.rows[0].assurance_version_id, later.assuranceVersionId);
  assert.equal(current.rows[0].conflicted, false);
  const count = await query('SELECT COUNT(*) AS count FROM wfm_agency_rtw_assurance_history WHERE tenant_id=$1 AND agency_id=$2 AND worker_id=$3;', ['T1','A1','W2']);
  assert.equal(Number(count.rows[0].count), 3);
});
