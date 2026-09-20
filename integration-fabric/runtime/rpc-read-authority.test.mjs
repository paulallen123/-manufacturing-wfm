import test from 'node:test';
import assert from 'node:assert/strict';
import {createRpcReadPolicy,authorizeRpcRead,assessRpcReadBatch} from './rpc-read-authority.mjs';

const policy=createRpcReadPolicy({
  provider:'odoo',
  allowedPairs:[
    {model:'res.partner',method:'search_read',operationClass:'read'},
    {model:'res.partner',method:'read',operationClass:'read'},
    {model:'res.partner',method:'fields_get',operationClass:'read'}
  ],
  transportMethods:['POST'],
  transactionModel:'per-call',
  singleCallConsistentMethods:['search_read']
});

test('exact read-via-POST pair is authorised without treating POST as write authority',()=>{
  const result=authorizeRpcRead({policy,model:'res.partner',method:'search_read',httpMethod:'POST',fields:['id','name']});
  assert.equal(result.operationClass,'read');
  assert.equal(result.singleCallTransactionConsistent,true);
  assert.equal(result.transportVerbConfersWriteAuthority,false);
});

test('unknown and mutation/control RPC methods fail closed',()=>{
  assert.throws(()=>authorizeRpcRead({policy,model:'res.partner',method:'create',httpMethod:'POST'}),/mutation\/control method denied/);
  assert.throws(()=>authorizeRpcRead({policy,model:'res.partner',method:'action_confirm',httpMethod:'POST'}),/mutation\/control method denied/);
  assert.throws(()=>authorizeRpcRead({policy,model:'res.users.apikeys',method:'generate',httpMethod:'POST'}),/mutation\/control method denied/);
  assert.throws(()=>authorizeRpcRead({policy,model:'mrp.production',method:'search_read',httpMethod:'POST'}),/not allowlisted/);
});

test('wildcards and high-risk methods cannot be compiled into a read policy',()=>{
  assert.throws(()=>createRpcReadPolicy({provider:'x',allowedPairs:[{model:'*',method:'search_read',operationClass:'read'}]}),/wildcard/);
  assert.throws(()=>createRpcReadPolicy({provider:'x',allowedPairs:[{model:'res.partner',method:'write',operationClass:'read'}]}),/high-risk/);
});

test('compiled policy cannot be widened by mutating returned authority collections',()=>{
  const p=policy;
  assert.throws(()=>p.allowedPairKeys.push('res.users:search_read'),TypeError);
  assert.throws(()=>p.allowedPairs.push({model:'res.users',method:'search_read',operationClass:'read'}),TypeError);
  assert.throws(()=>p.transportMethods.push('GET'),TypeError);
  assert.throws(()=>p.singleCallConsistentMethods.push('read'),TypeError);
  assert.throws(()=>authorizeRpcRead({policy:p,model:'res.users',method:'search_read',httpMethod:'POST'}),/not allowlisted/);
});

test('credential-like fields are excluded from generic read projections',()=>{
  assert.throws(()=>authorizeRpcRead({policy,model:'res.partner',method:'search_read',fields:['name','api_key']}),/credential-like fields/);
});

test('separate provider transactions are preserved as a bounded observation window, not an atomic snapshot',()=>{
  const result=assessRpcReadBatch({policy,maxSkewMs:5000,calls:[
    {model:'res.partner',method:'search_read',startedAt:'2026-09-20T19:00:00.000Z',completedAt:'2026-09-20T19:00:01.000Z'},
    {model:'res.partner',method:'read',startedAt:'2026-09-20T19:00:02.000Z',completedAt:'2026-09-20T19:00:03.000Z'}
  ]});
  assert.equal(result.atomicAcrossCalls,false);
  assert.equal(result.consistency,'bounded-observation-window');
  assert.equal(result.requiresProvenanceWindow,true);
  assert.equal(result.safeForBoundedTemporalJoin,true);
});

test('large skew or partial reads block bounded temporal joins',()=>{
  const skew=assessRpcReadBatch({policy,maxSkewMs:1000,calls:[
    {model:'res.partner',method:'search_read',startedAt:'2026-09-20T19:00:00Z',completedAt:'2026-09-20T19:00:00.500Z'},
    {model:'res.partner',method:'read',startedAt:'2026-09-20T19:00:03Z',completedAt:'2026-09-20T19:00:04Z'}
  ]});
  assert.equal(skew.consistency,'skew-exceeded');
  assert.equal(skew.safeForBoundedTemporalJoin,false);

  const partial=assessRpcReadBatch({policy,maxSkewMs:5000,calls:[
    {model:'res.partner',method:'search_read',startedAt:'2026-09-20T19:00:00Z',completedAt:'2026-09-20T19:00:01Z',partial:true}
  ]});
  assert.equal(partial.consistency,'partial-read-set');
  assert.equal(partial.safeForAtomicJoin,false);
  assert.equal(partial.safeForBoundedTemporalJoin,false);
});
