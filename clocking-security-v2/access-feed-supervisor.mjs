function iso(ms){ return ms==null?null:new Date(ms).toISOString(); }
function keyOf(tenant,sourceId){ return \`\${tenant}:\${sourceId}\`; }

/**
 * Runtime supervisor for access-control feeds. The connector process emits a
 * heartbeat even when no-one is using a door, so quiet sites are not mistaken
 * for broken integrations. Sequence gaps and reconnects create backfill jobs.
 */
export class AccessFeedSupervisor {
  constructor({heartbeatSlaMs=30_000,lagWarningMs=5_000,authRefreshLeadMs=5*60_000}={}){
    this.heartbeatSlaMs=heartbeatSlaMs;
    this.lagWarningMs=lagWarningMs;
    this.authRefreshLeadMs=authRefreshLeadMs;
    this.connectors=new Map();
    this.recovery=[];
  }

  register({tenant,sourceId,provider,site,supportsBackfill=true,nowMs=Date.now()}){
    if(!tenant||!sourceId||!provider||!site||!Number.isSafeInteger(nowMs)) throw new Error('Valid connector registration required.');
    this.connectors.set(keyOf(tenant,sourceId),{
      tenant,sourceId,provider,site,supportsBackfill:Boolean(supportsBackfill),
      registeredAtMs:nowMs,lastHeartbeatMs:null,lastEventObservedMs:null,lastEventReceivedMs:null,
      lastSequence:null,lastProviderEventId:null,duplicates:0,gaps:0,reconnects:0,authExpiresAtMs:null,
      seen:new Set(),
    });
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
    if(c.seen.size>50_000){
      const keep=[...c.seen].slice(-25_000); c.seen=new Set(keep);
    }

    if(Number.isSafeInteger(sequence) && Number.isSafeInteger(c.lastSequence) && sequence>c.lastSequence+1){
      c.gaps++;
      this.#queueBackfill(c,{reason:'SEQUENCE_GAP',fromMs:c.lastEventObservedMs,toMs:observedMs,expected:c.lastSequence+1,received:sequence});
    }
    if(Number.isSafeInteger(sequence) && (!Number.isSafeInteger(c.lastSequence)||sequence>c.lastSequence)) c.lastSequence=sequence;
    c.lastProviderEventId=id;
    c.lastEventObservedMs=c.lastEventObservedMs==null?observedMs:Math.max(c.lastEventObservedMs,observedMs);
    c.lastEventReceivedMs=receivedAtMs;
    return {status:'recorded',lagMs:Math.max(0,receivedAtMs-observedMs),backfillQueued:c.gaps>0};
  }

  disconnected({tenant,sourceId,atMs=Date.now(),reason='STREAM_DISCONNECTED'}){
    const c=this.#get(tenant,sourceId); this.#time(atMs);
    c.lastHeartbeatMs=null;
    return {action:'reconnect',reason};
  }

  reconnected({tenant,sourceId,atMs=Date.now()}){
    const c=this.#get(tenant,sourceId); this.#time(atMs); c.reconnects++; c.lastHeartbeatMs=atMs;
    this.#queueBackfill(c,{reason:'RECONNECT_RECONCILIATION',fromMs:c.lastEventObservedMs,toMs:atMs});
    return {status:'reconnected',backfillQueued:c.supportsBackfill};
  }

  status({tenant,sourceId,nowMs=Date.now()}){
    const c=this.#get(tenant,sourceId); this.#time(nowMs);
    const heartbeatAge=c.lastHeartbeatMs==null?Infinity:Math.max(0,nowMs-c.lastHeartbeatMs);
    const lastLag=(c.lastEventObservedMs==null||c.lastEventReceivedMs==null)?null:Math.max(0,c.lastEventReceivedMs-c.lastEventObservedMs);
    let state='healthy',action='none';
    if(c.authExpiresAtMs!=null && c.authExpiresAtMs<=nowMs){ state='auth_expired'; action='refresh_auth'; }
    else if(c.authExpiresAtMs!=null && c.authExpiresAtMs-nowMs<=this.authRefreshLeadMs){ state='auth_refresh_due'; action='refresh_auth'; }
    else if(heartbeatAge>this.heartbeatSlaMs){ state='stale'; action='reconnect'; }
    else if(lastLag!=null && lastLag>this.lagWarningMs){ state='degraded'; action=c.supportsBackfill?'backfill':'observe'; }
    else if(this.recovery.some(j=>j.tenant===tenant&&j.sourceId===sourceId&&j.status==='pending')){ state='reconciling'; action='backfill'; }
    return {
      state,action,provider:c.provider,site:c.site,lastHeartbeatAt:iso(c.lastHeartbeatMs),heartbeatAgeMs:Number.isFinite(heartbeatAge)?heartbeatAge:null,
      lastEventObservedAt:iso(c.lastEventObservedMs),lastEventReceivedAt:iso(c.lastEventReceivedMs),lastLagMs:lastLag,
      duplicates:c.duplicates,gaps:c.gaps,reconnects:c.reconnects,authExpiresAt:iso(c.authExpiresAtMs)
    };
  }

  pendingRecovery({tenant,sourceId}={}){
    return this.recovery.filter(j=>(!tenant||j.tenant===tenant)&&(!sourceId||j.sourceId===sourceId)&&j.status==='pending').map(j=>({...j}));
  }

  completeRecovery({jobId}){
    const j=this.recovery.find(x=>x.jobId===jobId); if(!j) return false; j.status='complete'; return true;
  }

  #queueBackfill(c,details){
    if(!c.supportsBackfill) return;
    const signature=\`\${c.tenant}:\${c.sourceId}:\${details.reason}:\${details.fromMs??'start'}:\${details.toMs??'now'}\`;
    if(this.recovery.some(j=>j.signature===signature&&j.status==='pending')) return;
    this.recovery.push({jobId:\`recovery-\${this.recovery.length+1}\`,signature,status:'pending',tenant:c.tenant,sourceId:c.sourceId,provider:c.provider,site:c.site,...details});
  }

  #get(tenant,sourceId){ const c=this.connectors.get(keyOf(tenant,sourceId)); if(!c) throw new Error('Connector is not registered.'); return c; }
  #time(ms){ if(!Number.isSafeInteger(ms)||ms<0) throw new Error('Valid millisecond timestamp required.'); }
}
