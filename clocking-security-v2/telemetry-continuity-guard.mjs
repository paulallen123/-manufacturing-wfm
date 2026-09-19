function int(value,label){
  if(!Number.isSafeInteger(value) || value<0) throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}
function id(value,label){
  const s=String(value||'').trim();
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(s)) throw new Error(`${label} is invalid.`);
  return s;
}
function clone(value){ return JSON.parse(JSON.stringify(value)); }

export class TelemetryContinuityGuard {
  constructor({maxCanaryLagMs=120_000,maxHeartbeatAgeMs=120_000,maxClockSkewMs=30_000,maxOpenCanaries=512}={}){
    this.maxCanaryLagMs=int(maxCanaryLagMs,'maxCanaryLagMs');
    this.maxHeartbeatAgeMs=int(maxHeartbeatAgeMs,'maxHeartbeatAgeMs');
    this.maxClockSkewMs=int(maxClockSkewMs,'maxClockSkewMs');
    this.maxOpenCanaries=int(maxOpenCanaries,'maxOpenCanaries');
    if(this.maxOpenCanaries<1) throw new Error('maxOpenCanaries must be at least 1.');
    this.streams=new Map();
    this.canaries=new Map();
    this.events=[];
  }

  observeHeartbeat({stream,sequence,observedAtMs,receivedAtMs=observedAtMs}){
    const name=id(stream,'stream');
    const seq=int(sequence,'sequence');
    const observed=int(observedAtMs,'observedAtMs');
    const received=int(receivedAtMs,'receivedAtMs');
    if(observed>received+this.maxClockSkewMs) throw new Error('Telemetry heartbeat timestamp is too far in the future.');
    const prev=this.streams.get(name);
    if(prev){
      if(seq<=prev.sequence) throw new Error('Telemetry heartbeat replay or sequence rollback detected.');
      if(seq!==prev.sequence+1) this.#event('sequence_gap',{stream:name,expected:prev.sequence+1,received:seq});
      if(observed<prev.observedAtMs) throw new Error('Telemetry heartbeat time rollback detected.');
    }
    this.streams.set(name,{sequence:seq,observedAtMs:observed,receivedAtMs:received});
    return true;
  }

  emitCanary({canaryId,emittedAtMs,stream='http'}){
    const cid=id(canaryId,'canaryId');
    const name=id(stream,'stream');
    const emitted=int(emittedAtMs,'emittedAtMs');
    if(this.canaries.has(cid)) throw new Error('Duplicate telemetry canary ID.');
    if(this.canaries.size>=this.maxOpenCanaries) throw new Error('Telemetry canary budget exhausted.');
    this.canaries.set(cid,{canaryId:cid,stream:name,emittedAtMs:emitted,observedAtMs:null});
    return true;
  }

  observeCanary({canaryId,observedAtMs}){
    const cid=id(canaryId,'canaryId');
    const observed=int(observedAtMs,'observedAtMs');
    const canary=this.canaries.get(cid);
    if(!canary) throw new Error('Unknown telemetry canary.');
    if(canary.observedAtMs!==null) throw new Error('Telemetry canary replay detected.');
    if(observed<canary.emittedAtMs-this.maxClockSkewMs) throw new Error('Telemetry canary was observed before emission.');
    canary.observedAtMs=observed;
    return true;
  }

  assess({nowMs,requiredStreams=['http'],serviceExpectedLive=true}={}){
    const now=int(nowMs,'nowMs');
    const required=[...new Set(requiredStreams.map(x=>id(x,'required stream')))];
    const reasons=[];
    for(const stream of required){
      const beat=this.streams.get(stream);
      if(!beat) reasons.push({code:'MISSING_HEARTBEAT',stream});
      else if(now-beat.receivedAtMs>this.maxHeartbeatAgeMs) reasons.push({code:'STALE_HEARTBEAT',stream,ageMs:now-beat.receivedAtMs});
    }
    for(const event of this.events){
      if(event.code==='sequence_gap' && required.includes(event.details.stream)) reasons.push({code:'SEQUENCE_GAP',...event.details});
    }
    for(const canary of this.canaries.values()){
      if(!required.includes(canary.stream)) continue;
      if(canary.observedAtMs===null && now-canary.emittedAtMs>this.maxCanaryLagMs){
        reasons.push({code:'CANARY_NOT_OBSERVED',stream:canary.stream,canaryId:canary.canaryId,ageMs:now-canary.emittedAtMs});
      }
    }
    const telemetryHealthy=reasons.length===0;
    const status=telemetryHealthy?'healthy':(serviceExpectedLive?'telemetry_loss':'telemetry_unproven');
    return {
      status,
      telemetryHealthy,
      releaseEligible:telemetryHealthy,
      automatedSecurityMutationAllowed:telemetryHealthy,
      containment:telemetryHealthy?[]:['BLOCK_SECURITY_SENSITIVE_PROMOTION','PAUSE_AUTOMATED_SECURITY_MUTATIONS','PRESERVE_LAST_GOOD_EVIDENCE'],
      reasons:clone(reasons)
    };
  }

  #event(code,details){ this.events.push({code,details:clone(details)}); }
}
