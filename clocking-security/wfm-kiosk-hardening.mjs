import crypto from 'node:crypto';

const ALLOWED_TYPES = new Set(['in','break_start','break_end','out']);
const EVENT_ID = /^[A-Za-z0-9_.:-]{8,100}$/;

function hash(value){
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function clone(value){ return JSON.parse(JSON.stringify(value)); }

export class WfmKioskHardening {
  constructor({challengeTtlMs=60_000, maxOfflineAgeMs=7*86_400_000, maxFutureMs=5*60_000}={}){
    this.challengeTtlMs = challengeTtlMs;
    this.maxOfflineAgeMs = maxOfflineAgeMs;
    this.maxFutureMs = maxFutureMs;
    this.devices = new Map();
    this.people = new Map();
    this.challenges = new Map();
    this.events = new Map();
    this.unresolvedHeldCounts = new Map();
    this.deviceSequences = new Map();
    this.personal = new Map();
    // Held-event evidence is immutable; reviewer outcomes are stored separately.
    this.resolutions = new Map();
    this.resolutionReceipts = new Map();
    this.audit = [];
  }

  registerPerson({tenant, employee, sites=[]}){
    if(!tenant || !employee) throw new Error('tenant and employee required');
    this.people.set(`${tenant}:${employee}`, {tenant, employee, sites:[...sites]});
    if(!this.personal.has(`${tenant}:${employee}`)) this.personal.set(`${tenant}:${employee}`, {status:'out', revision:0, events:[]});
  }

  registerDevice({tenant, deviceId, site, active=true}){
    if(!tenant || !deviceId || !site) throw new Error('tenant, deviceId and site required');
    this.devices.set(deviceId, {tenant, deviceId, site, active});
    if(!this.deviceSequences.has(deviceId)) this.deviceSequences.set(deviceId, 0);
  }

  revokeDevice(deviceId){
    const d=this.devices.get(deviceId); if(!d) return false; d.active=false; return true;
  }

  issueChallenge({deviceId, nowMs}){
    const d=this.#device(deviceId);
    const challengeId='kc-'+crypto.randomUUID();
    const row={challengeId, deviceId, tenant:d.tenant, site:d.site, issuedAt:nowMs, expiresAt:nowMs+this.challengeTtlMs, usedAt:null};
    this.challenges.set(challengeId,row);
    for(const [id,c] of this.challenges){ if(c.expiresAt < nowMs-5*this.challengeTtlMs) this.challenges.delete(id); }
    return clone({challengeId, serverTime:new Date(nowMs).toISOString(), expiresAt:new Date(row.expiresAt).toISOString()});
  }

  syncBatch({deviceId, events, serverNowMs}){
    const d=this.#device(deviceId);
    if(!Array.isArray(events) || events.length<1 || events.length>500) throw Object.assign(new Error('Provide 1–500 queued clock events.'),{status:400});
    const results=[];
    let last=this.deviceSequences.get(deviceId)||0;
    for(const raw of events){
      const x={...raw};
      try{
        if(!EVENT_ID.test(String(x.eventId||''))) throw Object.assign(new Error('Queued event ID is invalid.'),{status:400});
        if(!Number.isSafeInteger(x.sequence)||x.sequence<=0) throw Object.assign(new Error('Queued event sequence is invalid.'),{status:400});
        if(!ALLOWED_TYPES.has(x.type)) throw Object.assign(new Error('Queued event type is invalid.'),{status:400});
        const person=this.people.get(`${d.tenant}:${String(x.employee||'')}`);
        if(!person) throw Object.assign(new Error('Employee is not ready for site clocking.'),{status:409});
        if(!person.sites.includes(d.site)) throw Object.assign(new Error('Employee is not approved for this device site.'),{status:403});
        const clientAt=Date.parse(String(x.capturedAt||''));
        if(!Number.isFinite(clientAt) || clientAt>serverNowMs+this.maxFutureMs || clientAt<serverNowMs-this.maxOfflineAgeMs){
          throw Object.assign(new Error('Queued event timestamp is outside the supported offline window.'),{status:409});
        }
        const digest=hash({eventId:x.eventId,sequence:x.sequence,employee:x.employee,type:x.type,capturedAt:x.capturedAt,challengeId:x.challengeId||null});
        const key=`${deviceId}:${x.eventId}`;
        const prior=this.events.get(key);
        if(prior){
          if(prior.digest!==digest) throw Object.assign(new Error('Queued event ID was reused for different content.'),{status:409});
          results.push({...clone(prior.result),eventId:x.eventId,sequence:x.sequence,replayed:true});
          continue;
        }
        if(x.sequence!==last+1) throw Object.assign(new Error(`Device event sequence gap: expected ${last+1}. Keep later events queued.`),{status:409});

        const employeeKey=`${d.tenant}:${x.employee}`;
        const priorHeld=(this.unresolvedHeldCounts.get(employeeKey)||0)>0;
        const verification=priorHeld
          ? {ok:false,reason:'PRIOR_HELD_EVENT'}
          : this.#verifyChallenge({device:d, challengeId:x.challengeId, nowMs:serverNowMs});
        let result;
        if(verification.ok){
          // Canonical online time is server receipt time. Client wall clock survives only as evidence.
          const personalResult=this.#applyPersonal({tenant:d.tenant,employee:x.employee,type:x.type,at:serverNowMs});
          verification.challenge.usedAt=serverNowMs;
          result={
            status:'accepted', reason:null, timeTrust:'server', authoritativeAt:new Date(serverNowMs).toISOString(),
            clientCapturedAt:new Date(clientAt).toISOString(), receivedAt:new Date(serverNowMs).toISOString(),
            personalEventId:personalResult.id, challengeId:x.challengeId,
          };
        } else {
          // Durable evidence, deliberately not applied to authoritative personal state.
          result={
            status:'held', reason:'OFFLINE_OR_UNVERIFIED_TIME', holdDetail:verification.reason,
            timeTrust:'review_required', authoritativeAt:null,
            clientCapturedAt:new Date(clientAt).toISOString(), receivedAt:new Date(serverNowMs).toISOString(),
            personalEventId:null, challengeId:x.challengeId||null,
          };
          this.audit.push({tenant:d.tenant,actor:`kiosk:${deviceId}`,action:'kiosk-time-held',detail:{employee:x.employee,kind:x.type,eventId:x.eventId,reason:verification.reason},at:serverNowMs});
        }

        this.events.set(key,{tenant:d.tenant,deviceId,site:d.site,employee:x.employee,kind:x.type,sequence:x.sequence,clientAt,serverAt:serverNowMs,digest,result:clone(result)});
        if(result.status==='held')this.unresolvedHeldCounts.set(employeeKey,(this.unresolvedHeldCounts.get(employeeKey)||0)+1);
        last=x.sequence;
        this.deviceSequences.set(deviceId,last);
        results.push({...result,eventId:x.eventId,sequence:x.sequence,replayed:false});
      }catch(err){
        results.push({eventId:x?.eventId||null,sequence:x?.sequence||null,status:'rejected',error:err.message,code:err.status||400});
        break;
      }
    }
    return {deviceId,site:d.site,accepted:results.filter(x=>x.status==='accepted').length,held:results.filter(x=>x.status==='held').length,rejected:results.filter(x=>x.status==='rejected').length,lastSequence:last,results};
  }

  reviewHeld({tenant,limit=100}){
    const n=Math.max(1,Math.min(100,Number(limit)||100));
    return [...this.events.entries()]
      .filter(([,x])=>x.tenant===tenant && x.result.status==='held')
      .sort(([,a],[,b])=>b.serverAt-a.serverAt || b.sequence-a.sequence)
      .slice(0,n)
      .map(([eventKey,x])=>({
        deviceId:x.deviceId,eventId:eventKey.slice(x.deviceId.length+1),sequence:x.sequence,site:x.site,employee:x.employee,kind:x.kind,
        clientCapturedAt:new Date(x.clientAt).toISOString(),receivedAt:new Date(x.serverAt).toISOString(),reason:x.result.reason,holdDetail:x.result.holdDetail,
        resolution:this.resolutions.has(eventKey)?clone(this.resolutions.get(eventKey)):null,
      }));
  }

  resolveHeld({tenant,deviceId,eventId,decision,authoritativeAt,reviewer,reason,idempotencyKey,reviewedAtMs=Date.now()}){
    if(!tenant || !deviceId || !EVENT_ID.test(String(eventId||''))) throw Object.assign(new Error('Tenant, device and held event are required.'),{status:400});
    if(!['approve','reject'].includes(decision)) throw Object.assign(new Error('Decision must be approve or reject.'),{status:400});
    if(typeof reviewer!=='string' || reviewer.trim().length<3) throw Object.assign(new Error('Independent reviewer identity is required.'),{status:403});
    if(typeof reason!=='string' || reason.trim().length<8 || reason.length>400) throw Object.assign(new Error('A review reason of 8–400 characters is required.'),{status:400});
    if(typeof idempotencyKey!=='string' || !/^[A-Za-z0-9_.:-]{8,100}$/.test(idempotencyKey)) throw Object.assign(new Error('A valid review idempotency key is required.'),{status:400});
    if(!Number.isSafeInteger(reviewedAtMs) || reviewedAtMs<0) throw Object.assign(new Error('Invalid reviewer server time.'),{status:400});

    const eventKey=`${deviceId}:${eventId}`,event=this.events.get(eventKey);
    if(!event || event.tenant!==tenant || event.result.status!=='held') throw Object.assign(new Error('Held event not found in this tenant.'),{status:404});
    const receiptKey=`${tenant}:${reviewer}:${idempotencyKey}`;
    const proposedAt=decision==='approve'?Date.parse(String(authoritativeAt||'')):null;
    const digest=hash({eventKey,decision,authoritativeAt:decision==='approve'?String(authoritativeAt):null,reason:reason.trim()});
    const priorReceipt=this.resolutionReceipts.get(receiptKey);
    if(priorReceipt){
      if(priorReceipt.digest!==digest) throw Object.assign(new Error('Review idempotency key reused for different data.'),{status:409});
      return {...clone(priorReceipt.result),replayed:true};
    }
    const existing=this.resolutions.get(eventKey);
    if(existing) throw Object.assign(new Error('Held event is already resolved.'),{status:409});

    // Resolve an employee's held evidence strictly in durable server-receipt order.
    const unresolvedEarlier=[...this.events.entries()]
      .filter(([k,x])=>k!==eventKey && x.tenant===tenant && x.employee===event.employee && x.result.status==='held' && !this.resolutions.has(k))
      .filter(([,x])=>x.serverAt<event.serverAt || (x.serverAt===event.serverAt && x.sequence<event.sequence));
    if(unresolvedEarlier.length) throw Object.assign(new Error('Resolve earlier held evidence for this employee first.'),{status:409});

    let applied=null;
    if(decision==='approve'){
      if(!Number.isFinite(proposedAt)) throw Object.assign(new Error('A verified authoritative timestamp is required for approval.'),{status:400});
      if(proposedAt>reviewedAtMs+this.maxFutureMs || proposedAt<event.serverAt-this.maxOfflineAgeMs) throw Object.assign(new Error('Verified timestamp is outside the supported review window.'),{status:409});
      applied=this.#applyPersonal({tenant,employee:event.employee,type:event.kind,at:proposedAt});
    }
    const resolution={decision,authoritativeAt:decision==='approve'?new Date(proposedAt).toISOString():null,reviewer:reviewer.trim(),reason:reason.trim(),reviewedAt:new Date(reviewedAtMs).toISOString(),personalEventId:applied?.id||null};
    this.resolutions.set(eventKey,resolution);
    const employeeKey=`${tenant}:${event.employee}`,held=Math.max(0,(this.unresolvedHeldCounts.get(employeeKey)||0)-1);
    if(held)this.unresolvedHeldCounts.set(employeeKey,held);else this.unresolvedHeldCounts.delete(employeeKey);
    this.audit.push({tenant,actor:`reviewer:${reviewer.trim()}`,action:'kiosk-time-'+decision,detail:{deviceId,eventId,employee:event.employee,kind:event.kind,authoritativeAt:resolution.authoritativeAt,reason:resolution.reason},at:reviewedAtMs});
    const result={status:'resolved',deviceId,eventId,employee:event.employee,kind:event.kind,...resolution};
    this.resolutionReceipts.set(receiptKey,{digest,result:clone(result)});
    return {...result,replayed:false};
  }

  getPersonal({tenant,employee}){ return clone(this.personal.get(`${tenant}:${employee}`)); }

  #device(deviceId){
    const d=this.devices.get(deviceId);
    if(!d || !d.active) throw Object.assign(new Error('Device is not active.'),{status:401});
    return d;
  }

  #verifyChallenge({device,challengeId,nowMs}){
    if(!challengeId) return {ok:false,reason:'NO_ONLINE_CHALLENGE'};
    const c=this.challenges.get(challengeId);
    if(!c) return {ok:false,reason:'CHALLENGE_UNKNOWN'};
    if(c.deviceId!==device.deviceId || c.tenant!==device.tenant || c.site!==device.site) return {ok:false,reason:'CHALLENGE_WRONG_DEVICE'};
    if(c.usedAt!==null) return {ok:false,reason:'CHALLENGE_REUSED'};
    if(nowMs<c.issuedAt || nowMs>c.expiresAt) return {ok:false,reason:'CHALLENGE_EXPIRED'};
    return {ok:true,challenge:c};
  }

  #applyPersonal({tenant,employee,type,at}){
    const key=`${tenant}:${employee}`;
    const p=this.personal.get(key)??{status:'out',revision:0,events:[]};
    const transition=(p.status==='out'&&type==='in') || (p.status==='in'&&['out','break_start'].includes(type)) || (p.status==='break'&&type==='break_end');
    if(!transition) throw Object.assign(new Error('Clock state changed. Refresh before continuing.'),{status:409});
    const last=p.events.at(-1);
    if(last && at<last.at) throw Object.assign(new Error('Verified clock time moved backwards. Review the earlier event first.'),{status:409});
    const next=type==='in'?'in':type==='break_start'?'break':type==='break_end'?'in':'out';
    const id='pe-'+crypto.randomUUID();
    p.status=next; p.revision++; p.events.push({id,type,at}); this.personal.set(key,p);
    return {id,status:next,revision:p.revision};
  }
}
