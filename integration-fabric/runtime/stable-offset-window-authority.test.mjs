import test from 'node:test';
import assert from 'node:assert/strict';
import {createStableOffsetWindowAuthority} from './stable-offset-window-authority.mjs';

const sha=c=>`sha256:${c.repeat(64)}`;
const policy=()=>({provider:'oracle-maintenance',wfmTenantId:'tenant-uk',connectionId:'oracle-maint-1',oraclePodOrigin:'https://acme.fa.em2.oraclecloud.com',apiVersion:'11.13.18.05',resource:'maintenanceWorkOrders',method:'GET',organizationId:'300000001',stableOrder:'LastUpdateDate:asc,WorkOrderId:asc',principalFingerprint:sha('a'),queryFingerprint:sha('b'),schemaFingerprint:sha('c'),expectedCheckpointPredecessor:'cp:41',windowStart:'2026-09-26T00:00:00.000Z',windowEnd:'2026-09-27T00:00:00.000Z',expectedObservedAt:'2026-09-27T01:00:00.000Z',pageLimit:2,maxPagesPerPass:4,maxRows:20});
const row=(id,at,digest=sha('d'))=>({workOrderId:id,organizationId:'300000001',lastUpdateDate:at,payloadDigest:digest});
const pages=()=>[
 {offset:0,limit:2,count:2,hasMore:true,successful:true,rows:[row('101','2026-09-26T01:00:00.000Z'),row('102','2026-09-26T02:00:00.000Z')]},
 {offset:2,limit:2,count:1,hasMore:false,successful:true,rows:[row('103','2026-09-26T03:00:00.000Z')]}
];
const receipt=()=>({provider:'oracle-maintenance',wfmTenantId:'tenant-uk',connectionId:'oracle-maint-1',oraclePodOrigin:'https://acme.fa.em2.oraclecloud.com',apiVersion:'11.13.18.05',resource:'maintenanceWorkOrders',method:'GET',organizationId:'300000001',stableOrder:'LastUpdateDate:asc,WorkOrderId:asc',principalFingerprint:sha('a'),queryFingerprint:sha('b'),schemaFingerprint:sha('c'),checkpointPredecessor:'cp:41',windowStart:'2026-09-26T00:00:00.000Z',windowEnd:'2026-09-27T00:00:00.000Z',observedAt:'2026-09-27T01:00:00.000Z',complete:true,passes:[{passIndex:0,pages:pages()},{passIndex:1,pages:pages()}]});

test('admits only two identical complete stable offset passes as reconciliation evidence',()=>{
 const decision=createStableOffsetWindowAuthority(policy()).admit(receipt());
 assert.equal(decision.stableOffsetWindowCandidate,true);assert.equal(decision.uniqueRowCount,3);assert.equal(decision.passCount,2);
 for(const field of ['checkpointAdvanceAllowed','deletionAuthority','operationalDecisionAuthority','causalClaimAuthority','writeBackAuthority','payrollAuthority','attendanceAuthority']) assert.equal(decision[field],false);
 assert.equal(Object.isFrozen(decision),true);assert.equal(Object.isFrozen(decision.rows[0]),true);
});

test('binds Oracle pod version resource organization order fingerprints predecessor and closed horizon',()=>{
 for(const mutate of [v=>v.oraclePodOrigin='https://other.fa.em2.oraclecloud.com',v=>v.apiVersion='latest',v=>v.resource='workOrders',v=>v.method='POST',v=>v.organizationId='300000002',v=>v.stableOrder='WorkOrderId:asc',v=>v.queryFingerprint=sha('e'),v=>v.checkpointPredecessor='cp:40',v=>v.windowEnd='2026-09-27T02:00:00.000Z']){const value=receipt();mutate(value);assert.throws(()=>createStableOffsetWindowAuthority(policy()).admit(value),/origin|version|resource|method|organization|order|query|predecessor|window|horizon/i);}
 assert.throws(()=>createStableOffsetWindowAuthority({...policy(),oraclePodOrigin:'https://acme.fa.em2.oraclecloud.com:8443'}),/origin|port/i);
 assert.throws(()=>createStableOffsetWindowAuthority({...policy(),organizationId:'9'.repeat(19)}),/organization|precision|18/i);
});

test('requires exactly two gapless terminal offset chains with truthful count and hasMore',()=>{
 const authority=createStableOffsetWindowAuthority(policy());
 for(const mutate of [v=>v.passes.pop(),v=>v.passes.push(v.passes[0]),v=>v.passes[1].passIndex=2,v=>v.passes[0].pages[1].offset=3,v=>v.passes[0].pages[0].limit=1,v=>v.passes[0].pages[0].count=1,v=>v.passes[0].pages[0].hasMore=false,v=>v.passes[0].pages[1].hasMore=true,v=>v.passes[0].pages[0].successful=false]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/two|pass|offset|limit|count|hasMore|terminal|failed/i);}
});

test('rejects mutable offset churn missing rows and conflicting versions between passes',()=>{
 const authority=createStableOffsetWindowAuthority(policy());
 for(const mutate of [v=>v.passes[1].pages[1].rows=[],v=>v.passes[1].pages[1].count=0,v=>v.passes[1].pages[0].rows[1].payloadDigest=sha('e')]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/passes|stable|mismatch|churn|count/i);}
});

test('enforces half-open timestamps organization identity deterministic order and replay isolation',()=>{
 const authority=createStableOffsetWindowAuthority(policy());
 for(const mutate of [v=>v.passes[0].pages[0].rows[0].lastUpdateDate='2026-09-25T23:59:59.999Z',v=>v.passes[0].pages[0].rows[0].organizationId='300000002',v=>v.passes[0].pages[0].rows.reverse(),v=>v.passes[0].pages[0].rows[1].workOrderId='101',v=>{v.passes[0].pages[0].rows[1].workOrderId='not-an-int64';v.passes[1].pages[0].rows[1].workOrderId='not-an-int64';},v=>{v.passes[0].pages[0].rows[1].workOrderId='9'.repeat(19);v.passes[1].pages[0].rows[1].workOrderId='9'.repeat(19);},v=>v.passes[0].pages[0].rows[1].payloadDigest=sha('e')]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/window|organization|order|conflict|identity|mismatch|churn|WorkOrderId|precision|18/i);}
});

test('rejects oversized sparse secret executable and hidden evidence deterministically',()=>{
 const authority=createStableOffsetWindowAuthority(policy());
 const sparse=receipt();sparse.passes[0].pages=new Array(1);assert.throws(()=>authority.admit(sparse),/sparse|array/i);
 const secret=receipt();secret.accessToken='nope';assert.throws(()=>authority.admit(secret),/secret|allowed/i);
 const accessor=receipt();Object.defineProperty(accessor,'clientSecret',{enumerable:true,get(){throw new Error('executed');}});assert.throws(()=>authority.admit(accessor),/secret|credential/i);
 const hidden=receipt();Object.defineProperty(hidden.passes[0].pages[0].rows[0],'hidden',{enumerable:false,value:true});assert.throws(()=>authority.admit(hidden),/hidden|allowed/i);
 const a=authority.admit(receipt()),b=authority.admit(receipt());assert.equal(a.reconciliationFingerprint,b.reconciliationFingerprint);
});
