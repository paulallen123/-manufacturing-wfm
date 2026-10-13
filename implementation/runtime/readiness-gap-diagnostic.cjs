'use strict';

// Read-only triage of the existing implementation status response. The result
// cannot satisfy a requirement or change launch authority.
const SOURCE_DATA_KEYS = new Set(['source-systems', 'people-data', 'organisation-model']);

function diagnoseReadinessGaps(readiness) {
  if (!readiness || !Array.isArray(readiness.requirements)) {
    return { status: 'UNCLASSIFIED_BLOCKER', blocking: true, gaps: [], reason: 'READINESS_RESPONSE_UNAVAILABLE' };
  }
  const fixtureOnly = readiness.runtimeIdentity?.fixtureOnly === true;
  const hasSource = Boolean(readiness.sourceDataSummary);
  const gaps = [];
  for (const item of readiness.requirements) {
    if (item?.satisfied === true && item.status === 'PASS') continue;
    const key = typeof item?.key === 'string' ? item.key : null;
    let classification = 'UNCLASSIFIED_BLOCKER';
    if (item?.status === 'FAIL' || item?.status === 'REVALIDATION_REQUIRED') {
      classification = 'CONFIRMED_CONTRACT_BLOCKER';
    } else if (item?.status === 'MISSING' && fixtureOnly && !hasSource && SOURCE_DATA_KEYS.has(key)) {
      // The fixture may be incomplete, but absent source evidence cannot prove
      // that a real customer source is healthy. Keep promotion blocked.
      classification = 'POSSIBLE_PROOF_FIXTURE_DATA_GAP';
    } else if (item?.status === 'MISSING' && key === 'configuration-scope' && hasSource) {
      classification = 'CUSTOMER_SCOPE_AUTHORITY_BLOCKER';
    }
    gaps.push({ key, classification, blocking: true });
  }
  for (const code of Array.isArray(readiness.launchBoundary?.blockers) ? readiness.launchBoundary.blockers : []) {
    if (typeof code === 'string' && code) gaps.push({ key: code, classification: 'LAUNCH_BOUNDARY_BLOCKER', blocking: true });
  }
  if (gaps.length === 0 && readiness.operationalReady !== true) {
    gaps.push({ key: 'UNEXPLAINED_NOT_READY', classification: 'UNCLASSIFIED_BLOCKER', blocking: true });
  }
  return { status: gaps.length ? 'BLOCKED' : 'NO_GAPS_IN_SUPPLIED_RESPONSE', blocking: gaps.length > 0,
    gaps, reason: gaps.length ? 'REQUIREMENTS_OR_LAUNCH_BOUNDARY_OPEN' : null };
}

module.exports = { diagnoseReadinessGaps };
