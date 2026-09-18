import assert from 'node:assert/strict';
import {
  buildAgencyDemandEnvelope,
  normaliseCapacityResponse,
  normaliseWorkerNominations,
  ingestNominationRows,
  deduplicateGatewayEvents,
  assessAgencyGatewayReadiness
} from './gateway.mjs';

const pack = {
  packId: 'H1:S1:PACKER',
  versionHash: 'a'.repeat(64),
  complete: true,
  canonical: { site: { id: 'S1' } }
};
const requirement = {
  id: 'REQ-100', role: 'PACKER', headcount: 4, siteId: 'S1',
  shiftStart: '2026-09-18T22:00:00Z', shiftEnd: '2026-09-19T06:00:00Z'
};
const supplier = { id: 'AGENCY-A', billRate: 19.5 };

const demand = buildAgencyDemandEnvelope({ requirement, pack, supplier, issuedAt: '2026-09-18T14:00:00Z' });
assert.equal(demand.workerDataIncluded, false);
assert.equal(demand.headcount, 4);
assert.equal(demand.packRef.versionHash, pack.versionHash);

const partial = normaliseCapacityResponse({
  demand,
  response: { status: 'PARTIAL', acceptedHeadcount: 2, externalResponseId: 'RESP-1', source: 'api', respondedAt: '2026-09-18T14:01:00Z' }
});
assert.equal(partial.acceptedHeadcount, 2);
assert.equal(partial.remainingHeadcount, 2);
assert.equal(partial.idempotencyKey, 'capacity:AGENCY-A:RESP-1');

assert.throws(() => normaliseCapacityResponse({ demand, response: { status: 'ACCEPTED', acceptedHeadcount: 3 } }), /ACCEPTED must cover/);

const nominations = normaliseWorkerNominations({
  demand,
  packVersionHash: pack.versionHash,
  nominations: [
    { externalNominationId: 'N1', supplierWorkerId: 'W1', displayName: 'Worker One', sharingAuthorityConfirmed: true, availabilityConfirmed: true, mandatoryCompliancePassed: true, roleSkills: ['PACKER'] },
    { externalNominationId: 'N2', supplierWorkerId: 'W2', displayName: 'Worker Two', sharingAuthorityConfirmed: true, availabilityConfirmed: true, mandatoryCompliancePassed: true },
    { externalNominationId: 'N3', supplierWorkerId: 'W3', sharingAuthorityConfirmed: false, availabilityConfirmed: true, mandatoryCompliancePassed: true },
    { externalNominationId: 'N4', supplierWorkerId: 'W4', sharingAuthorityConfirmed: true, availabilityConfirmed: true, mandatoryCompliancePassed: true, rawIdentityDocument: 'base64-should-not-be-here' }
  ]
});
assert.equal(nominations.acceptedCount, 2);
assert.equal(nominations.rejectedCount, 2);
assert(nominations.rejected.some(r => r.gaps.includes('SHARING_AUTHORITY_NOT_CONFIRMED')));
assert(nominations.rejected.some(r => r.gaps.includes('PROHIBITED_EXCESS_DATA_INCLUDED')));

const csv = ingestNominationRows({
  demand,
  packVersionHash: pack.versionHash,
  rows: [
    { nomination_id: 'CSV1', worker_id: 'W5', worker_name: 'Worker Five', sharing_authority: 'yes', available: 'yes', compliance_passed: 'yes', skills: 'PACKER|LABEL' }
  ]
});
assert.equal(csv.acceptedCount, 1);
assert.equal(csv.accepted[0].source, 'CSV');
assert.deepEqual(csv.accepted[0].roleSkills, ['PACKER', 'LABEL']);

const replay = deduplicateGatewayEvents([partial, partial]);
assert.equal(replay.accepted.length, 1);
assert.equal(replay.duplicates.length, 1);
assert.equal(replay.safeToProcess, true);

const conflict = deduplicateGatewayEvents([
  partial,
  { ...partial, payloadHash: 'different-hash' }
]);
assert.equal(conflict.conflicts.length, 1);
assert.equal(conflict.safeToProcess, false);

const apiReady = assessAgencyGatewayReadiness({ id: 'AGENCY-A', apiEnabled: true, externalSystemName: 'Bullhorn', credentialsConfigured: true });
assert.equal(apiReady.touchlessChannelAvailable, true);
assert.equal(apiReady.fallbackChannelAvailable, true);

const portalOnly = assessAgencyGatewayReadiness({ id: 'AGENCY-B', apiEnabled: false, portalEnabled: true, csvEnabled: true });
assert.equal(portalOnly.touchlessChannelAvailable, false);
assert.equal(portalOnly.fallbackChannelAvailable, true);
assert.equal(portalOnly.action, 'READY_FOR_DEMAND');

console.log('gateway tests: 10/10 passed');
