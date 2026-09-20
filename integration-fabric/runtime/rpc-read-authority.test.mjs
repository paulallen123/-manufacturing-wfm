import test from 'node:test';
import assert from 'node:assert/strict';
import {createRpcReadPolicy,authorizeRpcRead,assessRpcReadBatch} from './rpc-read-authority.mjs';

const policy=()=>createRpcReadPolicy({
  provider:'odoo',
  allowedPairs:[
    {model:'res.partner',method:'search_read',operationClass:'read'},
    {model:'hr.attendance',method:'search_read',operationClass:'read'},
    {model:'mrp.production',method:'search_read',operationClass:'read'}
  ],
  transactionModel:'per-call',
  singleCallConsistentMethods:['search_read']
});

test('exact read-via-POST pair is authorised without treating POST as write authority',()=>{
  const result=authorizeRpcRead({policy:policy(),model:'res.partner',method:'search_read',httpMethod:'POST',fields:['id','name']});
  assert.equal(result.operationClass,'read');
  assert.equal(result.singleCallTransactionConsistent,true);
  assert.equal(result.transportVerbConfersWriteAuthority,false);
});

test('unknown and mutation/control RPC methods fail closed',()=>{
  const p=policy();
  assert.throws(()=>authorizeRpcRead({policy:p,model:'res.partner',method:'create',httpMethod:'POST'}),/mutation\/control method denied/);
  assert.throws(()=>authorizeRpcRead({policy:p,model:'res.users.apikeys',method:'generate',httpMethod:'POST'}),/mutation\/control method denied/);
  assert.throws(()=>authorizeRpcRead({policy:p,model:'res.users',method:'search_read',httpMethod:'POST'}),/not allowlisted/);
});

test('wildcards and high-risk methods cannot be compiled into a read policy',()=>{
  assert.throws(()=>createRpcReadPolicy({provider:'x',allowedPairs:[{model:'*',method:'search_read',operationClass:'read'}]}),/wildcard/);
  assert.throws(()=>createRpcReadPolicy({provider:'x',allowedPairs:[{model:'res.partner',method:'write',operationClass:'read'}]}),/high-risk/);
});

test('credential-like fields are excluded from generic read projections',()=>{
  const p=policy();
  assert.throws(()=>authorizeRpcRead({policy:p,model:'res.partner',method:'search_read',fields:['id','api_key']}),/credential-like fields/);
  assert.throws(()=>authorizeRpcRead({policy:p,model:'res.partner',method:'search_read',fields:['password_hash']}),/credential-like fields/);
});

test('separate provider transactions are preserved as a bounded observation window, not an atomic snapshot',()=>{
  const result=assessRpcReadBatch({policy:policy(),maxSkewMs:5000,calls:[
    {model:'hr.attendance',method:'search_read',startedAt:'2026-09-20T12:00:00.000Z',completedAt:'2026-09-20T12:00:00.500Z'},
    {model:'mrp.production',method:'search_read',startedAt:'2026-09-20T12:00:01.000Z',completedAt:'2026-09-20T12:00:01.500Z'}
  ]});
  assert.equal(result.atomicAcrossCalls,false);
  assert.equal(result.consistency,'bounded-observation-window');
  assert.equal(result.safeForAtomicJoin,false);
  assert.equal(result.safeForBoundedTemporalJoin,true);
  assert.equal(result.requiresProvenanceWindow,true);
});

test('large skew or partial reads block bounded temporal joins',()=>{
  const p=policy();
  const skew=assessRpcReadBatch({policy:p,maxSkewMs:1000,calls:[
    {model:'hr.attendance',method:'search_read',startedAt:'2026-09-20T12:00:00Z',completedAt:'2026-09-20T12:00:00.100Z'},
    {model:'mrp.production',method:'search_read',startedAt:'2026-09-20T12:00:03Z',completedAt:'2026-09-20T12:00:03.100Z'}
  ]});
  assert.equal(skew.consistency,'skew-exceeded');
  assert.equal(skew.safeForBoundedTemporalJoin,false);
  const partial=assessRpcReadBatch({policy:p,maxSkewMs:5000,calls:[
    {model:'hr.attendance',method:'search_read',startedAt:'2026-09-20T12:00:00Z',completedAt:'2026-09-20T12:00:00.100Z',partial:true}
  ]});
  assert.equal(partial.consistency,'partial-read-set');
  assert.equal(partial.safeForAtomicJoin,false);
  assert.equal(partial.safeForBoundedTemporalJoin,false);
});
