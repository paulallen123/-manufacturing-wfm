import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCatalog} from '../scripts/load-catalog.mjs';
import {createRpcReadPolicy,authorizeRpcRead,assessRpcReadBatch} from './rpc-read-authority.mjs';

function odoo(){
  const system=loadCatalog().systems.find(x=>x.id==='odoo');
  assert.ok(system,'Odoo must remain in the effective catalog');
  return system;
}

test('Odoo is promoted to spec-verified with JSON-2 primary and legacy RPC migration-only',()=>{
  const system=odoo();
  assert.equal(system.testLevel,'spec-verified');
  assert.equal(system.writeEnabled,false);
  assert.ok(system.protocols.includes('JSON-2'));
  assert.ok(system.protocols.includes('JSON-RPC'));
  assert.ok(system.protocols.includes('XML-RPC'));
  assert.equal(system.apiVersionRouting.preferredVersion,'json-2-v19+');
  assert.equal(system.apiVersionRouting.fallbackVersion,'legacy-rpc-migration-only');
  assert.equal(system.deploymentVariants.legacyPre19OrMigration.migrationOnly,true);
});

test('Odoo deployment/source scopes distinguish hosted databases from private on-prem hosts',()=>{
  const system=odoo();
  assert.deepEqual(system.sourceScope.requiredDimensionsByVariant.odooOnline19Plus,['database']);
  assert.deepEqual(system.sourceScope.requiredDimensionsByVariant.onPrem19Plus,['host','database']);
  assert.equal(system.deploymentVariants.odooOnline19Plus.customerEdgeRequired,false);
  assert.equal(system.deploymentVariants.onPrem19Plus.customerEdgeRequired,true);
  assert.equal(system.deploymentVariants.onPrem19Plus.directCloudToPrivateNetworkAllowed,false);
});

test('Odoo evidence blockers pin method authority, bot permissions, cross-call consistency and credential rotation',()=>{
  const blockers=odoo().securityEvidenceBlockers.join('\n');
  assert.match(blockers,/POST.*reads.*mutating/i);
  assert.match(blockers,/access rights.*record rules.*field access/i);
  assert.match(blockers,/own SQL transaction/i);
  assert.match(blockers,/three months/i);
  assert.match(blockers,/Legacy XML-RPC\/JSON-RPC/i);
});

test('Odoo JSON-2 read-via-POST is exact-pair authorised and mutation methods remain denied',()=>{
  const policy=createRpcReadPolicy({
    provider:'odoo',
    allowedPairs:[
      {model:'res.partner',method:'search_read',operationClass:'read'},
      {model:'mrp.production',method:'search_read',operationClass:'read'}
    ],
    transactionModel:'per-call',
    singleCallConsistentMethods:['search_read']
  });
  const read=authorizeRpcRead({policy,model:'res.partner',method:'search_read',httpMethod:'POST',fields:['id','name']});
  assert.equal(read.operationClass,'read');
  assert.equal(read.transportVerbConfersWriteAuthority,false);
  assert.throws(()=>authorizeRpcRead({policy,model:'res.partner',method:'create',httpMethod:'POST'}),/mutation\/control method denied/i);
  assert.throws(()=>authorizeRpcRead({policy,model:'res.users.apikeys',method:'generate',httpMethod:'POST'}),/mutation\/control method denied/i);
});

test('separate Odoo model reads become an observation window, never an atomic snapshot',()=>{
  const policy=createRpcReadPolicy({
    provider:'odoo',
    allowedPairs:[
      {model:'hr.attendance',method:'search_read',operationClass:'read'},
      {model:'mrp.production',method:'search_read',operationClass:'read'}
    ],
    transactionModel:'per-call'
  });
  const assessment=assessRpcReadBatch({policy,maxSkewMs:5000,calls:[
    {model:'hr.attendance',method:'search_read',startedAt:'2026-09-20T19:00:00.000Z',completedAt:'2026-09-20T19:00:00.500Z'},
    {model:'mrp.production',method:'search_read',startedAt:'2026-09-20T19:00:01.000Z',completedAt:'2026-09-20T19:00:01.600Z'}
  ]});
  assert.equal(assessment.atomicAcrossCalls,false);
  assert.equal(assessment.consistency,'bounded-observation-window');
  assert.equal(assessment.requiresProvenanceWindow,true);
});

test('Odoo value mapping spans workforce and manufacturing domains without claiming a live connection',()=>{
  const system=odoo();
  for(const target of ['shift','attendance','work-centre','production-order','maintenance-request','quality-check','inventory','finance-ledger-entry']){
    assert.ok(system.valueReview.wfmObjects.includes(target),target);
  }
  assert.match(system.valueReview.nextDevelopmentAction,/authorised Odoo 19 Custom-plan sandbox\/test database/i);
  assert.match(system.evidenceNote,/No sandbox or tenant was authenticated/i);
});
