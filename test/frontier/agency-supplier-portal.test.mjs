import test from 'node:test';
import assert from 'node:assert/strict';
import {issueAgencyPortalToken,verifyAgencyPortalToken,buildAgencyPortalView,normalizeAgencyPortalSubmission,portalAuditReceipt} from '../../src/frontier/agency-supplier-portal.mjs';

const SECRET='0123456789abcdef0123456789abcdef0123456789abcdef';
const scope={tenantId:'T1',siteId:'S1',requestId:'R1',agencyId:'A1'};
const claims={...scope,expiresAt:'2026-09-18T13:00:00.000Z',tokenId:'tok-1'};
function view(){return buildAgencyPortalView({requestPack:{requestId:'R1',hirer:{name:'Factory'},assignment:{roleName:'Operator',location:'Plant'}},agencyId:'A1',preferredWorkerIds:['W1','W2'],responseDeadline:'2026-09-18T12:00:00.000Z'});}

test('valid scoped token verifies and exposes only a fingerprint for logs',()=>{const t=issueAgencyPortalToken(claims,SECRET);const v=verifyAgencyPortalToken(t,scope,SECRET,{now:'2026-09-18T11:00:00.000Z'});assert.equal(v.valid,true);assert.equal(v.claims.tokenId,'tok-1');assert.equal(v.tokenFingerprint.length,16);assert.ok(!v.tokenFingerprint.includes(t));});

test('tampering, wrong scope, expiry and replay fail closed',()=>{const t=issueAgencyPortalToken(claims,SECRET);const tampered=t.slice(0,-1)+(t.endsWith('a')?'b':'a');assert.equal(verifyAgencyPortalToken(tampered,scope,SECRET,{now:'2026-09-18T11:00:00.000Z'}).valid,false);assert.match(verifyAgencyPortalToken(t,{...scope,agencyId:'A2'},SECRET,{now:'2026-09-18T11:00:00.000Z'}).reason,/scope_mismatch/);assert.equal(verifyAgencyPortalToken(t,scope,SECRET,{now:'2026-09-18T14:00:00.000Z'}).reason,'expired_token');assert.equal(verifyAgencyPortalToken(t,scope,SECRET,{now:'2026-09-18T11:00:00.000Z',consumedTokenIds:['tok-1']}).reason,'token_already_consumed');});

test('preferred worker confirmation is restricted to the request preferred list',()=>{const v=view();let n=normalizeAgencyPortalSubmission({view:v,claims:scope,submission:{action:'confirm_preferred_worker',workerId:'W1'}});assert.equal(n.valid,true);n=normalizeAgencyPortalSubmission({view:v,claims:scope,submission:{action:'confirm_preferred_worker',workerId:'W9'}});assert.equal(n.valid,false);assert.ok(n.failures.includes('worker_not_in_preferred_list'));});

test('alternative worker is captured but never accepted without revalidation',()=>{const n=normalizeAgencyPortalSubmission({view:view(),claims:scope,submission:{action:'propose_alternative',alternative:{workerRef:'AGENCY-77',consentToShare:true,available:true,siteReady:true}}});assert.equal(n.valid,true);assert.equal(n.response.status,'pending_alternative_revalidation');assert.equal(n.response.alternative.workerRef,'AGENCY-77');assert.match(n.response.authorityBoundary,/no_schedule_payroll_or_invoice_mutation/);});

test('partial fill can mix preferred confirmations and alternatives while flagging revalidation',()=>{const n=normalizeAgencyPortalSubmission({view:view(),claims:scope,submission:{action:'partial_fill',confirmedPreferredWorkerIds:['W1'],alternativeWorkers:[{workerRef:'ALT-1',consentToShare:true}]}});assert.equal(n.valid,true);assert.equal(n.response.status,'pending_alternative_revalidation');assert.deepEqual(n.response.partialFill.confirmedPreferredWorkerIds,['W1']);});

test('audit receipt never stores the signing secret or raw token',()=>{const t=issueAgencyPortalToken(claims,SECRET);const verification=verifyAgencyPortalToken(t,scope,SECRET,{now:'2026-09-18T11:00:00.000Z'});const normalized=normalizeAgencyPortalSubmission({view:view(),claims:verification.claims,submission:{action:'decline_request',reason:'No qualified worker available'}});const receipt=portalAuditReceipt({verification,normalized,receivedAt:'2026-09-18T11:01:00.000Z'});const text=JSON.stringify(receipt);assert.equal(receipt.secretOrRawTokenStored,false);assert.ok(!text.includes(SECRET));assert.ok(!text.includes(t));assert.equal(receipt.action,'decline_request');});

test('1,000 token mutations never verify',()=>{const t=issueAgencyPortalToken(claims,SECRET);for(let i=0;i<1000;i++){const ix=i%t.length;const ch=t[ix]==='A'?'B':'A';const x=t.slice(0,ix)+ch+t.slice(ix+1);assert.equal(verifyAgencyPortalToken(x,scope,SECRET,{now:'2026-09-18T11:00:00.000Z'}).valid,false);}});
