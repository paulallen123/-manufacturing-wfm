import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createAgencyRightToWorkAssuranceVersion} from '../../src/frontier/agency-right-to-work-assurance-ledger.mjs';

function input(validUntil){
  const request={roleId:'PACK',location:'Synthetic site',startAt:'2026-10-05T06:00:00Z',endAt:'2026-10-05T14:00:00Z'};
  const rightToWork={status:'verified',indefinite:false,validUntil,engagementType:'workers_contract',employmentCommencedAt:'2026-10-02T09:00:00Z',
    checkedByAgencyId:'A1',checkMethod:'home_office_online',checkedAt:'2026-10-04T10:30:00Z',evidenceRef:'SYNTHETIC-EVIDENCE',assignmentScope:{...request,restrictionsSatisfied:true}};
  const acceptedRefresh={accepted:true,receipt:{refreshRecorded:true,eligibleAfterRefresh:true,tenantId:'T1',siteId:'S1',requestId:'R1',agencyId:'A1',workerId:'W1',
    assignmentFingerprint:'c'.repeat(24),evidenceFingerprint:crypto.createHash('sha256').update(rightToWork.evidenceRef).digest('hex').slice(0,24),checkMethod:rightToWork.checkMethod,checkedAt:rightToWork.checkedAt}};
  return {acceptedRefresh,rightToWork,request,agency:{agencyId:'A1',rightToWorkScheme:{arrangement:'employment_business_supply_to_hirer_own_operations',responsibleParty:'employment_business'}},now:'2026-10-04T12:00:00Z'};
}
test('real assurance producer cannot publish a rolled impossible ISO expiry',()=>{
  for(const date of ['2027-02-30T12:00:00.000Z','2027-04-31T12:00:00Z','2027-02-29','2027-02-30T12:00:00+01:00']){
    const args=input(date),before=structuredClone(args);
    const result=createAgencyRightToWorkAssuranceVersion(args);
    assert.equal(result.valid,false,JSON.stringify(result.version));assert.equal(result.version,null);
    assert.deepEqual(args,before);
  }
});
test('real producer retains valid leap-day, date-only and explicit-offset coverage',()=>{
  for(const date of ['2028-02-29T12:00:00.000Z','2027-02-28','2027-02-28T12:00:00+01:00']){
    const result=createAgencyRightToWorkAssuranceVersion(input(date));
    assert.equal(result.valid,true);assert.equal(result.version.coverageUntil,new Date(Date.parse(date)).toISOString());
  }
});
