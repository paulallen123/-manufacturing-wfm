'use strict';

const HIGH_RISK_CONFIDENCE = 0.995;
const STRUCTURAL_CONFIDENCE = 0.98;

function compact(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function round(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(Number(value) * factor) / factor;
}

function mode(values) {
  if (!values.length) return { value: null, confidence: 0, count: 0 };
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const [value, count] = ranked[0];
  return { value, count, confidence: count / values.length };
}

function parseClockMinutes(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value || '');
  const hhmm = text.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return h * 60 + m;
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.getHours() * 60 + date.getMinutes();
  return null;
}

function bucketMinutes(minutes, size = 15) {
  if (!Number.isFinite(minutes)) return null;
  const day = 24 * 60;
  return ((Math.round(minutes / size) * size) % day + day) % day;
}

function hhmm(minutes) {
  const day = 24 * 60;
  const value = ((Number(minutes) % day) + day) % day;
  const h = Math.floor(value / 60);
  const m = value % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function inferOrganisationModel(people) {
  const sites = new Map();
  const employeeIds = new Set();
  const orphanManagers = [];
  const duplicateEmployeeIds = [];
  const missingStructure = [];
  let missingIdentityCount = 0;

  for (const person of people || []) {
    const id = compact(person.employeeId);
    if (!id) { missingIdentityCount++; continue; }
    if (employeeIds.has(id)) duplicateEmployeeIds.push(id);
    employeeIds.add(id);

    const location = compact(person.location);
    const departmentName = compact(person.department);
    if (!location || !departmentName) missingStructure.push({ employeeId: id, missing: [!location && 'location', !departmentName && 'department'].filter(Boolean) });
    const site = location || 'UNASSIGNED';
    const department = departmentName || 'UNASSIGNED';
    if (!sites.has(site)) sites.set(site, new Set());
    sites.get(site).add(department);
  }

  for (const person of people || []) {
    const id = compact(person.employeeId);
    const managerId = compact(person.managerId);
    if (id && managerId && !employeeIds.has(managerId)) {
      orphanManagers.push({ employeeId: id, managerId });
    }
  }

  const total = (people || []).filter(p => compact(p.employeeId)).length;
  const valid = total - orphanManagers.length - duplicateEmployeeIds.length - missingStructure.length;
  const sourceCount = (people || []).length;
  const confidence = sourceCount > 0 ? Math.max(0, valid / sourceCount) : 0;
  const incomplete = missingIdentityCount > 0 || missingStructure.length > 0;

  return {
    sites: [...sites.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, departments]) => ({
        name,
        departments: [...departments].sort()
      })),
    peopleCount: total,
    sourceCount,
    missingIdentityCount,
    missingStructure,
    orphanManagers,
    duplicateEmployeeIds: [...new Set(duplicateEmployeeIds)].sort(),
    confidence: round(confidence),
    status: !incomplete && orphanManagers.length === 0 && duplicateEmployeeIds.length === 0 && confidence >= STRUCTURAL_CONFIDENCE ? 'PROPOSED' : 'EXCEPTION',
    autoApply: !incomplete && confidence >= STRUCTURAL_CONFIDENCE && orphanManagers.length === 0 && duplicateEmployeeIds.length === 0
  };
}

function roleFromPerson(person) {
  const explicit = compact(person.wfmRole).toLowerCase();
  if (['employee', 'manager', 'payroll', 'admin'].includes(explicit)) return explicit;

  const title = compact(person.jobTitle).toLowerCase();
  if (/payroll/.test(title)) return 'payroll';
  if (/administrator|system admin|wfm admin/.test(title)) return 'admin';
  if (/manager|supervisor|team leader|shift leader|foreman/.test(title)) return 'manager';
  return 'employee';
}

function cohortKey(person) {
  return [
    compact(person.location || 'UNASSIGNED'),
    compact(person.department || 'UNASSIGNED'),
    compact(person.jobTitle || 'UNASSIGNED'),
    compact(person.employmentType || 'UNASSIGNED'),
    roleFromPerson(person)
  ].join('|');
}

function buildMassEmployeeAssignments(people) {
  const assignments = [];
  const cohorts = new Map();
  const exceptions = [];

  for (const person of people || []) {
    const employeeId = compact(person.employeeId);
    if (!employeeId) {
      exceptions.push({ reason: 'MISSING_EMPLOYEE_ID', source: compact(person.email || person.firstName || 'unknown') });
      continue;
    }
    const location = compact(person.location);
    const department = compact(person.department);
    if (!location || !department) {
      exceptions.push({ employeeId, reason: 'MISSING_STRUCTURE', missing: [!location && 'location', !department && 'department'].filter(Boolean) });
      continue;
    }

    const role = roleFromPerson(person);
    const key = cohortKey(person);
    if (!cohorts.has(key)) {
      cohorts.set(key, {
        key,
        location,
        department,
        jobTitle: compact(person.jobTitle || 'UNASSIGNED'),
        employmentType: compact(person.employmentType || 'UNASSIGNED'),
        role,
        employeeIds: []
      });
    }
    cohorts.get(key).employeeIds.push(employeeId);
    assignments.push({
      employeeId,
      location,
      department,
      managerId: compact(person.managerId) || null,
      role,
      cohortKey: key
    });
  }

  const denominator = Math.max(1, (people || []).length);
  const coverage = assignments.length / denominator;
  return {
    assignments,
    cohorts: [...cohorts.values()].map(item => ({ ...item, employeeCount: item.employeeIds.length })),
    exceptions,
    coverage: round(coverage),
    autoApply: coverage >= 0.995 && exceptions.length === 0
  };
}

function inferShiftTemplates(punches, options = {}) {
  const bucketSize = Number(options.bucketMinutes || 15);
  const minSamples = Number(options.minSamples || 5);
  const groups = new Map();
  const totals = new Map();
  let rejected = 0;

  for (const record of punches || []) {
    const site = compact(record.location || 'UNASSIGNED');
    const start = bucketMinutes(parseClockMinutes(record.clockIn), bucketSize);
    const end = bucketMinutes(parseClockMinutes(record.clockOut), bucketSize);
    if (start === null || end === null) {
      rejected += 1;
      continue;
    }
    totals.set(site, (totals.get(site) || 0) + 1);
    const key = [site, start, end].join('|');
    groups.set(key, (groups.get(key) || 0) + 1);
  }

  const templates = [];
  for (const [key, count] of groups.entries()) {
    if (count < minSamples) continue;
    const [site, startText, endText] = key.split('|');
    const total = totals.get(site) || count;
    const confidence = count / total;
    templates.push({
      location: site,
      start: hhmm(Number(startText)),
      end: hhmm(Number(endText)),
      sampleCount: count,
      siteCoverage: round(confidence),
      confidence: round(Math.min(1, 0.75 + Math.log10(count + 1) / 4)),
      autoApply: count >= minSamples && confidence >= 0.1
    });
  }

  templates.sort((a, b) => a.location.localeCompare(b.location) || a.start.localeCompare(b.start));
  const represented = templates.reduce((sum, item) => sum + item.sampleCount, 0);
  const valid = [...totals.values()].reduce((a, b) => a + b, 0);
  return {
    templates,
    rejected,
    sampleCount: valid,
    representedCoverage: valid ? round(represented / valid) : 0,
    status: templates.length ? 'PROPOSED' : 'EXCEPTION'
  };
}

function inferBreakPolicy(timecards) {
  const byBand = new Map();
  for (const item of timecards || []) {
    const worked = Number(item.workedHours);
    const breakMinutes = Number(item.breakMinutes);
    if (!Number.isFinite(worked) || !Number.isFinite(breakMinutes) || worked <= 0 || breakMinutes < 0) continue;
    const band = worked < 6 ? 'UNDER_6H' : worked < 9 ? '6_TO_9H' : '9H_PLUS';
    if (!byBand.has(band)) byBand.set(band, []);
    byBand.get(band).push(Math.round(breakMinutes));
  }

  const rules = [];
  for (const [band, values] of byBand.entries()) {
    const inferred = mode(values);
    rules.push({
      band,
      breakMinutes: inferred.value,
      sampleCount: values.length,
      confidence: round(inferred.confidence),
      requiresDecision: inferred.confidence < 0.98,
      autoApply: inferred.confidence >= 0.995 && values.length >= 20
    });
  }
  return { rules: rules.sort((a, b) => a.band.localeCompare(b.band)) };
}

function inferOvertimePolicy(timecards) {
  const candidates = [];
  for (const item of timecards || []) {
    const worked = Number(item.workedHours);
    const regular = Number(item.regularHours);
    const overtime = Number(item.overtimeHours);
    if (![worked, regular, overtime].every(Number.isFinite)) continue;
    if (overtime <= 0 || worked <= regular) continue;
    candidates.push(Math.round(regular * 4) / 4);
  }

  const inferred = mode(candidates);
  if (!candidates.length) {
    return {
      status: 'UNRESOLVED',
      thresholdHours: null,
      confidence: 0,
      risk: 'HIGH',
      autoApply: false,
      requiresHistoricalReplay: true,
      requiresDecision: true
    };
  }

  return {
    status: inferred.confidence >= 0.9 ? 'PROPOSED' : 'EXCEPTION',
    thresholdHours: inferred.value,
    supportingRecords: inferred.count,
    sampleCount: candidates.length,
    confidence: round(inferred.confidence),
    risk: 'HIGH',
    autoApply: false,
    requiresHistoricalReplay: true,
    requiresDecision: inferred.confidence < HIGH_RISK_CONFIDENCE
  };
}

function buildConfigurationProposal(input = {}) {
  const people = Array.isArray(input.people) ? input.people : [];
  const punches = Array.isArray(input.punches) ? input.punches : [];
  const timecards = Array.isArray(input.timecards) ? input.timecards : [];

  const organisation = inferOrganisationModel(people);
  const workforce = buildMassEmployeeAssignments(people);
  const shifts = inferShiftTemplates(punches);
  const breaks = inferBreakPolicy(timecards);
  const overtime = inferOvertimePolicy(timecards);

  const decisions = [];
  if (!organisation.autoApply) decisions.push({ key: 'organisation-structure', risk: 'MEDIUM', reason: 'STRUCTURE_EXCEPTIONS', detail: organisation });
  if (!workforce.autoApply) decisions.push({ key: 'employee-assignment', risk: 'MEDIUM', reason: 'EMPLOYEE_EXCEPTIONS', detail: { exceptions: workforce.exceptions } });
  for (const rule of breaks.rules) {
    if (rule.requiresDecision) decisions.push({ key: 'break-' + rule.band.toLowerCase(), risk: 'HIGH', reason: 'AMBIGUOUS_BREAK_PATTERN', detail: rule });
  }
  decisions.push({
    key: 'overtime-threshold',
    risk: 'HIGH',
    reason: overtime.requiresDecision ? 'PAYROLL_RULE_CONFIRMATION_REQUIRED' : 'HISTORICAL_REPLAY_REQUIRED',
    detail: overtime
  });

  return {
    organisation,
    workforce,
    shifts,
    policies: { breaks, overtime },
    decisions,
    metrics: {
      people: people.length,
      massAssignmentCoverage: workforce.coverage,
      cohortCount: workforce.cohorts.length,
      shiftTemplateCoverage: shifts.representedCoverage,
      unresolvedDecisions: decisions.length
    },
    safety: {
      payrollRulesAutoApplied: false,
      highRiskInferenceConfidenceFloor: HIGH_RISK_CONFIDENCE
    }
  };
}

module.exports = {
  HIGH_RISK_CONFIDENCE,
  STRUCTURAL_CONFIDENCE,
  inferOrganisationModel,
  buildMassEmployeeAssignments,
  inferShiftTemplates,
  inferBreakPolicy,
  inferOvertimePolicy,
  buildConfigurationProposal,
  roleFromPerson,
  parseClockMinutes,
  bucketMinutes
};

