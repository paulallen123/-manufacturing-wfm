import test from 'node:test';
import assert from 'node:assert/strict';
import {EmployeePresenceProof,createSyntheticPasskey} from './wfm-employee-presence.mjs';
import {WfmKioskHardening} from './wfm-kiosk-hardening.mjs';
import {SecureClockCoordinator} from './wfm-secure-clock-coordinator.mjs';
const NOW=Date.parse('2026-09-16T20:30:00Z');
function seed(){
  const passkey=createSyntheticPasskey();
  const presence=new EmployeePresenceProof({rpId:'wfm.test',origin:'https://wfm.test'});
  presence.registerCredential({tenant:'t1',employee:'e1',credentialId:'cred-e1',publicKeyPem:passkey.publicKeyPem});
  const kiosk=new WfmKioskHardening();
  kiosk.registerPerson({tenant:'t1',employee:'e1',sites:['tamworth']});
  kiosk.registerPerson({tenant:'t1',employee:'e2',sites:['tamworth']});
  kiosk.registerDevice({tenant:'t1',deviceId:'kiosk-a',site:'tamworth'});
  kiosk.registerDevice({tenant:'t1',deviceId:'kiosk-b',site:'leeds'});
  const coordinator=new SecureClockCoordinator({presence,kiosk});
  return {passkey,presence,kiosk,coordinator};
}
function proof(s,at=NOW){
  const c=s.presence.issueAuthenticationChallenge({tenant:'t1',employee:'e1',site:'tamworth',nowMs:at-100});
  const signature=s.passkey.sign(s.presence.challengeSigningBytes({challengeId:c.challengeId}));
  return s.presence.verifyAndIssuePresence({tenant:'t1',challengeId:c.challengeId,credentialId:'cred-e1',signature,origin:'https://wfm.test',rpId:'wfm.test',nowMs:at});
}
function args(p,c,over={}){return {deviceId:'kiosk-a',presenceToken:p.presenceToken,challengeId:c?.challengeId,eventId:'secure-event-0001',sequence:1,type:'in',capturedAt:new Date(NOW-3600000).toISOString(),serverNowMs:NOW+1000,...over};}

test('passkey presence plus kiosk challenge produces server-time authoritative clock',()=>{
  const s=seed(),p=proof(s),c=s.kiosk.issueChallenge({deviceId:'kiosk-a',nowMs:NOW+900});
  const out=s.coordinator.clock(args(p,c));
  assert.equal(out.status,'accepted');
  assert.equal(out.employee,'e1');
  assert.equal(out.identityAssurance,'passkey+single-use-presence-token');
  assert.equal(out.authoritativeAt,new Date(NOW+1000).toISOString());
  assert.equal(s.kiosk.getPersonal({tenant:'t1',employee:'e1'}).status,'in');
});

test('high-assurance path has no caller-supplied employee field to substitute',()=>{
  const s=seed(),p=proof(s),c=s.kiosk.issueChallenge({deviceId:'kiosk-a',nowMs:NOW+900});
  const out=s.coordinator.clock(args(p,c,{employee:'e2'}));
  assert.equal(out.employee,'e1');
  assert.equal(s.kiosk.getPersonal({tenant:'t1',employee:'e2'}).status,'out');
});

test('same secure event retry is idempotent even though presence token was consumed',()=>{
  const s=seed(),p=proof(s),c=s.kiosk.issueChallenge({deviceId:'kiosk-a',nowMs:NOW+900}),a=args(p,c);
  const first=s.coordinator.clock(a),retry=s.coordinator.clock(a);
  assert.equal(retry.replayed,true);
  assert.equal(retry.personalEventId,first.personalEventId);
  assert.equal(s.kiosk.getPersonal({tenant:'t1',employee:'e1'}).events.length,1);
});

test('secure event id collision is rejected before identity replay can leak data',()=>{
  const s=seed(),p=proof(s),c=s.kiosk.issueChallenge({deviceId:'kiosk-a',nowMs:NOW+900}),a=args(p,c);
  s.coordinator.clock(a);
  assert.throws(()=>s.coordinator.clock({...a,type:'out'}),/reused for different content/);
});

test('valid identity but missing time challenge is held not authoritative',()=>{
  const s=seed(),p=proof(s);
  const out=s.coordinator.clock(args(p,null));
  assert.equal(out.status,'held');
  assert.equal(out.identityAssurance,'passkey+single-use-presence-token');
  assert.equal(out.timeTrust,'review_required');
  assert.equal(s.kiosk.getPersonal({tenant:'t1',employee:'e1'}).status,'out');
});

test('presence QR for Tamworth cannot be used on a Leeds kiosk',()=>{
  const s=seed(),p=proof(s),c=s.kiosk.issueChallenge({deviceId:'kiosk-b',nowMs:NOW+900});
  assert.throws(()=>s.coordinator.clock(args(p,c,{deviceId:'kiosk-b'})),/different site/);
  assert.equal(s.kiosk.getPersonal({tenant:'t1',employee:'e1'}).status,'out');
});

test('copied presence token cannot create a second distinct clock event',()=>{
  const s=seed(),p=proof(s),c=s.kiosk.issueChallenge({deviceId:'kiosk-a',nowMs:NOW+900});
  s.coordinator.clock(args(p,c));
  const c2=s.kiosk.issueChallenge({deviceId:'kiosk-a',nowMs:NOW+2000});
  assert.throws(()=>s.coordinator.clock(args(p,c2,{eventId:'secure-event-0002',sequence:2,type:'out',serverNowMs:NOW+2100})),/already used/);
  assert.equal(s.kiosk.getPersonal({tenant:'t1',employee:'e1'}).events.length,1);
});

test('revoked kiosk cannot consume employee presence proof',()=>{
  const s=seed(),p=proof(s);s.kiosk.revokeDevice('kiosk-a');
  assert.throws(()=>s.coordinator.clock(args(p,null)),/Device is not active/);
});
