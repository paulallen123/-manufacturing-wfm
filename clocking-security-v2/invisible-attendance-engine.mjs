import crypto from 'node:crypto';

const EVENT_ID = /^[A-Za-z0-9_.:-]{8,160}$/;
const ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const VALID_KINDS = new Set([
  'access_entry','access_exit','legacy_clock_in','legacy_clock_out',
  'wifi_authenticated','wifi_disconnected',
  'hmi_login','hmi_logout','workstation_login','workstation_logout',
  'site_sso_login','site_sso_logout','ranging_near','ranging_away','scanner_activity'
]);

const KIND = {
  access_entry:      { polarity:'present', domain:'physical_access', anchorIn:true,  anchorOut:false, location:true,  identity:true },
  access_exit:       { polarity:'absent',  domain:'physical_access', anchorIn:false, anchorOut:true,  location:true,  identity:true },
  legacy_clock_in:   { polarity:'present', domain:'legacy_taa',      anchorIn:true,  anchorOut:false, location:true,  identity:true },
  legacy_clock_out:  { polarity:'absent',  domain:'legacy_taa',      anchorIn:false, anchorOut:true,  location:true,  identity:true },
  wifi_authenticated:{ polarity:'present', domain:'network_auth',    anchorIn:false, anchorOut:false, location:true,  identity:true },
  wifi_disconnected: { polarity:'absent',  domain:'network_auth',    anchorIn:false, anchorOut:false, location:false, identity:true },
  hmi_login:         { polarity:'present', domain:'work_system',     anchorIn:true,  anchorOut:false, location:true,  identity:true },
  hmi_logout:        { polarity:'absent',  domain:'work_system',     anchorIn:false, anchorOut:false, location:true,  identity:true },
  workstation_login: { polarity:'present', domain:'work_device',     anchorIn:true,  anchorOut:false, location:true,  identity:true },
  workstation_logout:{ polarity:'absent',  domain:'work_device',     anchorIn:false, anchorOut:false, location:true,  identity:true },
  site_sso_login:    { polarity:'present', domain:'identity',        anchorIn:false, anchorOut:false, location:false, identity:true },
  site_sso_logout:   { polarity:'absent',  domain:'identity',        anchorIn:false, anchorOut:false, location:false, identity:true },
  ranging_near:      { polarity:'present', domain:'proximity',       anchorIn:false, anchorOut:false, location:true,  identity:false },
  ranging_away:      { polarity:'absent',  domain:'proximity',       anchorIn:false, anchorOut:false, location:true,  identity:false },
  scanner_activity:  { polarity:'present', domain:'work_activity',   anchorIn:true,  anchorOut:false, location:true,  identity:true },
};

function clone(x){ return JSON.parse(JSON.stringify(x)); }
function digest(x){ return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function iso(ms){ return new Date(ms).toISOString(); }
function err(message,status=400){ return Object.assign(new Error(message),{status}); }
function key(...parts){ return JSON.stringify(parts.map(String)); }

/**
 * AutomaticAttendanceEvidenceEngine
 *
 * Zero-interaction attendance from infrastructure a customer already owns.
 * Decisions are deterministic and auditable. Evidence is immutable/idempotent.
 * Weak/disappearing signals can never silently stop pay.
 */
export class AutomaticAttendanceEvidenceEngine {
  constructor({corroborationWindowMs=5*60_000,maxFutureMs=2*60_000,maxOfflineAgeMs=24*60*60_000,minDistinctDomains=2}={}){
    this.corroborationWindowMs=corroborationWindowMs;
    this.maxFutureMs=maxFutureMs;
    this.maxOfflineAgeMs=maxOfflineAgeMs;
    this.minDistinctDomains=minDistinctDomains;
    this.sources=new Map();
    this.people=new Map();
    this.events=new Map();
    this.employeeEvents=new Map();
    this.sessions=new Map();
    this.decisions=new Map();
    this.audit=[];
  }

  registerPerson({tenant,employee,sites=[]}){
    if(!ID.test(String(tenant||'')) || !ID.test(String(employee||'')) || !Array.isArray(sites) || sites.some(x=>!ID.test(String(x)))) throw err('Valid tenant, employee and sites required.');
    this.people.set(key(tenant,employee),{tenant,employee,sites:[...new Set(sites)]});
  }

  registerSource({tenant,sourceId,site,type,directAttendanceAuthority=false,timestampMode='source',active=true}){
    if(!ID.test(String(tenant||'')) || !ID.test(String(sourceId||'')) || !ID.test(String(site||'')) || !ID.test(String(type||''))) throw err('Valid source registration required.');
    if(!['source','server'].includes(timestampMode)) throw err('timestampMode must be source or server.');
    this.sources.set(key(tenant,sourceId),{tenant,sourceId,site,type,directAttendanceAuthority:Boolean(directAttendanceAuthority),timestampMode,active:Boolean(active)});
  }

  revokeSource({tenant,sourceId}){
    const s=this.sources.get(key(tenant,sourceId)); if(!s) return false; s.active=false; return true;
  }

  ingest({tenant,sourceId,eventId,employee,kind,observedAt,receivedAtMs=Date.now(),metadata={}}){
    if(!EVENT_ID.test(String(eventId||''))) throw err('Invalid evidence event ID.');
    if(!VALID_KINDS.has(kind)) throw err('Unsupported attendance evidence kind.');
    if(!Number.isSafeInteger(receivedAtMs) || receivedAtMs<0) throw err('Invalid server receive time.');
    const source=this.sources.get(key(tenant,sourceId));
    if(!source || !source.active) throw err('Attendance evidence source is not active.',401);
    const person=this.people.get(key(tenant,employee));
    if(!person) throw err('Employee is not registered for attendance evidence.',404);
    if(!person.sites.includes(source.site)) throw err('Employee is not assigned to this source site.',403);

    let observedMs=source.timestampMode==='server' ? receivedAtMs : Date.parse(String(observedAt||''));
    if(!Number.isFinite(observedMs)) throw err('Invalid evidence timestamp.');
    if(observedMs>receivedAtMs+this.maxFutureMs) throw err('Evidence timestamp is too far in the future.',409);
    if(observedMs<receivedAtMs-this.maxOfflineAgeMs) throw err('Evidence is outside the supported offline window.',409);

    const safeMetadata=this.#minimiseMetadata(metadata);
    const eventKey=key(tenant,sourceId,eventId);
    const content={tenant,sourceId,eventId,employee,kind,observedMs,site:source.site,metadata:safeMetadata};
    const d=digest(content);
    const prior=this.events.get(eventKey);
    if(prior){
      if(prior.digest!==d) throw err('Evidence event ID was reused for different content.',409);
      return {...clone(prior.receipt),replayed:true};
    }

    const spec=KIND[kind];
    const event={...content,domain:spec.domain,polarity:spec.polarity,anchorIn:spec.anchorIn,anchorOut:spec.anchorOut,location:spec.location,identity:spec.identity,receivedAtMs,digest:d,directAttendanceAuthority:source.directAttendanceAuthority,sourceType:source.type};
    this.events.set(eventKey,event);
    const employeeKey=key(tenant,employee,source.site);
    const list=this.employeeEvents.get(employeeKey) ?? [];
    list.push(event);
    list.sort((a,b)=>a.observedMs-b.observedMs || a.receivedAtMs-b.receivedAtMs || a.eventId.localeCompare(b.eventId));
    this.employeeEvents.set(employeeKey,list);

    const evaluation=this.#evaluate({tenant,employee,site:source.site,trigger:event,employeeKey});
    const receipt={status:'recorded',tenant,employee,site:source.site,eventId,sourceId,kind,observedAt:iso(observedMs),receivedAt:iso(receivedAtMs),decision:evaluation};
    this.events.set(eventKey,{...event,receipt:clone(receipt)});
    this.audit.push({tenant,employee,site:source.site,sourceId,eventId,action:'attendance-evidence-recorded',kind,at:receivedAtMs,decision:evaluation.status});
    return {...receipt,replayed:false};
  }

  getState({tenant,employee,site}){
    const stateKey=key(tenant,employee,site);
    return clone(this.sessions.get(stateKey) ?? {status:'outside',openAt:null,closeAt:null,lastDecision:null});
  }

  getEvidence({tenant,employee,site}){
    const employeeKey=key(tenant,employee,site);
    return clone((this.employeeEvents.get(employeeKey)??[]).map(x=>({sourceId:x.sourceId,eventId:x.eventId,kind:x.kind,observedAt:iso(x.observedMs),receivedAt:iso(x.receivedAtMs),domain:x.domain,metadata:x.metadata})));
  }

  #evaluate({tenant,employee,site,trigger,employeeKey}){
    const state=this.sessions.get(employeeKey) ?? {status:'outside',openAt:null,closeAt:null,lastDecision:null};
    const direction=state.status==='outside'?'in':'out';
    const spec=KIND[trigger.kind];

    if(trigger.directAttendanceAuthority && ((direction==='in'&&trigger.kind==='legacy_clock_in') || (direction==='out'&&trigger.kind==='legacy_clock_out'))){
      return this.#commit({employeeKey,state,tenant,employee,site,direction,at:trigger.observedMs,reason:'DIRECT_EXISTING_TAA',evidence:[trigger]});
    }

    if(direction==='in' && spec.polarity!=='present'){
      return {status:'evidence_only',direction:'in',reason:'ABSENCE_SIGNAL_CANNOT_START_ATTENDANCE'};
    }

    // Revocation is immediate for future decisions: evidence accepted before a source
    // was revoked may remain in the immutable audit record, but it cannot complete a
    // still-pending quorum after the source loses authority.
    const all=(this.employeeEvents.get(employeeKey)??[]).filter(e=>{
      const registered=this.sources.get(key(tenant,e.sourceId));
      return Boolean(registered?.active) && registered.site===site;
    });
    const cluster=all.filter(e=>Math.abs(e.observedMs-trigger.observedMs)<=this.corroborationWindowMs);
    const wanted=cluster.filter(e=>direction==='in'?e.polarity==='present':e.polarity==='absent');
    const anchors=wanted.filter(e=>direction==='in'?e.anchorIn:e.anchorOut);
    if(!anchors.length){
      if(direction==='out') return {status:'evidence_only',direction:'out',reason:'NEGATIVE_SIGNAL_CANNOT_STOP_PAY',evidenceCount:wanted.length};
      return {status:'review_required',direction,reason:'NO_TRUSTED_TIME_ANCHOR',evidenceCount:wanted.length};
    }

    const anchor=direction==='in' ? anchors[0] : anchors.at(-1);
    const near=wanted.filter(e=>Math.abs(e.observedMs-anchor.observedMs)<=this.corroborationWindowMs);
    const domains=new Set(near.map(e=>e.domain));
    const sources=new Set(near.map(e=>e.sourceId));
    const identity=near.some(e=>e.identity);
    const location=near.some(e=>e.location);
    // Logical domain diversity is necessary but not sufficient for independent
    // corroboration. One connector/source must never be able to impersonate two
    // evidence domains by emitting different event kinds and thereby clock a worker
    // in or out on its own. Existing authoritative T&A remains the explicit exception
    // handled above.
    const corroborated=domains.size>=this.minDistinctDomains && sources.size>=2 && identity && location;
    if(!corroborated){
      return {status:'review_required',direction,reason:'INSUFFICIENT_INDEPENDENT_CORROBORATION',anchorAt:iso(anchor.observedMs),domains:[...domains].sort(),sources:[...sources].sort()};
    }

    return this.#commit({employeeKey,state,tenant,employee,site,direction,at:anchor.observedMs,reason:'INDEPENDENT_CORROBORATION',evidence:near});
  }

  #commit({employeeKey,state,tenant,employee,site,direction,at,reason,evidence}){
    const fingerprint=digest({tenant,employee,site,direction,at,reason,evidence:evidence.map(e=>({sourceId:e.sourceId,eventId:e.eventId}))});
    const existing=this.decisions.get(fingerprint);
    if(existing) return clone(existing);
    if(direction==='in' && state.status!=='outside') return {status:'evidence_only',direction,reason:'ALREADY_PRESENT'};
    if(direction==='out' && state.status!=='present') return {status:'evidence_only',direction,reason:'ALREADY_OUTSIDE'};
    const decision={status:'authoritative',direction,authoritativeAt:iso(at),reason,assurance:reason==='DIRECT_EXISTING_TAA'?'existing-authoritative-source':'independent-evidence-quorum',evidence:evidence.map(e=>({sourceId:e.sourceId,eventId:e.eventId,kind:e.kind,domain:e.domain,observedAt:iso(e.observedMs)}))};
    if(direction==='in'){
      state.status='present'; state.openAt=at; state.closeAt=null;
    }else{
      if(state.openAt!==null && at<state.openAt) return {status:'review_required',direction,reason:'OUT_BEFORE_OPEN'};
      state.status='outside'; state.closeAt=at;
    }
    state.lastDecision=clone(decision);
    this.sessions.set(employeeKey,state);
    this.decisions.set(fingerprint,clone(decision));
    this.audit.push({tenant,employee,site,action:`attendance-${direction}-authoritative`,at,reason,evidenceCount:evidence.length});
    return decision;
  }

  #minimiseMetadata(metadata){
    if(!metadata || typeof metadata!=='object' || Array.isArray(metadata)) return {};
    const allowed=['providerEventId','controllerId','accessPointId','workstationId','terminalId','zoneId','sourceRevision','sequence'];
    const out={};
    for(const k of allowed){
      const v=metadata[k];
      if(['string','number','boolean'].includes(typeof v) && String(v).length<=160) out[k]=v;
    }
    return out;
  }
}
