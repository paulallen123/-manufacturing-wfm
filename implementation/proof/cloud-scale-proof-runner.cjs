'use strict';

const fs = require('node:fs');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const ENGINE_PATH = process.env.WFM_CONFIG_ENGINE_PATH || '/tmp/configuration-inference-engine.cjs';
const EXPECTED_ENGINE_BLOB = process.env.WFM_CONFIG_ENGINE_GIT_BLOB_SHA || 'b47687d87b56a41240e731cf4e2046edf5acfa68';
const PORT = Number(process.env.PORT || 3000);

function gitBlobSha(content) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash('sha1').update(Buffer.from(`blob ${body.length}\0`)).update(body).digest('hex');
}

const engineBytes = fs.readFileSync(ENGINE_PATH);
const engineBlobSha = gitBlobSha(engineBytes);
if (engineBlobSha !== EXPECTED_ENGINE_BLOB) {
  throw new Error(`Configuration engine identity mismatch: ${engineBlobSha} != ${EXPECTED_ENGINE_BLOB}`);
}

const { buildConfigurationProposal } = require(ENGINE_PATH);

function money(value) {
  return Math.round(Number(value) * 100) / 100;
}

function employeeId(index) {
  return `E${String(index + 1).padStart(5, '0')}`;
}

function buildFixture() {
  const people = [];
  const punches = [];
  const timecards = [];
  const payrollRows = [];
  const jobTitles = ['Operator A', 'Operator B', 'Operator C', 'Technician', 'Supervisor'];
  const departments = ['Assembly', 'Packing', 'Quality', 'Maintenance', 'Stores', 'Machining', 'Dispatch'];

  for (let i = 0; i < 10000; i += 1) {
    const siteIndex = Math.floor(i / 200);
    const site = `SITE-${String(siteIndex + 1).padStart(3, '0')}`;
    const id = employeeId(i);
    const siteLeadIndex = siteIndex * 200;
    const department = departments[i % departments.length];
    const jobTitle = jobTitles[Math.floor(i / departments.length) % jobTitles.length];
    const managerId = i === siteLeadIndex ? '' : employeeId(siteLeadIndex);

    people.push({
      employeeId: id,
      firstName: `Person${i + 1}`,
      lastName: 'Scale',
      email: `${id.toLowerCase()}@example.invalid`,
      location: site,
      department,
      jobTitle,
      employmentType: 'Permanent',
      managerId
    });

    const shiftA = i % 2 === 0;
    for (let d = 0; d < 10; d += 1) {
      punches.push({
        employeeId: id,
        location: site,
        clockIn: shiftA ? '06:00' : '14:00',
        clockOut: shiftA ? '14:00' : '22:00'
      });
    }

    const rate = 20 + (i % 5);
    const cardHours = [8, 8, 42, 10];
    for (let w = 0; w < cardHours.length; w += 1) {
      const workedHours = cardHours[w];
      const regularHours = Math.min(40, workedHours);
      const overtimeHours = Math.max(0, workedHours - 40);
      const breakMinutes = workedHours < 9 ? 30 : 45;
      const expectedGross = money(regularHours * rate + overtimeHours * rate * 1.5);
      const row = {
        employeeId: id,
        period: `P${w + 1}`,
        workedHours,
        regularHours,
        overtimeHours,
        breakMinutes,
        hourlyRate: rate,
        expectedGross
      };
      timecards.push(row);
      payrollRows.push({ ...row });
    }
  }

  return { people, punches, timecards, payrollRows };
}

function independentlyProjectGross(rows) {
  return rows.map(row => ({
    employeeId: row.employeeId,
    period: row.period,
    gross: money(Number(row.regularHours) * Number(row.hourlyRate) + Number(row.overtimeHours) * Number(row.hourlyRate) * 1.5)
  }));
}

function reconcile(expectedRows, projectedRows) {
  const projected = new Map(projectedRows.map(row => [`${row.employeeId}|${row.period}`, Number(row.gross)]));
  let expectedTotal = 0;
  let projectedTotal = 0;
  let unexplainedVariance = 0;
  const variances = [];

  for (const row of expectedRows) {
    const key = `${row.employeeId}|${row.period}`;
    const expected = Number(row.expectedGross);
    const actual = projected.has(key) ? Number(projected.get(key)) : NaN;
    expectedTotal += expected;
    if (Number.isFinite(actual)) projectedTotal += actual;
    const variance = Number.isFinite(actual) ? money(actual - expected) : NaN;
    if (!Number.isFinite(variance) || Math.abs(variance) > 0.001) {
      variances.push({ key, expected, projected: Number.isFinite(actual) ? actual : null, variance: Number.isFinite(variance) ? variance : null });
      if (Number.isFinite(variance)) unexplainedVariance += variance;
    }
  }

  return {
    expectedTotal: money(expectedTotal),
    projectedTotal: money(projectedTotal),
    unexplainedVariance: money(unexplainedVariance),
    varianceCount: variances.length,
    sampleVariances: variances.slice(0, 5)
  };
}

function runProof() {
  const started = performance.now();
  const fixture = buildFixture();
  const proposalStarted = performance.now();
  const proposal = buildConfigurationProposal(fixture);
  const proposalMs = performance.now() - proposalStarted;

  const sites = proposal.organisation.sites.length;
  const projected = independentlyProjectGross(fixture.payrollRows);
  const cleanReconciliation = reconcile(fixture.payrollRows, projected);

  const corrupted = projected.map(row => ({ ...row }));
  corrupted[12345].gross = money(corrupted[12345].gross + 20);
  const corruptionReconciliation = reconcile(fixture.payrollRows, corrupted);

  const hostilePeople = fixture.people.map(row => ({ ...row }));
  hostilePeople.push({ ...hostilePeople[0] });
  hostilePeople[1].managerId = 'MISSING-MANAGER';
  hostilePeople[2].location = '';
  const hostilePunches = fixture.punches.concat([{ employeeId: 'E00001', location: 'SITE-001', clockIn: 'bad', clockOut: 'also-bad' }]);
  const hostile = buildConfigurationProposal({ people: hostilePeople, punches: hostilePunches, timecards: fixture.timecards });

  const assertions = {
    employeeCount: fixture.people.length === 10000,
    siteCount: sites === 50,
    punchCount: fixture.punches.length === 100000,
    timecardCount: fixture.timecards.length === 40000,
    massAssignmentCoverage: proposal.workforce.coverage === 1,
    structuralAutoApply: proposal.organisation.autoApply === true && proposal.workforce.autoApply === true,
    payrollRulesRemainProtected: proposal.safety.payrollRulesAutoApplied === false && proposal.policies.overtime.autoApply === false,
    cleanPayrollZeroVariance: cleanReconciliation.varianceCount === 0 && cleanReconciliation.unexplainedVariance === 0 && cleanReconciliation.expectedTotal === cleanReconciliation.projectedTotal,
    corruptionDetected: corruptionReconciliation.varianceCount === 1 && corruptionReconciliation.unexplainedVariance === 20,
    duplicateDetected: hostile.organisation.duplicateEmployeeIds.length > 0,
    orphanManagerDetected: hostile.organisation.orphanManagers.length > 0,
    missingStructureBlocksAutoApply: hostile.workforce.autoApply === false,
    malformedPunchRejected: hostile.shifts.rejected > 0,
    hostileStructureBlocksAutoApply: hostile.organisation.autoApply === false
  };

  const failedAssertions = Object.entries(assertions).filter(([, ok]) => !ok).map(([key]) => key);
  const status = failedAssertions.length ? 'FAIL' : 'PASS';

  return {
    schemaVersion: 1,
    proof: 'wfm-cloud-scale-implementation-and-payroll-reconciliation',
    status,
    engineIdentity: {
      gitBlobSha: engineBlobSha,
      expectedGitBlobSha: EXPECTED_ENGINE_BLOB,
      exact: engineBlobSha === EXPECTED_ENGINE_BLOB
    },
    scale: {
      employees: fixture.people.length,
      sites,
      punches: fixture.punches.length,
      timecards: fixture.timecards.length,
      cohorts: proposal.workforce.cohorts.length
    },
    configuration: {
      proposalMs: Number(proposalMs.toFixed(2)),
      massAssignmentCoverage: proposal.workforce.coverage,
      organisationAutoApply: proposal.organisation.autoApply,
      workforceAutoApply: proposal.workforce.autoApply,
      overtimeThresholdHours: proposal.policies.overtime.thresholdHours,
      overtimeConfidence: proposal.policies.overtime.confidence,
      payrollRuleAutoApplied: proposal.policies.overtime.autoApply
    },
    payroll: {
      clean: cleanReconciliation,
      deliberateCorruption: corruptionReconciliation
    },
    hostileData: {
      duplicateEmployeeIds: hostile.organisation.duplicateEmployeeIds.slice(0, 3),
      orphanManagers: hostile.organisation.orphanManagers.slice(0, 3),
      workforceExceptions: hostile.workforce.exceptions.slice(0, 3),
      rejectedPunches: hostile.shifts.rejected,
      organisationAutoApply: hostile.organisation.autoApply,
      workforceAutoApply: hostile.workforce.autoApply
    },
    assertions,
    failedAssertions,
    totalProofMs: Number((performance.now() - started).toFixed(2)),
    environment: 'REAL_CLOUD_PROOF_RUNTIME_WHEN_HOSTED',
    productionMutation: false,
    customerMutation: false,
    claimBoundary: 'Exact candidate configuration-inference engine plus an independent deterministic payroll reconciliation harness. This proves cloud execution, scale behaviour and fail-closed data handling only; it does not claim a live payroll/HCM/ERP provider connection or customer production implementation.'
  };
}

const receipt = runProof();
process.stdout.write(JSON.stringify(receipt) + '\n');
if (receipt.status !== 'PASS') process.exit(1);
if (process.env.WFM_PROOF_ONESHOT === 'true') process.exit(0);

const server = http.createServer((req, res) => {
  const path = String(req.url || '/').split('?')[0];
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (path === '/api/health') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ status: 'ok', proofStatus: receipt.status, employees: receipt.scale.employees, sites: receipt.scale.sites, engineBlobSha }));
    return;
  }
  if (path === '/api/proof') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(receipt));
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Manufacturing WFM cloud scale proof runtime\n');
});

server.listen(PORT, '::', () => {
  process.stdout.write(`WFM_CLOUD_SCALE_PROOF_LISTENING=${PORT}\n`);
});
