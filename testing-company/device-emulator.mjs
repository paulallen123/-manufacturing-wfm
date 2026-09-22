import crypto from 'node:crypto';
import profiles from './device-profiles.json' with { type: 'json' };

const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clone=v=>structuredClone(v);
const device=id=>{
  const d=profiles.devices.find(x=>x.id===id);
  if(!d) throw new Error('NORTHSTAR_DEVICE_NOT_FOUND');
  return d;
};

const now='2026-09-22T07:58:00.000Z';

function baseEvent(deviceId,index=0){
  return {
    eventId:'ns-device-'+deviceId+'-'+String(index+1).padStart(6,'0'),
    employee:'NS-EMP-000101',
    site:'NS-001',
    deviceId:'NS-DEVICE-'+deviceId.toUpperCase(),
    occurredAt:now,
    receivedAt:'2026-09-22T07:58:00.250Z',
    sequence:1001+index,
    fictional:true
  };
}

function outcome(deviceId,action,fault){
  const d=device(deviceId);
  const e=baseEvent(deviceId);
  let status='accepted';
  let vectorDisposition='time_event_candidate';
  let authority='explicit_user_action';
  let notes=[];
  let emitted=[{...e,type:action}];
  let replayed=0,duplicates=0,reviewRequired=false,payrollMutationPermitted=false;

  if(deviceId==='wall-terminal'){
    authority='direct_only_if_configured';
    vectorDisposition='authoritative_ta_candidate';
  }
  if(deviceId==='access-reader'){
    authority='evidence';
    vectorDisposition=action==='ACCESS_DENIED'?'operational_event':'attendance_evidence';
  }
  if(deviceId==='workstation-hmi'||deviceId==='wifi-radius'){
    authority='corroborating_evidence';
    vectorDisposition='attendance_evidence_only';
  }
  if(deviceId==='privacy-sensitive-biometric-terminal'){
    authority='none';
    vectorDisposition='rejected_privacy_sensitive_payload';
    status='rejected';
    notes.push('Raw biometric material is not accepted into attendance evidence.');
  }

  if(fault==='offline-replay'){
    status='recovered';
    replayed=1;
    notes.push('Event queued offline then replayed with original occurrence timestamp and stable event ID.');
  }
  if(fault==='double-tap'||fault==='duplicate-punch'||fault==='duplicate-event'){
    emitted=[{...e,type:action},{...e,type:action}];
    duplicates=1;
    notes.push('Duplicate event ID must be idempotent.');
  }
  if(fault==='clock-skew'){
    emitted=[{...e,type:action,occurredAt:'2026-09-22T06:28:00.000Z'}];
    status='held';
    reviewRequired=true;
    vectorDisposition='review_required_clock_skew';
    notes.push('Unsupported device/source clock skew must be held or rejected.');
  }
  if(fault==='sequence-gap'){
    emitted=[{...e,type:action,sequence:1007}];
    status='reconciling';
    vectorDisposition='gap_detected_backfill_required';
    notes.push('Sequence gap requires reconciliation before completeness certification.');
  }
  if(fault==='session-bleed'){
    status='rejected';
    vectorDisposition='shared_device_identity_boundary_failed';
    notes.push('Previous worker session must not survive handoff to the next worker.');
  }
  if(fault==='wrong-employee'||fault==='identity-mismatch'||fault==='shared-credential'){
    status='held';
    reviewRequired=true;
    vectorDisposition='review_required_identity';
    notes.push('Ambiguous or mismatched identity cannot become automatic attendance.');
  }
  if(fault==='unknown-direction'){
    status='held';
    reviewRequired=true;
    vectorDisposition='review_required_direction';
    notes.push('Access event without known entry/exit direction cannot become attendance.');
  }
  if(fault==='door-state-only'){
    status='ignored';
    vectorDisposition='not_person_presence_evidence';
    notes.push('Door state/unlock is not proof a person crossed the boundary.');
  }
  if(fault==='logout-without-departure'||fault==='signal-loss'||fault==='stale-stop'){
    status='evidence_only';
    vectorDisposition='must_not_generate_automatic_out';
    notes.push('Negative/disappearance evidence alone cannot stop pay.');
  }
  if(fault==='raw-template-present'){
    status='rejected';
    vectorDisposition='privacy_sensitive_payload_rejected';
    notes.push('Raw biometric template/image must not be stored in the attendance evidence model.');
  }
  if(fault==='revoked-session'||fault==='revoked-credential'){
    status='rejected';
    vectorDisposition='credential_or_session_revoked';
  }
  if(fault==='kiosk-reset'||fault==='stale-app-version'){
    status='degraded';
    vectorDisposition='safe_recovery_required';
  }
  if(fault==='roam'){
    status='evidence_only';
    vectorDisposition='same_site_session_continuity';
  }

  const core={
    recordType:'northstar-device-emulation-receipt',
    device:{id:d.id,name:d.name,class:d.class,authority:d.authority},
    action,fault,
    emitted,
    result:{status,vectorDisposition,replayed,duplicates,reviewRequired,payrollMutationPermitted,notes},
    invariants:{
      tenantBound:true,
      employeeBound:!['session-bleed','wrong-employee','identity-mismatch','shared-credential'].includes(fault),
      stableEventIdentity:true,
      originalAndReceiptTimeSeparate:true,
      silentWrongPayrollMutation:false,
      automaticOutFromNegativeSignal:false
    },
    claimBoundary:'Synthetic device/evidence emulation only. Not hardware certification or a live VECTOR attendance round trip.'
  };
  return Object.freeze({...core,receiptDigest:hash(core)});
}

export function listDevices(){return clone(profiles);}

export function emulateDevice({deviceId='personal-mobile',action,fault='none'}={}){
  const d=device(deviceId);
  const defaultAction=
    deviceId==='access-reader'?'ACCESS_GRANTED_ENTRY':
    deviceId==='workstation-hmi'?'LOGIN':
    deviceId==='wifi-radius'?'ACCOUNTING_START':
    deviceId==='privacy-sensitive-biometric-terminal'?'MATCH':'CLOCK_IN';
  const chosen=String(action||defaultAction);
  if(fault!=='none' && !d.faults.includes(fault)) throw new Error('NORTHSTAR_DEVICE_FAULT_NOT_SUPPORTED');
  return outcome(deviceId,chosen,fault);
}

export function runDeviceSuite({deviceId='personal-mobile'}={}){
  const d=device(deviceId);
  const cases=['none',...d.faults].map(fault=>{
    const receipt=emulateDevice({deviceId,fault});
    const r=receipt.result;
    const pass=
      fault==='none'?r.status!=='rejected':
      ['double-tap','duplicate-punch','duplicate-event'].includes(fault)?r.duplicates===1:
      ['logout-without-departure','signal-loss','stale-stop'].includes(fault)?receipt.invariants.automaticOutFromNegativeSignal===false&&r.vectorDisposition==='must_not_generate_automatic_out':
      fault==='door-state-only'?r.status==='ignored':
      fault==='raw-template-present'?r.status==='rejected':
      ['wrong-employee','identity-mismatch','shared-credential','unknown-direction','clock-skew'].includes(fault)?r.reviewRequired===true:
      ['revoked-session','revoked-credential'].includes(fault)?r.status==='rejected':
      true;
    return {fault,pass,status:r.status,disposition:r.vectorDisposition,receiptDigest:receipt.receiptDigest};
  });
  const core={device:{id:d.id,name:d.name},pass:cases.every(x=>x.pass),cases,claimBoundary:'Synthetic Northstar device regression suite; no hardware/customer certification.'};
  return Object.freeze({...core,suiteDigest:hash(core)});
}
