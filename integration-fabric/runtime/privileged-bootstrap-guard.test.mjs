import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePrivilegedBootstrap,assertPrivilegedBootstrapSafe} from './privileged-bootstrap-guard.mjs';

test('allows a bounded steady-state read route without privileged bootstrap',()=>{
  const decision=evaluatePrivilegedBootstrap({
    surface:'rest',
    registrationRequiresElevatedAuthority:false,
    bootstrapCapabilities:['read-only'],
    runtimeCapabilities:['read-only']
  });
  assert.equal(decision.allowed,true);
  assert.equal(decision.mode,'least-privilege-steady-state');
  assert.equal(decision.retainBootstrapCredential,false);
  assert.equal(decision.reuseBootstrapCredentialAtRuntime,false);
});

test('blocks runtime reuse when setup authority is privileged',()=>{
  const decision=evaluatePrivilegedBootstrap({
    surface:'webhooks',
    registrationRequiresElevatedAuthority:true,
    bootstrapCapabilities:['override-permissions:manage-all-data'],
    runtimeCapabilities:['override-permissions:manage-all-data']
  });
  assert.equal(decision.allowed,false);
  assert.equal(decision.mode,'blocked-runtime-authority');
  assert.throws(()=>assertPrivilegedBootstrapSafe({
    surface:'webhooks',
    registrationRequiresElevatedAuthority:true,
    bootstrapCapabilities:['administrator'],
    runtimeCapabilities:['administrator']
  }),error=>error?.code==='WFM_PRIVILEGED_BOOTSTRAP_BLOCKED');
});

test('allows customer pre-provisioning only when runtime is independent of bootstrap credentials',()=>{
  const decision=evaluatePrivilegedBootstrap({
    surface:'webhooks',
    registrationRequiresElevatedAuthority:true,
    bootstrapCapabilities:['administrator'],
    runtimeCapabilities:['read-only','verify-hmac'],
    customerPreProvisioned:true,
    runtimeCanOperateWithoutBootstrapCredential:true,
    verificationMaterialSeparated:true
  });
  assert.equal(decision.allowed,true);
  assert.equal(decision.mode,'customer-preprovisioned-separated-bootstrap');
  assert.equal(decision.retainBootstrapCredential,false);
  assert.equal(decision.reuseBootstrapCredentialAtRuntime,false);
});

test('fails closed when elevated bootstrap has not been separated',()=>{
  const decision=evaluatePrivilegedBootstrap({
    surface:'subscription',
    registrationRequiresElevatedAuthority:true,
    bootstrapCapabilities:['site-admin'],
    runtimeCapabilities:['read-only'],
    customerPreProvisioned:false,
    runtimeCanOperateWithoutBootstrapCredential:false,
    verificationMaterialSeparated:false
  });
  assert.equal(decision.allowed,false);
  assert.equal(decision.mode,'bootstrap-separation-required');
});
