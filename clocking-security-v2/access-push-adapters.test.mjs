import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {verifyKisiWebhook,verifyVerkadaWebhook,normalizeVerkadaAccessWebhook,acknowledgeAfterDurableCommit} from './access-push-adapters.mjs';
import {ACCESS_PROVIDER_CAPABILITIES,planAccessConnection} from './access-control-evidence.mjs';

const T=Date.parse('2026-09-18T13:10:00Z');
const secret='test-shared-secret';
const raw='{"hello":"world"}';

function verkadaVerification(rawBody=raw){
  const ts=String(Math.floor(T/1000));
  const sig=crypto.createHmac('sha256',secret).update(`${rawBody}|${ts}`).digest('hex');
  return verifyVerkadaWebhook({rawBody,signatureHeader:`${ts}|${sig}`,secret,nowMs:T});
}

test('Kisi HMAC verifies raw body and rejects tampering',()=>{
  const sig=crypto.createHmac('sha256',secret).update(raw).digest('hex');
  assert.equal(verifyKisiWebhook({rawBody:raw,signature:sig,secret}).ok,true);
  assert.equal(verifyKisiWebhook({rawBody:raw+'x',signature:sig,secret}).reason,'INVALID_SIGNATURE');
});

test('Verkada signature validates timestamped HMAC',()=>{
  const r=verkadaVerification(raw);
  assert.equal(r.ok,true);
  assert.match(r.authenticatedBodySha256,/^[a-f0-9]{64}$/);
});

test('Verkada stale signed webhook is rejected as replay risk',()=>{
  const ts=String(Math.floor((T-61_000)/1000));
  const sig=crypto.createHmac('sha256',secret).update(`${raw}|${ts}`).digest('hex');
  const r=verifyVerkadaWebhook({rawBody:raw,signatureHeader:`${ts}|${sig}`,secret,nowMs:T});
  assert.equal(r.ok,false);
  assert.equal(r.reason,'STALE_OR_FUTURE_DELIVERY');
});

function payload(type,{userId='u1',direction='Inbound'}={}){
  return {
    webhook_type:'notification',
    data:{
      event_id:`evt-${type}`,
      device_type:'access_control',
      notification_type:type,
      door_id:'d1',
      created:T/1000,
      direction,
      user_info:userId?{user_id:userId,name:'Sensitive Name',email:'secret@example.com',phone:'123'}:null,
      door_info:{door_id:'d1',acu_id:'acu1',camera_info:{url:'do-not-copy'}},
      input_value:'raw-credential-never-copy'
    }
  };
}
const base={sourceId:'doors',employee:'e1',expectedProviderUserId:'u1',accessPoint:{id:'d1',direction:'entry',attendanceEligible:true,zoneId:'site'},receivedAtMs:T+1000,identityBinding:'assigned_badge'};

test('Verkada personal keycard event becomes minimized access_entry evidence',()=>{
  const r=normalizeVerkadaAccessWebhook({...base,payload:payload('door_keycard_entered_accepted')});
  assert.equal(r.status,'evidence');
  assert.equal(r.event.kind,'access_entry');
  assert.equal(r.event.metadata.accessPointId,'d1');
  const serialized=JSON.stringify(r);
  assert.equal(serialized.includes('Sensitive Name'),false);
  assert.equal(serialized.includes('secret@example.com'),false);
  assert.equal(serialized.includes('raw-credential-never-copy'),false);
  assert.equal(serialized.includes('do-not-copy'),false);
});

test('provider user mismatch cannot silently create attendance',()=>{
  const r=normalizeVerkadaAccessWebhook({...base,payload:payload('door_keycard_entered_accepted',{userId:'other'})});
  assert.equal(r.status,'review_required');
  assert.equal(r.reason,'PROVIDER_USER_ID_MISMATCH');
});

test('remote unlock is never treated as person crossing',()=>{
  const r=normalizeVerkadaAccessWebhook({...base,payload:payload('door_remote_unlock_accepted')});
  assert.equal(r.status,'ignored');
  assert.equal(r.reason,'DOOR_STATE_OR_REMOTE_ACTION_NOT_PERSON_CROSSING');
});

test('face and license-plate credential events are excluded from attendance evidence',()=>{
  for(const type of ['door_face_presented_accepted','door_lp_presented_accepted']){
    const r=normalizeVerkadaAccessWebhook({...base,payload:payload(type)});
    assert.equal(r.status,'ignored');
    assert.equal(r.reason,'PRIVACY_SENSITIVE_CREDENTIAL_NOT_USED_FOR_ATTENDANCE');
  }
});

test('shared code entry is review-required, never automatic attendance',()=>{
  const r=normalizeVerkadaAccessWebhook({...base,payload:payload('door_code_entered_accepted')});
  assert.equal(r.status,'review_required');
  assert.equal(r.reason,'SHARED_OR_UNPROVEN_CREDENTIAL');
});

test('tailgating remains operational intelligence only',()=>{
  const r=normalizeVerkadaAccessWebhook({...base,payload:payload('door_tailgating',{userId:null})});
  assert.equal(r.status,'operational_event');
  assert.equal(r.event.type,'door_tailgating');
});

test('Verkada is declared as realtime webhook plus historical backfill provider',()=>{
  assert.equal(ACCESS_PROVIDER_CAPABILITIES.verkada.realtime,'webhook');
  assert.equal(ACCESS_PROVIDER_CAPABILITIES.verkada.reconciliation,'events_api');
  const p=planAccessConnection({provider:'verkada'});
  assert.equal(p.strategy,'cloud_signed_webhook');
  assert.equal(p.backfill,true);
});

test('webhook is acknowledged only after the exact authenticated body is derived and durably committed',async()=>{
  let persisted=false;
  const verification=verkadaVerification(raw);
  const r=await acknowledgeAfterDurableCommit({verification,rawBody:raw,deriveDelivery:async parsed=>({id:parsed.hello}),persist:async d=>{ persisted=true; return {id:d.id}; }});
  assert.equal(persisted,true);
  assert.equal(r.httpStatus,200);
  assert.equal(r.status,'accepted');
});

test('valid signature cannot be paired with a different payload before durable commit',async()=>{
  let called=false;
  const verification=verkadaVerification(raw);
  const r=await acknowledgeAfterDurableCommit({verification,rawBody:'{"hello":"attacker"}',deriveDelivery:async parsed=>parsed,persist:async()=>{called=true;}});
  assert.equal(called,false);
  assert.equal(r.httpStatus,401);
  assert.equal(r.reason,'AUTHENTICATED_BODY_MISMATCH');
});

test('caller-constructed verification lookalike cannot cross the durable boundary',async()=>{
  let called=false;
  const fake={ok:true,authenticatedBodySha256:crypto.createHash('sha256').update(raw).digest('hex')};
  const r=await acknowledgeAfterDurableCommit({verification:fake,rawBody:raw,deriveDelivery:async parsed=>parsed,persist:async()=>{called=true;}});
  assert.equal(called,false);
  assert.equal(r.httpStatus,401);
  assert.equal(r.reason,'UNVERIFIED_DELIVERY');
});

test('serialized genuine verification loses process-private authority',async()=>{
  let called=false;
  const cloned=JSON.parse(JSON.stringify(verkadaVerification(raw)));
  const r=await acknowledgeAfterDurableCommit({verification:cloned,rawBody:raw,deriveDelivery:async parsed=>parsed,persist:async()=>{called=true;}});
  assert.equal(called,false);
  assert.equal(r.httpStatus,401);
  assert.equal(r.reason,'UNVERIFIED_DELIVERY');
});

test('durable commit failure returns retryable 500 instead of false acknowledgement',async()=>{
  const verification=verkadaVerification(raw);
  const r=await acknowledgeAfterDurableCommit({verification,rawBody:raw,deriveDelivery:async parsed=>parsed,persist:async()=>{ throw new Error('disk'); }});
  assert.equal(r.httpStatus,500);
  assert.equal(r.reason,'DURABLE_COMMIT_FAILED');
});

test('unverified delivery never reaches durable attendance inbox',async()=>{
  let called=false;
  const r=await acknowledgeAfterDurableCommit({verification:{ok:false,reason:'INVALID_SIGNATURE'},rawBody:raw,deriveDelivery:async parsed=>parsed,persist:async()=>{ called=true; }});
  assert.equal(called,false);
  assert.equal(r.httpStatus,401);
  assert.equal(r.reason,'INVALID_SIGNATURE');
});
