import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCatalog} from '../scripts/load-catalog.mjs';
import {connectorById} from './connector-registry.mjs';
import {createRegionalRoutePolicy,authorizeRegionalRoute} from './regional-route-authority.mjs';

function ifs(){
  const system=loadCatalog().systems.find(x=>x.id==='ifs-cloud');
  assert.ok(system,'IFS Cloud must remain in the effective catalog');
  return system;
}

test('IFS Cloud is promoted to spec-verified without write authority',()=>{
  const system=ifs();
  assert.equal(system.testLevel,'spec-verified');
  assert.equal(system.writeEnabled,false);
  assert.deepEqual(system.protocols,['REST','OData','OpenAPI']);
  assert.match(system.evidenceNote,/No sandbox or customer tenant was authenticated/i);
});

test('IFS service path keeps projection and data-scope controls explicit',()=>{
  const system=ifs();
  assert.match(system.auth,/client-credentials/i);
  assert.match(system.securityEvidenceBlockers.join('\n'),/Read Only projection/i);
  assert.match(system.securityEvidenceBlockers.join('\n'),/Data Access Control|data.*scope/i);
  assert.equal(system.governedReadProjection.mutationProjectionAllowed,false);
});

test('IFS source identity partitions global estates by instance company site region and projection',()=>{
  const dimensions=ifs().sourceScope.sourceIdentityDimensions;
  for(const dimension of ['instance','company','site','region','projection','apiVersion','dataset']) assert.ok(dimensions.includes(dimension),dimension);
});

test('connector registry exposes fail-closed regional routing defaults for IFS',()=>{
  const connector=connectorById('ifs-cloud');
  assert.equal(connector.regionalRouting.regionPinningRequired,true);
  assert.equal(connector.regionalRouting.crossBorderTransferAllowed,false);
  assert.equal(connector.regionalRouting.silentCrossRegionFailoverAllowed,false);
  assert.equal(connector.security.crossBorderTransferRequiresExplicitApproval,true);
  assert.equal(connector.security.dataResidencyOverrideAllowed,false);
});

test('tenant route cannot silently widen from exact IFS system host',()=>{
  const policy=createRegionalRoutePolicy({providerId:'ifs-cloud',routes:[{id:'uk-prod',region:'uk',dataLocation:'UK',endpointHosts:['customer.ifs.cloud']} ]});
  assert.equal(authorizeRegionalRoute({policy,routeId:'uk-prod',endpointUrl:'https://customer.ifs.cloud/main/ifsapplications/projection/v1/Example.svc'}).region,'uk');
  assert.throws(()=>authorizeRegionalRoute({policy,routeId:'uk-prod',endpointUrl:'https://other.ifs.cloud/main/ifsapplications/projection/v1/Example.svc'}),/not allowlisted/i);
});

test('IFS value mapping spans workforce production maintenance quality inventory and finance',()=>{
  const system=ifs();
  for(const target of ['person','skill','production-order','work-centre','labour-transaction-evidence','maintenance-request','non-conformance','inventory','purchase-order','finance-ledger-entry']){
    assert.ok(system.valueReview.wfmObjects.includes(target),target);
  }
  assert.match(system.valueReview.nextDevelopmentAction,/authorised IFS Cloud test tenant/i);
});
