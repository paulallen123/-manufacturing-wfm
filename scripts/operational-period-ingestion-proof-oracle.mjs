import { createHash } from 'node:crypto';

/**
 * Validation only. No I/O, clocks, period writes, payroll calculation or admission.
 * The trusted caller MUST obtain expected values and authenticate collector/owner
 * provenance outside this module. JSON cannot prove its own origin. All envelope
 * fields below are a proposed collector adapter contract, NOT runtime receipts.
 * `consistent` means internally consistent supplied evidence, never customer proof.
 * See OPERATIONAL_PERIOD_INGESTION_HANDOFF.md for source bindings and limitations.
 */
export const OPERATIONAL_PERIOD_PROOF_SCHEMA = 'operational-period-ingestion-proof/v1';
export const INSPECTED_SOURCE_SHA = '8632e5bb5c84e4fc258311d31d973714be169866';
export const SNAPSHOT_SCHEMA = 'sealed-load-with-time-review-and-corrections/v1';
export const SEALED_ARTIFACT_SHA256 = '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';
// Computational bounds, not business limits or freshness policy. Larger proofs
// need a reviewed schema revision; never truncate evidence to fit these bounds.
export const PROOF_LIMITS = Object.freeze({ nodes: 600000, depth: 32, array: 20000, string: 65536, characters: 16000000 });
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.length > 0 && x.length <= 160 && !/[\u0000-\u001f\u007f]/.test(x);
const canonical = x => Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : object(x)
  ? '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}' : JSON.stringify(x);
const same = (a, b) => canonical(a) === canonical(b);
const digest = x => createHash('sha256').update(canonical(x)).digest('hex');
const sha = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const day = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x + 'T00:00:00Z')) && new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x;
const instant = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(x) && day(x.slice(0, 10)) && Number.isFinite(Date.parse(x)) && Number(x.slice(11, 13)) < 24 && Number(x.slice(14, 16)) < 60 && Number(x.slice(17, 19)) < 60;
const addDays = (x, n) => new Date(Date.parse(x + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const pick = (x, keys) => Object.fromEntries(keys.map(k => [k, x[k]]));
const periodProjection = p => ({ id: p.id, start: p.start, end: p.end });
const fingerprint = r => canonical({ id: r.id, employee: r.employee, team: r.team, date: r.date, sourceVersion: r.sourceVersion, raw: r.raw, correction: r.correction || null, scheduledStart: r.scheduledStart || null, scheduledEnd: r.scheduledEnd || null, plannedMinutes: r.plannedMinutes, scheduledBreaks: r.scheduledBreaks || null });
const positiveInteger = x => Number.isSafeInteger(x) && x >= 1;
function sealedDeadlineMatches(start, deadline) {
  // Verify openPeriodFromSource's E.resolveLondon(C.addDays(start,7)+'T12:00')
  // output. resolveLondon returns toISOString(), so equivalent offset text is not
  // an exact readback. London noon is unique across both DST transitions.
  if (!instant(deadline) || new Date(deadline).toISOString() !== deadline || !deadline.endsWith(':00.000Z')) return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(deadline)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}` === addDays(start, 7) && parts.hour === '12' && parts.minute === '00' && parts.second === '00';
}

// Closed, source-bound container profile, not a caller-supplied "complete" flag.
// Sources: sealed core.seed; engine.decorate; server initTenant/load decorator
// chain C/P/R/RD/SP/OA/ON, SP->O->D, plus TR/AC.decorate. See handoff hashes.
// Map values and row payloads remain opaque here: expected.preStateDigest binds
// their full initial content, and the mutation-footprint checks preserve it.
// Other runtime extensions need an inspected profile revision, never omission.
const STATE_PROFILE = {
  version: positiveInteger, jurisdiction: text, rulesVerifiedAt: text,
  org: Array.isArray, staff: Array.isArray, requests: Array.isArray, audit: Array.isArray,
  shifts: object, availability: Array.isArray, offers: Array.isArray, assignments: Array.isArray,
  gaps: Array.isArray, profiles: object, history: Array.isArray,
  costing: { schema: x => x === 3, rates: object, employeePolicies: object, policies: object,
    ledger: Array.isArray, weekEvidence: object, imports: Array.isArray, budgets: object,
    calendar: { source: text, reviewedAt: text, years: Array.isArray, scheduledRefresh: x => typeof x === 'boolean' },
    demandHistory: Array.isArray, historySource: x => typeof x === 'string' },
  payrollControl: { version: x => x === 1, periods: Array.isArray, audit: Array.isArray, adjustments: Array.isArray, adjustmentBatches: Array.isArray },
  workRules: { revision: positiveInteger, checkedAt: text, contracts: object, templates: Array.isArray,
    patterns: Array.isArray, premiums: Array.isArray, leaveRules: Array.isArray, jobs: Array.isArray,
    roster: Array.isArray, absences: Array.isArray, annualOpening: object, leaveBalances: object, audit: Array.isArray },
  readiness: { schemaVersion: x => x === 1, requirements: Array.isArray, runs: Array.isArray, receipts: Array.isArray },
  demandPlanning: { schema: x => x === 6, revision: positiveInteger, source: x => typeof x === 'string',
    products: Array.isArray, records: Array.isArray, performance: Array.isArray, batches: Array.isArray,
    audit: Array.isArray, actions: Array.isArray, receipts: Array.isArray, costBenchmarks: object,
    shareAggregates: x => typeof x === 'boolean', minCohort: positiveInteger, benchmark: text, market: Array.isArray },
  operations: { schema: x => x === 1, revision: positiveInteger, preferences: object, leaveOpenings: object,
    breakRules: Array.isArray, siteAccess: object, swaps: Array.isArray, notices: Array.isArray,
    receipts: Array.isArray, travelMinutes: object, audit: Array.isArray },
  schedulePublication: { schemaVersion: x => x === 1, drafts: Array.isArray, publications: Array.isArray,
    notifications: Array.isArray, receipts: Array.isArray, audit: Array.isArray, acknowledgements: Array.isArray },
  orgAdmin: { schema: x => x === 1, revision: positiveInteger, baseOrg: Array.isArray, changes: Array.isArray, receipts: Array.isArray },
  onboarding: { schemaVersion: x => x === 1, batches: Array.isArray, people: Array.isArray, receipts: Array.isArray, audit: Array.isArray },
  attendanceCorrections: { requests: Array.isArray, notifications: Array.isArray, receipts: Array.isArray },
  timeReview: { schema: x => x === 1, revision: positiveInteger,
    thresholds: { earlyIn: Number.isFinite, lateIn: Number.isFinite, earlyOut: Number.isFinite, lateOut: Number.isFinite },
    active: object, decisions: Array.isArray, receipts: Array.isArray, audit: Array.isArray }
};
function snapshotShapeErrors(value, shape = STATE_PROFILE, path = '') {
  if (typeof shape === 'function') return shape(value) ? [] : [path];
  if (!object(value)) return [path];
  const errors = Object.keys(value).filter(k => !Object.hasOwn(shape, k)).map(k => path + '.' + k);
  for (const [key, rule] of Object.entries(shape)) {
    if (!Object.hasOwn(value, key)) errors.push(path + '.' + key);
    else errors.push(...snapshotShapeErrors(value[key], rule, path + '.' + key));
  }
  return errors;
}

// Reject getters/non-JSON/cycles before reading values. Proxy objects are outside
// the trusted-caller boundary; callers must pass parsed, bounded JSON data.
function boundedJSON(value) {
  let nodes = 0, characters = 0;
  const active = new Set();
  function visit(x, depth) {
    if (++nodes > PROOF_LIMITS.nodes || depth > PROOF_LIMITS.depth) throw Error('BOUND');
    if (typeof x === 'string') { characters += x.length; if (x.length > PROOF_LIMITS.string || characters > PROOF_LIMITS.characters) throw Error('BOUND'); return; }
    if (x === null || typeof x === 'boolean' || typeof x === 'number' && Number.isFinite(x)) return;
    if (!object(x) && !Array.isArray(x)) throw Error('JSON');
    if (active.has(x) || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(x))) throw Error('JSON');
    if (Array.isArray(x) && x.length > PROOF_LIMITS.array) throw Error('BOUND');
    active.add(x);
    const keys = Reflect.ownKeys(x);
    if (Array.isArray(x) && keys.length !== x.length + 1) throw Error('JSON');
    for (const k of keys) {
      if (Array.isArray(x) && k === 'length') continue;
      if (typeof k !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(k)) throw Error('JSON');
      characters += k.length;
      if (characters > PROOF_LIMITS.characters) throw Error('BOUND');
      const d = Object.getOwnPropertyDescriptor(x, k);
      if (!d.enumerable || !('value' in d)) throw Error('JSON');
      visit(d.value, depth + 1);
    }
    active.delete(x);
  }
  visit(value, 0);
}

export function validateOperationalPeriodIngestionProof(packet) {
  try { return validate(packet); } catch {
    return { schemaVersion: OPERATIONAL_PERIOD_PROOF_SCHEMA, status: 'not-proven', readiness: 'not-proven', provenance: 'requires-trusted-caller-verification', issues: [{ code: 'invalid-evidence-shape', path: '$' }] };
  }
}

function validate(packet) {
  const issues = [];
  const issue = (code, path) => issues.push({ code, path });
  const check = (ok, code, path) => { if (!ok) issue(code, path); return !!ok; };
  const result = () => ({ schemaVersion: OPERATIONAL_PERIOD_PROOF_SCHEMA, status: issues.length ? 'not-proven' : 'consistent', readiness: 'not-proven', provenance: 'requires-trusted-caller-verification', issues: issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code)) });
  try { boundedJSON(packet); } catch { issue('invalid-or-unbounded-json', '$'); return result(); }
  if (!object(packet)) { issue('evidence-gap', '$'); return result(); }
  if (!check(packet.schemaVersion === OPERATIONAL_PERIOD_PROOF_SCHEMA, 'unsupported-schema', 'schemaVersion')) return result();
  const e = packet.expected;
  if (!check(object(e), 'evidence-gap', 'expected')) return result();
  const bindingKeys = ['tenantId', 'sourceSha', 'deploymentId', 'configurationDigest'];
  const b = e.binding;
  if (!check(object(b) && bindingKeys.every(k => text(b[k])) && sha(b.configurationDigest) && b.sourceSha === INSPECTED_SOURCE_SHA, 'source-binding-invalid', 'expected.binding')) return result();
  const manifest = e.snapshotManifest;
  if (!check(object(manifest) && manifest.schemaVersion === SNAPSHOT_SCHEMA && manifest.sourceSha === INSPECTED_SOURCE_SHA && manifest.artifactSha256 === SEALED_ARTIFACT_SHA256 && sha(manifest.preStateDigest), 'evidence-gap:unsupported-snapshot-schema', 'expected.snapshotManifest')) return result();
  const calendar = e.calendar;
  if (!check(object(calendar) && text(calendar.timeZone) && Number.isFinite(calendar.maxAgeMs) && calendar.maxAgeMs > 0 && instant(e.now), 'evidence-gap', 'expected.calendar')) return result();
  try { new Intl.DateTimeFormat('en-GB', { timeZone: calendar.timeZone }).format(0); } catch { issue('invalid-timezone', 'expected.calendar.timeZone'); return result(); }
  function fresh(at, path) {
    // tenant-calendar.cjs freshness contract, including its 30s future allowance.
    return check(instant(at) && Date.parse(at) <= Date.parse(e.now) + 30000 && Date.parse(e.now) - Date.parse(at) <= calendar.maxAgeMs, 'stale-or-invalid-time', path);
  }
  function bound(x, path) { return check(object(x) && same(x, b), 'identity-mismatch', path); }
  function unique(xs, path) { return check(Array.isArray(xs) && xs.every(text) && new Set(xs).size === xs.length, 'duplicate-or-invalid-id', path); }
  function ordered(a, z, path) { check(instant(a) && instant(z) && Date.parse(a) <= Date.parse(z), 'temporal-order', path); }
  const owner = packet.ownerEvidence;
  if (!check(object(owner) && text(owner.evidenceRef) && owner.owner === 'Continue customer proof' && text(owner.collectorId) && text(owner.independentCollectorId) && owner.collectorId !== owner.independentCollectorId && text(owner.actorId) && text(owner.tenantResolutionRef) && owner.tenantBinding === 'authenticated-server-context' && Array.isArray(owner.permissions) && owner.permissions.includes('time.ingest'), 'evidence-gap:owner-authority', 'ownerEvidence')) return result();
  bound(owner.binding, 'ownerEvidence.binding');
  const ep = e.period, roster = e.roster;
  if (!check(object(ep) && day(ep.start) && day(ep.end) && ep.id === ep.start && new Date(ep.start + 'T12:00Z').getUTCDay() === 1 && ep.end === addDays(ep.start, 6) && instant(ep.deadline) && Date.parse(ep.deadline) > Date.parse(ep.end + 'T23:59:59Z') && text(ep.source) && ep.source.length >= 8, 'invalid-week-contract', 'expected.period')) return result();
  if (!check(sealedDeadlineMatches(ep.start, ep.deadline), 'invalid-sealed-period-deadline', 'expected.period.deadline')) return result();
  if (!check(Array.isArray(roster) && roster.length > 0 && roster.every(r => object(r) && ['id', 'manager', 'name', 'site'].every(k => text(r[k]))), 'evidence-gap:roster', 'expected.roster')) return result();
  unique(roster.map(r => r.id), 'expected.roster');
  const employees = roster.map(r => r.id), teamIds = [...new Set(roster.map(r => r.manager))];
  const rosterMap = new Map(roster.map(r => [r.id, r]));
  function inputErrors(input) {
    const errors = [];
    if (!object(input)) return ['input'];
    if (Object.keys(input).some(k => !['start', 'employeeIds', 'records', 'sourceReference', 'completeTeams'].includes(k))) errors.push('unsupported-input-or-client-tenant');
    if (!day(input.start) || new Date(input.start + 'T12:00Z').getUTCDay() !== 1) errors.push('monday');
    if (!Array.isArray(input.employeeIds) || !same(input.employeeIds, employees)) errors.push('roster');
    if (!text(input.sourceReference) || input.sourceReference.length < 8) errors.push('source');
    if (!Array.isArray(input.completeTeams) || !same(input.completeTeams, teamIds)) errors.push('complete-teams');
    if (!Array.isArray(input.records)) return [...errors, 'records'];
    const ids = new Set(), days = new Set();
    for (const r of input.records) {
      if (!object(r)) { errors.push('record'); continue; }
      const employee = rosterMap.get(r.employee), key = r.employee + '|' + r.date;
      if (!text(r.id) || ids.has(r.id) || days.has(key)) errors.push('duplicate-record');
      ids.add(r.id); days.add(key);
      if (!employee || r.team !== employee.manager) errors.push('record-roster');
      if (!day(r.date) || !day(input.start) || r.date < input.start || r.date > addDays(input.start, 6)) errors.push('record-date');
      if (!object(r.raw) || !r.sourceVersion || !['string', 'number'].includes(typeof r.sourceVersion)) errors.push('raw-source-version');
      if (r.correction != null || r.timeReviewTreatment != null) errors.push('imported-approval');
      if (!Number.isFinite(r.plannedMinutes)) errors.push('planned-minutes');
      for (const [start, end] of [[r.scheduledStart, r.scheduledEnd], [r.raw?.clockIn, r.raw?.clockOut]]) {
        if (start != null && !instant(start) || end != null && !instant(end) || start != null && end != null && Date.parse(start) >= Date.parse(end)) errors.push('interval');
      }
      for (const breaks of [r.scheduledBreaks, r.raw?.breaks]) if (breaks != null) {
        if (!Array.isArray(breaks) || breaks.some(v => !object(v) || !instant(v.start) || !instant(v.end) || Date.parse(v.start) >= Date.parse(v.end))) errors.push('break-interval');
      }
    }
    // Actual weekly blockers require one daily outcome per frozen employee.
    if (day(input.start)) for (const id of employees) for (let n = 0; n < 7; n++) if (!days.has(id + '|' + addDays(input.start, n))) errors.push('missing-daily-outcome');
    return errors;
  }
  const ingestion = packet.ingestion;
  if (!check(object(ingestion) && text(ingestion.evidenceRef), 'evidence-gap:ingestion', 'ingestion')) return result();
  bound(ingestion.binding, 'ingestion.binding');
  check(ingestion.collectorId === owner.collectorId && ingestion.actorId === owner.actorId && ingestion.seam === 'WFMPayroll.openPeriodFromSource', 'ingestion-provenance-mismatch', 'ingestion');
  const input = ingestion.input;
  for (const error of inputErrors(input)) issue('invalid-ingestion:' + error, 'ingestion.input');
  if (!object(input) || !Array.isArray(input.records)) return result();
  check(input.start === ep.start && input.sourceReference === ep.source, 'source-period-mismatch', 'ingestion.input');
  check(sha(e.inputDigest) && e.inputDigest === digest(input) && ingestion.inputDigest === e.inputDigest, 'input-digest-mismatch', 'ingestion.inputDigest');
  check(same(ingestion.result, { id: ep.id }), 'ingestion-result-mismatch', 'ingestion.result');
  fresh(ingestion.startedAt, 'ingestion.startedAt'); fresh(ingestion.completedAt, 'ingestion.completedAt');
  ordered(ingestion.startedAt, ingestion.completedAt, 'ingestion');
  function snapshot(x, path, collector = owner.collectorId) {
    if (!check(object(x) && object(x.state) && text(x.evidenceRef) && text(x.processId) && text(x.sessionId), 'evidence-gap:state', path)) return null;
    bound(x.binding, path + '.binding');
    check(x.collectorId === collector, 'collector-mismatch', path + '.collectorId');
    fresh(x.at, path + '.at');
    if (!check(x.schemaVersion === SNAPSHOT_SCHEMA, 'evidence-gap:unsupported-snapshot-schema', path + '.schemaVersion')) return null;
    const shapeErrors = snapshotShapeErrors(x.state);
    for (const field of shapeErrors) issue('evidence-gap:unsupported-snapshot-shape', path + '.state' + field);
    if (shapeErrors.length) return null;
    check(sha(x.stateDigest) && x.stateDigest === digest(x.state), 'state-digest-mismatch', path + '.stateDigest');
    const periods = x.state.payrollControl?.periods;
    if (!check(Array.isArray(periods) && Array.isArray(x.state.payrollControl.audit) && object(x.state.timeReview?.active), 'evidence-gap:canonical-period-store', path + '.state')) return null;
    if (!check(periods.every(p => object(p) && text(p.id) && day(p.start) && day(p.end) && p.start <= p.end), 'invalid-period', path + '.periods')) return null;
    unique(periods.map(p => p.id), path + '.periods');
    const sorted = [...periods].sort((a, z) => a.start.localeCompare(z.start));
    for (let i = 1; i < sorted.length; i++) check(sorted[i - 1].end < sorted[i].start, 'overlapping-periods', path + '.periods');
    unique(x.state.payrollControl.audit.map(a => a?.id), path + '.audit');
    return x.state;
  }
  const states = {};
  for (const phase of ['pre', 'post', 'restart', 'freshSession']) states[phase] = snapshot(packet.states?.[phase], 'states.' + phase);
  if (Object.values(states).some(s => !s)) return result();
  const { pre, post, restart, freshSession } = states;
  check(digest(pre) === manifest.preStateDigest, 'authoritative-pre-snapshot-digest-mismatch', 'states.pre.stateDigest');
  ordered(packet.states.pre.at, ingestion.startedAt, 'pre-before-ingestion');
  ordered(ingestion.completedAt, packet.states.post.at, 'post-after-ingestion');
  const p = post.payrollControl.periods.find(p => p.id === ep.id);
  if (!check(object(p), 'evidence-gap:canonical-period', 'states.post.state.payrollControl.periods')) return result();
  check(!pre.payrollControl.periods.some(p => p.id === ep.id), 'period-already-present', 'states.pre');
  check(same(pick(p, ['id', 'start', 'end', 'deadline', 'source']), ep), 'period-mismatch', 'states.post.period');
  check(same(p.expectedRoster, employees) && same(p.records, input.records), 'roster-or-records-mismatch', 'states.post.period');
  const org = pre.org;
  if (!check(Array.isArray(org) && Array.isArray(pre.staff), 'evidence-gap:staff-org', 'states.pre.state')) return result();
  unique(pre.staff.map(r => r?.id), 'states.pre.staff'); unique(org.map(r => r?.id), 'states.pre.org');
  for (const employee of roster) check(same(pick(pre.staff.find(r => r.id === employee.id) || {}, ['id', 'manager', 'name', 'site']), employee), 'authoritative-roster-mismatch', 'expected.roster.' + employee.id);
  const teams = teamIds.map(id => {
    const node = org.find(n => n.id === id), people = roster.filter(r => r.manager === id);
    check(object(node) && text(node.label) && text(node.name), 'evidence-gap:review-owner', 'states.pre.org.' + id);
    return { id, name: node?.label, owner: id, ownerName: node?.name, site: people[0].site, employees: people.map(r => r.id), feedComplete: true };
  });
  check(same(p.teams, teams), 'teams-mismatch', 'states.post.period.teams');
  check(same(p.reviews, Object.fromEntries(teamIds.map(id => [id, { revision: 1, status: 'draft', acknowledgements: {}, employeeChecks: {}, signature: null }]))), 'imported-review-or-signature', 'states.post.period.reviews');
  for (const key of ['issues', 'batches', 'reminders', 'personalSessionLinks']) check(same(p[key], []), 'unexpected-period-effect', 'states.post.period.' + key);
  check(same(post.payrollControl.periods, [...pre.payrollControl.periods, p]), 'unrelated-period-change-or-order', 'states.post.periods');
  const delta = post.payrollControl.audit.slice(pre.payrollControl.audit.length);
  check(same(post.payrollControl.audit.slice(0, pre.payrollControl.audit.length), pre.payrollControl.audit) && delta.length === 1, 'audit-count-or-history-mismatch', 'states.post.audit');
  const audit = delta[0];
  check(object(audit) && audit.id === 'pa-' + pre.payrollControl.audit.length && audit.type === 'weekly-source-ingested' && audit.period === ep.id && audit.source === ep.source && audit.employees === employees.length && audit.actor === owner.actorId, 'audit-mismatch', 'states.post.audit');
  if (audit) { ordered(ingestion.startedAt, audit.at, 'audit.after-start'); ordered(audit.at, ingestion.completedAt, 'audit.before-completion'); }
  check(same(ingestion.audit, audit), 'audit-readback-mismatch', 'ingestion.audit');
  const expectedActive = { ...pre.timeReview.active };
  for (const id of teamIds) {
    const key = ep.id + '|' + id, active = post.timeReview.active[key];
    check(!Object.hasOwn(pre.timeReview.active, key), 'preexisting-target-activation', 'states.pre.timeReview.active');
    check(object(active) && active.by === owner.actorId && same(active.thresholds, pre.timeReview.thresholds), 'activation-mismatch', 'states.post.timeReview.active.' + key);
    if (active) { ordered(ingestion.startedAt, active.at, 'activation.after-start'); ordered(active.at, ingestion.completedAt, 'activation.before-completion'); }
    expectedActive[key] = active;
  }
  check(same(post.timeReview.active, expectedActive), 'unrelated-activation-change', 'states.post.timeReview.active');
  // Entire tenant snapshot except the three documented mutation paths is immutable.
  const unaffected = s => ({ ...s, payrollControl: { ...s.payrollControl, periods: [], audit: [] }, timeReview: { ...s.timeReview, active: {} } });
  check(same(unaffected(pre), unaffected(post)), 'unrelated-state-change', 'states.post.state');
  check(same(post, restart) && same(post, freshSession), 'restart-or-session-state-mismatch', 'states');
  // Restart may establish an intermediate session. Fresh authentication must not
  // recycle any earlier checkpoint session, even when all read/replay metadata
  // consistently relabels the recycled session. Reads within a checkpoint may
  // and must retain that checkpoint's session identity.
  const priorSessions = new Set(['pre', 'post', 'restart'].map(phase => packet.states[phase].sessionId));
  check(!priorSessions.has(packet.states.freshSession.sessionId), 'stale-lifecycle-session-reuse', 'states.freshSession.sessionId');
  for (const phase of ['restart', 'freshSession']) {
    const event = packet.lifecycle?.[phase], before = packet.states[phase === 'restart' ? 'post' : 'restart'], after = packet.states[phase];
    if (!check(object(event) && text(event.evidenceRef), 'evidence-gap:lifecycle', 'lifecycle.' + phase)) continue;
    bound(event.binding, 'lifecycle.' + phase + '.binding');
    check(event.collectorId === owner.independentCollectorId, 'collector-mismatch', 'lifecycle.' + phase);
    ordered(before.at, event.at, 'lifecycle.' + phase + '.after'); ordered(event.at, after.at, 'lifecycle.' + phase + '.before');
    const field = phase === 'restart' ? 'processId' : 'sessionId';
    check(event.from === before[field] && event.to === after[field] && event.from !== event.to, 'stale-lifecycle-identity', 'lifecycle.' + phase);
    if (phase === 'freshSession') check(after.processId === before.processId, 'process-mismatch', 'states.freshSession');
  }
  check(packet.states.pre.processId === packet.states.post.processId && packet.states.pre.sessionId === packet.states.post.sessionId, 'ingestion-context-mismatch', 'states.post');

  // Each phase requires independent, complete reads of all four actual consumers.
  for (const phase of ['post', 'restart', 'freshSession']) {
    const reads = packet.readbacks?.[phase], snap = packet.states[phase];
    for (const name of ['currentReviewPeriod', 'timeReview', 'weeklyReview', 'payroll']) {
      const read = reads?.[name], path = 'readbacks.' + phase + '.' + name;
      if (!check(object(read) && text(read.evidenceRef) && object(read.query), 'evidence-gap:consumer', path)) continue;
      bound(read.binding, path + '.binding');
      check(read.collectorId === owner.independentCollectorId && read.processId === snap.processId && read.sessionId === snap.sessionId && read.stateDigest === snap.stateDigest, 'consumer-context-mismatch', path);
      fresh(read.at, path + '.at'); ordered(snap.at, read.at, path + '.after-state');
      const nextEvent = phase === 'post' ? packet.lifecycle?.restart : phase === 'restart' ? packet.lifecycle?.freshSession : null;
      if (nextEvent) ordered(read.at, nextEvent.at, path + '.before-next-lifecycle');
      check(same(read.query, name === 'currentReviewPeriod' ? {} : { period: ep.id }), 'filtered-or-wrong-consumer-query', path + '.query');
      if (name === 'currentReviewPeriod') {
        const body = read.body;
        if (!check(object(body), 'evidence-gap:consumer-body', path)) continue;
        check(body.schemaVersion === 'tenant-calendar-1' && body.source === 'server-authoritative-tenant-calendar' && body.tenant === b.tenantId && body.site === calendar.site && body.timeZone === calendar.timeZone && body.maxAgeMs === calendar.maxAgeMs, 'calendar-binding-mismatch', path);
        fresh(body.asOf, path + '.asOf'); ordered(snap.at, body.asOf, path + '.calendar-after-state'); ordered(body.asOf, read.at, path + '.calendar-before-read');
        if (instant(body.asOf)) {
          const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: calendar.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(body.asOf)).map(v => [v.type, v.value]));
          check(body.localDate === `${parts.year}-${parts.month}-${parts.day}`, 'calendar-date-mismatch', path);
        }
        check(day(body.localDate) && ep.start <= body.localDate && ep.end >= body.localDate && same(body.period, ep), 'not-current-canonical-period', path + '.period');
        const historical = post.payrollControl.periods.filter(v => v.end < body.localDate).sort((a, z) => z.end.localeCompare(a.end)).slice(0, 12).map(v => ({ ...periodProjection(v), source: v.source || null }));
        check(same(body.historicalPeriods, historical), 'historical-period-mismatch', path);
        continue;
      }
      const bodies = name === 'timeReview' ? read.pages : [read.body];
      if (!check(Array.isArray(bodies) && bodies.length > 0 && bodies.every(object), 'evidence-gap:consumer-body', path)) continue;
      for (const body of bodies) {
        check(body.period === ep.id && body.start === ep.start && body.end === ep.end && same(body.periods, post.payrollControl.periods.map(periodProjection)), 'consumer-period-mismatch', path);
        check(Array.isArray(body.teams) && same(body.teams.map(t => t.id), teamIds), 'consumer-teams-mismatch', path);
      }
      if (name === 'timeReview') {
        const rows = [], sorted = [...p.records].sort((a, z) => rosterMap.get(a.employee).name.localeCompare(rosterMap.get(z.employee).name) || a.date.localeCompare(z.date));
        for (const body of bodies) {
          const page = body.page;
          if (!check(object(page) && Array.isArray(body.rows), 'evidence-gap:pagination', path)) continue;
          check(page.offset === rows.length && Number.isInteger(page.limit) && page.limit >= 1 && page.limit <= 100 && page.total === sorted.length && page.all === sorted.length && body.rows.length === Math.min(page.limit, sorted.length - rows.length) && page.hasMore === (page.offset + page.limit < page.total), 'pagination-mismatch', path);
          check(body.source === ep.source && positiveInteger(body.version) && body.version === post.version && positiveInteger(body.configRevision) && body.configRevision === post.timeReview.revision && same(body.thresholds, post.timeReview.thresholds), 'time-review-source-mismatch', path);
          check(body.teams.every(t => t.active === true && t.status === 'draft'), 'inactive-time-review', path);
          rows.push(...body.rows);
        }
        check(rows.length === sorted.length && same(rows.map(r => r.id), sorted.map(r => r.id)), 'time-review-row-order-or-count', path);
        rows.forEach((r, i) => {
          const source = sorted[i]; if (!source) return;
          check(r.employee === source.employee && r.team === source.team && r.date === source.date && r.fingerprint === fingerprint(source) && same(r.original, { clockIn: source.raw.clockIn, clockOut: source.raw.clockOut, breaks: source.raw.breaks || [] }) && r.treatment === null && r.decision === null, 'time-review-record-mismatch', path + '.rows.' + i);
          check(r.clockIn === source.raw.clockIn && r.clockOut === source.raw.clockOut && same(r.breaks, source.raw.breaks || []) && r.kind === source.raw.kind && r.scheduledStart === source.scheduledStart && r.scheduledEnd === source.scheduledEnd && r.plannedMinutes === source.plannedMinutes, 'time-review-display-mismatch', path + '.rows.' + i);
        });
      } else {
        const body = bodies[0];
        check(body.deadline === ep.deadline, 'consumer-deadline-mismatch', path);
        for (const team of Array.isArray(body.teams) ? body.teams : []) {
          const expectedTeam = teams.find(t => t.id === team.id);
          check(expectedTeam && team.period === ep.id && team.start === ep.start && team.end === ep.end && team.deadline === ep.deadline && team.revision === 1 && team.status === 'draft' && team.signature === null && Array.isArray(team.employees) && same(team.employees.map(v => v.id), expectedTeam.employees), 'consumer-roster-review-mismatch', path);
          if (name === 'weeklyReview') {
            const records = p.records.filter(r => r.team === team.id);
            check(Array.isArray(team.records) && same(team.records.map(r => r.id), records.map(r => r.id)), 'weekly-record-order-or-count', path);
            (team.records || []).forEach((r, i) => check(records[i] && r.employee === records[i].employee && r.date === records[i].date && same(r.raw, records[i].raw) && same(r.effective, records[i].raw) && r.correction === null && r.timeReviewTreatment === null, 'weekly-record-mismatch', path));
            (team.records || []).forEach((r, i) => check(records[i] && r.scheduledStart === records[i].scheduledStart && r.scheduledEnd === records[i].scheduledEnd && r.plannedMinutes === records[i].plannedMinutes, 'weekly-display-mismatch', path));
          }
        }
        check(same(body.audit, [audit]), 'evidence-gap:consumer-audit', path);
        if (name === 'payroll') check(body.totals?.employees === employees.length && body.canRelease === false && same(body.batches, []) && same(body.lines, []) && body.schema === 'reviewed-pay-v3-reconciled', 'unexpected-payroll-effect', path);
      }
    }
  }

  const attempts = packet.replays;
  if (!check(Array.isArray(attempts) && attempts.length >= 3, 'evidence-gap:replays', 'replays')) return result();
  unique(attempts.map(a => a?.id), 'replays');
  for (const kind of ['identical', 'conflicting', 'invalid']) check(attempts.some(a => a.kind === kind), 'evidence-gap:' + kind + '-replay', 'replays');
  for (const [i, a] of attempts.entries()) {
    const path = 'replays.' + i;
    if (!check(object(a) && ['identical', 'conflicting', 'invalid'].includes(a.kind) && text(a.evidenceRef), 'invalid-replay', path)) continue;
    bound(a.binding, path + '.binding');
    check(a.collectorId === owner.independentCollectorId, 'collector-mismatch', path);
    const before = snapshot(a.before, path + '.before', owner.independentCollectorId), after = snapshot(a.after, path + '.after', owner.independentCollectorId);
    check(a.before?.processId === packet.states.freshSession.processId && a.after?.processId === a.before?.processId && a.before?.sessionId === packet.states.freshSession.sessionId && a.after?.sessionId === a.before?.sessionId, 'replay-context-mismatch', path);
    if (i > 0) ordered(attempts[i - 1].after?.at, a.before?.at, path + '.after-previous-attempt');
    ordered(packet.states.freshSession.at, a.before?.at, path + '.after-fresh-session'); ordered(a.before?.at, a.startedAt, path + '.before-start'); ordered(a.startedAt, a.completedAt, path + '.duration'); ordered(a.completedAt, a.after?.at, path + '.after-end');
    check(before && after && same(before, post) && same(before, after), 'replay-wrote-state', path);
    // This is a normalized authoritative write-journal observation, not a receipt
    // implemented by the runtime. Equality alone cannot exclude transient writes.
    const effects = a.effects;
    check(object(effects) && text(effects.evidenceRef) && text(effects.beforeCursor) && effects.beforeCursor === effects.afterCursor && effects.writeCount === 0 && same(effects.writes, []), 'evidence-gap:zero-writes', path + '.effects');
    // Existing-period rejection precedes roster/row checks in the inspected seam;
    // an invalid replay may therefore be rejected as 409 rather than 400.
    check(a.outcome === 'rejected' && (a.kind === 'invalid' ? [400, 409].includes(a.statusCode) : a.statusCode === 409), 'replay-outcome-mismatch', path);
    const errors = inputErrors(a.input);
    check(sha(a.inputDigest) && a.inputDigest === digest(a.input), 'replay-digest-mismatch', path);
    if (a.kind === 'identical') check(same(a.input, input), 'not-identical-retry', path);
    if (a.kind === 'conflicting') check(errors.length === 0 && a.input.start === input.start && !same(a.input, input), 'not-conflicting-replay', path);
    if (a.kind === 'invalid') check(errors.length > 0, 'not-invalid-replay', path);
  }
  return result();
}
