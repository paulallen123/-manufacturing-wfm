import crypto from 'node:crypto';

function int(value,label){
  if(!Number.isSafeInteger(value) || value<0) throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}
function id(value,label){
  const s=String(value||'').trim();
  if(!/^[A-Za-z0-9._:-]{1,160}$/.test(s)) throw new Error(`${label} is invalid.`);
  return s;
}
function clone(value){ return JSON.parse(JSON.stringify(value)); }
function signatureBytes(value){
  if(Buffer.isBuffer(value)) return value;
  if(typeof value!=='string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length<16) throw new Error('Telemetry observer signature is invalid.');
  return Buffer.from(value,'base64');
}

const OBSERVATION_KINDS=new Set(['session_handoff','heartbeat','backfill_heartbeat','canary']);

export function telemetryObserverPayload({trustDomain,observerSessionId,kind,stream,sequence,continuityId,canaryId,emittedAtMs,observedAtMs}){
  const domain=id(trustDomain,'trustDomain');
  const session=id(observerSessionId,'observerSessionId');
  const observationKind=id(kind,'kind');
  if(!OBSERVATION_KINDS.has(observationKind)) throw new Error('Telemetry observation kind is invalid.');
  const name=id(stream,'stream');
  const observed=int(observedAtMs,'observedAtMs');
  const payload={v:3,trustDomain:domain,observerSessionId:session,kind:observationKind,stream:name,observedAtMs:observed};
  if(observationKind==='canary'){
    payload.canaryId=id(canaryId,'canaryId');
    payload.emittedAtMs=int(emittedAtMs,'emittedAtMs');
  }else{
    payload.sequence=int(sequence,'sequence');
    if(observationKind==='session_handoff') payload.continuityId=id(continuityId,'continuityId');
  }
  return Buffer.from(JSON.stringify(payload));
}

/**
 * Independent hosted-telemetry continuity guard.
 *
 * Promotion evidence needs a fresh observer-signed session handoff, a fresh
 * sequenced heartbeat and a recent independently expected canary on each
 * required telemetry stream. The handoff is bound to the fresh per-process
 * observer session and carries the independent observer's last durable sequence,
 * so a WFM process restart cannot silently reset sequence history and green a
 * stream that lost telemetry while the process was down.
 *
 * All observations are signed by an allow-listed independent observer and are
 * bound to one trust domain plus the current observer session. Sequence gaps
 * remain unresolved until every missing sequence is explicitly observed through
 * the signed backfill path.
 */
export class TelemetryContinuityGuard {
  #observerSessionId;

  constructor({
    trustDomain,
    trustedObservers,
    maxCanaryLagMs=120_000,
    maxCanaryAgeMs=300_000,
    maxHeartbeatAgeMs=120_000,
    maxClockSkewMs=30_000,
    maxCanaryHistory=2048
  }={}){
    this.trustDomain=id(trustDomain,'trustDomain');
    if(!Array.isArray(trustedObservers) || trustedObservers.length<1) throw new Error('At least one trusted telemetry observer is required.');
    this.trustedObservers=new Map();
    for(const entry of trustedObservers){
      const observerId=id(entry?.observerId,'observerId');
      if(this.trustedObservers.has(observerId)) throw new Error('Duplicate trusted telemetry observer.');
      if(!Array.isArray(entry?.streams) || entry.streams.length<1) throw new Error('Trusted telemetry observer must be scoped to at least one stream.');
      const streams=new Set(entry.streams.map(stream=>id(stream,'observer stream')));
      const continuityId=id(entry?.continuityId||observerId,'observer continuityId');
      let publicKey;
      try{
        publicKey=(entry.publicKey && entry.publicKey.type==='public' && entry.publicKey.asymmetricKeyType)
          ? entry.publicKey
          : crypto.createPublicKey(entry.publicKey);
      }catch{ throw new Error('Trusted telemetry observer public key is invalid.'); }
      if(publicKey.asymmetricKeyType!=='ed25519') throw new Error('Trusted telemetry observer key must use Ed25519.');
      this.trustedObservers.set(observerId,{publicKey,streams,continuityId});
    }
    this.maxCanaryLagMs=int(maxCanaryLagMs,'maxCanaryLagMs');
    this.maxCanaryAgeMs=int(maxCanaryAgeMs,'maxCanaryAgeMs');
    this.maxHeartbeatAgeMs=int(maxHeartbeatAgeMs,'maxHeartbeatAgeMs');
    this.maxClockSkewMs=int(maxClockSkewMs,'maxClockSkewMs');
    this.maxCanaryHistory=int(maxCanaryHistory,'maxCanaryHistory');
    if(this.maxCanaryHistory<1) throw new Error('maxCanaryHistory must be at least 1.');
    this.#observerSessionId=crypto.randomUUID();
    this.sessionBaselines=new Map();
    this.streams=new Map();
    this.canaries=new Map();
  }

  observerChallenge(){
    return Object.freeze({trustDomain:this.trustDomain,observerSessionId:this.#observerSessionId});
  }

  _verifyObserver({observerId,signature,kind,stream,sequence,continuityId,canaryId,emittedAtMs,observedAtMs}){
    const oid=id(observerId,'observerId');
    const observer=this.trustedObservers.get(oid);
    if(!observer) throw new Error('Telemetry observation is not from a trusted observer.');
    const name=id(stream,'stream');
    if(!observer.streams.has(name)) throw new Error('Telemetry observer is not authorised for this stream.');
    let cid;
    if(kind==='session_handoff'){
      cid=id(continuityId,'continuityId');
      if(cid!==observer.continuityId) throw new Error('Telemetry session handoff continuity identity mismatch.');
    }
    const payload=telemetryObserverPayload({trustDomain:this.trustDomain,observerSessionId:this.#observerSessionId,kind,stream:name,sequence,continuityId:cid,canaryId,emittedAtMs,observedAtMs});
    if(!crypto.verify(null,payload,observer.publicKey,signatureBytes(signature))) throw new Error('Telemetry observer signature verification failed.');
    return {observerId:oid,continuityId:observer.continuityId};
  }

  observeSessionHandoff({stream,lastSequence,observedAtMs,receivedAtMs=observedAtMs,observerId,continuityId,signature}){
    const name=id(stream,'stream');
    const seq=int(lastSequence,'lastSequence');
    const observed=int(observedAtMs,'observedAtMs');
    const received=int(receivedAtMs,'receivedAtMs');
    if(observed>received+this.maxClockSkewMs) throw new Error('Telemetry session handoff timestamp is too far in the future.');
    if(this.sessionBaselines.has(name)) throw new Error('Telemetry session handoff replay detected.');
    const verified=this._verifyObserver({observerId,signature,kind:'session_handoff',stream:name,sequence:seq,continuityId,observedAtMs:observed});
    this.sessionBaselines.set(name,{sequence:seq,observedAtMs:observed,receivedAtMs:received,observerId:verified.observerId,continuityId:verified.continuityId});
    return true;
  }

  observeHeartbeat({stream,sequence,observedAtMs,receivedAtMs=observedAtMs,observerId,signature}){
    const name=id(stream,'stream');
    const seq=int(sequence,'sequence');
    const observed=int(observedAtMs,'observedAtMs');
    const received=int(receivedAtMs,'receivedAtMs');
    if(observed>received+this.maxClockSkewMs) throw new Error('Telemetry heartbeat timestamp is too far in the future.');
    this._verifyObserver({observerId,signature,kind:'heartbeat',stream:name,sequence:seq,observedAtMs:observed});

    const baseline=this.sessionBaselines.get(name);
    if(!baseline) throw new Error('Telemetry session handoff is required before live heartbeat evidence.');
    const prev=this.streams.get(name);
    if(!prev){
      if(seq<=baseline.sequence) throw new Error('Telemetry live heartbeat replay or sequence rollback detected against session handoff.');
      if(observed<baseline.observedAtMs) throw new Error('Telemetry heartbeat time rollback detected against session handoff.');
      const gaps=[];
      if(seq>baseline.sequence+1) gaps.push({expected:baseline.sequence+1,received:seq,recovered:new Set()});
      this.streams.set(name,{sequence:seq,observedAtMs:observed,receivedAtMs:received,gaps,observerId:id(observerId,'observerId')});
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
    prev.observerId=id(observerId,'observerId');
    return true;
  }

  observeBackfillHeartbeat({stream,sequence,observedAtMs,receivedAtMs=Date.now(),observerId,signature}){
    const name=id(stream,'stream');
    const seq=int(sequence,'sequence');
    const observed=int(observedAtMs,'observedAtMs');
    const received=int(receivedAtMs,'receivedAtMs');
    if(observed>received+this.maxClockSkewMs) throw new Error('Telemetry backfill timestamp is too far in the future.');
    this._verifyObserver({observerId,signature,kind:'backfill_heartbeat',stream:name,sequence:seq,observedAtMs:observed});
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
    this.canaries.set(cid,{canaryId:cid,stream:name,emittedAtMs:emitted,observedAtMs:null,receivedAtMs:null,observerId:null});
    return true;
  }

  observeCanary({canaryId,observedAtMs,receivedAtMs=observedAtMs,observerId,signature}){
    const cid=id(canaryId,'canaryId');
    const observed=int(observedAtMs,'observedAtMs');
    const received=int(receivedAtMs,'receivedAtMs');
    const canary=this.canaries.get(cid);
    if(!canary) throw new Error('Unknown telemetry canary.');
    if(canary.observedAtMs!==null) throw new Error('Telemetry canary replay detected.');
    if(observed<canary.emittedAtMs-this.maxClockSkewMs) throw new Error('Telemetry canary was observed before emission.');
    if(observed>received+this.maxClockSkewMs) throw new Error('Telemetry canary observation timestamp is too far in the future.');
    const verified=this._verifyObserver({observerId,signature,kind:'canary',stream:canary.stream,canaryId:cid,emittedAtMs:canary.emittedAtMs,observedAtMs:observed});
    canary.observedAtMs=observed;
    canary.receivedAtMs=received;
    canary.observerId=verified.observerId;
    return observed-canary.emittedAtMs<=this.maxCanaryLagMs;
  }

  assess({nowMs,requiredStreams=['http'],serviceExpectedLive=true}={}){
    const now=int(nowMs,'nowMs');
    const required=[...new Set(requiredStreams.map(x=>id(x,'required stream')))];
    const reasons=[];

    for(const stream of required){
      const baseline=this.sessionBaselines.get(stream);
      if(!baseline) reasons.push({code:'MISSING_SESSION_HANDOFF',stream});

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
      const validCanaries=streamCanaries
        .filter(c=>c.observedAtMs!==null && c.observedAtMs-c.emittedAtMs<=this.maxCanaryLagMs)
        .sort((a,b)=>b.observedAtMs-a.observedAtMs);
      const latestValid=validCanaries[0]||null;

      for(const canary of streamCanaries){
        if(canary.observedAtMs!==null || now-canary.emittedAtMs<=this.maxCanaryLagMs) continue;
        const recoveredByLaterCanary=Boolean(latestValid && latestValid.emittedAtMs>canary.emittedAtMs);
        if(!recoveredByLaterCanary){
          reasons.push({code:'CANARY_NOT_OBSERVED',stream,canaryId:canary.canaryId,ageMs:now-canary.emittedAtMs});
        }
      }

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
