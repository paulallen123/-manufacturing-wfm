'use strict';

/**
 * Pure constructor, NOT an authentication, authorisation or provisioning service.
 * Call only from a trusted server boundary after validating users.person_id,
 * tenant ownership and the supplied organisation facts against authoritative data.
 * Never expose authorize or authority as request-controlled approval switches.
 * authorize receives a frozen copy of the exact validated input and must synchronously
 * return true after checking its external authority reference. Nothing here creates
 * users, workforce membership, personnel_links, roles, invitations or approval proof.
 * Missing owner/org authority is a setup-only case for the caller, not seed fallback.
 */
function object(value, keys, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !keys.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
      })) {
    throw new TypeError('Invalid ' + label);
  }
}
function text(value, label, max = 180) {
  if (typeof value !== 'string' || !value.length || value.length > max ||
      value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError('Required ' + label);
  }
  return value;
}
function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}

function createCleanCustomerState(input, { authorize } = {}) {
  object(input, ['tenant', 'owner', 'organisation', 'authority'], 'input');
  object(input.owner, ['tenant', 'person_id'], 'owner');
  object(input.organisation, ['tenant', 'ownerAnchor'], 'organisation');
  object(input.organisation.ownerAnchor, ['id', 'parent', 'name', 'label', 'role'], 'owner anchor');
  object(input.authority, ['tenant', 'person_id', 'purpose', 'reference'], 'authority');
  const tenant = text(input.tenant, 'tenant', 100);
  const personId = text(input.owner.person_id, 'canonical users.person_id', 100);
  // The pinned org renderer interpolates ids into HTML attributes without escaping.
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(personId)) {
    throw new TypeError('Canonical users.person_id is not safe for the pinned organisation reader');
  }
  const anchor = input.organisation.ownerAnchor;
  text(anchor.id, 'anchor id', 100);
  text(anchor.name, 'authorised owner display name');
  text(anchor.label, 'authorised organisation label');
  if (Object.hasOwn(anchor, 'role')) text(anchor.role, 'supplied organisation title');
  text(input.authority.reference, 'external authority reference', 300);
  if (input.owner.tenant !== tenant || input.organisation.tenant !== tenant ||
      input.authority.tenant !== tenant || input.authority.person_id !== personId ||
      anchor.id !== personId || anchor.parent !== null ||
      input.authority.purpose !== 'construct-clean-customer-state') {
    throw new Error('Tenant, canonical owner and explicit root-anchor authority must match');
  }
  const validated = freeze(structuredClone(input));
  if (typeof authorize !== 'function' || authorize(validated) !== true) {
    throw new Error('Externally validated owner/organisation authority required');
  }
  const org = [structuredClone(validated.organisation.ownerAnchor)];
  return {
    version: 1, org, staff: [], requests: [], audit: [], shifts: {},
    availability: [], offers: [], assignments: [], gaps: [], profiles: {}, history: [],
    costing: { schema: 3, rates: {}, policies: {}, employeePolicies: {}, ledger: [],
      weekEvidence: {}, imports: [], budgets: {}, calendar: null, demandHistory: [], historySource: null },
    payrollControl: { version: 1, periods: [], audit: [], adjustments: [], adjustmentBatches: [] },
    workRules: { revision: 1, checkedAt: null, contracts: {}, templates: [], patterns: [],
      premiums: [], leaveRules: [], jobs: [], roster: [], absences: [], annualOpening: {}, leaveBalances: {}, audit: [] },
    demandPlanning: { schema: 6, revision: 1, source: null, products: [], records: [], performance: [],
      batches: [], audit: [], actions: [], receipts: [], costBenchmarks: {}, shareAggregates: false,
      minCohort: null, benchmark: null, market: [] },
    operations: { schema: 1, revision: 1, preferences: {}, leaveOpenings: {}, breakRules: [],
      siteAccess: {}, swaps: [], notices: [], receipts: [], travelMinutes: {}, audit: [] },
    readiness: { schemaVersion: 1, requirements: [], runs: [], receipts: [] },
    schedulePublication: { schemaVersion: 1, drafts: [], publications: [], notifications: [],
      receipts: [], audit: [], acknowledgements: [] },
    onboarding: { schemaVersion: 1, batches: [], people: [], receipts: [], audit: [] },
    orgAdmin: { schema: 1, revision: 1, baseOrg: structuredClone(org), changes: [], receipts: [] },
    availabilityControl: { schema: 1, revision: 0, records: [], audit: [] },
    attendanceCorrections: { requests: [], notifications: [], receipts: [] },
    economicCosting: { schema: 1, revision: 1, entries: [], audit: [] },
    manufacturingContext: { schema: 2, revision: 1, events: [], lossClaims: [], watermarks: [], reconciliations: [], audit: [] },
    manufacturingScenarios: { schema: 1, revision: 1, runs: [], receipts: [], audit: [] },
    resources: { schema: 1, revision: 1, agencies: [], workers: [], placements: [], time: [],
      shutdowns: [], exports: [], notices: [], audit: [], receipts: [] },
    recommendations: { schema: 1, plans: [], audit: [] },
    valueCockpit: { schema: 1, revision: 1, decisions: [], audit: [] },
    // Unknown policies: suppress decorator defaults without claiming approval.
    // Callers must gate these readers pending genuine reviewed settings.
    timeReview: { schema: 1, revision: 1, thresholds: null, active: {}, decisions: [], receipts: [], audit: [] },
    overtimeWatch: { version: 1, revision: 0, settings: {
      enabled: null, minimumHistory: null, lookbackWeeks: null, minimumExcessMinutes: null,
      relativeIncrease: null, modifiedZThreshold: null, lateClockMinutes: null
    }, reviews: [] }
  };
}

module.exports = { createCleanCustomerState };
