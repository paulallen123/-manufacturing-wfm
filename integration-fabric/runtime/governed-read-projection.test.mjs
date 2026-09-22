import test from 'node:test';
import assert from 'node:assert/strict';
import {createGovernedProjectionPolicy,authorizeGovernedProjectionRead,assessProjectionPageChain} from './governed-read-projection.mjs';

function policy(){
  return createGovernedProjectionPolicy({provider:'epicor-kinetic',projections:[{
    id:'WFM_ProductionRead_v1',kind:'baq',providerReadOnlySemantics:true,
    allowedParameters:['company','site','modifiedSince'],
    allowedFields:['Company','Plant','JobNum','OprSeq','ResourceGrpID','EmployeeNum','LaborHrs','QtyCompleted','ScrapQty','LastUpdated'],
    stableIdFields:['Company','JobNum','OprSeq'],scopeFields:['Company','Plant'],pageMode:'odata',deltaFields:['LastUpdated'],datasetKind:'incremental-delta'
  }]});
}

test('governed projection is exact and immutable',()=>{
  const p=policy();
  assert.equal(p.arbitraryQueryAllowed,false);
  assert.equal(Object.isFrozen(p.projections),true);
  assert.equal(Object.isFrozen(p.projections[0].allowedFields),true);
  assert.throws(()=>createGovernedProjectionPolicy({provider:'x',projections:[{id:'*',providerReadOnlySemantics:true}]}),/exact/);
  assert.throws(()=>createGovernedProjectionPolicy({provider:'x',projections:[{id:'q'}]}),/read-only semantics/);
});

test('only reviewed parameters and fields are accepted',()=>{
  const read=authorizeGovernedProjectionRead({policy:policy(),projectionId:'WFM_ProductionRead_v1',parameters:{company:'MFG',site:'UK01'},fields:['JobNum','LaborHrs']});
  assert.equal(read.mutationAllowed,false);
  assert.equal(read.directSqlAllowed,false);
  assert.throws(()=>authorizeGovernedProjectionRead({policy:policy(),projectionId:'WFM_ProductionRead_v1',parameters:{where:'1=1'}}),/not allowlisted/);
  assert.throws(()=>authorizeGovernedProjectionRead({policy:policy(),projectionId:'WFM_ProductionRead_v1',fields:['AccessToken']}),/sensitive/);
});

test('arbitrary or unknown projections are denied',()=>{
  assert.throws(()=>authorizeGovernedProjectionRead({policy:policy(),projectionId:'DynamicQuery'}),/not allowlisted/);
});

test('pagination gaps and duplicates fail closed',()=>{
  assert.throws(()=>assessProjectionPageChain({pages:[{ordinal:0,pageId:'a'},{ordinal:2,pageId:'c'}],finalPageReached:true}),/gap/);
  assert.throws(()=>assessProjectionPageChain({pages:[{ordinal:0,pageId:'a'},{ordinal:1,pageId:'a'}],finalPageReached:true}),/duplicate/);
});

test('complete page chain alone cannot infer deletions from an incremental projection',()=>{
  const result=assessProjectionPageChain({pages:[{ordinal:0,pageId:'a'},{ordinal:1,pageId:'b'}],finalPageReached:true,scopeProven:true,reconciliationComplete:true,datasetKind:'incremental-delta',authoritativeForExistence:false});
  assert.equal(result.checkpointMayAdvance,true);
  assert.equal(result.canInferAbsence,false);
  assert.equal(result.missingRecordDisposition,'do-not-delete');
});

test('absence inference requires full scope, completeness and reconciliation',()=>{
  const result=assessProjectionPageChain({pages:[{ordinal:0,pageId:'a'}],finalPageReached:true,scopeProven:true,reconciliationComplete:true,datasetKind:'complete-snapshot',authoritativeForExistence:true});
  assert.equal(result.canInferAbsence,true);
  assert.equal(result.missingRecordDisposition,'tombstone-candidate');
});
