function iso(ms){ return ms==null?null:new Date(ms).toISOString(); }
function keyOf(tenant,sourceId){ return `${tenant}:${sourceId}`; }

/**
 * Provider-neutral 24/7 continuity supervisor for all attendance evidence feeds.
 * A connector can be healthy "now" while still having missed part of a shift;
 * certification therefore tracks both live health and whole-window continuity.
 */
export class AttendanceSourceSupervisor {
  constructor({heartbeatSlaMs=30_000,lagWarningMs=5_000,authRefreshLeadMs=5*60_000}={}){
    this.heartbeatSlaMs=heartbeatSlaMs;
    this.lagWarningMs=lagWarningMs;
    this.authRefreshLeadMs=authRefreshLeadMs;
    this.connectors=new Map();
    this.recovery=[];
  }

  register({tenant,sourceId,provider,site,domain='attendance',supportsBackfill=true,nowMs=Date.now()}){
    if(!tenant||!sourceId||!provider||!site||!Number.isSafeInteger(nowMs)) throw new Error('Valid connector registration required.');
    this.connectors.set(keyOf(tenant,sourceId),{
      tenant,sourceId,provider,site,domain,supportsBackfill:Boolean(supportsBackfill),
      registeredAtMs:nowMs,lastHeartbeatMs:null,lastEventObservedMs:null,lastEventReceivedMs:null,
      lastSequence:null,lastProviderEventId:null,duplicates:0,gaps:0,reconnects:0,authExpiresAtMs:null,
      seen:new Set(),window:{id:null,startMs:null,continuityComplete:true,unrecoverable:false}
    });
  }

  startCertificationWindow({tenant,sourceId,windowId,startMs=Date.now()}){
    const c=this.#get(tenant,sourceId); this.#time(startMs);
    c.window={id:String(windowId||''),startMs,continuityComplete:true,unrecoverable:false};
    if(!c.window.id) throw new Error('Certification window ID required.');
    return this.status({tenant,sourceId,nowMs:startMs});
  }

  heartbeat({tenant,sourceId,atMs=Date.now()}){
    const c=this.#get(tenant,sourceId); this.#time(atMs); c.lastHeartbeatMs=atMs; return this.status({tenant,sourceId,nowMs:atMs});
  }

  auth({tenant,sourceId,expiresAtMs}){
    const c=this.#get(tenant,sourceId); this.#time(expiresAtMs); c.authExpiresAtMs=expiresAtMs; return true;
  }

  event({tenant,sourceId,providerEventId,observedAt,receivedAtMs=Date.now(),sequence}){
    const c=this.#get(tenant,sourceId); this.#time(receivedAtMs);
    const observedMs=Date.parse(String(observedAt||''));
    if(!Number.isFinite(observedMs)) throw new Error('Valid observedAt required.');
    const id=String(providerEventId||''); if(!id) throw new Error('providerEventId required.');
    if(c.seen.has(id)){ c.duplicates++; return {status:'duplicate',providerEventId:id}; }
    c.seen.add(id);
    if(c.seen.size>50_000) c.seen=new Set([...c.seen].slice(-25_000));

    if(Number.isSafeInteger(sequence) && Number.isSafeInteger(c.lastSequence) && sequence>c.lastSequence+1){
      c.gaps++;
      this.#markContinuityGap(c);
      this.#queueBackfill(c,{reason:'SEQUENCE_GAP',fromMs:c.lastEventObservedMs,toMs:observedMs,expected:c.lastSequence+1,received:sequence});
    }
    if(Number.isSafeInteger(sequence) && (!Number.isSafeInteger(c.lastSequence)||sequence>c.lastSequence)) c.lastSequence=sequence;
    c.lastProviderEventId=id;
    c.lastEventObservedMs=c.lastEventObservedMs==null?observedMs:Math.max(c.lastEventObservedMs,observedMs);
    c.lastEventReceivedMs=receivedAtMs;
    return {status:'recorded',lagMs:Math.max(0,receivedAtMs-observedMs),backfillQueued:this.#pendingFor(c).length>0};
  }

  disconnected({tenant,sourceId,atMs=Date.now(),reason='STREAM_DISCONNECTED'}){
    const c=this.#get(tenant,sourceId); this.#time(atMs); c.lastHeartbeatMs=null; return {action:'reconnect',reason};
  }

  reconnected({tenant,sourceId,atMs=Date.now()}){
    const c=this.#get(tenant,sourceId); this.#time(atMs); c.reconnects++; c.lastHeartbeatMs=atMs;
    this.#markContinuityGap(c);
    this.#queueBackfill(c,{reason:'RECONNECT_RECONCILIATION',fromMs:c.lastEventObservedMs,toMs:atMs});
    return {status:'reconnected',backfillQueued:c.supportsBackfill,periodCoverageComplete:this.#periodComplete(c)};
  }

  status({tenant,sourceId,nowMs=Date.now()}){
    const c=this.#get(tenant,sourceId); this.#time(nowMs);
    const heartbeatAge=c.lastHeartbeatMs==null?Infinity:Math.max(0,nowMs-c.lastHeartbeatMs);
    const lastLag=(c.lastEventObservedMs==null||c.lastEventReceivedMs==null)?null:Math.max(0,c.lastEventReceivedMs-c.lastEventObservedMs);
    const pending=this.#pendingFor(c);
    let state='healthy',action='none';
    if(c.authExpiresAtMs!=null && c.authExpiresAtMs<=nowMs){ state='auth_expired'; action='refresh_auth'; }
    else if(c.authExpiresAtMs!=null && c.authExpiresAtMs-nowMs<=this.authRefreshLeadMs){ state='auth_refresh_due'; action='refresh_auth'; }
    else if(heartbeatAge>this.heartbeatSlaMs){ state='stale'; action='reconnect'; }
    else if(lastLag!=null && lastLag>this.lagWarningMs){ state='degraded'; action=c.supportsBackfill?'backfill':'observe'; }
    else if(pending.length){ state='reconciling'; action='backfill'; }
    return {
      sourceId:c.sourceId,state,action,provider:c.provider,domain:c.domain,site:c.site,
      lastHeartbeatAt:iso(c.lastHeartbeatMs),heartbeatAgeMs:Number.isFinite(heartbeatAge)?heartbeatAge:null,
      lastEventObservedAt:iso(c.lastEventObservedMs),lastEventReceivedAt:iso(c.lastEventReceivedMs),lastLagMs:lastLag,
      duplicates:c.duplicates,gaps:c.gaps,reconnects:c.reconnects,authExpiresAt:iso(c.authExpiresAtMs),
      pendingRecovery:pending.length>0,periodCoverageComplete:this.#periodComplete(c),certificationWindowId:c.window.id
    };
  }

  pendingRecovery({tenant,sourceId}={}){
    return this.recovery.filter(j=>(!tenant||j.tenant===tenant)&&(!sourceId||j.sourceId===sourceId)&&j.status==='pending').map(j=>({...j}));
  }

  completeRecovery({jobId}){
    const j=this.recovery.find(x=>x.jobId===jobId); if(!j) return false; j.status='complete';
    const c=this.#get(j.tenant,j.sourceId);
    if(c.window.id===j.windowId && !c.window.unrecoverable && this.#pendingFor(c).length===0) c.window.continuityComplete=true;
    return true;
  }

  #periodComplete(c){
    if(!c.window.id) return null;
    return c.window.continuityComplete===true && c.window.unrecoverable!==true && this.#pendingFor(c).length===0;
  }
  #pendingFor(c){ return this.recovery.filter(j=>j.tenant===c.tenant&&j.sourceId===c.sourceId&&j.status==='pending'&&(!c.window.id||j.windowId===c.window.id)); }
  #markContinuityGap(c){
    if(!c.window.id) return;
    c.window.continuityComplete=false;
    if(!c.supportsBackfill) c.window.unrecoverable=true;
  }
  #queueBackfill(c,details){
    if(!c.supportsBackfill) return;
    const windowId=c.window.id;
    const signature=`${c.tenant}:${c.sourceId}:${windowId||'no-window'}:${details.reason}:${details.fromMs??'start'}:${details.toMs??'now'}`;
    if(this.recovery.some(j=>j.signature===signature&&j.status==='pending')) return;
    this.recovery.push({jobId:`recovery-${this.recovery.length+1}`,signature,status:'pending',tenant:c.tenant,sourceId:c.sourceId,provider:c.provider,domain:c.domain,site:c.site,windowId,...details});
  }
  #get(tenant,sourceId){ const c=this.connectors.get(keyOf(tenant,sourceId)); if(!c) throw new Error('Connector is not registered.'); return c; }
  #time(ms){ if(!Number.isSafeInteger(ms)||ms<0) throw new Error('Valid millisecond timestamp required.'); }
}
