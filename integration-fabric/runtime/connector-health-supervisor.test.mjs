import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConnectorHealthState,
  recordConnectorSuccess,
  recordConnectorFailure,
  planConnectorRecovery,
  runConnectorRecovery
} from './connector-health-supervisor.mjs';

const NOW=Date.parse('2026-10-03T22:40:00.000Z');
function base(){
  return createConnectorHealthState({
    providerId:'oracle-netsuite',tenantId:'northstar-demo',connectionId:'netsuite-sandbox',nowMs:NOW
  });
}

test('successful probe produces healthy state without write authority',()=>{
  const state=recordConnectorSuccess(base(),{latencyMs:42,nowMs:NOW});
  assert.equal(state.state,'healthy');
  assert.equal(state.latencyMs,42);
  assert.equal(state.writeRecoveryAllowed,false);
  assert.equal(state.customerActionRequired,false);
});

test('retryable transport failures degrade then become unreachable with bounded backoff',()=>{
  let state=base();
  state=recordConnectorFailure(state,{code:'WFM_PROVIDER_READ_TIMEOUT',retryable:true},{nowMs:NOW});
  assert.equal(state.state,'degraded');
  assert.equal(state.nextRetryAt,NOW+30_000);
  state=recordConnectorFailure(state,{code:'WFM_PROVIDER_READ_TIMEOUT',retryable:true},{nowMs:NOW+30_000});
  assert.equal(state.state,'degraded');
  assert.equal(state.nextRetryAt,NOW+90_000);
  state=recordConnectorFailure(state,{code:'WFM_PROVIDER_TRANSPORT_ERROR',retryable:true},{nowMs:NOW+90_000});
  assert.equal(state.state,'unreachable');
  assert.ok(state.nextRetryAt>NOW+90_000);
  assert.equal(state.writeRecoveryAllowed,false);
});

test('authentication failure only auto-recovers when managed refresh exists',()=>{
  const failed=recordConnectorFailure(base(),{code:'WFM_PROVIDER_AUTH_REJECTED',status:401,retryable:false},{nowMs:NOW});
  assert.equal(failed.state,'authentication_required');
  assert.equal(failed.customerActionRequired,true);
  assert.deepEqual(planConnectorRecovery(failed,{managedCredentialRefreshAvailable:false,nowMs:NOW}),{
    action:'reauthorize',automatic:false,reason:'customer-credential-action-required'
  });
  const managed=planConnectorRecovery(failed,{managedCredentialRefreshAvailable:true,nowMs:NOW});
  assert.equal(managed.action,'refresh-session-and-probe');
  assert.equal(managed.automatic,true);
});

test('bounded backoff prevents repeated probes before retry time',()=>{
  const failed=recordConnectorFailure(base(),{code:'WFM_PROVIDER_HTTP_ERROR',status:503,retryable:true},{nowMs:NOW});
  let probed=false;
  const result=await runConnectorRecovery({
    state:failed,nowMs:NOW+10_000,
    readOnlyProbe:async()=>{probed=true;return {ok:true};},
    verifyRecovery:async()=>true
  });
  assert.equal(result.status,'NO_AUTOMATIC_ACTION');
  assert.equal(result.plan.action,'wait');
  assert.equal(probed,false);
});

test('managed authentication recovery refreshes once, probes read-only and requires independent verification',async()=>{
  const failed=recordConnectorFailure(base(),{code:'WFM_PROVIDER_AUTH_REJECTED',status:401},{nowMs:NOW});
  let refreshes=0,probes=0,verified;
  const result=await runConnectorRecovery({
    state:failed,managedCredentialRefreshAvailable:true,nowMs:NOW+1,
    refreshSession:async request=>{
      refreshes++;
      assert.equal(request.binding.connectionId,'netsuite-sandbox');
    },
    readOnlyProbe:async request=>{
      probes++;
      assert.equal(request.readOnly,true);
      assert.equal(request.writeAllowed,false);
      assert.equal(request.destructiveAllowed,false);
      return {
        ok:true,latencyMs:55,receiptId:'probe-receipt-1',
        configurationFingerprint:'config-fingerprint-1',
        observedAt:'2026-10-03T22:40:00.001Z'
      };
    },
    verifyRecovery:async request=>{verified=request;return true;}
  });
  assert.equal(refreshes,1);
  assert.equal(probes,1);
  assert.equal(verified.readOnly,true);
  assert.equal(result.status,'RECOVERED_VERIFIED');
  assert.equal(result.state.state,'healthy');
  assert.equal(result.state.reconciliationRequired,true);
  assert.equal(result.state.recoveryCount,1);
  assert.equal(result.writeRecoveryPerformed,false);
});

test('failed independent recovery verification never returns healthy',async()=>{
  const failed=recordConnectorFailure(base(),{code:'WFM_PROVIDER_RATE_LIMITED',status:429,retryable:true},{nowMs:NOW});
  const result=await runConnectorRecovery({
    state:failed,nowMs:failed.nextRetryAt,
    readOnlyProbe:async()=>({
      ok:true,latencyMs:20,receiptId:'probe-2',configurationFingerprint:'cfg-2',
      observedAt:'2026-10-03T22:41:00.000Z'
    }),
    verifyRecovery:async()=>false
  });
  assert.equal(result.status,'RECOVERY_FAILED');
  assert.notEqual(result.state.state,'healthy');
  assert.equal(result.writeRecoveryPerformed,false);
});

test('probe failure remains bounded and never attempts a write recovery',async()=>{
  const failed=recordConnectorFailure(base(),{code:'WFM_PROVIDER_HTTP_ERROR',status:503,retryable:true},{nowMs:NOW});
  const error=Object.assign(new Error('still down'),{code:'WFM_PROVIDER_TRANSPORT_ERROR',status:503,retryable:true});
  const result=await runConnectorRecovery({
    state:failed,nowMs:failed.nextRetryAt,
    readOnlyProbe:async()=>{throw error;},
    verifyRecovery:async()=>{throw new Error('must not verify');}
  });
  assert.equal(result.status,'RECOVERY_FAILED');
  assert.equal(result.writeRecoveryPerformed,false);
  assert.ok(result.state.consecutiveFailures>failed.consecutiveFailures);
});

test('unconfigured connector requires configuration instead of pretending to self-heal',async()=>{
  const state=createConnectorHealthState({
    providerId:'sap-s4hana',tenantId:'northstar-demo',connectionId:'sap-unconfigured',
    configured:false,nowMs:NOW
  });
  const plan=planConnectorRecovery(state,{nowMs:NOW});
  assert.equal(plan.action,'configure');
  assert.equal(plan.automatic,false);
  let probed=false;
  const result=await runConnectorRecovery({
    state,nowMs:NOW,
    readOnlyProbe:async()=>{probed=true;return {ok:true};},
    verifyRecovery:async()=>true
  });
  assert.equal(result.status,'NO_AUTOMATIC_ACTION');
  assert.equal(probed,false);
});
