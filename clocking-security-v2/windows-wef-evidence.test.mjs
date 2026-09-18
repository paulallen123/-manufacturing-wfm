import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWefSecurityEvent } from './windows-wef-evidence.mjs';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';

const R=Date.parse('2026-09-18T06:00:05Z');
const baseSystem=(id,record='1001',at='2026-09-18T06:00:00Z')=>({
  eventId:id,eventRecordId:record,timeCreated:at,computer:'LINE3-HMI-01.factory.local',channel:'Security'
});
const normalize=(event,overrides={})=>normalizeWefSecurityEvent({
  sourceId:'wef-line3',
  employee:'e1',
  receivedAtMs:R,
  identityBinding:'exact_sid',
  workstationBinding:'fixed_site_asset',
  event,
  ...overrides
});

test('4624 Interactive local logon becomes workstation presence evidence at source time',()=>{
  const r=normalize({system:baseSystem(4624),data:{LogonType:2,TargetLogonId:'0x123'}});
  assert.equal(r.status,'evidence');
  assert.equal(r.event.kind,'workstation_login');
  assert.equal(r.event.observedAt,'2026-09-18T06:00:00.000Z');
  assert.equal(r.event.metadata.workstationId,'LINE3-HMI-01.factory.local');
});

test('4624 Unlock/CachedInteractive/CachedUnlock remain eligible local presence',()=>{
  for(const logonType of [7,11,13]){
    const r=normalize({system:baseSystem(4624,`r-${logonType}`),data:{LogonType:logonType}});
    assert.equal(r.status,'evidence');
    assert.equal(r.event.kind,'workstation_login');
  }
});

test('RDP, network, batch and service logons are never attendance evidence',()=>{
  for(const logonType of [3,4,5,8,9,10,12]){
    const r=normalize({system:baseSystem(4624,`r-${logonType}`),data:{LogonType:logonType}});
    assert.equal(r.status,'ignored');
    assert.equal(r.reason,'NON_LOCAL_INTERACTIVE_WINDOWS_LOGON');
  }
});

test('4801 workstation unlock becomes positive workstation evidence',()=>{
  const r=normalize({system:baseSystem(4801),data:{TargetLogonId:'0xabc'}});
  assert.equal(r.status,'evidence');
  assert.equal(r.event.kind,'workstation_login');
});

test('lock/logoff/session termination are weak workstation_logout evidence only',()=>{
  for(const eventId of [4634,4647,4800]){
    const r=normalize({system:baseSystem(eventId,`r-${eventId}`),data:{TargetLogonId:'0xabc'}});
    assert.equal(r.status,'evidence');
    assert.equal(r.event.kind,'workstation_logout');
  }
});

test('username-only or otherwise weak Windows identity binding cannot become employee evidence',()=>{
  const r=normalize({system:baseSystem(4624),data:{LogonType:2}}, {identityBinding:'username_only'});
  assert.deepEqual(r,{status:'review_required',reason:'WEAK_WINDOWS_IDENTITY_BINDING'});
});

test('mobile/unknown Windows asset cannot prove factory location',()=>{
  const r=normalize({system:baseSystem(4624),data:{LogonType:2}}, {workstationBinding:'mobile_or_unknown'});
  assert.deepEqual(r,{status:'review_required',reason:'WINDOWS_ASSET_NOT_FIXED_TO_SITE'});
});

test('stable derived event ID deduplicates WEF re-delivery without storing SID or username',()=>{
  const event={system:baseSystem(4624,'1442'),data:{LogonType:2,TargetUserSid:'S-1-5-21-1',TargetUserName:'worker',TargetLogonId:'0x88'}};
  const a=normalize(event); const b=normalize(event);
  assert.equal(a.event.eventId,b.event.eventId);
  assert.match(a.event.eventId,/^wef-[0-9a-f]{32}$/);
  assert.equal('TargetUserSid' in a.event.metadata,false);
  assert.equal('TargetUserName' in a.event.metadata,false);
});

test('WEF local login plus independent Wi-Fi evidence can create authoritative IN',()=>{
  const engine=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000});
  engine.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  engine.registerSource({tenant:'acme',sourceId:'wef-line3',site:'s1',type:'windows_wef'});
  engine.registerSource({tenant:'acme',sourceId:'wifi',site:'s1',type:'radius'});
  const wef=normalize({system:baseSystem(4624),data:{LogonType:2,TargetLogonId:'0x123'}});
  engine.ingest({tenant:'acme',receivedAtMs:R,...wef.event});
  const wifi=engine.ingest({
    tenant:'acme',sourceId:'wifi',eventId:'wifi-auth-001',employee:'e1',kind:'wifi_authenticated',
    observedAt:'2026-09-18T06:00:10Z',receivedAtMs:R+10_000
  });
  assert.equal(wifi.decision.status,'authoritative');
  assert.equal(wifi.decision.direction,'in');
  assert.equal(wifi.decision.authoritativeAt,'2026-09-18T06:00:00.000Z');
});

test('WEF logoff plus Wi-Fi disconnect cannot stop pay without a departure anchor',()=>{
  const engine=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000});
  engine.registerPerson({tenant:'acme',employee:'e1',sites:['s1']});
  engine.registerSource({tenant:'acme',sourceId:'wef-line3',site:'s1',type:'windows_wef'});
  engine.registerSource({tenant:'acme',sourceId:'wifi',site:'s1',type:'radius'});
  engine.registerSource({tenant:'acme',sourceId:'door',site:'s1',type:'access'});
  engine.ingest({tenant:'acme',sourceId:'door',eventId:'door-entry-001',employee:'e1',kind:'access_entry',observedAt:'2026-09-18T06:00:00Z',receivedAtMs:R});
  engine.ingest({tenant:'acme',sourceId:'wifi',eventId:'wifi-auth-002',employee:'e1',kind:'wifi_authenticated',observedAt:'2026-09-18T06:00:05Z',receivedAtMs:R});
  const end=Date.parse('2026-09-18T14:00:00Z');
  const wef=normalizeWefSecurityEvent({
    sourceId:'wef-line3',employee:'e1',receivedAtMs:end+5000,identityBinding:'exact_sid',workstationBinding:'fixed_site_asset',
    event:{system:baseSystem(4647,'2001','2026-09-18T14:00:00Z'),data:{TargetLogonId:'0x123'}}
  });
  const a=engine.ingest({tenant:'acme',receivedAtMs:end+5000,...wef.event});
  const b=engine.ingest({tenant:'acme',sourceId:'wifi',eventId:'wifi-stop-002',employee:'e1',kind:'wifi_disconnected',observedAt:'2026-09-18T14:00:03Z',receivedAtMs:end+5000});
  assert.equal(a.decision.status,'evidence_only');
  assert.equal(b.decision.status,'evidence_only');
  assert.equal(engine.getState({tenant:'acme',employee:'e1',site:'s1'}).status,'present');
});
