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

const SOURCE_KIND_DEFAULTS = new Map([
  ['access',['access_entry','access_exit']],
  ['access-control',['access_entry','access_exit']],
  ['radius',['wifi_authenticated','wifi_disconnected']],
  ['wifi',['wifi_authenticated','wifi_disconnected']],
  ['network',['wifi_authenticated','wifi_disconnected']],
  ['mes',['hmi_login','hmi_logout']],
  ['hmi',['hmi_login','hmi_logout']],
  ['windows',['workstation_login','workstation_logout']],
  ['windows_wef',['workstation_login','workstation_logout']],
  ['workstation',['workstation_login','workstation_logout']],
  ['wef',['workstation_login','workstation_logout']],
  ['legacy',['legacy_clock_in','legacy_clock_out']],
  ['legacy_taa',['legacy_clock_in','legacy_clock_out']],
  ['taa',['legacy_clock_in','legacy_clock_out']],
  ['t&a',['legacy_clock_in','legacy_clock_out']],
  ['sso',['site_sso_login','site_sso_logout']],
  ['identity',['site_sso_login','site_sso_logout']],
  ['ranging',['ranging_near','ranging_away']],
  ['proximity',['ranging_near','ranging_away']],
  ['scanner',['scanner_activity']]
]);
const DIRECT_TAA_TYPES = new Set(['legacy','legacy_taa','taa','t&a']);

function clone(x){ return JSON.parse(JSON.stringify(x)); }
function digest(x){ return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex'); }
function iso(ms){ return new Date(ms).toISOString(); }
function err(message,status=400){ return Object.assign(new Error(message),{status}); }
function key(...parts){ return JSON.stringify(parts.map(String)); }
function normaliseAllowedKinds(type,allowedKinds){
  const normalizedType=String(type||'').toLowerCase();
  const defaults=SOURCE_KIND_DEFAULTS.get(normalizedType);
  const raw=allowedKinds===undefined ? defaults : allowedKinds;
  if(!Array.isArray(raw) || raw.length===0 || raw.some(kind=>!VALID_KINDS.has(String(kind)))) throw err('Attendance source must declare supported evidence kinds.');
  const kinds=[...new Set(raw.map(String))].sort();
  // A known physical/provider source type has a fixed trust boundary. Explicit
  // configuration may narrow that capability, but it must never widen it into a
  // different evidence domain (for example an access connector claiming Wi-Fi
  // authentication). Otherwise two logical source IDs from one source family can
  // manufacture the "independent" domains required for automatic attendance.
  if(defaults && kinds.some(kind=>!defaults.includes(kind))) throw err('Known attendance source type cannot declare evidence kinds outside its trusted capability.');
  return kinds;
}

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
    const personKey=key(tenant,employee);
    const normalizedSites=[...new Set(sites.map(String))];
    const prior=this.people.get(personKey);
    let assignmentGeneration=Number.isSafeInteger(prior?.assignmentGeneration) && prior.assignmentGeneration>0 ? prior.assignmentGeneration : 1;
    if(prior){
      const before=[...new Set((prior.sites??[]).map(String))].sort();
      const after=[...normalizedSites].sort();
      if(JSON.stringify(before)!==JSON.stringify(after)) assignmentGeneration+=1;
    }
    this.people.set(personKey,{tenant,employee,sites:normalizedSites,assignmentGeneration});
  }

  registerSource({tenant,sourceId,site,type,directAttendanceAuthority=false,timestampMode='source',active=true,allowedKinds}){
    if(!ID.test(String(tenant||'')) || !ID.test(String(sourceId||'')) || !ID.test(String(site||'')) || !ID.test(String(type||''))) throw err('Valid source registration required.');
    if(!['source','server'].includes(timestampMode)) throw err('timestampMode must be source or server.');
    const normalizedType=String(type).toLowerCase();
    const normalizedAllowedKinds=normaliseAllowedKinds(type,allowedKinds);
    const directAuthority=Boolean(directAttendanceAuthority);
    if(directAuthority && !DIRECT_TAA_TYPES.has(normalizedType)) throw err('Direct attendance authority is reserved for explicitly recognised existing T&A source types.');
    if(directAuthority && timestampMode!=='source') throw err('Direct attendance authority requires the source event timestamp.');
    if(directAuthority && normalizedAllowedKinds.some(kind=>kind!=='legacy_clock_in'&&kind!=='legacy_clock_out')) throw err('Direct attendance authority may emit only existing T&A clock events.');
    const sourceKey=key(tenant,sourceId);
    const normalized={tenant,sourceId,site,type,directAttendanceAuthority:directAuthority,timestampMode,active:Boolean(active),allowedKinds:normalizedAllowedKinds};
    const prior=this.sources.get(sourceKey);
    let authorityGeneration=Number.isSafeInteger(prior?.authorityGeneration) && prior.authorityGeneration>0 ? prior.authorityGeneration : 1;
    if(prior){
      const changed=prior.site!==normalized.site || prior.type!==normalized.type || prior.directAttendanceAuthority!==normalized.directAttendanceAuthority || prior.timestampMode!==normalized.timestampMode || prior.active!==normalized.active || JSON.stringify(prior.allowedKinds)!==JSON.stringify(normalized.allowedKinds);
      if(changed) authorityGeneration+=1;
    }
    this.sources.set(sourceKey,{...normalized,authorityGeneration});
  }

  revokeSource({tenant,sourceId}){
    const s=this.sources.get(key(tenant,sourceId)); if(!s) return false;
    if(s.active){
      s.active=false;
      s.authorityGeneration=(Number.isSafeInteger(s.authorityGeneration) && s.authorityGeneration>0 ? s.authorityGeneration : 1)+1;
    }
    return true;
  }

  ingest({tenant,sourceId,eventId,employee,kind,observedAt,receivedAtMs=Date.now(),metadata={}}){
    if(!EVENT_ID.test(String(eventId||''))) throw err('Invalid evidence event ID.');
    if(!VALID_KINDS.has(kind)) throw err('Unsupported attendance evidence kind.');
    if(!Number.isSafeInteger(receivedAtMs) || receivedAtMs<0) throw err('Invalid server receive time.');
    const source=this.sources.get(key(tenant,sourceId));
    if(!source || !source.active) throw err('Attendance evidence source is not active.',401);
    if(!Array.isArray(source.allowedKinds) || !source.allowedKinds.includes(kind)) throw err('Attendance evidence kind is not authorised for this source.',403);
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
    const event={...content,domain:spec.domain,polarity:spec.polarity,anchorIn:spec.anchorIn,anchorOut:spec.anchorOut,location:spec.location,identity:spec.identity,receivedAtMs,digest:d,directAttendanceAuthority:source.directAttendanceAuthority,sourceType:source.type,sourceAuthorityGeneration:Number.isSafeInteger(source.authorityGeneration)&&source.authorityGeneration>0?source.authorityGeneration:1,personAssignmentGeneration:Number.isSafeInteger(person.assignmentGeneration)&&person.assignmentGeneration>0?person.assignmentGeneration:1};
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
    if(direction==='in' && state.closeAt!==null && trigger.observedMs<=state.closeAt){
      return {status:'review_required',direction:'in',reason:'IN_NOT_AFTER_PRIOR_CLOSE'};
    }
    if(direction==='out' && state.openAt!==null && trigger.observedMs<=state.openAt && spec.anchorOut){
      return {status:'review_required',direction:'out',reason:'OUT_BEFORE_OPEN'};
    }

    // Revocation and employee/site assignment changes are immediate for future
    // decisions. Evidence remains immutable/auditable, but evidence accepted under
    // an older authority generation cannot complete a still-pending quorum after
    // either the source or the employee/site assignment changes.
    const currentPerson=this.people.get(key(tenant,employee));
    const currentAssignmentGeneration=Number.isSafeInteger(currentPerson?.assignmentGeneration)&&currentPerson.assignmentGeneration>0?currentPerson.assignmentGeneration:1;
    const all=(this.employeeEvents.get(employeeKey)??[]).filter(e=>{
      const registered=this.sources.get(key(tenant,e.sourceId));
      const currentGeneration=Number.isSafeInteger(registered?.authorityGeneration)&&registered.authorityGeneration>0?registered.authorityGeneration:1;
      const eventGeneration=Number.isSafeInteger(e.sourceAuthorityGeneration)&&e.sourceAuthorityGeneration>0?e.sourceAuthorityGeneration:1;
      const eventAssignmentGeneration=Number.isSafeInteger(e.personAssignmentGeneration)&&e.personAssignmentGeneration>0?e.personAssignmentGeneration:1;
      return Boolean(registered?.active) && registered.site===site && eventGeneration===currentGeneration && eventAssignmentGeneration===currentAssignmentGeneration;
    });
    // Evidence from a prior attendance session must never be recycled to satisfy
    // a new quorum. For IN, every corroborator must be strictly after the prior
    // authoritative close. For OUT, every corroborator must belong to the currently
    // open session. This keeps the quorum bound to the transition it is proving.
    const sessionBounded=all.filter(e=>{
      if(direction==='in' && state.closeAt!==null) return e.observedMs>state.closeAt;
      if(direction==='out' && state.openAt!==null) return e.observedMs>=state.openAt;
      return true;
    });
    const cluster=sessionBounded.filter(e=>Math.abs(e.observedMs-trigger.observedMs)<=this.corroborationWindowMs);
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
    if(direction==='in' && state.closeAt!==null && at<=state.closeAt) return {status:'review_required',direction,reason:'IN_NOT_AFTER_PRIOR_CLOSE'};
    const decision={status:'authoritative',direction,authoritativeAt:iso(at),reason,assurance:reason==='DIRECT_EXISTING_TAA'?'existing-authoritative-source':'independent-evidence-quorum',evidence:evidence.map(e=>({sourceId:e.sourceId,eventId:e.eventId,kind:e.kind,domain:e.domain,observedAt:iso(e.observedMs)}))};
    if(direction==='in'){
      state.status='present'; state.openAt=at; state.closeAt=null;
    }else{
      if(state.openAt!==null && at<=state.openAt) return {status:'review_required',direction,reason:'OUT_BEFORE_OPEN'};
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