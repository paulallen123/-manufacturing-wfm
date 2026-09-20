import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAgencySupplierEligibility } from '../../src/frontier/agency-supplier-compliance.mjs';

const NOW = '2026-09-18T12:00:00.000Z';
const REQUEST = {
  endAt: '2026-09-21T14:00:00.000Z',
  fairWorkAgencyGangmasterLicenceRequired: true,
};

function fwaLicence(overrides = {}) {
  return {
    status: 'licensed',
    evidenceRef: 'fwa-register-snapshot:2026-09-18:A1',
    providerReference: 'FWA-A1',
    checkedAt: '2026-09-18T09:00:00.000Z',
    authorisedPersonConfirmed: true,
    ...overrides,
  };
}

function agency(overrides = {}) {
  return {
    agencyId: 'A1',
    approved: true,
    active: true,
    fairWorkAgencyGangmasterLicence: fwaLicence(),
    ...overrides,
  };
}

test('approved active supplier is eligible when the request does not require a gangmaster licence', () => {
  const result = evaluateAgencySupplierEligibility(
    { agencyId: 'A1', approved: true, active: true },
    { fairWorkAgencyGangmasterLicenceRequired: false },
    { now: NOW },
  );
  assert.equal(result.eligible, true);
  assert.equal(result.evidence.licenceRequired, false);
});

test('fresh FWA licence evidence is accepted and preserved as audit evidence', () => {
  const result = evaluateAgencySupplierEligibility(agency(), REQUEST, { now: NOW });
  assert.equal(result.eligible, true);
  assert.equal(result.evidence.primaryLicence.status, 'licensed');
  assert.equal(result.evidence.primaryLicence.evidenceRef, 'fwa-register-snapshot:2026-09-18:A1');
  assert.ok(result.evidence.primaryLicence.checkAgeDays < 1);
});

test('legacy boolean-only GLAA evidence fails closed because licence freshness cannot be proved', () => {
  const result = evaluateAgencySupplierEligibility(
    { agencyId: 'A1', approved: true, active: true, glaaLicenceValid: true },
    { ...REQUEST, fairWorkAgencyGangmasterLicenceRequired: false, glaaLicenceRequired: true },
    { now: NOW },
  );
  assert.equal(result.eligible, false);
  assert.ok(result.failures.includes('fwa_gangmaster_licence_evidence_ref_missing'));
  assert.ok(result.failures.includes('fwa_gangmaster_licence_check_time_missing'));
  assert.ok(result.warnings.includes('legacy_glaa_evidence_field_names_migrate_to_fwa'));
});

test('a licence check older than three calendar months is rejected', () => {
  const result = evaluateAgencySupplierEligibility(
    agency({ fairWorkAgencyGangmasterLicence: fwaLicence({ checkedAt: '2026-06-17T12:00:00.000Z' }) }),
    REQUEST,
    { now: NOW },
  );
  assert.equal(result.eligible, false);
  assert.ok(result.failures.includes('fwa_gangmaster_licence_check_stale'));
});

test('a covered supplier with an unverified subcontractor is rejected before ranking', () => {
  const result = evaluateAgencySupplierEligibility(
    agency({
      subcontractors: [{
        agencyId: 'SUB-1', approved: true, active: true,
        fairWorkAgencyGangmasterLicence: fwaLicence({ status: 'not_verified', evidenceRef: 'fwa-register-snapshot:SUB-1' }),
      }],
    }),
    REQUEST,
    { now: NOW },
  );
  assert.equal(result.eligible, false);
  assert.ok(result.failures.includes('subcontractor:SUB-1:fwa_gangmaster_licence_not_verified'));
  assert.equal(result.evidence.subcontractorCount, 1);
});

test('contract negotiation fails closed unless the FWA authorised person check is confirmed', () => {
  const result = evaluateAgencySupplierEligibility(
    agency({ fairWorkAgencyGangmasterLicence: fwaLicence({ authorisedPersonConfirmed: false }) }),
    { ...REQUEST, supplierContractNegotiation: true },
    { now: NOW },
  );
  assert.equal(result.eligible, false);
  assert.ok(result.failures.includes('fwa_authorised_person_not_confirmed'));
});

test('licence validity cannot expire before the assignment ends', () => {
  const result = evaluateAgencySupplierEligibility(
    agency({ fairWorkAgencyGangmasterLicence: fwaLicence({ validUntil: '2026-09-20T23:59:59.000Z' }) }),
    REQUEST,
    { now: NOW },
  );
  assert.equal(result.eligible, false);
  assert.ok(result.failures.includes('fwa_gangmaster_licence_expires_before_assignment_end'));
});
