import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCatalog} from '../scripts/load-catalog.mjs';
import {createGovernedProjectionPolicy,authorizeGovernedProjectionRead,assessProjectionPageChain} from './governed-read-projection.mjs';

function epicor(){
  const system=loadCatalog().systems.find(x=>x.id==='epicor-kinetic');
  assert.ok(system,'Epicor Kinetic must remain in the effective catalog');
  return system;
}

test('Epicor Kinetic is promoted to spec-verified without write authority',()=>{
  const system=epicor();
  assert.equal(system.testLevel,'spec-verified');
  assert.equal(system.writeEnabled,false);
  assert.ok(system.protocols.includes('REST'));
  assert.ok(system.protocols.includes('OData'));
  assert.ok(system.protocols.includes('OpenAPI'));
  assert.match(system.evidenceNote,/No sandbox or customer tenant was authenticated/i);
});

test('Epicor deployment variants keep private instances behind customer edge',()=>{
  const system=epicor();
  assert.equal(system.deploymentVariants.epicorCloud.customerEdgeRequired,false);
  assert.equal(system.deploymentVariants.onPremises.customerEdgeRequired,true);
  assert.equal(system.deploymentVariants.onPremises.directCloudToPrivateNetworkAllowed,false);
  assert.equal(system.deploymentVariants.hybrid.customerEdgeRequired,true);
  assert.deepEqual(system.sourceScope.requiredDimensions,['instance']);
});

test('Epicor evidence blockers pin full-service mutation risk and tenant-specific contracts',()=>{
  const blockers=epicor().securityEvidenceBlockers.join('\n');
  assert.match(blockers,/processes.*Functions/i);
  assert.match(blockers,/exact read-only service\/projection authority/i);
  assert.match(blockers,/pagination.*rate-limit.*webhook/i);
  assert.match(blockers,/customer-edge/i);
});

test('governed BAQ projection cannot widen to arbitrary queries or fields',()=>{
  const policy=createGovernedProjectionPolicy({provider:'epicor-kinetic',projections:[{
    id:'WFM_ProductionRead_v1',kind:'baq',providerReadOnlySemantics:true,
    allowedParameters:['company','site','modifiedSince'],
    allowedFields:['Company','Plant','JobNum','OprSeq','LaborHrs','QtyCompleted','ScrapQty','LastUpdated'],
    stableIdFields:['Company','JobNum','OprSeq'],scopeFields:['Company','Plant'],datasetKind:'incremental-delta'
  }]});
  const read=authorizeGovernedProjectionRead({policy,projectionId:'WFM_ProductionRead_v1',parameters:{company:'MFG',site:'UK01'},fields:['JobNum','LaborHrs']});
  assert.equal(read.mutationAllowed,false);
  assert.equal(read.directSqlAllowed,false);
  assert.throws(()=>authorizeGovernedProjectionRead({policy,projectionId:'DynamicQuery'}),/not allowlisted/);
  assert.throws(()=>authorizeGovernedProjectionRead({policy,projectionId:'WFM_ProductionRead_v1',fields:['Password']}),/sensitive/);
});

test('Epicor incremental projection paging cannot imply deletion',()=>{
  const result=assessProjectionPageChain({pages:[{ordinal:0,pageId:'0'},{ordinal:1,pageId:'1'}],finalPageReached:true,scopeProven:true,reconciliationComplete:true,datasetKind:'incremental-delta',authoritativeForExistence:false});
  assert.equal(result.checkpointMayAdvance,true);
  assert.equal(result.canInferAbsence,false);
  assert.equal(result.missingRecordDisposition,'do-not-delete');
});

test('Epicor value mapping spans production, labour, material, quality, maintenance and finance without live claims',()=>{
  const system=epicor();
  for(const target of ['production-order','operation','work-centre','labour-transaction-evidence','maintenance-request','non-conformance','inventory','finance-ledger-entry']){
    assert.ok(system.valueReview.wfmObjects.includes(target),target);
  }
  assert.match(system.valueReview.nextDevelopmentAction,/authorised Epicor Kinetic test environment/i);
});
