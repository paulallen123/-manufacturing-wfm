import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=process.env.TRUST_FABRIC_SOURCE||path.resolve(here,'../lane03-fabric/source/integration-fabric/runtime');
const constructors={
 'field-projection-authority':'createFieldProjectionAuthority',
 'change-signal-reconciliation':'createChangeSignalReconciliation',
 'effective-dated-workforce-authority':'createEffectiveDatedWorkforceAuthority',
 'managed-task-ingress-authority':'createManagedTaskIngressAuthority',
 'manufacturing-observation-authority':'createManufacturingObservationAuthority',
 'mutable-poll-window-authority':'createMutablePollWindowAuthority',
 'opaque-page-chain-authority':'createOpaquePageChainAuthority',
 'presence-signal-reconciliation':'createPresenceSignalAuthority',
 'rotating-oauth-transition':'createRotatingOAuthTransition',
 'shift-time-authority':'createShiftTimeAuthority',
 'workday-worker-evidence-authority':'createWorkdayWorkerEvidenceAuthority'
};
for(const [filename,name] of Object.entries(constructors)) {
 const module=await import(pathToFileURL(path.join(root,filename+'.mjs')));
 test(filename+': inert rejection never reads an indexed getter',()=>{
  let invoked=0;const array=[];
  Object.defineProperty(array,'0',{enumerable:true,get(){invoked++;return 'sentinel';}});
  assert.throws(()=>module[name]({reviewerUntrustedArray:array}),/executable|hidden/i);
  assert.equal(invoked,0);
 });
}
const {createFieldProjectionAuthority}=await import(pathToFileURL(path.join(root,'field-projection-authority.mjs')));
const {evaluateProviderCapabilityAuthority}=await import(pathToFileURL(path.join(root,'provider-capability-authority.mjs')));
function policy(routePath='/read'){return {provider:'bounded-provider',wfmTenantId:'tenant',connectionId:'connection-1',sourceAccountId:'account-1',apiOrigin:'https://approved.example.invalid',apiVersion:'v1',resource:'employees',routePath,method:'GET',readOperation:'read-employees',schemaFingerprint:'schema-1',projectionFingerprint:'projection-1',identityField:'employeeId',allowedFields:['employeeId'],requiredFields:['employeeId'],deniedSensitiveFields:['bankAccountNumber'],maxFields:1,maxRecords:1};}
function request(p){const {identityField,allowedFields,requiredFields,deniedSensitiveFields,maxFields,maxRecords,...scope}=p;return {...scope,fields:['employeeId']};}
function capability(exactHost='https://approved.example.invalid',route='/read'){const op={method:'GET',path:route,capability:'employees',operationId:'read-employees',readOnly:true};return {provider:'provider',wfmTenant:'tenant',connectionId:'connection-1',exactHost,credentialRevision:'revision-1',approvedCapabilities:['employees'],observedCapabilities:['employees'],requiredCapabilities:['employees'],approvedOperations:[op],requestedOperation:op};}
for(const route of ['//outside.example.invalid/read','/\\outside.example.invalid/read','/\t/outside.example.invalid/read','/\n/outside.example.invalid/read','/ /outside.example.invalid/read','/a\u007fb']) {
 test('field route rejects '+JSON.stringify(route),()=>assert.throws(()=>{const p=policy(route);createFieldProjectionAuthority(p).authorizeRead(request(p));},/path/i));
 test('capability route rejects '+JSON.stringify(route),()=>assert.equal(evaluateProviderCapabilityAuthority(capability(undefined,route)).allowed,false));
}
for(const host of ['https://approved.example.invalid@outside.example.invalid','https://user:password@approved.example.invalid','https://approved.example.invalid/path','https://approved.example.invalid?x=1','https://approved.example.invalid#fragment','http://approved.example.invalid']) {
 test('capability exact origin rejects '+JSON.stringify(host),()=>assert.equal(evaluateProviderCapabilityAuthority(capability(host)).allowed,false));
}
test('ordinary field route preserves exact origin and refuses tenant drift',()=>{const p=policy();const authority=createFieldProjectionAuthority(p),plan=authority.authorizeRead(request(p));assert.equal(new URL(plan.routePath,plan.apiOrigin).origin,p.apiOrigin);assert.throws(()=>authority.authorizeRead({...request(p),wfmTenantId:'other'}),/authority|tenant/i);});
test('ordinary capability route remains admitted',()=>assert.equal(evaluateProviderCapabilityAuthority(capability()).allowed,true));
