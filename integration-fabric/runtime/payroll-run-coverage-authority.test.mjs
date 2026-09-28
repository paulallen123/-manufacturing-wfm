import test from 'node:test';
import assert from 'node:assert/strict';
import {createPayrollRunCoverageAuthority} from './payroll-run-coverage-authority.mjs';

const fp=letter=>`sha256:${letter.repeat(64)}`;
const ids={
  principal:fp('a'),webhook:fp('b'),employeeSchema:fp('c'),statementSchema:fp('d'),
  mapping:fp('e'),roster:fp('f'),payloadA:fp('1'),payloadB:fp('2')
};

const policy=()=>({
  provider:'paylocity',wfmTenantId:'wfm-tenant-us',connectionId:'paylocity-conn-1',
  sourceCompanyId:'B0001',apiOrigin:'https://dc1demogwext.paylocity.com',apiVersion:'payroll-v1',
  employeeRoute:'/coreHr/v1/companies/B0001/employees',
  payStatementRouteTemplate:'/apiHub/payroll/v1/companies/B0001/employees/{employeeId}/payStatements',
  timeZone:'America/Chicago',currency:'USD',partnerAgreementRevision:'partner-2026-09',
  principalFingerprint:ids.principal,webhookCredentialFingerprint:ids.webhook,
  employeeSchemaFingerprint:ids.employeeSchema,payStatementSchemaFingerprint:ids.statementSchema,
  mappingFingerprint:ids.mapping,expectedCheckpointPredecessor:'payroll:42',
  expectedCheckDate:'2026-09-25',expectedProcessId:'2026092501',expectedRunId:1,
  expectedObservedAt:'2026-09-28T11:00:00.000Z',pageLimit:100,maxEmployees:10000,
  maxPagesPerEmployee:20,maxStatementsPerEmployee:100,maxTextBytes:512
});

const pagesFor=(employeeId,statementId,payloadDigest)=>[{
  offset:0,limit:100,totalCount:statementId?1:0,successful:true,
  statements:statementId?[{employeeId,payStatementId:statementId,processId:'2026092501',checkDate:'2026-09-25',payloadDigest}]:[]
}];

const pass=(passIndex,startedAt,completedAt)=>({
  passIndex,startedAt,completedAt,employeeReads:[
    {employeeId:'E-001',pages:pagesFor('E-001','550e8400-e29b-41d4-a716-446655440001',ids.payloadA)},
    {employeeId:'E-002',pages:pagesFor('E-002','550e8400-e29b-41d4-a716-446655440002',ids.payloadB)},
    {employeeId:'E-003',pages:pagesFor('E-003',null,null)}
  ]
});

const receipt=()=>({
  provider:'paylocity',wfmTenantId:'wfm-tenant-us',connectionId:'paylocity-conn-1',
  sourceCompanyId:'B0001',apiOrigin:'https://dc1demogwext.paylocity.com',apiVersion:'payroll-v1',
  employeeRoute:'/coreHr/v1/companies/B0001/employees',
  payStatementRouteTemplate:'/apiHub/payroll/v1/companies/B0001/employees/{employeeId}/payStatements',
  timeZone:'America/Chicago',currency:'USD',partnerAgreementRevision:'partner-2026-09',
  principalFingerprint:ids.principal,webhookCredentialFingerprint:ids.webhook,
  employeeSchemaFingerprint:ids.employeeSchema,payStatementSchemaFingerprint:ids.statementSchema,
  mappingFingerprint:ids.mapping,checkpointPredecessor:'payroll:42',
  observedAt:'2026-09-28T11:00:00.000Z',
  webhook:{
    companyId:'B0001',processId:'2026092501',checkDate:'2026-09-25',runId:1,
    processDate:'2026-09-25T15:31:05.900Z',status:'Processed',
    originAuthenticated:true,tlsVersion:'TLSv1.2',credentialFingerprint:ids.webhook
  },
  roster:{
    complete:true,reconciliationFingerprint:ids.roster,
    employeeIds:['E-001','E-002','E-003']
  },
  passes:[
    pass(0,'2026-09-25T15:32:00.000Z','2026-09-25T15:33:00.000Z'),
    pass(1,'2026-09-25T15:34:00.000Z','2026-09-25T15:35:00.000Z')
  ]
});

test('admits two stable complete payroll reads as observation evidence only',()=>{
  const decision=createPayrollRunCoverageAuthority(policy()).admit(receipt());
  assert.equal(decision.payrollRunObservationCandidate,true);
  assert.equal(decision.stableAcrossPasses,true);
  assert.equal(decision.coveredEmployeeCount,3);
  assert.equal(decision.payStatementCount,2);
  assert.equal(decision.zeroStatementEmployeeCount,1);
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.payrollAuthority,false);
  assert.equal(decision.attendanceAuthority,false);
  assert.equal(decision.writeBackAuthority,false);
  assert.equal(decision.causalAuthority,false);
  assert.ok(decision.employeeCoverage.every(item=>!Object.hasOwn(item,'employeeId')));
  assert.equal(JSON.stringify(decision).includes('E-001'),false);
});

test('binds tenant connection company endpoint routes version and partner entitlement',()=>{
  const authority=createPayrollRunCoverageAuthority(policy());
  for(const mutate of [
    value=>{value.wfmTenantId='wfm-tenant-eu';},value=>{value.connectionId='other';},
    value=>{value.sourceCompanyId='B0002';},value=>{value.apiOrigin='https://dc2demogwext.paylocity.com';},
    value=>{value.apiVersion='payroll-v2';},value=>{value.employeeRoute='/other';},
    value=>{value.payStatementRouteTemplate='/other/{employeeId}';},
    value=>{value.partnerAgreementRevision='partner-2025-01';}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/tenant|connection|company|origin|version|route|partner/i);}
});

test('requires an authenticated TLS payroll-processed hint with exact run identity',()=>{
  const authority=createPayrollRunCoverageAuthority(policy());
  for(const mutate of [
    value=>{value.webhook.status='Failed';},value=>{value.webhook.originAuthenticated=false;},
    value=>{value.webhook.tlsVersion='TLSv1.1';},value=>{value.webhook.companyId='B0002';},
    value=>{value.webhook.processId='2026092502';},value=>{value.webhook.checkDate='2026-09-26';},
    value=>{value.webhook.runId=2;},value=>{value.webhook.credentialFingerprint=fp('9');}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/processed|auth|tls|company|process|check|run|credential/i);}
});

test('requires two ordered passes after the webhook and before the observation horizon',()=>{
  const authority=createPayrollRunCoverageAuthority(policy());
  for(const mutate of [
    value=>{value.passes.pop();},value=>{value.passes.push(pass(2,'2026-09-25T15:36:00.000Z','2026-09-25T15:37:00.000Z'));},
    value=>{value.passes[0].passIndex=1;},value=>{value.passes[0].startedAt='2026-09-25T15:30:00.000Z';},
    value=>{value.passes[0].completedAt='2026-09-25T15:31:00.000Z';},
    value=>{value.passes[1].startedAt='2026-09-25T15:32:30.000Z';},
    value=>{value.passes[1].completedAt='2026-09-28T11:00:01.000Z';}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/two|index|webhook|time|ordered|horizon/i);}
});

test('requires exact complete roster coverage in each pass',()=>{
  const authority=createPayrollRunCoverageAuthority(policy());
  for(const mutate of [
    value=>{value.roster.complete=false;},value=>{value.roster.employeeIds.push('E-001');},
    value=>{value.passes[0].employeeReads.pop();},
    value=>{value.passes[0].employeeReads.push({employeeId:'E-004',pages:pagesFor('E-004',null,null)});},
    value=>{value.passes[0].employeeReads[1].employeeId='E-001';}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/roster|duplicate|coverage|employee/i);}
});

test('rejects failed gapped over-limit or incomplete employee pagination',()=>{
  const authority=createPayrollRunCoverageAuthority(policy());
  for(const mutate of [
    value=>{value.passes[0].employeeReads[0].pages[0].successful=false;},
    value=>{value.passes[0].employeeReads[0].pages[0].offset=1;},
    value=>{value.passes[0].employeeReads[0].pages[0].limit=99;},
    value=>{value.passes[0].employeeReads[0].pages[0].totalCount=2;},
    value=>{value.passes[0].employeeReads[0].pages[0].statements=[];},
    value=>{value.passes[0].employeeReads[0].pages.push({...value.passes[0].employeeReads[0].pages[0],offset:1});}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/page|offset|limit|count|complete|failed/i);}
});

test('rejects cross-employee cross-run malformed and conflicting statement identity',()=>{
  const authority=createPayrollRunCoverageAuthority(policy());
  for(const mutate of [
    value=>{value.passes[0].employeeReads[0].pages[0].statements[0].employeeId='E-002';},
    value=>{value.passes[0].employeeReads[0].pages[0].statements[0].processId='2026092502';},
    value=>{value.passes[0].employeeReads[0].pages[0].statements[0].checkDate='2026-09-26';},
    value=>{value.passes[0].employeeReads[0].pages[0].statements[0].payStatementId='not-a-uuid';},
    value=>{value.passes[0].employeeReads[0].pages[0].statements.push({...value.passes[0].employeeReads[0].pages[0].statements[0],payloadDigest:fp('9')});value.passes[0].employeeReads[0].pages[0].totalCount=2;}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/employee|process|check|uuid|conflict|duplicate/i);}
});

test('rejects one pay statement UUID being reassigned to a different employee',()=>{
  const value=receipt();
  for(const pass of value.passes){
    pass.employeeReads[1].pages[0].statements[0].payStatementId='550e8400-e29b-41d4-a716-446655440001';
  }
  assert.throws(()=>createPayrollRunCoverageAuthority(policy()).admit(value),/statement identity|duplicate|employee/i);
});

test('quarantines a payroll run when the second pass changes identity or payload',()=>{
  const authority=createPayrollRunCoverageAuthority(policy());
  for(const mutate of [
    value=>{value.passes[1].employeeReads[0].pages[0].statements[0].payStatementId='550e8400-e29b-41d4-a716-446655440099';},
    value=>{value.passes[1].employeeReads[0].pages[0].statements[0].payloadDigest=fp('9');},
    value=>{value.passes[1].employeeReads[2].pages[0].statements=[{employeeId:'E-003',payStatementId:'550e8400-e29b-41d4-a716-446655440003',processId:'2026092501',checkDate:'2026-09-25',payloadDigest:fp('3')}];value.passes[1].employeeReads[2].pages[0].totalCount=1;}
  ]){const value=receipt();mutate(value);assert.throws(()=>authority.admit(value),/stable|pass|changed/i);}
});

test('preserves opaque employee identities without returning them',()=>{
  const value=receipt();
  value.roster.employeeIds=['é','e\u0301'];
  for(const p of value.passes){
    p.employeeReads=[
      {employeeId:'é',pages:pagesFor('é','550e8400-e29b-41d4-a716-446655440010',ids.payloadA)},
      {employeeId:'e\u0301',pages:pagesFor('e\u0301','550e8400-e29b-41d4-a716-446655440011',ids.payloadB)}
    ];
  }
  const decision=createPayrollRunCoverageAuthority(policy()).admit(value);
  assert.equal(decision.coveredEmployeeCount,2);
  assert.notEqual(decision.employeeCoverage[0].scopedEmployeeFingerprint,decision.employeeCoverage[1].scopedEmployeeFingerprint);
  assert.equal(JSON.stringify(decision).includes('é'),false);
});

test('rejects zero UUIDs oversized identifiers sparse arrays secrets and executable evidence',()=>{
  const authority=createPayrollRunCoverageAuthority(policy());
  const zero=receipt();zero.passes[0].employeeReads[0].pages[0].statements[0].payStatementId='00000000-0000-0000-0000-000000000000';
  assert.throws(()=>authority.admit(zero),/uuid/i);
  const huge=receipt();huge.roster.employeeIds[0]='x'.repeat(513);
  assert.throws(()=>authority.admit(huge),/byte|long/i);
  const sparse=receipt();sparse.passes[0].employeeReads.length=10;
  assert.throws(()=>authority.admit(sparse),/sparse|coverage/i);
  const secret=receipt();secret.webhook.clientSecret='nope';
  assert.throws(()=>authority.admit(secret),/secret|not allowed/i);
  const executable=receipt();Object.defineProperty(executable.roster,'complete',{enumerable:true,get(){throw new Error('executed');}});
  assert.throws(()=>authority.admit(executable),/executable|hidden/i);
});

test('binds caps and fingerprints and returns deterministic deeply immutable output',()=>{
  const first=createPayrollRunCoverageAuthority(policy()).admit(receipt());
  const second=createPayrollRunCoverageAuthority(policy()).admit(receipt());
  assert.equal(first.reconciliationFingerprint,second.reconciliationFingerprint);
  const changed=createPayrollRunCoverageAuthority({...policy(),maxEmployees:9999}).admit(receipt());
  assert.notEqual(first.authorityFingerprint,changed.authorityFingerprint);
  assert.throws(()=>{first.employeeCoverage[0].statementFingerprints.push('x');},TypeError);
  assert.throws(()=>{first.coveredEmployeeCount=0;},TypeError);
});

test('binds webhook timing and transport provenance into reconciliation evidence',()=>{
  const baseline=createPayrollRunCoverageAuthority(policy()).admit(receipt());
  const changedTime=receipt();
  changedTime.webhook.processDate='2026-09-25T15:31:06.000Z';
  const timeDecision=createPayrollRunCoverageAuthority(policy()).admit(changedTime);
  assert.notEqual(baseline.reconciliationFingerprint,timeDecision.reconciliationFingerprint);

  const changedTransport=receipt();
  changedTransport.webhook.tlsVersion='TLSv1.3';
  const transportDecision=createPayrollRunCoverageAuthority(policy()).admit(changedTransport);
  assert.notEqual(baseline.reconciliationFingerprint,transportDecision.reconciliationFingerprint);
});
