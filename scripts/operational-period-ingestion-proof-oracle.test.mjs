import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateOperationalPeriodIngestionProof as validate, OPERATIONAL_PERIOD_PROOF_SCHEMA, INSPECTED_SOURCE_SHA, PROOF_LIMITS, SNAPSHOT_SCHEMA, SEALED_ARTIFACT_SHA256 } from './operational-period-ingestion-proof-oracle.mjs';

// Synthetic data only. This constructs the proposed adapter envelope and minimal
// inspected consumer fields; it does not impersonate owner receipts or run payroll.
const clone = x => structuredClone(x);
const canonical = x => Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : x && typeof x === 'object' ? '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}' : JSON.stringify(x);
const hash = x => createHash('sha256').update(canonical(x)).digest('hex');
const at = n => `2026-10-06T10:00:${String(n).padStart(2, '0')}.000Z`;
const periodView = p => ({ id: p.id, start: p.start, end: p.end });
const fp = r => canonical({ id: r.id, employee: r.employee, team: r.team, date: r.date, sourceVersion: r.sourceVersion, raw: r.raw, correction: r.correction || null, scheduledStart: r.scheduledStart || null, scheduledEnd: r.scheduledEnd || null, plannedMinutes: r.plannedMinutes, scheduledBreaks: r.scheduledBreaks || null });
function fixture() {
  const binding = { tenantId: 'tenant-synthetic-1', sourceSha: INSPECTED_SOURCE_SHA, deploymentId: 'deployment-synthetic-1', configurationDigest: 'a'.repeat(64) };
  const roster = [{ id: 'employee-1', manager: 'manager-1', name: 'Zed Synthetic', site: 'site-1' }, { id: 'employee-2', manager: 'manager-2', name: 'Ada Synthetic', site: 'site-1' }];
  const org = [{ id: 'manager-1', label: 'Team 1', name: 'Manager One' }, { id: 'manager-2', label: 'Team 2', name: 'Manager Two' }];
  const period = { id: '2026-10-05', start: '2026-10-05', end: '2026-10-11', deadline: '2026-10-12T11:00:00.000Z', source: 'synthetic-attendance-source-1' };
  const records = roster.flatMap(person => Array.from({ length: 7 }, (_, i) => ({ id: 'record-' + person.id + '-' + i, employee: person.id, team: person.manager, date: '2026-10-' + String(5 + i).padStart(2, '0'), scheduledStart: null, scheduledEnd: null, plannedMinutes: 0, raw: { kind: 'off_rota', clockIn: null, clockOut: null, breaks: [], breaksConfirmed: true, pendingSync: false, absenceMinutes: 0, source: 'synthetic-source' }, correction: null, sourceVersion: 1 })));
  const input = { start: period.start, employeeIds: roster.map(r => r.id), records, sourceReference: period.source, completeTeams: org.map(o => o.id) };
  const teams = org.map(o => ({ id: o.id, name: o.label, owner: o.id, ownerName: o.name, site: 'site-1', employees: roster.filter(r => r.manager === o.id).map(r => r.id), feedComplete: true }));
  const p = { ...period, expectedRoster: input.employeeIds, teams, records, reviews: Object.fromEntries(teams.map(t => [t.id, { revision: 1, status: 'draft', acknowledgements: {}, employeeChecks: {}, signature: null }])), issues: [], batches: [], reminders: [], personalSessionLinks: [] };
  const historical = { id: '2026-09-28', start: '2026-09-28', end: '2026-10-04', source: 'synthetic-prior', records: [{ id: 'prior-row', raw: { source: 'untouched' } }], batches: [{ id: 'prior-batch' }] };
  const pre = { version: 1, jurisdiction: 'GB-ENG', rulesVerifiedAt: at(0), staff: roster, org,
    requests: [], audit: [], shifts: {}, availability: [], offers: [], assignments: [], gaps: [], profiles: {}, history: [],
    costing: { schema: 3, rates: {}, employeePolicies: {}, policies: {}, ledger: [], weekEvidence: {}, imports: [], budgets: {}, calendar: { source: 'synthetic-calendar', reviewedAt: at(0), years: [2026], scheduledRefresh: false }, demandHistory: [], historySource: 'synthetic-history' },
    workRules: { revision: 1, checkedAt: at(0), contracts: {}, templates: [], patterns: [], premiums: [], leaveRules: [], jobs: [], roster: [], absences: [], annualOpening: {}, leaveBalances: {}, audit: [] },
    readiness: { schemaVersion: 1, requirements: [], runs: [], receipts: [] },
    demandPlanning: { schema: 6, revision: 1, source: 'synthetic-demand', products: [], records: [], performance: [], batches: [], audit: [], actions: [], receipts: [], costBenchmarks: {}, shareAggregates: false, minCohort: 5, benchmark: 'synthetic-benchmark', market: [] },
    operations: { schema: 1, revision: 1, preferences: {}, leaveOpenings: {}, breakRules: [], siteAccess: {}, swaps: [], notices: [], receipts: [], travelMinutes: {}, audit: [] },
    schedulePublication: { schemaVersion: 1, drafts: [], publications: [], notifications: [], receipts: [], audit: [], acknowledgements: [] },
    orgAdmin: { schema: 1, revision: 1, baseOrg: clone(org), changes: [], receipts: [] },
    onboarding: { schemaVersion: 1, batches: [], people: [], receipts: [], audit: [] },
    attendanceCorrections: { requests: [], notifications: [], receipts: [] }, payrollControl: { version: 1, periods: [historical], audit: [], adjustments: [], adjustmentBatches: [] }, timeReview: { schema: 1, revision: 1, thresholds: { earlyIn: 5, lateIn: 5, earlyOut: 5, lateOut: 5 }, active: {}, decisions: [], receipts: [], audit: [] } };
  const audit = { id: 'pa-0', at: at(2), actor: 'ingestor-1', email: null, type: 'weekly-source-ingested', period: period.id, source: period.source, employees: 2 };
  const post = clone(pre);
  post.payrollControl.periods.push(clone(p)); post.payrollControl.audit.push(audit);
  for (const t of teams) post.timeReview.active[period.id + '|' + t.id] = { by: 'ingestor-1', at: at(2), thresholds: clone(pre.timeReview.thresholds) };
  const snap = (state, n, processId = 'process-1', sessionId = 'session-1', collectorId = 'collector-1') => ({ schemaVersion: SNAPSHOT_SCHEMA, binding: clone(binding), evidenceRef: 'synthetic-state-' + n, collectorId, at: at(n), processId, sessionId, state: clone(state), stateDigest: hash(state) });
  const packet = {
    schemaVersion: OPERATIONAL_PERIOD_PROOF_SCHEMA,
    expected: { binding, snapshotManifest: { schemaVersion: SNAPSHOT_SCHEMA, sourceSha: INSPECTED_SOURCE_SHA, artifactSha256: SEALED_ARTIFACT_SHA256, preStateDigest: hash(pre) }, now: at(59), calendar: { timeZone: 'Europe/London', site: 'site-1', maxAgeMs: 900000 }, period, roster, inputDigest: hash(input) },
    ownerEvidence: { evidenceRef: 'synthetic-owner', owner: 'Continue customer proof', collectorId: 'collector-1', independentCollectorId: 'collector-2', actorId: 'ingestor-1', tenantResolutionRef: 'synthetic-session-context', tenantBinding: 'authenticated-server-context', permissions: ['time.ingest'], binding: clone(binding) },
    ingestion: { evidenceRef: 'synthetic-ingestion', binding: clone(binding), collectorId: 'collector-1', actorId: 'ingestor-1', seam: 'WFMPayroll.openPeriodFromSource', input, inputDigest: hash(input), startedAt: at(1), completedAt: at(3), result: { id: period.id }, audit: clone(audit) },
    states: { pre: snap(pre, 0), post: snap(post, 4), restart: snap(post, 8, 'process-2'), freshSession: snap(post, 12, 'process-2', 'session-2') },
    lifecycle: { restart: { binding: clone(binding), evidenceRef: 'synthetic-restart', collectorId: 'collector-2', at: at(7), from: 'process-1', to: 'process-2' }, freshSession: { binding: clone(binding), evidenceRef: 'synthetic-login', collectorId: 'collector-2', at: at(11), from: 'session-1', to: 'session-2' } }, readbacks: {}, replays: []
  };
  for (const [phase, n] of [['post', 5], ['restart', 9], ['freshSession', 13]]) {
    const state = packet.states[phase], base = { binding: clone(binding), evidenceRef: 'synthetic-read-' + phase, collectorId: 'collector-2', at: at(n), processId: state.processId, sessionId: state.sessionId, stateDigest: state.stateDigest }, periods = post.payrollControl.periods.map(periodView);
    const teamViews = teams.map(t => ({ ...clone(t), period: p.id, start: p.start, end: p.end, deadline: p.deadline, revision: 1, status: 'draft', signature: null, employees: t.employees.map(id => ({ id })), records: records.filter(r => r.team === t.id).map(r => ({ id: r.id, employee: r.employee, date: r.date, scheduledStart: r.scheduledStart, scheduledEnd: r.scheduledEnd, plannedMinutes: r.plannedMinutes, raw: clone(r.raw), effective: clone(r.raw), correction: null, timeReviewTreatment: null })) }));
    const summary = { period: p.id, start: p.start, end: p.end, deadline: p.deadline, periods, teams: teamViews, audit: [clone(audit)] };
    const rows = [...records].sort((a, b) => roster.find(r => r.id === a.employee).name.localeCompare(roster.find(r => r.id === b.employee).name) || a.date.localeCompare(b.date)).map(r => ({ id: r.id, employee: r.employee, team: r.team, date: r.date, fingerprint: fp(r), clockIn: null, clockOut: null, breaks: [], kind: r.raw.kind, scheduledStart: null, scheduledEnd: null, plannedMinutes: 0, original: { clockIn: null, clockOut: null, breaks: [] }, treatment: null, decision: null }));
    const pages = [0, 10].map(offset => ({ version: 1, period: p.id, start: p.start, end: p.end, source: p.source, periods, teams: teams.map(t => ({ id: t.id, active: true, status: 'draft' })), rows: rows.slice(offset, offset + 10), page: { offset, limit: 10, total: 14, all: 14, hasMore: offset + 10 < 14 }, thresholds: clone(pre.timeReview.thresholds), configRevision: 1 }));
    packet.readbacks[phase] = {
      currentReviewPeriod: { ...clone(base), query: {}, body: { schemaVersion: 'tenant-calendar-1', source: 'server-authoritative-tenant-calendar', tenant: binding.tenantId, site: 'site-1', timeZone: 'Europe/London', maxAgeMs: 900000, asOf: at(n), localDate: '2026-10-06', localTime: '11:00:00', period: clone(period), historicalPeriods: [{ ...periodView(historical), source: historical.source }] } },
      timeReview: { ...clone(base), query: { period: p.id }, pages },
      weeklyReview: { ...clone(base), query: { period: p.id }, body: clone(summary) },
      payroll: { ...clone(base), query: { period: p.id }, body: { ...clone(summary), schema: 'reviewed-pay-v3-reconciled', totals: { employees: 2 }, canRelease: false, batches: [], lines: [] } }
    };
  }
  for (const [i, kind] of ['identical', 'conflicting', 'invalid'].entries()) {
    const request = clone(input);
    if (kind === 'conflicting') request.sourceReference = 'synthetic-conflicting-source';
    if (kind === 'invalid') request.start = '2026-02-30';
    const n = 20 + i * 4;
    packet.replays.push({ id: 'replay-' + i, kind, evidenceRef: 'synthetic-replay-' + i, binding: clone(binding), collectorId: 'collector-2', input: request, inputDigest: hash(request), before: snap(post, n, 'process-2', 'session-2', 'collector-2'), startedAt: at(n + 1), completedAt: at(n + 2), after: snap(post, n + 3, 'process-2', 'session-2', 'collector-2'), outcome: 'rejected', statusCode: kind === 'invalid' ? 400 : 409, effects: { evidenceRef: 'synthetic-write-journal', beforeCursor: 'cursor-1', afterCursor: 'cursor-1', writeCount: 0, writes: [] } });
  }
  return packet;
}
const reject = (packet, pattern) => { const result = validate(packet); assert.equal(result.status, 'not-proven', JSON.stringify(result)); if (pattern) assert.ok(result.issues.some(i => pattern.test(i.code)), JSON.stringify(result)); return result; };
const mutate = fn => { const p = fixture(); fn(p); return p; };
const rehash = p => { for (const s of Object.values(p.states)) s.stateDigest = hash(s.state); };
function uniformlyChangeSnapshots(packet, change) {
  for (const snap of Object.values(packet.states)) { change(snap.state); snap.stateDigest = hash(snap.state); }
  for (const replay of packet.replays) for (const snap of [replay.before, replay.after]) { change(snap.state); snap.stateDigest = hash(snap.state); }
  for (const [phase, reads] of Object.entries(packet.readbacks)) for (const read of Object.values(reads)) read.stateDigest = packet.states[phase].stateDigest;
}
function rebindDeadline(packet, deadline) {
  packet.expected.period.deadline = deadline;
  uniformlyChangeSnapshots(packet, state => {
    const period = state.payrollControl.periods.find(p => p.id === packet.expected.period.id);
    if (period) period.deadline = deadline;
  });
  for (const reads of Object.values(packet.readbacks)) {
    reads.currentReviewPeriod.body.period.deadline = deadline;
    for (const name of ['weeklyReview', 'payroll']) {
      reads[name].body.deadline = deadline;
      for (const team of reads[name].body.teams) team.deadline = deadline;
    }
  }
}
test('uniformly rebound impossible deadline is not a supported runtime output', () => {
  const p = fixture(); rebindDeadline(p, '2026-11-01T12:00:00.000Z');
  reject(p, /deadline/);
});
test('uniform removal of unrelated sections cannot establish complete snapshot proof', () => {
  const p = fixture();
  uniformlyChangeSnapshots(p, state => { delete state.company; delete state.attendanceCorrections; });
  reject(p, /snapshot/);
});
test('uniform missing versions and readback revisions cannot pass undefined equality', () => {
  const p = fixture();
  uniformlyChangeSnapshots(p, state => { delete state.version; delete state.timeReview.revision; });
  for (const reads of Object.values(p.readbacks)) for (const page of reads.timeReview.pages) { delete page.version; delete page.configRevision; }
  reject(p, /snapshot/);
});
for (const key of ['version', 'jurisdiction', 'rulesVerifiedAt', 'staff', 'org', 'requests', 'audit', 'shifts', 'availability', 'offers', 'assignments', 'gaps', 'profiles', 'history', 'costing', 'workRules', 'readiness', 'demandPlanning', 'operations', 'schedulePublication', 'orgAdmin', 'onboarding', 'payrollControl', 'timeReview', 'attendanceCorrections']) test('source profile requires uniformly missing root ' + key, () => {
  const p = fixture(); uniformlyChangeSnapshots(p, state => { delete state[key]; }); reject(p, /snapshot/);
});
test('all declared containers require every source-defined field, even when removed uniformly', () => {
  for (const container of ['costing', 'workRules', 'readiness', 'demandPlanning', 'operations', 'schedulePublication', 'orgAdmin', 'onboarding', 'payrollControl', 'timeReview', 'attendanceCorrections']) {
    for (const key of Object.keys(fixture().states.pre.state[container])) {
      const p = fixture(); uniformlyChangeSnapshots(p, state => { delete state[container][key]; }); reject(p, /snapshot/);
    }
  }
});
test('versions and revisions require positive safe integer types, not equal missing or coerced values', () => {
  for (const value of [null, '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const p = fixture(); uniformlyChangeSnapshots(p, state => { state.version = value; state.timeReview.revision = value; });
    for (const reads of Object.values(p.readbacks)) for (const page of reads.timeReview.pages) { page.version = value; page.configRevision = value; }
    reject(p, /snapshot/);
  }
});
test('manifest and snapshot schema bindings fail closed for omissions and unknown profiles', () => {
  for (const key of Object.keys(fixture().expected.snapshotManifest)) reject(mutate(p => delete p.expected.snapshotManifest[key]), /snapshot/);
  reject(mutate(p => p.expected.snapshotManifest.schemaVersion = 'unknown'), /snapshot/);
  reject(mutate(p => p.states.post.schemaVersion = 'unknown'), /snapshot/);
  reject(mutate(p => p.replays[0].before.schemaVersion = 'unknown'), /snapshot/);
  reject(mutate(p => p.expected.snapshotManifest.artifactSha256 = 'b'.repeat(64)), /snapshot/);
  reject(mutate(p => p.expected.snapshotManifest.preStateDigest = 'b'.repeat(64)), /pre-snapshot-digest/);
});
test('unknown source containers are unsupported, not silently treated as a complete schema', () => {
  const p = fixture(); uniformlyChangeSnapshots(p, state => { state.company = { id: 'synthetic-unsupported-extension' }; });
  reject(p, /unsupported-snapshot-shape/);
});
test('trusted pre-state digest detects uniform removal from a dynamic source map', () => {
  const p = fixture();
  uniformlyChangeSnapshots(p, state => { state.operations.preferences.retained = { widgets: ['attendance'] }; });
  p.expected.snapshotManifest.preStateDigest = hash(p.states.pre.state);
  assert.equal(validate(p).status, 'consistent');
  uniformlyChangeSnapshots(p, state => { delete state.operations.preferences.retained; });
  reject(p, /pre-snapshot-digest/);
});
test('explicit Time Review body version and revision are required', () => {
  for (const field of ['version', 'configRevision']) for (const value of [null, '1', 0, 1.5]) reject(mutate(p => p.readbacks.post.timeReview.pages[0][field] = value), /time-review-source/);
});
function shiftFixtureWeek(start, deadline) {
  const days = (Date.parse(start + 'T00:00:00Z') - Date.parse('2026-10-05T00:00:00Z')) / 86400000;
  const shift = s => s.replace(/2026-\d{2}-\d{2}/g, date => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10));
  const walk = x => typeof x === 'string' ? shift(x) : Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [shift(k), walk(v)])) : x;
  const p = walk(fixture());
  rebindDeadline(p, deadline);
  p.expected.snapshotManifest.preStateDigest = hash(p.states.pre.state);
  p.expected.inputDigest = p.ingestion.inputDigest = hash(p.ingestion.input);
  for (const attempt of p.replays) attempt.inputDigest = hash(attempt.input);
  return p;
}
for (const [start, deadline, wrongOffset] of [
  ['2026-03-23', '2026-03-30T11:00:00.000Z', '2026-03-30T12:00:00.000Z'],
  ['2026-10-19', '2026-10-26T12:00:00.000Z', '2026-10-26T11:00:00.000Z'],
  ['2026-10-26', '2026-11-02T12:00:00.000Z', '2026-11-02T11:00:00.000Z']
]) test('sealed London deadline respects DST for week ' + start, () => {
  const p = shiftFixtureWeek(start, deadline);
  assert.equal(validate(p).status, 'consistent', JSON.stringify(validate(p)));
  rebindDeadline(p, wrongOffset); reject(p, /deadline/);
});
for (const deadline of ['2026-10-12T12:00:00+01:00', '2026-10-12T11:00:00Z', '2026-10-12T11:00:00.001Z', '2026-10-12T11:00:01.000Z', '2026-10-12T11:01:00.000Z', '2026-10-19T11:00:00.000Z']) test('rejects non-exact sealed deadline ' + deadline, () => {
  const p = fixture(); rebindDeadline(p, deadline); reject(p, /deadline/);
});

test('complete synthetic evidence is consistent, never readiness or authenticated proof', () => {
  assert.deepEqual(validate(fixture()), { schemaVersion: OPERATIONAL_PERIOD_PROOF_SCHEMA, status: 'consistent', readiness: 'not-proven', provenance: 'requires-trusted-caller-verification', issues: [] });
});
test('pure and deterministic with deeply frozen input and object-key order variation', () => {
  const p = fixture(), before = canonical(p);
  function freeze(x) { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; }
  freeze(p); assert.deepEqual(validate(p), validate(p)); assert.equal(canonical(p), before);
  const reverse = x => Array.isArray(x) ? x.map(reverse) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).reverse().map(([k, v]) => [k, reverse(v)])) : x;
  assert.deepEqual(validate(reverse(p)), validate(p));
});
function rebindCheckpointSession(packet, phase, sessionId) {
  packet.states[phase].sessionId = sessionId;
  for (const read of Object.values(packet.readbacks[phase])) read.sessionId = sessionId;
  if (phase === 'restart') packet.lifecycle.freshSession.from = sessionId;
  if (phase === 'freshSession') {
    packet.lifecycle.freshSession.to = sessionId;
    for (const attempt of packet.replays) {
      attempt.before.sessionId = sessionId;
      attempt.after.sessionId = sessionId;
    }
  }
}
test('fresh login rejects original session reused after an intermediate restart session', () => {
  const p = fixture();
  rebindCheckpointSession(p, 'restart', 'session-temporary');
  rebindCheckpointSession(p, 'freshSession', p.states.post.sessionId);
  reject(p, /stale-lifecycle-session-reuse/);
});
test('fresh login permits a genuinely new session after an intermediate restart session', () => {
  const p = fixture();
  rebindCheckpointSession(p, 'restart', 'session-temporary');
  rebindCheckpointSession(p, 'freshSession', 'session-new');
  assert.equal(validate(p).status, 'consistent');
});
test('fresh session is compared with every prior checkpoint, not only its predecessor', () => {
  for (const phase of ['pre', 'post', 'restart']) {
    const p = fixture();
    rebindCheckpointSession(p, 'restart', 'session-temporary');
    rebindCheckpointSession(p, 'freshSession', p.states[phase].sessionId);
    reject(p, /stale-lifecycle-session-reuse/);
  }
});
for (const field of ['expected', 'ownerEvidence', 'ingestion', 'states', 'lifecycle', 'readbacks', 'replays']) test('missing ' + field + ' is not proven', () => reject(mutate(p => delete p[field]), /evidence-gap/));
for (const phase of ['pre', 'post', 'restart', 'freshSession']) test('missing state ' + phase, () => reject(mutate(p => delete p.states[phase]), /evidence-gap/));
for (const phase of ['post', 'restart', 'freshSession']) for (const consumer of ['currentReviewPeriod', 'timeReview', 'weeklyReview', 'payroll']) test('missing ' + phase + '/' + consumer, () => reject(mutate(p => delete p.readbacks[phase][consumer]), /evidence-gap:consumer/));
for (const key of ['tenantId', 'sourceSha', 'deploymentId', 'configurationDigest']) test('rejects mismatched ' + key + ' in every observed context', () => {
  for (const target of [p => p.ingestion, p => p.ownerEvidence, p => p.states.restart, p => p.readbacks.freshSession.payroll, p => p.replays[0]]) reject(mutate(p => target(p).binding[key] = 'wrong'), /identity-mismatch/);
});
for (const [label, fn, pattern] of [
  ['unknown schema', p => p.schemaVersion = 'v99', /unsupported-schema/],
  ['caller PASS alone', p => { delete p.ownerEvidence; p.status = 'PASS'; p.verified = true; p.signed = true; }, /owner-authority/],
  ['client tenant owner', p => p.ownerEvidence.tenantBinding = 'x-wfm-tenant', /owner-authority/],
  ['client tenant input', p => p.ingestion.input.tenantId = p.expected.binding.tenantId, /client-tenant/],
  ['no permission', p => p.ownerEvidence.permissions = [], /owner-authority/],
  ['same collector', p => p.ownerEvidence.independentCollectorId = p.ownerEvidence.collectorId, /owner-authority/],
  ['invented ingress route', p => p.ingestion.seam = '/api/operations/period-rollover', /provenance/],
  ['impossible start', p => p.expected.period.start = '2026-02-30', /week-contract/],
  ['inverted period', p => p.expected.period.end = '2026-10-01', /week-contract/],
  ['non Monday', p => p.ingestion.input.start = '2026-10-06', /monday/],
  ['impossible row date', p => p.ingestion.input.records[0].date = '2026-02-30', /record-date/],
  ['row outside week', p => p.ingestion.input.records[0].date = '2026-10-12', /record-date/],
  ['inverted clock', p => Object.assign(p.ingestion.input.records[0].raw, { clockIn: at(4), clockOut: at(2) }), /interval/],
  ['source mismatch', p => p.ingestion.input.sourceReference = 'wrong-source', /source-period-mismatch/],
  ['roster mismatch', p => p.ingestion.input.employeeIds.reverse(), /roster/],
  ['wrong team', p => p.ingestion.input.records[0].team = 'manager-2', /record-roster/],
  ['duplicate record ID', p => p.ingestion.input.records[1].id = p.ingestion.input.records[0].id, /duplicate-record/],
  ['duplicate daily outcome', p => p.ingestion.input.records[1].date = p.ingestion.input.records[0].date, /duplicate-record/],
  ['missing daily outcome', p => p.ingestion.input.records.pop(), /missing-daily-outcome/],
  ['import correction', p => p.ingestion.input.records[0].correction = {}, /imported-approval/],
  ['import treatment', p => p.ingestion.input.records[0].timeReviewTreatment = {}, /imported-approval/],
  ['incomplete team feed', p => p.ingestion.input.completeTeams.pop(), /complete-teams/],
  ['input digest', p => p.expected.inputDigest = 'b'.repeat(64), /digest-mismatch/],
  ['state digest', p => p.states.restart.stateDigest = 'b'.repeat(64), /state-digest-mismatch/],
  ['state side table only', p => { p.states.post.state.vector_operational_periods = p.states.post.state.payrollControl.periods; delete p.states.post.state.payrollControl.periods; }, /snapshot-shape/],
  ['missing real period', p => p.states.post.state.payrollControl.periods.pop(), /canonical-period/],
  ['duplicate period ID', p => p.states.post.state.payrollControl.periods.push(clone(p.states.post.state.payrollControl.periods[1])), /duplicate-or-invalid-id/],
  ['overlapping period', p => p.states.post.state.payrollControl.periods.push({ id: 'overlap', start: '2026-10-06', end: '2026-10-07' }), /overlapping-periods/],
  ['changed unrelated period', p => { p.states.post.state.payrollControl.periods[0].records[0].raw.source = 'changed'; rehash(p); }, /unrelated-period-change/],
  ['changed unrelated operations', p => { p.states.post.state.operations.preferences.synthetic = {}; rehash(p); }, /unrelated-state-change/],
  ['changed correction state', p => { p.states.post.state.attendanceCorrections.requests.push({ id: 'unexpected' }); rehash(p); }, /unrelated-state-change/],
  ['changed time decisions', p => { p.states.post.state.timeReview.decisions.push({ id: 'unexpected' }); rehash(p); }, /unrelated-state-change/],
  ['changed unrelated activation', p => p.states.post.state.timeReview.active.other = {}, /unrelated-activation-change/],
  ['import signature', p => p.states.post.state.payrollControl.periods[1].reviews['manager-1'].signature = { by: 'manager-1' }, /imported-review/],
  ['wrong audit source', p => p.states.post.state.payrollControl.audit[0].source = 'wrong', /audit-mismatch/],
  ['extra audit', p => p.states.post.state.payrollControl.audit.push({ id: 'pa-1' }), /audit-count/],
  ['restart lost state', p => p.states.restart.state.payrollControl.periods.pop(), /restart-or-session-state/],
  ['fresh login lost state', p => p.states.freshSession.state.timeReview.active = {}, /restart-or-session-state/],
  ['restart same process', p => p.states.restart.processId = 'process-1', /stale-lifecycle/],
  ['login same session', p => p.states.freshSession.sessionId = 'session-1', /stale-lifecycle/],
  ['old session consumer', p => p.readbacks.freshSession.payroll.sessionId = 'session-1', /consumer-context/],
  ['old process consumer', p => p.readbacks.restart.payroll.processId = 'process-1', /consumer-context/],
  ['read before state', p => p.readbacks.restart.payroll.at = at(1), /temporal-order/],
  ['stale evidence', p => p.expected.now = '2026-10-07T10:00:00.000Z', /stale-or-invalid-time/],
  ['future evidence', p => p.states.pre.at = '2026-10-06T11:00:00.000Z', /stale-or-invalid-time/],
  ['calendar wrong age contract', p => p.readbacks.post.currentReviewPeriod.body.maxAgeMs = 1, /calendar-binding/],
  ['calendar wrong timezone', p => p.readbacks.post.currentReviewPeriod.body.timeZone = 'UTC', /calendar-binding/],
  ['calendar wrong date', p => p.readbacks.post.currentReviewPeriod.body.localDate = '2026-10-07', /calendar-date/],
  ['calendar historical fallback', p => p.readbacks.post.currentReviewPeriod.body.period = p.states.pre.state.payrollControl.periods[0], /not-current/],
  ['filtered time read', p => p.readbacks.post.timeReview.query.filter = 'action', /filtered/],
  ['time missing page', p => p.readbacks.post.timeReview.pages.pop(), /row-order-or-count/],
  ['time duplicate page', p => p.readbacks.post.timeReview.pages.push(clone(p.readbacks.post.timeReview.pages[0])), /pagination/],
  ['time reordered rows', p => p.readbacks.post.timeReview.pages[0].rows.reverse(), /row-order-or-count/],
  ['time offset mismatch', p => p.readbacks.post.timeReview.pages[1].page.offset = 0, /pagination/],
  ['time inflated count', p => p.readbacks.post.timeReview.pages[0].page.all = 15, /pagination/],
  ['time fingerprint', p => p.readbacks.post.timeReview.pages[0].rows[0].fingerprint = 'PASS', /record-mismatch/],
  ['time original changed', p => p.readbacks.post.timeReview.pages[0].rows[0].original.clockIn = at(1), /record-mismatch/],
  ['time display changed', p => p.readbacks.post.timeReview.pages[0].rows[0].clockIn = at(1), /display-mismatch/],
  ['weekly schedule changed', p => p.readbacks.post.weeklyReview.body.teams[0].records[0].plannedMinutes = 999, /display-mismatch/],
  ['replay stale session', p => p.replays[0].after.sessionId = 'session-old', /replay-context/],
  ['overlapping replay observations', p => p.replays[1].before.at = at(20), /temporal-order/],
  ['time inactive', p => p.readbacks.post.timeReview.pages[0].teams[0].active = false, /inactive-time-review/],
  ['weekly wrong period', p => p.readbacks.post.weeklyReview.body.period = 'prior', /consumer-period/],
  ['weekly missing team', p => p.readbacks.post.weeklyReview.body.teams.pop(), /consumer-teams/],
  ['weekly row changed', p => p.readbacks.post.weeklyReview.body.teams[0].records[0].raw.kind = 'worked', /weekly-record/],
  ['payroll incomplete roster', p => p.readbacks.post.payroll.body.teams[0].employees = [], /consumer-roster/],
  ['payroll release not ingestion', p => p.readbacks.post.payroll.body.canRelease = true, /unexpected-payroll/],
  ['payroll missing audit', p => p.readbacks.post.payroll.body.audit = [], /consumer-audit/],
  ['retry duplicate effect', p => { p.replays[0].after.state.payrollControl.audit.push({ id: 'pa-1' }); p.replays[0].after.stateDigest = hash(p.replays[0].after.state); }, /replay-wrote-state/],
  ['retry transient write', p => p.replays[0].effects.writeCount = 1, /zero-writes/],
  ['retry cursor moved', p => p.replays[0].effects.afterCursor = 'cursor-2', /zero-writes/],
  ['missing replay journal', p => delete p.replays[1].effects, /zero-writes/],
  ['retry success invented', p => p.replays[0].outcome = 'PASS', /replay-outcome/],
  ['retry changed input', p => p.replays[0].input.sourceReference = 'changed-source', /not-identical/],
  ['conflict actually identical', p => { p.replays[1].input = clone(p.ingestion.input); p.replays[1].inputDigest = hash(p.replays[1].input); }, /not-conflicting/],
  ['invalid actually valid', p => { p.replays[2].input = clone(p.ingestion.input); p.replays[2].inputDigest = hash(p.replays[2].input); }, /not-invalid/],
  ['missing conflict scenario', p => p.replays.splice(1, 1), /evidence-gap/],
  ['duplicate replay IDs', p => p.replays[1].id = p.replays[0].id, /duplicate-or-invalid-id/]
]) test(label, () => reject(mutate(fn), pattern));

test('all single-field removals from critical evidence objects fail closed without throwing', () => {
  for (const select of [p => p.expected.binding, p => p.expected.period, p => p.ownerEvidence, p => p.ingestion, p => p.states.post, p => p.readbacks.freshSession.payroll, p => p.replays[0].effects]) {
    for (const key of Object.keys(select(fixture()))) {
      // Reference-only labels and replay journal shape are required, all fields used.
      const p = fixture(); delete select(p)[key]; reject(p);
    }
  }
});
for (const [index, kind] of ['identical', 'conflicting', 'invalid'].entries()) test(kind + ' requires state equality AND independent zero-write observation', () => {
  reject(mutate(p => { p.replays[index].after.state.operations.preferences.synthetic = {}; p.replays[index].after.stateDigest = hash(p.replays[index].after.state); }), /replay-wrote-state/);
  reject(mutate(p => { p.replays[index].effects.writes = [{ table: 'synthetic-table' }]; }), /zero-writes/);
  reject(mutate(p => { delete p.replays[index].after; }), /evidence-gap/);
});
test('calendar freshness accepts the inspected exact maximum age and future tolerance boundaries', () => {
  const p = fixture(); p.expected.now = '2026-10-06T10:15:00.000Z'; assert.equal(validate(p).status, 'consistent');
  p.expected.now = '2026-10-06T10:15:00.001Z'; reject(p, /stale-or-invalid-time/);
  const future = fixture(); future.expected.now = at(1); assert.equal(validate(future).status, 'consistent');
  future.expected.now = '2026-10-06T10:00:00.999Z'; reject(future, /stale-or-invalid-time/);
});
test('malformed or hostile JSON is bounded and does not run accessors', () => {
  for (const x of [null, [], undefined, 1, 'PASS', { schemaVersion: 'unknown' }, new Date(), NaN, Infinity, 1n]) reject(x);
  const p = fixture(); p.loop = p; reject(p, /json/);
  let invoked = false; const getter = {}; Object.defineProperty(getter, 'expected', { enumerable: true, get() { invoked = true; throw Error(); } }); reject(getter, /json/); assert.equal(invoked, false);
  reject({ x: Array(PROOF_LIMITS.array + 1).fill(0) }, /json/);
  reject({ x: 'x'.repeat(PROOF_LIMITS.string + 1) }, /json/);
  reject({ x: Array(3) }, /json/);
  let nested = {}; for (let i = 0; i < 40; i++) nested = { nested }; reject(nested, /json/);
  for (const fn of [p => p.ingestion.input.records[0] = null, p => p.readbacks.post.weeklyReview.body.teams = [null], p => p.readbacks.post.timeReview.pages[0].rows = [null], p => p.replays[0].input = null]) reject(mutate(fn));
});
