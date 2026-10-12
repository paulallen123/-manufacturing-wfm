import { createHash } from 'node:crypto';

// Diagnostic only. Evidence references are structurally checked, never authenticated.
// The owner must authenticate the extracts, scope grants, revisions and evidence
// independently. No output from this module is a readiness or authority receipt.
const FIELDS = ['employeeId', 'firstName', 'lastName', 'email', 'status', 'department',
  'location', 'managerId', 'jobTitle', 'startDate', 'endDate', 'payRate', 'payCurrency', 'employmentType'];
const NS = ['tenant', 'provider', 'company', 'connectionId'];
const PINS = ['batchId', 'mappingVersion', 'batchChecksum', 'sourceRevision',
  'onboardingRevision', 'onboardingChecksum', 'operatingRevision', 'operatingChecksum'];
const LIMIT = 500;
const str = x => typeof x === 'string' && x.length > 0 && x.length <= 256 && x.trim() === x;
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const hash = x => createHash('sha256').update(x).digest('hex');
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const sorted = xs => [...new Set(xs)].sort();
const same = (a, b, keys) => obj(a) && obj(b) && keys.every(k => a[k] === b[k]);
const validNS = n => obj(n) && NS.every(k => str(n[k]));
const time = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)
  && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
const key = (n, id) => JSON.stringify([...NS.map(k => n[k]), id]);
const pinsValid = c => obj(c) && PINS.every(k => k === 'mappingVersion'
  ? Number.isSafeInteger(c[k]) && c[k] > 0 : k.endsWith('Checksum') ? digest(c[k]) : str(c[k]));

/**
 * Bounded JSON input (<=500 members per population, <=1500 edges/exclusions).
 * namespace; asOf (UTC millisecond ISO); current (PINS above);
 * authority: {namespace,current,permission:'people.read',provenance};
 * source: canonical DB rows enriched with namespace;
 * onboarding/operating: {namespace,revision,checksum,provenance,ids:string[]};
 * bindings: {id,namespace,current,employeeId,recordChecksum,onboardingId,
 *   operatingId,provenance}; exclusions: {id,namespace,current,population,
 *   memberId,reason:'excluded'|'former',provenance}.
 * provenance: {issuer,evidenceId,evidenceChecksum,validFrom,validUntil}.
 * All dates are explicit; intervals are [validFrom, validUntil).
 * Source exclusions use employee_key, other exclusions use the snapshot ID.
 * Snapshot checksum = SHA256(JSON.stringify(ids.slice().sort())); includes duplicates.
 * Missing = expected source identities without an unambiguous edge to that stage.
 * Extra = stage IDs without an unambiguous edge to an expected source identity;
 * this denotes unexplained membership, never proof that a person is unauthorized.
 */
export function reconcileWorkforcePopulation(input) {
  const result = { kind: 'workforce-population-diagnostic', authoritative: false,
    authentication: 'required-by-integrating-owner', structuralStatus: 'blocked',
    namespace: null, counts: {}, missing: { onboarding: [], operating: [] },
    extra: { onboarding: [], operating: [] }, unbound: { source: [], onboarding: [], operating: [] },
    duplicates: [], conflicting: [], rejected: [], excluded: [], bindings: [], reasons: [] };
  const reason = code => result.reasons.push(code);
  if (!obj(input)) { reason('invalid-input'); return result; }
  const { namespace: ns, current, asOf } = input;
  if (!validNS(ns) || !pinsValid(current) || !time(asOf)) {
    reason('invalid-namespace-current-or-asOf'); return result;
  }
  result.namespace = Object.fromEntries(NS.map(k => [k, ns[k]]));
  const provenance = p => obj(p) && str(p.issuer) && str(p.evidenceId) && digest(p.evidenceChecksum)
    && time(p.validFrom) && time(p.validUntil) && p.validFrom <= asOf && asOf < p.validUntil;
  const evidence = x => obj(x) && same(x.namespace, ns, NS) && same(x.current, current, PINS)
    && provenance(x.provenance);
  const bounded = (x, n) => Array.isArray(x) && x.length <= n;
  if (!bounded(input.source, LIMIT) || !bounded(input.onboarding?.ids, LIMIT)
      || !bounded(input.operating?.ids, LIMIT) || !bounded(input.bindings, LIMIT * 3)
      || !bounded(input.exclusions, LIMIT * 3)) {
    reason('missing-or-over-limit-collections'); return result;
  }
  let globalValid = evidence(input.authority) && input.authority.permission === 'people.read';
  if (!globalValid) reason('missing-stale-or-mismatched-source-authority');
  const populations = { source: new Map(), onboarding: new Map(), operating: new Map() };
  const bad = { source: new Set(), onboarding: new Set(), operating: new Set() };
  const reject = (population, id, code) => {
    result.rejected.push({ population, id: str(id) ? id : null, reason: code }); reason(code);
  };
  const add = (population, id, value) => {
    const map = populations[population];
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(value);
  };
  for (const population of ['onboarding', 'operating']) {
    const snapshot = input[population];
    let valid = same(snapshot.namespace, ns, NS) && provenance(snapshot.provenance)
      && snapshot.revision === current[`${population}Revision`]
      && snapshot.checksum === current[`${population}Checksum`]
      && snapshot.ids.every(str);
    if (valid) valid = hash(JSON.stringify([...snapshot.ids].sort())) === snapshot.checksum;
    if (!valid) {
      globalValid = false;
      reject(population, null, 'invalid-snapshot-scope-revision-checksum-or-provenance');
    }
    // Foreign-scope IDs are quarantined, never added to scoped counts.
    for (const id of snapshot.ids) {
      if (!str(id) || !same(snapshot.namespace, ns, NS)) {
        reject(population, id, 'invalid-or-foreign-member'); continue;
      }
      add(population, id, id);
    }
  }
  const checksums = [];
  for (const row of input.source) {
    if (!obj(row) || !same(row.namespace, ns, NS) || row.tenant !== ns.tenant
        || row.connection_id !== ns.connectionId || !digest(row.employee_key)) {
      reject('source', row?.employee_key, 'invalid-or-foreign-source-row'); globalValid = false; continue;
    }
    const id = row.employee_key;
    add('source', id, row);
    let canonical;
    try { canonical = typeof row.canonical_json === 'string' && row.canonical_json.length <= 65536
      ? JSON.parse(row.canonical_json) : null; } catch { canonical = null; }
    // Match the existing hub's employeeId normalization and ordered checksum.
    const employeeId = obj(canonical) && ['string', 'number'].includes(typeof canonical.employeeId)
      ? String(canonical.employeeId).trim() : '';
    let valid = false;
    // Parsed JSON may be within the byte/character bound yet exceed the engine's
    // serialization stack. Preserve hub hashing exactly; reject serialization
    // failures rather than coercing, omitting, or repairing canonical values.
    try {
      valid = str(employeeId) && row.batch_id === current.batchId && hash(employeeId) === id
        && digest(row.record_checksum)
        && hash(JSON.stringify(FIELDS.map(field => [field, canonical[field] ?? null]))) === row.record_checksum;
    } catch { valid = false; }
    if (!valid) { bad.source.add(id); reject('source', id, 'invalid-source-batch-key-or-record-checksum'); }
    if (digest(row.record_checksum)) checksums.push(row.record_checksum);
  }
  if (hash([ns.connectionId, String(current.mappingVersion), ...checksums.sort()].join('|')) !== current.batchChecksum) {
    globalValid = false; reason('batch-checksum-mismatch');
  }
  for (const population of Object.keys(populations)) {
    for (const [id, rows] of populations[population]) if (rows.length > 1) {
      bad[population].add(id);
      result.duplicates.push({ population, id, occurrences: rows.length });
      reason('duplicate-population-member');
    }
  }
  const excluded = { source: new Set(), onboarding: new Set(), operating: new Set() };
  const exclusionGroups = new Map();
  const exclusionIds = new Map();
  for (const x of input.exclusions) if (str(x?.id)) exclusionIds.set(x.id, (exclusionIds.get(x.id) || 0) + 1);
  for (const [id, occurrences] of exclusionIds) if (occurrences > 1) {
    result.duplicates.push({ population: 'exclusion-evidence', id, occurrences }); reason('duplicate-exclusion-id');
  }
  for (const x of input.exclusions) {
    if (!obj(x) || !str(x.id) || exclusionIds.get(x.id) !== 1
        || typeof x.population !== 'string' || !['source', 'onboarding', 'operating'].includes(x.population)
        || !str(x.memberId) || !['excluded', 'former'].includes(x.reason) || !evidence(x)
        || !populations[x.population].has(x.memberId) || bad[x.population].has(x.memberId) || !globalValid) {
      reject('exclusion', x?.id, 'invalid-or-stale-exclusion-authority'); continue;
    }
    const k = JSON.stringify([x.population, x.memberId]);
    if (!exclusionGroups.has(k)) exclusionGroups.set(k, []);
    exclusionGroups.get(k).push(x);
  }
  for (const xs of exclusionGroups.values()) {
    if (xs.length > 1) {
      result.duplicates.push({ population: 'exclusion', id: xs[0].memberId, occurrences: xs.length });
      reason('duplicate-exclusion'); continue;
    }
    const x = xs[0]; excluded[x.population].add(x.memberId);
    result.excluded.push({ population: x.population, id: x.memberId, reason: x.reason, evidenceId: x.provenance.evidenceId });
  }
  const candidates = [];
  const edgeIds = new Map();
  for (const edge of input.bindings) if (str(edge?.id)) edgeIds.set(edge.id, (edgeIds.get(edge.id) || 0) + 1);
  for (const [id, occurrences] of edgeIds) if (occurrences > 1) {
    result.duplicates.push({ population: 'binding', id, occurrences }); reason('duplicate-binding-id');
  }
  for (const edge of input.bindings) {
    if (!obj(edge) || !str(edge.id) || !str(edge.employeeId) || !str(edge.onboardingId)
        || !str(edge.operatingId) || !evidence(edge) || !globalValid || edgeIds.get(edge.id) !== 1) {
      reject('binding', edge?.id, 'invalid-stale-or-duplicate-binding-evidence'); continue;
    }
    const sourceId = hash(edge.employeeId);
    const ids = { source: sourceId, onboarding: edge.onboardingId, operating: edge.operatingId };
    if (Object.entries(ids).some(([p, id]) => !populations[p].has(id) || bad[p].has(id) || excluded[p].has(id))
        || edge.recordChecksum !== populations.source.get(sourceId)?.[0].record_checksum) {
      reject('binding', edge.id, 'unknown-duplicate-excluded-member-or-stale-record'); continue;
    }
    candidates.push({ id: edge.id, ...ids, evidenceId: edge.provenance.evidenceId });
  }
  // Reject every edge incident on an ambiguous member (including repeated triples).
  const ambiguous = new Set();
  for (const population of Object.keys(populations)) {
    const groups = new Map();
    for (const edge of candidates) {
      const id = edge[population]; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(edge.id);
    }
    for (const [id, edgeIdList] of groups) if (edgeIdList.length > 1) {
      edgeIdList.forEach(e => ambiguous.add(e));
      result.conflicting.push({ population, id, bindingIds: sorted(edgeIdList), reason: 'non-unique-binding' });
      reason('non-unique-binding');
    }
  }
  const bound = { source: new Set(), onboarding: new Set(), operating: new Set() };
  for (const edge of candidates) {
    if (ambiguous.has(edge.id)) continue;
    for (const population of Object.keys(bound)) bound[population].add(edge[population]);
    result.bindings.push({ ...edge, source: key(ns, edge.source) });
  }
  for (const population of Object.keys(populations)) {
    const ids = [...populations[population].keys()];
    const unbound = ids.filter(id => !bound[population].has(id) && !excluded[population].has(id));
    result.unbound[population] = sorted(unbound.map(id => population === 'source' ? key(ns, id) : id));
    result.counts[population] = { observedRows: [...populations[population].values()].reduce((n, rows) => n + rows.length, 0),
      distinct: ids.length, excluded: excluded[population].size, bound: bound[population].size, unbound: unbound.length };
  }
  // Edges are complete triples. Missing in either stage stays unresolved in both.
  result.missing.onboarding = [...result.unbound.source];
  result.missing.operating = [...result.unbound.source];
  result.extra.onboarding = [...result.unbound.onboarding];
  result.extra.operating = [...result.unbound.operating];
  if (Object.values(result.unbound).some(ids => ids.length)) reason('unbound-population-members');
  const compare = (a, b) => { const x = JSON.stringify(a), y = JSON.stringify(b); return x < y ? -1 : x > y ? 1 : 0; };
  for (const field of ['duplicates', 'conflicting', 'rejected', 'excluded', 'bindings']) result[field].sort(compare);
  result.reasons = sorted(result.reasons);
  result.structuralStatus = result.reasons.length ? 'blocked' : 'consistent-unverified';
  return result;
}
