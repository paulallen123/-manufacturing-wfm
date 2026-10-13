import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCashToCapacityEvidenceBundle} from '../../src/frontier/cash-to-capacity-evidence.mjs';

const context={tenantId:'t1',siteId:'s1',legalEntityId:'le1',currency:'GBP'};
const now='2026-09-20T16:00:00Z';
const base=(extra={})=>({authoritative:true,tenantId:'t1',provider:'source',revision:'r1',ref:'ref:1',observedAt:'2026-09-20T15:55:00Z',...extra});
const sources={
 productionPlan:base({siteId:'s1'}),
 workforceEligibility:base({siteId:'s1'}),
 customerCommitment:base({legalEntityId:'le1'}),
 financialMilestone:base({legalEntityId:'le1',currency:'GBP'})
};

test('builds one scoped evidence bundle across MES WFM ERP and finance',()=>{
 const r=buildCashToCapacityEvidenceBundle({context,sources,now});
 assert.equal(r.status,'accepted');
 assert.equal(r.evidence.productionPlan.ageMinutes,5);
});

test('cross-tenant or cross-site evidence fails closed',()=>{
 const tenant=structuredClone(sources);tenant.workforceEligibility.tenantId='other';
 assert.equal(buildCashToCapacityEvidenceBundle({context,sources:tenant,now}).reason,'tenant_scope_mismatch');
 const site=structuredClone(sources);site.productionPlan.siteId='other';
 assert.equal(buildCashToCapacityEvidenceBundle({context,sources:site,now}).reason,'site_scope_mismatch');
});

test('finance evidence cannot cross legal entities or currencies silently',()=>{
 const entity=structuredClone(sources);entity.financialMilestone.legalEntityId='le2';
 assert.equal(buildCashToCapacityEvidenceBundle({context,sources:entity,now}).reason,'legal_entity_scope_mismatch');
 const fx=structuredClone(sources);fx.financialMilestone.currency='EUR';
 assert.equal(buildCashToCapacityEvidenceBundle({context,sources:fx,now}).reason,'currency_scope_mismatch');
});

test('non-authoritative or provenance-free source cannot feed a decision',()=>{
 const non=structuredClone(sources);non.customerCommitment.authoritative=false;
 assert.equal(buildCashToCapacityEvidenceBundle({context,sources:non,now}).reason,'missing_authoritative_source');
 const noRev=structuredClone(sources);noRev.productionPlan.revision='';
 assert.equal(buildCashToCapacityEvidenceBundle({context,sources:noRev,now}).reason,'missing_source_provenance');
});

test('impossible or ambiguous source instants and invalid owner clock cannot appear fresh',()=>{
 for(const value of ['2026-02-30T15:55:00Z','2026-09-20T15:55:00','2026-09-20','2026-09-20T15:55:00+00:00']){
  const invalid=structuredClone(sources);invalid.productionPlan.observedAt=value;
  assert.deepEqual(buildCashToCapacityEvidenceBundle({context,sources:invalid,now}),
   {status:'rejected',reason:'invalid_source_time',type:'productionPlan'});
 }
 assert.equal(buildCashToCapacityEvidenceBundle({context,sources,now:'2026-02-30T16:00:00Z'}).reason,'invalid_source_time');
 const millis=structuredClone(sources);millis.productionPlan.observedAt='2026-09-20T15:55:00.000Z';
 assert.equal(buildCashToCapacityEvidenceBundle({context,sources:millis,now}).status,'accepted');
});
