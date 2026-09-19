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

/**
 * Independent hosted-telemetry continuity guard.
 *
 * This does not infer service health from quiet logs. Promotion evidence needs a
 * fresh sequenced heartbeat plus a recent, independently expected canary on each
 * required telemetry stream. Sequence gaps remain unresolved until every missing
 * sequence is explicitly observed through the backfill path.
 */
export class TelemetryContinuityGuard {
  constructor({
    maxCanaryLagMs=120_000,
    maxCanaryAgeMs=300_000,
    maxHeartbeatAgeMs=120_000,
    maxClockSkewMs=30_000,
    maxCanaryHistory=2048
  }={}){
    this.maxCanaryLagMs=int(maxCanaryLagMs,'maxCanaryLagMs');
    this.maxCanaryAgeMs=int(maxCanaryAgeMs,'maxCanaryAgeMs');
    this.maxHeartbeatAgeMs=int(maxHeartbeatAgeMs,'maxHeartbeatAgeMs');
    this.maxClockSkewMs=int(maxClockSkewMs,'maxClockSkewMs');
    this.maxCanaryHistory=int(maxCanaryHistory,'maxCanaryHistory');
    if(this.maxCanaryHistory<1) throw new Error('maxCanaryHistory must be at least 1.');
    this.streams=new Map();
    this.canaries=new Map();
  }

  observeHeartbeat({stream,sequence,observedAtMs,receivedAtMs=observedAtMs}){
    const name=id(stream,'stream');
    const seq=int(sequence,'sequence');
    const observed=int(observedAtMs,'observedAtMs');
    const received=int(receivedAtMs,'receivedAtMs');
    if(observed>received+this.maxClockSkewMs) throw new Error('Telemetry heartbeat timestamp is too far in the future.');

    const prev=this.streams.get(name);
    if(!prev){
      this.streams.set(name,{sequence:seq,observedAtMs:observed,receivedAtMs:received,gaps:[]});
      return true;
    }
    if(seq<=prev.sequence) throw new Error('Telemetry live heartbeat replay or sequence rollback detected.');
    if(observed<prev.observedAtMs) throw new Error('Telemetry heartbeat time rollback detected.');
    if(seq>prev.sequence+1){
      prev.gaps.push({expected:prev.sequence+1,received:seq,recovered:new Set()});
    }
    prev.sequence=seq;
    prev.observedAtMs=observed;
    prev.receivedAtMs=received;
    return true;
  }

  observeBackfillHeartbeat({stream,sequence,observedAtMs,receivedAtMs=Date.now()}){
    const name=id(stream,'stream');
    const seq=int(sequence,'sequence');
    const observed=int(observedAtMs,'observedAtMs');
    const received=int(receivedAtMs,'receivedAtMs');
    if(observed>received+this.maxClockSkewMs) throw new Error('Telemetry backfill timestamp is too far in the future.');
    const state=this.streams.get(name);
    if(!state) throw new Error('Telemetry stream has no live heartbeat state.');
    const gap=state.gaps.find(g=>seq>=g.expected&&seq<g.received);
    if(!gap) throw new Error('Telemetry backfill sequence is not part of an unresolved gap.');
    gap.recovered.add(seq);
    state.gaps=state.gaps.filter(g=>g.recovered.size!==(g.received-g.expected));
    return true;
  }

  emitCanary({canaryId,emittedAtMs,stream='http'}){
    const cid=id(canaryId,'canaryId');
    const name=id(stream,'stream');
    const emitted=int(emittedAtMs,'emittedAtMs');
    if(this.canaries.has(cid)) throw new Error('Duplicate telemetry canary ID.');
    if(this.canaries.size>=this.maxCanaryHistory) throw new Error('Telemetry canary history budget exhausted; rotate state through the durable continuity boundary.');
    this.canaries.set(cid,{canaryId:cid,stream:name,emittedAtMs:emitted,observedAtMs:null,receivedAtMs:null});
    return true;
  }

  observeCanary({canaryId,observedAtMs,receivedAtMs=observedAtMs}){
    const cid=id(canaryId,'canaryId');
    const observed=int(observedAtMs,'observedAtMs');
    const received=int(receivedAtMs,'receivedAtMs');
    const canary=this.canaries.get(cid);
    if(!canary) throw new Error('Unknown telemetry canary.');
    if(canary.observedAtMs!==null) throw new Error('Telemetry canary replay detected.');
    if(observed<canary.emittedAtMs-this.maxClockSkewMs) throw new Error('Telemetry canary was observed before emission.');
    if(observed>received+this.maxClockSkewMs) throw new Error('Telemetry canary observation timestamp is too far in the future.');
    canary.observedAtMs=observed;
    canary.receivedAtMs=received;
    return observed-canary.emittedAtMs<=this.maxCanaryLagMs;
  }

  assess({nowMs,requiredStreams=['http'],serviceExpectedLive=true}={}){
    const now=int(nowMs,'nowMs');
    const required=[...new Set(requiredStreams.map(x=>id(x,'required stream')))];
    const reasons=[];

    for(const stream of required){
      const beat=this.streams.get(stream);
      if(!beat){
        reasons.push({code:'MISSING_HEARTBEAT',stream});
      }else{
        const age=now-beat.receivedAtMs;
        if(age<0 || age>this.maxHeartbeatAgeMs) reasons.push({code:'STALE_HEARTBEAT',stream,ageMs:age});
        for(const gap of beat.gaps){
          reasons.push({code:'SEQUENCE_GAP',stream,expected:gap.expected,received:gap.received,recovered:[...gap.recovered].sort((a,b)=>a-b)});
        }
      }

      const streamCanaries=[...this.canaries.values()].filter(c=>c.stream===stream);
      for(const canary of streamCanaries){
        if(canary.observedAtMs===null && now-canary.emittedAtMs>this.maxCanaryLagMs){
          reasons.push({code:'CANARY_NOT_OBSERVED',stream,canaryId:canary.canaryId,ageMs:now-canary.emittedAtMs});
        }
      }
      const latestValid=streamCanaries
        .filter(c=>c.observedAtMs!==null && c.observedAtMs-c.emittedAtMs<=this.maxCanaryLagMs)
        .sort((a,b)=>b.observedAtMs-a.observedAtMs)[0]||null;
      if(!latestValid){
        reasons.push({code:'NO_VALID_CANARY',stream});
      }else{
        const canaryAge=now-latestValid.observedAtMs;
        if(canaryAge<0 || canaryAge>this.maxCanaryAgeMs) reasons.push({code:'STALE_CANARY',stream,canaryId:latestValid.canaryId,ageMs:canaryAge});
      }
    }

    const telemetryHealthy=reasons.length===0;
    const status=telemetryHealthy?'healthy':(serviceExpectedLive?'telemetry_loss':'telemetry_unproven');
    return Object.freeze({
      status,
      telemetryHealthy,
      releaseEligible:telemetryHealthy,
      automatedSecurityMutationAllowed:telemetryHealthy,
      containment:Object.freeze(telemetryHealthy?[]:['BLOCK_SECURITY_SENSITIVE_PROMOTION','PAUSE_AUTOMATED_SECURITY_MUTATIONS','PRESERVE_LAST_GOOD_EVIDENCE']),
      reasons:Object.freeze(clone(reasons))
    });
  }
}
