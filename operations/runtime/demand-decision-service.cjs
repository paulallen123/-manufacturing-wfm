'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { normaliseDemandSignal, rankDemandProblems } = require('./customer-demand-intelligence.cjs');
const { buildAbsenceRecoveryShadow } = require('./absence-recovery-shadow.cjs');
const { evaluateDeliveryDisruption } = require('./delivery-disruption-shadow.cjs');

const PREFIX = '/api/operations/intelligence';
const INTERNAL_HEADER = 'x-wfm-demand-internal';

function nowIso(){ return new Date().toISOString(); }
function sha256(v){ return createHash('sha256').update(String(v)).digest('hex'); }
function snapshotJson(value,seen=new WeakSet()){
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object'||seen.has(value))throw Object.assign(new Error('Invalid delivery input.'),{statusCode:400});
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(!array&&prototype!==Object.prototype&&prototype!==null)throw Object.assign(new Error('Invalid delivery input.'),{statusCode:400});
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(array&&(!Number.isSafeInteger(value.length)||Object.keys(descriptors).some(k=>k!=='length'&&!/^(0|[1-9]\d*)$/.test(k))))
    throw Object.assign(new Error('Invalid delivery input.'),{statusCode:400});
  seen.add(value);
  const copy=array?[]:{};
  if(array)copy.length=value.length;
  for(const key of Reflect.ownKeys(value)){
    if(array&&key==='length')continue;
    const d=descriptors[key];
    if(typeof key!=='string'||!d?.enumerable||!Object.hasOwn(d,'value')||array&&Number(key)>=value.length)
      throw Object.assign(new Error('Invalid delivery input.'),{statusCode:400});
    Object.defineProperty(copy,key,{value:snapshotJson(d.value,seen),enumerable:true,writable:true,configurable:true});
  }
  if(array&&Object.keys(copy).length!==value.length)throw Object.assign(new Error('Invalid delivery input.'),{statusCode:400});
  seen.delete(value);
  return copy;
}
function deepFreezeJson(value){
  if(value&&typeof value==='object'){for(const v of Object.values(value))deepFreezeJson(v);Object.freeze(value);}
  return value;
}
function compact(v,max=240){ return String(v??'').trim().slice(0,max); }
function secureEqual(a,b){
  const x=Buffer.from(String(a||'')), y=Buffer.from(String(b||''));
  return x.length>0 && x.length===y.length && timingSafeEqual(x,y);
}
function cookieToken(req){
  for(const part of String(req?.headers?.cookie||'').split(';')){
    const p=part.trim();
    if(p.startsWith('wfm_session=')) return p.slice(12);
  }
  return '';
}
function pathOf(req){ return String(req?.url||'/').split('?')[0]||'/'; }
function writeJson(res,status,body){
  if(res.headersSent||res.writableEnded) return true;
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(body));
  return true;
}
async function readJson(req,max=128*1024){
  let size=0; const chunks=[];
  for await(const chunk of req){
    const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk); size+=b.length;
    if(size>max){ const e=new Error('Request body too large.'); e.statusCode=413; throw e; }
    chunks.push(b);
  }
  if(!chunks.length) return {};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{const e=new Error('Invalid JSON body.');e.statusCode=400;throw e;}
}
function tableExists(db,name){
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
}
function lifecycleDemandSignal(row){
  const kind=compact(row.kind,40).toUpperCase();
  const mapping={
    ABSENCE:{
      decisionKey:'absence-recovery',severity:4,frequency:4,economicImpact:3,productionImpact:5,adminImpact:3,risk:2,
      outcomeKpis:['coverage-gap-minutes','plan-attainment','overtime-cost'],
      falsification:'Reject if shadow recommendations do not reduce coverage loss or controllable labour cost without increasing risk.'
    },
    OVERTIME_OVERRIDE:{
      decisionKey:'overtime-control',severity:3,frequency:4,economicImpact:5,productionImpact:3,adminImpact:2,risk:2,
      outcomeKpis:['overtime-cost','plan-attainment','fatigue-policy-breaches'],
      falsification:'Reject if recommendations do not reduce controllable overtime cost without worse output or policy compliance.'
    },
    AGENCY_ASSIGNMENT:{
      decisionKey:'agency-labour-control',severity:3,frequency:3,economicImpact:5,productionImpact:4,adminImpact:3,risk:2,
      outcomeKpis:['agency-cost','fill-rate','plan-attainment'],
      falsification:'Reject if alternatives do not reduce agency cost or improve fill rate without worse output or compliance.'
    },
    INTEGRATION_OUTAGE:{
      decisionKey:'integration-recovery',severity:4,frequency:2,economicImpact:3,productionImpact:3,adminImpact:5,risk:4,
      outcomeKpis:['recovery-time','manual-interventions','data-freshness'],
      falsification:'Reject if recovery automation does not reduce outage duration or manual intervention while preserving source authority.'
    }
  };
  const m=mapping[kind];
  if(!m) return null;
  return normaliseDemandSignal({
    signalId:'lifecycle:'+compact(row.id,160),
    accountRef:compact(row.tenant,160)||null,
    segment:'unknown',
    persona:'operations-manager',
    manufacturingArchetype:'unknown',
    geography:'unknown',
    decisionKey:m.decisionKey,
    sourceType:'product-telemetry',
    evidenceType:'operational',
    observedAt:row.created_at || new Date(Number(row.effective_at_ms||Date.now())).toISOString(),
    severity:m.severity,frequency:m.frequency,economicImpact:m.economicImpact,
    productionImpact:m.productionImpact,adminImpact:m.adminImpact,
    evidenceConfidence:0.95,strategicFit:0.95,differentiation:0.8,reusePotential:0.95,
    integrationReadiness:0.9,outcomeProvability:0.9,implementationEffort:2,adoptionBurden:1,
    risk:m.risk,reversible:true,outcomeKpis:m.outcomeKpis,falsification:m.falsification
  });
}

function createDemandDecisionService(options={}){
  const dbPath=options.dbPath||process.env.WFM_DB;
  const internalToken=options.internalToken||process.env.WFM_DEMAND_INTERNAL_TOKEN||process.env.WFM_INTEGRATION_INTERNAL_TOKEN||'';
  const publishEvent=typeof options.publishEvent==='function'?options.publishEvent:null;
  const verifyDeliveryEvidence=typeof options.verifyDeliveryEvidence==='function'?options.verifyDeliveryEvidence:null;
  if(!dbPath) throw new Error('Demand decision service requires WFM_DB.');
  const db=new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;'+
    'CREATE TABLE IF NOT EXISTS vector_demand_signals('+
      'tenant TEXT NOT NULL,signal_id TEXT NOT NULL,signal_json TEXT NOT NULL,created_at TEXT NOT NULL,'+
      'PRIMARY KEY(tenant,signal_id));'+
    'CREATE TRIGGER IF NOT EXISTS no_vector_demand_signal_update BEFORE UPDATE ON vector_demand_signals '+
      "BEGIN SELECT RAISE(ABORT,'Vector demand signals are append only.'); END;"+
    'CREATE TRIGGER IF NOT EXISTS no_vector_demand_signal_delete BEFORE DELETE ON vector_demand_signals '+
      "BEGIN SELECT RAISE(ABORT,'Vector demand signals are append only.'); END;"+
    'CREATE TABLE IF NOT EXISTS vector_decision_episodes('+
      'tenant TEXT NOT NULL,episode_id TEXT NOT NULL,decision_type TEXT NOT NULL,episode_json TEXT NOT NULL,created_at TEXT NOT NULL,'+
      'PRIMARY KEY(tenant,episode_id));'+
    'CREATE TRIGGER IF NOT EXISTS no_vector_decision_episode_update BEFORE UPDATE ON vector_decision_episodes '+
      "BEGIN SELECT RAISE(ABORT,'Vector decision episodes are append only.'); END;"+
    'CREATE TRIGGER IF NOT EXISTS no_vector_decision_episode_delete BEFORE DELETE ON vector_decision_episodes '+
      "BEGIN SELECT RAISE(ABORT,'Vector decision episodes are append only.'); END;"+
    'CREATE TABLE IF NOT EXISTS vector_delivery_disruption_shadows('+
      'tenant TEXT NOT NULL,digest TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,'+
      'PRIMARY KEY(tenant,digest));'+
    'CREATE TRIGGER IF NOT EXISTS no_vector_delivery_shadow_update BEFORE UPDATE ON vector_delivery_disruption_shadows '+
      "BEGIN SELECT RAISE(ABORT,'Vector delivery shadows are append only.'); END;"+
    'CREATE TRIGGER IF NOT EXISTS no_vector_delivery_shadow_delete BEFORE DELETE ON vector_delivery_disruption_shadows '+
      "BEGIN SELECT RAISE(ABORT,'Vector delivery shadows are append only.'); END;"
  );

  const auth=db.prepare('SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  const signalById=db.prepare('SELECT signal_json FROM vector_demand_signals WHERE tenant=? AND signal_id=?');
  const insertSignal=db.prepare('INSERT INTO vector_demand_signals(tenant,signal_id,signal_json,created_at) VALUES(?,?,?,?)');
  const tenantSignals=db.prepare('SELECT signal_json FROM vector_demand_signals WHERE tenant=? ORDER BY created_at,signal_id');
  const episodeById=db.prepare('SELECT episode_json FROM vector_decision_episodes WHERE tenant=? AND episode_id=?');
  const insertEpisode=db.prepare('INSERT INTO vector_decision_episodes(tenant,episode_id,decision_type,episode_json,created_at) VALUES(?,?,?,?,?)');
  const tenantEpisodes=db.prepare('SELECT episode_json FROM vector_decision_episodes WHERE tenant=? ORDER BY created_at DESC,episode_id DESC LIMIT ?');
  const deliveryById=db.prepare('SELECT result_json FROM vector_delivery_disruption_shadows WHERE tenant=? AND digest=?');
  const insertDelivery=db.prepare('INSERT INTO vector_delivery_disruption_shadows(tenant,digest,result_json,created_at) VALUES(?,?,?,?)');
  const tenantDeliveries=db.prepare('SELECT result_json FROM vector_delivery_disruption_shadows WHERE tenant=? ORDER BY created_at DESC,digest DESC LIMIT 20');

  function ctx(req){
    const token=cookieToken(req);
    return token?auth.get(sha256(token),Date.now())||null:null;
  }
  function requireManager(req,res){
    const c=ctx(req);
    if(!c){writeJson(res,401,{error:'Sign in is required.'});return null;}
    if(String(c.role).toLowerCase()==='employee'){
      writeJson(res,403,{error:'Decision intelligence requires an authorised manager or administrator.'});return null;
    }
    return c;
  }
  function requireInternal(req,res){
    if(!internalToken){writeJson(res,503,{error:'Trusted demand intelligence worker is not configured.'});return false;}
    if(!secureEqual(req?.headers?.[INTERNAL_HEADER],internalToken)){
      writeJson(res,403,{error:'Trusted demand intelligence worker is required.'});return false;
    }
    return true;
  }
  function storedSignals(tenant){
    return tenantSignals.all(tenant).map(r=>JSON.parse(r.signal_json));
  }
  function derivedSignals(tenant){
    if(!tableExists(db,'workforce_lifecycle_events')) return [];
    const rows=db.prepare(
      'SELECT id,tenant,kind,effective_at_ms,created_at FROM workforce_lifecycle_events '+
      "WHERE tenant=? AND status='ACCEPTED' AND kind IN ('ABSENCE','OVERTIME_OVERRIDE','AGENCY_ASSIGNMENT','INTEGRATION_OUTAGE') "+
      'ORDER BY effective_at_ms DESC,id DESC LIMIT 500'
    ).all(tenant);
    return rows.map(lifecycleDemandSignal).filter(Boolean);
  }
  function demandForTenant(tenant){
    const seen=new Map();
    for(const signal of [...storedSignals(tenant),...derivedSignals(tenant)]){
      if(signal?.signalId) seen.set(signal.signalId,signal);
    }
    const signals=[...seen.values()];
    return {signals,problems:rankDemandProblems(signals)};
  }
  function recentEpisodes(tenant,limit=20){
    return tenantEpisodes.all(tenant,Math.max(1,Math.min(50,Number(limit)||20))).map(r=>JSON.parse(r.episode_json));
  }
  async function ingestSignal(req,res){
    if(!requireInternal(req,res)) return true;
    const body=await readJson(req);
    const tenant=compact(body.tenant,120);
    if(!tenant) return writeJson(res,400,{error:'tenant is required.'});
    const signal=normaliseDemandSignal(body.signal||{});
    const existing=signalById.get(tenant,signal.signalId);
    if(existing) return writeJson(res,200,{signal:JSON.parse(existing.signal_json),idempotent:true});
    insertSignal.run(tenant,signal.signalId,JSON.stringify(signal),nowIso());
    try{publishEvent?.({tenant,topic:'demand.updated',audience:'manager',payload:{signalId:signal.signalId}});}catch{}
    return writeJson(res,201,{signal,idempotent:false});
  }
  async function ingestAbsenceShadow(req,res){
    if(!requireInternal(req,res)) return true;
    const body=await readJson(req);
    const tenant=compact(body.tenant,120);
    if(!tenant) return writeJson(res,400,{error:'tenant is required.'});
    const shadow=buildAbsenceRecoveryShadow({...body.input,tenant});
    const episode=shadow.episode;
    const existing=episodeById.get(tenant,episode.episodeId);
    if(existing) return writeJson(res,200,{shadow:{...shadow,episode:JSON.parse(existing.episode_json)},idempotent:true});
    insertEpisode.run(tenant,episode.episodeId,episode.decisionType,JSON.stringify(episode),nowIso());
    try{publishEvent?.({tenant,topic:'autopilot.shadow.updated',audience:'manager',payload:{episodeId:episode.episodeId}});}catch{}
    return writeJson(res,201,{shadow,idempotent:false});
  }
  async function ingestDeliveryShadow(req,res){
    if(!requireInternal(req,res))return true;
    if(!verifyDeliveryEvidence)return writeJson(res,503,{error:'Trusted delivery evidence verifier is not configured.'});
    const body=await readJson(req);
    const tenant=compact(body.tenant,120);
    if(!tenant||body.input?.scope?.tenant!==tenant)return writeJson(res,400,{error:'Delivery tenant scope is required and must match.'});
    const owned=deepFreezeJson(snapshotJson(body.input));
    const verifierInput=snapshotJson(owned);
    const inputIdentity=sha256(JSON.stringify({tenant,input:owned}));
    // A verifier must authenticate every source record and option evidence against
    // the tenant-scoped snapshot. A true result is the only accepted attestation.
    let verified=false;
    try{verified=await verifyDeliveryEvidence(verifierInput,tenant)===true;}catch{}
    if(!verified||sha256(JSON.stringify({tenant,input:verifierInput}))!==inputIdentity||owned.scope?.tenant!==tenant)
      return writeJson(res,422,{error:'Delivery evidence could not be authenticated.'});
    const shadow=evaluateDeliveryDisruption(owned);
    if(shadow.status==='INSUFFICIENT_EVIDENCE')return writeJson(res,422,{shadow});
    // The lookup must share the writer lock with insertion. A pre-lock read can
    // race another process and turn a valid exact replay into a unique-key 500.
    try{db.exec('BEGIN IMMEDIATE');}
    catch(error){
      if(error?.code==='ERR_SQLITE_ERROR'&&/database is locked|database is busy/i.test(error.message))
        return writeJson(res,503,{error:'Delivery replay is temporarily busy.'});
      throw error;
    }
    let replay=null;
    try{
      const existing=deliveryById.get(tenant,shadow.digest);
      if(existing){
        replay=JSON.parse(existing.result_json);
      }else{
        insertDelivery.run(tenant,shadow.digest,JSON.stringify(shadow),nowIso());
        if(shadow.episode&&!episodeById.get(tenant,shadow.episode.episodeId))
          insertEpisode.run(tenant,shadow.episode.episodeId,shadow.episode.decisionType,JSON.stringify(shadow.episode),nowIso());
      }
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    if(replay)return writeJson(res,200,{shadow:replay,idempotent:true});
    try{publishEvent?.({tenant,topic:'autopilot.shadow.updated',audience:'manager',payload:{episodeId:shadow.episode?.episodeId||null}});}catch{}
    return writeJson(res,201,{shadow,idempotent:false});
  }
  function deliveries(req,res){
    const c=requireManager(req,res);if(!c)return true;
    return writeJson(res,200,{contractVersion:'VECTOR_DELIVERY_DISRUPTION_LIST_V1',tenant:c.tenant,
      shadows:tenantDeliveries.all(c.tenant).map(r=>JSON.parse(r.result_json))});
  }
  function summary(req,res){
    const c=requireManager(req,res); if(!c) return true;
    const demand=demandForTenant(c.tenant);
    const recent=recentEpisodes(c.tenant,1)[0]||null;
    return writeJson(res,200,{
      contractVersion:'VECTOR_DEMAND_DECISION_SUMMARY_V1',
      tenant:c.tenant,
      demandSignalCount:demand.signals.length,
      topDemand:demand.problems[0]||null,
      recentShadowDecision:recent?{
        episodeId:recent.episodeId,
        decisionType:recent.decisionType,
        triggeredAt:recent.triggeredAt,
        mode:recent.mode,
        recommendation:recent.recommendation
      }:null,
      executionAuthority:'UNCHANGED_EXISTING_GATES'
    });
  }
  function demand(req,res){
    const c=requireManager(req,res); if(!c) return true;
    const result=demandForTenant(c.tenant);
    return writeJson(res,200,{
      contractVersion:'VECTOR_CUSTOMER_DEMAND_INTELLIGENCE_V1',
      tenant:c.tenant,
      signalCount:result.signals.length,
      problems:result.problems
    });
  }
  function decisions(req,res){
    const c=requireManager(req,res); if(!c) return true;
    return writeJson(res,200,{
      contractVersion:'VECTOR_DECISION_EPISODE_LIST_V1',
      tenant:c.tenant,
      episodes:recentEpisodes(c.tenant,20)
    });
  }
  async function handleRequest(req,res){
    const path=pathOf(req); if(!path.startsWith(PREFIX)) return false;
    try{
      if(req.method==='GET'&&path===PREFIX+'/summary') return summary(req,res);
      if(req.method==='GET'&&path===PREFIX+'/demand') return demand(req,res);
      if(req.method==='GET'&&path===PREFIX+'/decisions') return decisions(req,res);
      if(req.method==='GET'&&path===PREFIX+'/delivery-disruptions') return deliveries(req,res);
      if(req.method==='POST'&&path===PREFIX+'/demand/signal') return await ingestSignal(req,res);
      if(req.method==='POST'&&path===PREFIX+'/absence-recovery/shadow') return await ingestAbsenceShadow(req,res);
      if(req.method==='POST'&&path===PREFIX+'/delivery-disruption/shadow') return await ingestDeliveryShadow(req,res);
      return writeJson(res,404,{error:'Decision intelligence endpoint not found.'});
    }catch(error){
      return writeJson(res,Number(error?.statusCode||500),{error:error?.statusCode?error.message:'Decision intelligence failed safely.'});
    }
  }
  return {handleRequest,close(){try{db.close();}catch{}},demandForTenant,recentEpisodes};
}

module.exports={createDemandDecisionService,lifecycleDemandSignal};

