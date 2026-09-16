import test from 'node:test';
import assert from 'node:assert/strict';
import {EmployeePresenceProof,createSyntheticPasskey} from './wfm-employee-presence.mjs';
const NOW=Date.parse('2026-09-16T20:00:00Z');
function seed(){
  const key=createSyntheticPasskey(),s=new EmployeePresenceProof({rpId:'wfm.test',origin:'https://wfm.test'});
  s.registerCredential({tenant:'t1',employee:'e1',credentialId:'cred-e1-main',publicKeyPem:key.publicKeyPem});
  return {s,key};
}
function authenticate({s,key,tenant='t1',employee='e1',site='tamworth',now=NOW,origin='https://wfm.test',rpId='wfm.test',credentialId='cred-e1-main'}={}){
  const c=s.issueAuthenticationChallenge({tenant,employee,site,nowMs:now-100});
  const signature=key.sign(s.challengeSigningBytes({challengeId:c.challengeId}));
  return s.verifyAndIssuePresence({tenant,challengeId:c.challengeId,credentialId,signature,origin,rpId,nowMs:now});
}

test('valid passkey proof issues opaque short-lived presence token',()=>{
  const {s,key}=seed(),p=authenticate({s,key});
  assert.match(p.presenceToken,/^presence-/);
  assert.equal(p.site,'tamworth');
  assert.ok(!p.presenceToken.includes('e1'));
});

test('presence token is one-time and resolves employee only server-side',()=>{
  const {s,key}=seed(),p=authenticate({s,key});
  const a=s.consumePresence({tenant:'t1',site:'tamworth',deviceId:'kiosk-a',presenceToken:p.presenceToken,nowMs:NOW+1000});
  assert.equal(a.employee,'e1'); assert.equal(a.verified,true);
  assert.throws(()=>s.consumePresence({tenant:'t1',site:'tamworth',deviceId:'kiosk-a',presenceToken:p.presenceToken,nowMs:NOW+2000}),/already used/);
});

test('copied QR cannot be replayed at a second kiosk',()=>{
  const {s,key}=seed(),p=authenticate({s,key});
  s.consumePresence({tenant:'t1',site:'tamworth',deviceId:'kiosk-a',presenceToken:p.presenceToken,nowMs:NOW+1000});
  assert.throws(()=>s.consumePresence({tenant:'t1',site:'tamworth',deviceId:'kiosk-b',presenceToken:p.presenceToken,nowMs:NOW+1100}),/already used/);
});

test('presence token is site-bound',()=>{
  const {s,key}=seed(),p=authenticate({s,key});
  assert.throws(()=>s.consumePresence({tenant:'t1',site:'leeds',deviceId:'kiosk-b',presenceToken:p.presenceToken,nowMs:NOW+1000}),/different site/);
});

test('presence token expires quickly',()=>{
  const key=createSyntheticPasskey(),s=new EmployeePresenceProof({rpId:'wfm.test',origin:'https://wfm.test',presenceTtlMs:1000});
  s.registerCredential({tenant:'t1',employee:'e1',credentialId:'cred-e1-main',publicKeyPem:key.publicKeyPem});
  const p=authenticate({s,key});
  assert.throws(()=>s.consumePresence({tenant:'t1',site:'tamworth',deviceId:'kiosk-a',presenceToken:p.presenceToken,nowMs:NOW+1001}),/expired/);
});

test('wrong origin is rejected',()=>{
  const {s,key}=seed();
  assert.throws(()=>authenticate({s,key,origin:'https://evil.example'}),/origin or relying party rejected/);
});

test('wrong relying party is rejected',()=>{
  const {s,key}=seed();
  assert.throws(()=>authenticate({s,key,rpId:'evil.example'}),/origin or relying party rejected/);
});

test('invalid signature is rejected',()=>{
  const {s}=seed(),attacker=createSyntheticPasskey();
  const c=s.issueAuthenticationChallenge({tenant:'t1',employee:'e1',site:'tamworth',nowMs:NOW-100});
  const signature=attacker.sign(s.challengeSigningBytes({challengeId:c.challengeId}));
  assert.throws(()=>s.verifyAndIssuePresence({tenant:'t1',challengeId:c.challengeId,credentialId:'cred-e1-main',signature,origin:'https://wfm.test',rpId:'wfm.test',nowMs:NOW}),/Passkey proof rejected/);
});

test('passkey authentication challenge is one-time',()=>{
  const {s,key}=seed(),c=s.issueAuthenticationChallenge({tenant:'t1',employee:'e1',site:'tamworth',nowMs:NOW-100});
  const signature=key.sign(s.challengeSigningBytes({challengeId:c.challengeId}));
  s.verifyAndIssuePresence({tenant:'t1',challengeId:c.challengeId,credentialId:'cred-e1-main',signature,origin:'https://wfm.test',rpId:'wfm.test',nowMs:NOW});
  assert.throws(()=>s.verifyAndIssuePresence({tenant:'t1',challengeId:c.challengeId,credentialId:'cred-e1-main',signature,origin:'https://wfm.test',rpId:'wfm.test',nowMs:NOW+1}),/already used/);
});

test('revoked credential cannot authenticate even with a previously issued challenge',()=>{
  const {s,key}=seed(),c=s.issueAuthenticationChallenge({tenant:'t1',employee:'e1',site:'tamworth',nowMs:NOW-100});
  const signature=key.sign(s.challengeSigningBytes({challengeId:c.challengeId}));
  s.revokeCredential({tenant:'t1',credentialId:'cred-e1-main'});
  assert.throws(()=>s.verifyAndIssuePresence({tenant:'t1',challengeId:c.challengeId,credentialId:'cred-e1-main',signature,origin:'https://wfm.test',rpId:'wfm.test',nowMs:NOW}),/not active/);
});

test('credential registered to another employee cannot satisfy challenge',()=>{
  const {s,key}=seed(),other=createSyntheticPasskey();
  s.registerCredential({tenant:'t1',employee:'e2',credentialId:'cred-e2-main',publicKeyPem:other.publicKeyPem});
  const c=s.issueAuthenticationChallenge({tenant:'t1',employee:'e1',site:'tamworth',nowMs:NOW-100});
  const signature=other.sign(s.challengeSigningBytes({challengeId:c.challengeId}));
  assert.throws(()=>s.verifyAndIssuePresence({tenant:'t1',challengeId:c.challengeId,credentialId:'cred-e2-main',signature,origin:'https://wfm.test',rpId:'wfm.test',nowMs:NOW}),/not registered for this employee/);
});

test('tenant isolation blocks token consumption in another tenant',()=>{
  const {s,key}=seed(),p=authenticate({s,key});
  assert.throws(()=>s.consumePresence({tenant:'t2',site:'tamworth',deviceId:'kiosk-x',presenceToken:p.presenceToken,nowMs:NOW+1000}),/not found/);
});
