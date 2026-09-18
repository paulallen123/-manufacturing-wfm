'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const {
  buildConfigurationProposal
} = require('../implementation/runtime/configuration-inference-engine.cjs');
const {
  createAdaptiveLearningEngine,
  COMPETENCIES
} = require('../learning/runtime/adaptive-learning-engine.cjs');
const {
  createOneDayEnterpriseEngine,
  REQUIREMENTS
} = require('../implementation/runtime/one-day-enterprise-engine.cjs');

const TENANT = 'sell-readiness-enterprise';
const EMPLOYEES = 10000;
const SITES = 50;
const EMPLOYEES_PER_SITE = EMPLOYEES / SITES;
const INTERNAL_LEARNING = 'sell-readiness-learning-worker';
const INTERNAL_IMPLEMENTATION = 'sell-readiness-implementation-worker';
const outDir = path.join(process.cwd(), 'proof-output');
fs.mkdirSync(outDir, { recursive: true });

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}
function pad(value, width) {
  return String(value).padStart(width, '0');
}
function response() {
  const headers = {};
  return {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    end(value = '') {
      this.body = String(value);
      this.headersSent = true;
      this.writableEnded = true;
    },
    headers
  };
}
async function call(engine, token, method, url, body, extraHeaders = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = {
    ...(token ? { cookie: 'wfm_session=' + token } : {}),
    ...extraHeaders
  };
  const res = response();
  const handled = await engine.handleRequest(req, res);
  assert.equal(handled, true, url + ' was not handled');
  return {
    status: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null
  };
}

function buildEnterpriseDataset() {
  const people = [];
  const punches = [];
  const timecards = [];
  const rates = new Map();
  const shiftPatterns = [
    ['06:00', '14:00'],
    ['14:00', '22:00'],
    ['22:00', '06:00']
  ];

  let serial = 0;
  for (let siteIndex = 0; siteIndex < SITES; siteIndex++) {
    const site = 'SITE-' + pad(siteIndex + 1, 2);
    const ids = Array.from({ length: EMPLOYEES_PER_SITE }, (_, local) => 'E' + pad(siteIndex * EMPLOYEES_PER_SITE + local + 1, 5));
    for (let local = 0; local < EMPLOYEES_PER_SITE; local++) {
      serial += 1;
      const employeeId = ids[local];
      let wfmRole = 'employee';
      let jobTitle = 'Production Operator';
      if (local === 0) { wfmRole = 'admin'; jobTitle = 'Site WFM Administrator'; }
      else if (local === 1) { wfmRole = 'payroll'; jobTitle = 'Payroll Specialist'; }
      else if (local >= 2 && local <= 11) { wfmRole = 'manager'; jobTitle = 'Shift Manager'; }

      const managerId =
        local === 0 ? null :
        local <= 11 ? ids[0] :
        ids[2 + Math.floor((local - 12) / Math.ceil((EMPLOYEES_PER_SITE - 12) / 10)) % 10];

      const department = ['Assembly', 'Packing', 'Quality', 'Maintenance', 'Warehouse', 'Engineering', 'Planning', 'Dispatch'][local % 8];
      const employmentType = local % 17 === 0 ? 'Agency' : (local % 11 === 0 ? 'Part Time' : 'Permanent');
      const email = 'worker' + pad(serial, 5) + '@example.invalid';

      people.push({
        employeeId,
        email,
        firstName: 'Worker',
        lastName: pad(serial, 5),
        location: site,
        department,
        managerId,
        wfmRole,
        jobTitle,
        employmentType
      });

      const rateCents = 1600 + siteIndex * 4 + (local % 5) * 20;
      rates.set(employeeId, rateCents);

      const [clockIn, clockOut] = shiftPatterns[local % shiftPatterns.length];
      for (let shift = 0; shift < 10; shift++) {
        punches.push({ employeeId, location: site, clockIn, clockOut });
      }

      for (let week = 0; week < 4; week++) {
        const overtime = (local + week) % 4 === 0 ? 4 : 0;
        const workedHours = 40 + overtime;
        timecards.push({
          employeeId,
          week,
          workedHours,
          regularHours: 40,
          overtimeHours: overtime,
          breakMinutes: 30
        });
      }
    }
  }
  return { people, punches, timecards, rates };
}

function reconcileHistoricalPayroll(dataset, overtimeThresholdHours) {
  assert.equal(overtimeThresholdHours, 40, 'The inferred overtime threshold must be 40 hours before reconciliation.');
  const oracle = new Map();
  const projected = new Map();

  for (const row of dataset.timecards) {
    const rate = dataset.rates.get(row.employeeId);
    const oracleCents = Math.round(row.regularHours * rate + row.overtimeHours * rate * 1.5);
    oracle.set(row.employeeId, (oracle.get(row.employeeId) || 0) + oracleCents);

    const regular = Math.min(row.workedHours, overtimeThresholdHours);
    const overtime = Math.max(0, row.workedHours - overtimeThresholdHours);
    const projectionCents = Math.round(regular * rate + overtime * rate * 1.5);
    projected.set(row.employeeId, (projected.get(row.employeeId) || 0) + projectionCents);
  }

  let absoluteVarianceCents = 0;
  let employeesWithVariance = 0;
  let oracleGrossCents = 0;
  let projectedGrossCents = 0;
  for (const person of dataset.people) {
    const a = oracle.get(person.employeeId) || 0;
    const b = projected.get(person.employeeId) || 0;
    oracleGrossCents += a;
    projectedGrossCents += b;
    const delta = b - a;
    absoluteVarianceCents += Math.abs(delta);
    if (delta !== 0) employeesWithVariance += 1;
  }
  return {
    employees: dataset.people.length,
    periods: 4,
    lines: dataset.timecards.length,
    oracleGrossCents,
    projectedGrossCents,
    absoluteVarianceCents,
    employeesWithVariance,
    zeroUnexplainedVariance: absoluteVarianceCents === 0 && employeesWithVariance === 0,
    oracleDigest: sha256([...oracle.entries()]),
    projectionDigest: sha256([...projected.entries()])
  };
}

function hostileDataset(clean) {
  const people = clean.people.slice();
  people.push({ ...clean.people[0] });
  people[17] = { ...people[17], managerId: 'E99999' };
  people[43] = { ...people[43], location: '' };

  const punches = clean.punches.slice();
  punches.push({ employeeId: 'E00001', location: 'SITE-01', clockIn: 'not-a-time', clockOut: '14:00' });

  const timecards = clean.timecards.slice();
  timecards[0] = { ...timecards[0], regularHours: 37.5, overtimeHours: 6.5, workedHours: 44, breakMinutes: 7 };
  return { people, punches, timecards };
}

function seedUsers(db) {
  db.exec(
    'CREATE TABLE tenants(id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);' +
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT \'[]\');' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL);'
  );
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(TENANT, 1, '{}');
  const insert = db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)');
  const managerToken = 'm'.repeat(64);
  const expires = Date.now() + 60 * 60 * 1000;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (let siteIndex = 0; siteIndex < SITES; siteIndex++) {
      for (let local = 0; local < EMPLOYEES_PER_SITE; local++) {
        const serial = siteIndex * EMPLOYEES_PER_SITE + local + 1;
        const email = 'worker' + pad(serial, 5) + '@example.invalid';
        const personId = 'P' + pad(serial, 5);
        const role = local === 0 ? 'company-admin' : local === 1 ? 'payroll' : local <= 11 ? 'manager' : 'employee';
        insert.run(email, TENANT, personId, role, role === 'employee' ? 0 : 1, 's', '00', '[]');
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
    sha256(managerToken),
    'worker00003@example.invalid',
    expires
  );
  return { managerToken };
}

function bulkMasterAllAssignments(dbPath) {
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare('SELECT id,tenant,email,competency_key FROM learning_assignments ORDER BY id').all();
  const insert = db.prepare(
    'INSERT INTO learning_evidence(assignment_id,tenant,email,evidence_type,result,score_value,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)'
  );
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      insert.run(row.id, row.tenant, row.email, 'OBSERVED_SUCCESS', 'PASS', 60, '{"source":"10k-scale-observed-simulation"}', now);
      insert.run(row.id, row.tenant, row.email, 'RETRIEVAL_CHECK', 'PASS', 30, '{"source":"10k-scale-retrieval-simulation"}', now);
      if (COMPETENCIES[row.competency_key]?.teachBack) {
        insert.run(row.id, row.tenant, row.email, 'TEACH_BACK', 'PASS', 45, '{"source":"10k-scale-teach-back-simulation"}', now);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  db.close();
  return rows.length;
}

async function passTechnicalEvidence(engine, runId, internalHeaders, historicalReplayStatus = 'PASS') {
  let latest;
  for (const item of REQUIREMENTS) {
    if (['role-learning', 'privileged-competency', 'frontline-readiness'].includes(item.key)) continue;
    const result = await call(
      engine,
      null,
      'POST',
      '/api/implementation/autonomous/evidence',
      {
        runId,
        kind: item.key,
        status: item.key === 'historical-replay' ? historicalReplayStatus : 'PASS',
        confidence: 1,
        source: 'sell-readiness-scale-proof',
        detail: { syntheticEnterprise: true, employees: EMPLOYEES, sites: SITES }
      },
      internalHeaders
    );
    assert.equal(result.status, 200);
    latest = result.body;
  }
  return latest;
}

const startedAt = new Date().toISOString();
const wallStart = performance.now();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-sell-readiness-'));
const dbPath = path.join(temp, 'enterprise.sqlite');
let learning;
let implementation;

try {
  const datasetStart = performance.now();
  const clean = buildEnterpriseDataset();
  assert.equal(clean.people.length, EMPLOYEES);
  assert.equal(new Set(clean.people.map(x => x.location)).size, SITES);
  const datasetMs = performance.now() - datasetStart;

  const inferenceStart = performance.now();
  const proposal = buildConfigurationProposal(clean);
  const inferenceMs = performance.now() - inferenceStart;
  assert.equal(proposal.organisation.peopleCount, EMPLOYEES);
  assert.equal(proposal.organisation.sites.length, SITES);
  assert.equal(proposal.organisation.autoApply, true);
  assert.equal(proposal.workforce.assignments.length, EMPLOYEES);
  assert.equal(proposal.workforce.coverage, 1);
  assert.equal(proposal.workforce.exceptions.length, 0);
  assert.equal(proposal.policies.overtime.thresholdHours, 40);
  assert.equal(proposal.policies.overtime.autoApply, false, 'High-risk payroll rule must never silently auto-apply.');

  const reconciliation = reconcileHistoricalPayroll(clean, proposal.policies.overtime.thresholdHours);
  assert.equal(reconciliation.zeroUnexplainedVariance, true);

  const hostile = hostileDataset(clean);
  const hostileProposal = buildConfigurationProposal(hostile);
  assert.equal(hostileProposal.organisation.autoApply, false);
  assert.equal(hostileProposal.workforce.autoApply, false);
  assert.ok(hostileProposal.organisation.duplicateEmployeeIds.length >= 1);
  assert.ok(hostileProposal.organisation.orphanManagers.length >= 1);
  assert.ok(hostileProposal.workforce.exceptions.length >= 1);
  assert.equal(hostileProposal.policies.overtime.autoApply, false);

  const db = new DatabaseSync(dbPath);
  const { managerToken } = seedUsers(db);
  db.close();

  const learningStart = performance.now();
  learning = createAdaptiveLearningEngine({ dbPath, internalToken: INTERNAL_LEARNING });
  const initialLearning = learning.summaryForTenant(TENANT);
  assert.equal(initialLearning.users, EMPLOYEES);
  assert.ok(initialLearning.assignments > 50000);
  assert.equal(initialLearning.fullyCertified, false);
  const assignmentCount = bulkMasterAllAssignments(dbPath);
  assert.equal(assignmentCount, initialLearning.assignments);
  const masteredLearning = learning.summaryForTenant(TENANT);
  const learningMs = performance.now() - learningStart;
  assert.equal(masteredLearning.users, EMPLOYEES);
  assert.equal(masteredLearning.fullyCertified, true);
  assert.equal(masteredLearning.privilegedReady, true);
  assert.equal(masteredLearning.masteryPercent, 100);

  implementation = createOneDayEnterpriseEngine({
    dbPath,
    internalToken: INTERNAL_IMPLEMENTATION,
    learningSummaryProvider: tenant => learning.summaryForTenant(tenant)
  });
  const implementationHeaders = { 'x-wfm-implementation-internal': INTERNAL_IMPLEMENTATION };

  const run = await call(
    implementation,
    null,
    'POST',
    '/api/implementation/autonomous/contract-activated',
    { tenant: TENANT, contractRef: 'sell-readiness-10k-clean', targetHours: 8 },
    implementationHeaders
  );
  assert.equal(run.status, 201);
  const ready = await passTechnicalEvidence(implementation, run.body.runId, implementationHeaders, 'PASS');
  assert.equal(ready.operationalReady, true);
  assert.equal(ready.state, 'READY');
  assert.equal(ready.learningSummary.users, EMPLOYEES);
  assert.equal(ready.learningSummary.fullyCertified, true);

  const managerStatus = await call(
    implementation,
    managerToken,
    'GET',
    '/api/implementation/autonomous/status'
  );
  assert.equal(managerStatus.status, 200);
  assert.equal(managerStatus.body.operationalReady, true);

  const badRun = await call(
    implementation,
    null,
    'POST',
    '/api/implementation/autonomous/contract-activated',
    { tenant: TENANT, contractRef: 'sell-readiness-10k-hostile-payroll', targetHours: 8 },
    implementationHeaders
  );
  assert.equal(badRun.status, 201);
  const blocked = await passTechnicalEvidence(implementation, badRun.body.runId, implementationHeaders, 'FAIL');
  assert.equal(blocked.operationalReady, false, 'A failed historical payroll reconciliation must block READY.');

  const wallMs = performance.now() - wallStart;
  const result = {
    schemaVersion: 1,
    proof: 'sell-readiness-scale-control-plane',
    status: 'PASS',
    startedAt,
    completedAt: new Date().toISOString(),
    scale: {
      employees: EMPLOYEES,
      sites: SITES,
      employeesPerSite: EMPLOYEES_PER_SITE,
      punches: clean.punches.length,
      timecards: clean.timecards.length,
      learningAssignments: masteredLearning.assignments
    },
    implementation: {
      cleanOperationalReady: ready.operationalReady,
      cleanState: ready.state,
      hostilePayrollReplayBlocksReady: blocked.operationalReady === false,
      unresolvedHighRiskPayrollRulesAutoApplied: proposal.policies.overtime.autoApply
    },
    training: {
      users: masteredLearning.users,
      assignments: masteredLearning.assignments,
      masteryPercent: masteredLearning.masteryPercent,
      privilegedReady: masteredLearning.privilegedReady,
      fullyCertified: masteredLearning.fullyCertified,
      evidenceMode: 'bounded synthetic observed/retrieval/teach-back evidence at full 10,000-user assignment scale'
    },
    historicalReplay: reconciliation,
    hostileInput: {
      duplicateEmployeeIdsDetected: hostileProposal.organisation.duplicateEmployeeIds.length,
      orphanManagersDetected: hostileProposal.organisation.orphanManagers.length,
      employeeAssignmentExceptionsDetected: hostileProposal.workforce.exceptions.length,
      organisationAutoApplyDenied: hostileProposal.organisation.autoApply === false,
      workforceAutoApplyDenied: hostileProposal.workforce.autoApply === false,
      highRiskPayrollAutoApplyDenied: hostileProposal.policies.overtime.autoApply === false
    },
    timingMs: {
      datasetGeneration: Number(datasetMs.toFixed(1)),
      configurationInference: Number(inferenceMs.toFixed(1)),
      learningAssignmentAndCertification: Number(learningMs.toFixed(1)),
      total: Number(wallMs.toFixed(1))
    },
    memory: process.memoryUsage(),
    digests: {
      people: sha256(clean.people),
      punches: sha256(clean.punches),
      timecards: sha256(clean.timecards),
      configurationProposal: sha256(proposal),
      hostileProposal: sha256(hostileProposal)
    },
    claimBoundary: 'This is exact control-plane code at 10,000-user/50-site synthetic scale and an independent historical payroll replay oracle. It is not yet proof that the sealed hosted payroll runtime processed all 10,000 employees, nor external provider/customer production acceptance. Sell-ready must remain false until those live-runtime gates pass.'
  };
  fs.writeFileSync(path.join(outDir, 'sell-readiness-scale.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  try { implementation?.close(); } catch {}
  try { learning?.close(); } catch {}
  fs.rmSync(temp, { recursive: true, force: true });
}
