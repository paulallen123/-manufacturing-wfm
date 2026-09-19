function iso(ms){ return ms==null?null:new Date(ms).toISOString(); }
function keyOf(tenant,sourceId){ return JSON.stringify([String(tenant),String(sourceId)]); }

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
    const k=keyOf(tenant,sourceId);
    const existing=this.connectors.get(k);
    if(existing){
      const same=String(existing.provider)===String(provider)
        && String(existing.site)===String(site)
        && String(existing.domain)===String(domain)
        && existing.supportsBackfill===Boolean(supportsBackfill);
      if(!same) throw new Error('Attendance source already registered with different configuration; explicit migration required.');
      // Registration is idempotent, not a reset primitive. Re-registering an active
      // connector must preserve gaps, continuity windows, replay state and recovery.
      return this.status({tenant,sourceId,nowMs});
    }
    this.connectors.set(k,{
      tenant,sourceId,provider,site,domain,supportsBackfill:Boolean(supportsBackfill),
      registeredAtMs:nowMs,lastHeartbeatMs:null,lastEventObservedMs:null,lastEventReceivedMs:null,
      lastSequence:null,lastProviderEventId:null,duplicates:0,gaps:0,reconnects:0,authExpiresAtMs:null,
      seen:new Set(),seenWindowIds:new Set(),window:{id:null,startMs:null,continuityComplete:true,unrecoverable:false}
    });
  }

  startCertificationWindow({tenant,sourceId,windowId,startMs=Date.now()}){
    const c=this.#get(tenant,sourceId); this.#time(startMs);
    const id=String(windowId||'');
    if(!id) throw new Error('Certification window ID required.');
    if(c.window.id===id){
      if(c.window.startMs!==startMs) throw new Error('Certification window replay changed its start time.');
      // Exact replay is idempotent and preserves any continuity failure already
      // observed for this window. It must never be a way to clear an outage/gap.
      return this.status({tenant,sourceId,nowMs:startMs});
    }
    if(c.seenWindowIds.has(id)) throw new Error('Certification window ID replay requires explicit migration.');
    c.window={id,startMs,continuityComplete:true,unrecoverable:false};
    c.seenWindowIds.add(id);
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
    if(Number.isSafeInteger(sequence)) this.#recordSequenceRecovery(c,sequence);
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
      tenant:c.tenant,sourceId:c.sourceId,state,action,provider:c.provider,domain:c.domain,site:c.site,
      lastHeartbeatAt:iso(c.lastHeartbeatMs),heartbeatAgeMs:Number.isFinite(heartbeatAge)?heartbeatAge:null,
      lastEventObservedAt:iso(c.lastEventObservedMs),lastEventReceivedAt:iso(c.lastEventReceivedMs),lastLagMs:lastLag,
      duplicates:c.duplicates,gaps:c.gaps,reconnects:c.reconnects,authExpiresAt:iso(c.authExpiresAtMs),
      pendingRecovery:pending.length>0,periodCoverageComplete:this.#periodComplete(c),certificationWindowId:c.window.id
    };
  }


  exportState(){
    return {
      version:1,
      config:{heartbeatSlaMs:this.heartbeatSlaMs,lagWarningMs:this.lagWarningMs,authRefreshLeadMs:this.authRefreshLeadMs},
      connectors:[...this.connectors.values()].map(c=>({
        tenant:c.tenant,sourceId:c.sourceId,provider:c.provider,site:c.site,domain:c.domain,supportsBackfill:c.supportsBackfill,
        registeredAtMs:c.registeredAtMs,lastHeartbeatMs:c.lastHeartbeatMs,lastEventObservedMs:c.lastEventObservedMs,lastEventReceivedMs:c.lastEventReceivedMs,
        lastSequence:c.lastSequence,lastProviderEventId:c.lastProviderEventId,duplicates:c.duplicates,gaps:c.gaps,reconnects:c.reconnects,authExpiresAtMs:c.authExpiresAtMs,
        seen:[...c.seen],seenWindowIds:[...c.seenWindowIds],window:{...c.window}
      })),
      recovery:this.recovery.map(j=>({...j,...(Array.isArray(j.recoveredSequences)?{recoveredSequences:[...j.recoveredSequences]}:{})}))
    };
  }

  restoreState(state){
    if(!state || state.version!==1 || !Array.isArray(state.connectors) || !Array.isArray(state.recovery)) throw new Error('Unsupported attendance source supervisor state.');
    const cfg=state.config||{};
    if(cfg.heartbeatSlaMs!==this.heartbeatSlaMs || cfg.lagWarningMs!==this.lagWarningMs || cfg.authRefreshLeadMs!==this.authRefreshLeadMs){
      throw new Error('Attendance source supervisor configuration changed; explicit migration required.');
    }
    const next=new Map();
    for(const raw of state.connectors){
      if(!raw?.tenant||!raw?.sourceId||!raw?.provider||!raw?.site) throw new Error('Invalid persisted attendance source connector.');
      const seenWindowIds=new Set(Array.isArray(raw.seenWindowIds)?raw.seenWindowIds.map(String):[]);
      if(raw.window?.id) seenWindowIds.add(String(raw.window.id));
      const c={
        tenant:String(raw.tenant),sourceId:String(raw.sourceId),provider:String(raw.provider),site:String(raw.site),domain:String(raw.domain||'attendance'),
        supportsBackfill:Boolean(raw.supportsBackfill),registeredAtMs:raw.registeredAtMs,lastHeartbeatMs:raw.lastHeartbeatMs,
        lastEventObservedMs:raw.lastEventObservedMs,lastEventReceivedMs:raw.lastEventReceivedMs,lastSequence:raw.lastSequence,
        lastProviderEventId:raw.lastProviderEventId,duplicates:Number(raw.duplicates)||0,gaps:Number(raw.gaps)||0,reconnects:Number(raw.reconnects)||0,
        authExpiresAtMs:raw.authExpiresAtMs,seen:new Set(Array.isArray(raw.seen)?raw.seen.slice(-50_000):[]),seenWindowIds,
        window:{id:raw.window?.id??null,startMs:raw.window?.startMs??null,continuityComplete:raw.window?.continuityComplete!==false,unrecoverable:raw.window?.unrecoverable===true}
      };
      next.set(keyOf(c.tenant,c.sourceId),c);
    }
    for(const j of state.recovery){
      if(!j?.jobId||!j?.tenant||!j?.sourceId||!['pending','complete'].includes(j.status)) throw new Error('Invalid persisted attendance recovery job.');
      if(!next.has(keyOf(j.tenant,j.sourceId))) throw new Error('Persisted recovery job references unknown connector.');
      if(j.reason==='SEQUENCE_GAP' && !this.#sequenceGapStateValid(j)) throw new Error('Invalid persisted sequence-gap recovery evidence.');
    }
    this.connectors=next;
    this.recovery=state.recovery.map(j=>({...j,...(Array.isArray(j.recoveredSequences)?{recoveredSequences:[...j.recoveredSequences]}:{})}));
    return true;
  }

  pendingRecovery({tenant,sourceId}={}){
    return this.recovery
      .filter(j=>(!tenant||j.tenant===tenant)&&(!sourceId||j.sourceId===sourceId)&&j.status==='pending')
      .map(j=>({...j,...(Array.isArray(j.recoveredSequences)?{recoveredSequences:[...j.recoveredSequences]}:{})}));
  }

  completeRecovery({jobId}){
    const j=this.recovery.find(x=>x.jobId===jobId); if(!j) return false;
    if(j.reason==='SEQUENCE_GAP' && !this.#sequenceGapSatisfied(j)) return false;
    j.status='complete';
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
    const signature=JSON.stringify([String(c.tenant),String(c.sourceId),String(windowId||'no-window'),String(details.reason),String(details.fromMs??'start'),String(details.toMs??'now')]);
    if(this.recovery.some(j=>j.signature===signature&&j.status==='pending')) return;
    const sequenceEvidence=details.reason==='SEQUENCE_GAP'&&Number.isSafeInteger(details.expected)&&Number.isSafeInteger(details.received)&&details.received>details.expected
      ? {missingCount:details.received-details.expected,recoveredSequences:[]}
      : {};
    this.recovery.push({jobId:`recovery-${this.recovery.length+1}`,signature,status:'pending',tenant:c.tenant,sourceId:c.sourceId,provider:c.provider,domain:c.domain,site:c.site,windowId,...details,...sequenceEvidence});
  }
  #recordSequenceRecovery(c,sequence){
    for(const j of this.#pendingFor(c)){
      if(j.reason!=='SEQUENCE_GAP'||!Number.isSafeInteger(j.expected)||!Number.isSafeInteger(j.received)) continue;
      if(sequence<j.expected||sequence>=j.received) continue;
      if(!Array.isArray(j.recoveredSequences)) j.recoveredSequences=[];
      if(!j.recoveredSequences.includes(sequence)) j.recoveredSequences.push(sequence);
    }
  }
  #sequenceGapStateValid(j){
    if(!Number.isSafeInteger(j.expected)||!Number.isSafeInteger(j.received)||j.received<=j.expected) return false;
    const expectedCount=j.received-j.expected;
    if(!Number.isSafeInteger(j.missingCount)||j.missingCount!==expectedCount||expectedCount<=0) return false;
    if(!Array.isArray(j.recoveredSequences)||j.recoveredSequences.length>expectedCount) return false;
    const unique=new Set();
    for(const n of j.recoveredSequences){
      if(!Number.isSafeInteger(n)||n<j.expected||n>=j.received||unique.has(n)) return false;
      unique.add(n);
    }
    return true;
  }
  #sequenceGapSatisfied(j){ return this.#sequenceGapStateValid(j)&&j.recoveredSequences.length===j.missingCount; }
  #get(tenant,sourceId){ const c=this.connectors.get(keyOf(tenant,sourceId)); if(!c) throw new Error('Connector is not registered.'); return c; }
  #time(ms){ if(!Number.isSafeInteger(ms)||ms<0) throw new Error('Valid millisecond timestamp required.'); }
}
