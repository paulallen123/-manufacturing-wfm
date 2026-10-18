'use strict';
const { createHash } = require('node:crypto');

const ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;
const id = value => typeof value === 'string' && ID.test(value);
const time = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
};
const fields = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => allowed.includes(key));
const SNAPSHOT_FIELDS = ['tenantId','siteId','sourceRevision','complete','observedAt','validUntil','evidenceRef','contentDigest'];
const QUALIFICATION_FIELDS = ['tenantId','siteId','sourceRevision','workerRef','skillId','status','validFrom','validUntil','observedAt','evidenceRef'];
const REQUIREMENT_FIELDS = ['tenantId','siteId','sourceRevision','skillId','requiredCount','validFrom','validUntil','observedAt','evidenceRef'];

// Aggregate source-snapshot assessment. This is succession risk context, never
// an individual schedule eligibility decision or certification grant.
module.exports = function assessCriticalSkillBench(input) {
  const blocked = reason => ({ status: 'BLOCKED', reason, sourceAuthenticated: false, executionAuthority: false });
  if (!input || !id(input.tenantId) || !id(input.siteId) || time(input.asOf) === null) return blocked('SCOPE_INVALID');
  const now = time(input.asOf), snapshot = input.snapshot;
  if (!fields(snapshot, SNAPSHOT_FIELDS) || snapshot.complete !== true ||
      snapshot.tenantId !== input.tenantId || snapshot.siteId !== input.siteId ||
      !id(snapshot.sourceRevision) || !id(snapshot.evidenceRef) || !/^[a-f0-9]{64}$/.test(snapshot.contentDigest || '') ||
      time(snapshot.observedAt) === null || time(snapshot.validUntil) === null ||
      !(time(snapshot.observedAt) <= now && now < time(snapshot.validUntil))) return blocked('SNAPSHOT_UNPROVEN');
  if (!Array.isArray(input.requirements) || !input.requirements.length || input.requirements.length > 256 ||
      !Array.isArray(input.qualifications) || input.qualifications.length > 10000) return blocked('COLLECTION_INVALID');
  const required = new Map();
  for (const row of input.requirements) {
    const from = time(row?.validFrom), until = time(row?.validUntil);
    if (!fields(row, REQUIREMENT_FIELDS) || Object.keys(row).length !== REQUIREMENT_FIELDS.length ||
        row.tenantId !== input.tenantId || row.siteId !== input.siteId ||
        row.sourceRevision !== snapshot.sourceRevision || !id(row.evidenceRef) ||
        time(row.observedAt) === null || time(row.observedAt) > time(snapshot.observedAt) ||
        from === null || until === null || !(from <= now && now < until) ||
        !id(row.skillId) || required.has(row.skillId) || !Number.isSafeInteger(row.requiredCount) ||
        row.requiredCount < 1 || row.requiredCount > 10000) return blocked('REQUIREMENT_INVALID');
    required.set(row.skillId, row.requiredCount);
  }
  const qualified = new Map([...required.keys()].map(skillId => [skillId, new Set()]));
  const seen = new Set();
  for (const row of input.qualifications) {
    if (!fields(row, QUALIFICATION_FIELDS) || Object.keys(row).length !== QUALIFICATION_FIELDS.length ||
        row.tenantId !== input.tenantId || row.siteId !== input.siteId ||
        row.sourceRevision !== snapshot.sourceRevision || !id(row.workerRef) ||
        !required.has(row.skillId) || !id(row.evidenceRef) ||
        !['VALID','EXPIRED','REVOKED'].includes(row.status)) return blocked('QUALIFICATION_INVALID');
    const from = time(row.validFrom), until = time(row.validUntil), observed = time(row.observedAt);
    if (from === null || until === null || observed === null || from >= until || observed > time(snapshot.observedAt)) return blocked('QUALIFICATION_TIME_INVALID');
    const key = JSON.stringify([row.workerRef, row.skillId]);
    if (seen.has(key)) return blocked('DUPLICATE_QUALIFICATION');
    seen.add(key);
    if (row.status === 'VALID' && from <= now && now < until) qualified.get(row.skillId).add(row.workerRef);
  }
  const canonical = rows => rows.map(row => Object.keys(row).sort().map(key => [key, row[key]]))
    .sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const digest = createHash('sha256').update(JSON.stringify({ requirements: canonical(input.requirements),
    qualifications: canonical(input.qualifications) })).digest('hex');
  if (digest !== snapshot.contentDigest) return blocked('SNAPSHOT_CONTENT_MISMATCH');
  const skills = [...required].sort(([a],[b]) => a.localeCompare(b)).map(([skillId, requiredCount]) => {
    const qualifiedCount = qualified.get(skillId).size;
    return { skillId, requiredCount, qualifiedCount, gapCount: Math.max(0, requiredCount - qualifiedCount),
      oneWorkerLossCovered: qualifiedCount - 1 >= requiredCount };
  });
  return { status: 'ASSESSED', tenantId: input.tenantId, siteId: input.siteId,
    sourceRevision: snapshot.sourceRevision, snapshotEvidenceRef: snapshot.evidenceRef,
    skills, sourceAuthenticated: false, executionAuthority: false };
};
