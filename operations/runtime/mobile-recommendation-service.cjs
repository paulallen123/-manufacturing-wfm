'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { safePlan } = require('./autopilot-execution-engine.cjs');

const PREFIX = '/api/mobile/recommendations';
const INTERNAL_HEADER = 'x-wfm-mobile-internal';

function nowIso(){ return new Date().toISOString(); }
function sha256(v){ return createHash('sha256').update(String(v)).digest('hex'); }
function compact(v,max=240){ return String(v??'').trim().slice(0,max); }
function secureEqual(a,b){
  const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
  return x.length>0&&x.length===y.length&&timingSafeEqual(x,y);
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
  let size=0;const chunks=[];
  for await(const chunk of req){
    const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=b.length;
    if(size>max){const e=new Error('Request body too large.');e.statusCode=413;throw e;}
    chunks.push(b);
  }
  if(!chunks.length) return {};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{const e=new Error('Invalid JSON body.');e.statusCode=400;throw e;}
}
function parseRecommendationPath(path){
  if(!path.startsWith(PREFIX+'/')) return null;
  const rest=path.slice((PREFIX+'/').length);
  const parts=rest.split('/').filter(Boolean);
  if(parts.length!==2) return null;
  return {episodeId:decodeURIComponent(parts[0]),action:parts[1]};
}

function createMobileRecommendationService(options={}){
  const dbPath=options.dbPath||process.env.WFM_DB;
  const autopilot=options.autopilot||null;
  const internalToken=options.internalToken||process.env.WFM_MOBILE_INTERNAL_TOKEN||process.env.WFM_DEMAND_INTERNAL_TOKEN||process.env.WFM_INTEGRATION_INTERNAL_TOKEN||'';
  if(!dbPath) throw new Error('Mobile recommendation service requires WFM_DB.');

  const db=new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;'+
    'CREATE TABLE IF NOT EXISTS vector_mobile_recommendation_decisions('+
      'decision_id TEXT PRIMARY KEY,decision_key TEXT NOT NULL UNIQUE,tenant TEXT NOT NULL,episode_id TEXT NOT NULL,'+
      'option_id TEXT NOT NULL,context_revision TEXT NOT NULL,decision TEXT NOT NULL,actor_ref TEXT NOT NULL,'+
      'execution_requested INTEGER NOT NULL,created_at TEXT NOT NULL);'+
    'CREATE TRIGGER IF NOT EXISTS no_vector_mobile_decision_update BEFORE UPDATE ON vector_mobile_recommendation_decisions '+
      "BEGIN SELECT RAISE(ABORT,'Mobile recommendation decisions are append only.'); END;"+
    'CREATE TRIGGER IF NOT EXISTS no_vector_mobile_decision_delete BEFORE DELETE ON vector_mobile_recommendation_decisions '+
      "BEGIN SELECT RAISE(ABORT,'Mobile recommendation decisions are append only.'); END;"+
    'CREATE TABLE IF NOT EXISTS vector_mobile_action_plans('+
      'tenant TEXT NOT NULL,episode_id TEXT NOT NULL,option_id TEXT NOT NULL,context_revision TEXT NOT NULL,'+
      'plan_json TEXT NOT NULL,source_ref TEXT NOT NULL,created_at TEXT NOT NULL,'+
      'PRIMARY KEY(tenant,episode_id,option_id));'+
    'CREATE TRIGGER IF NOT EXISTS no_vector_mobile_plan_update BEFORE UPDATE ON vector_mobile_action_plans '+
      "BEGIN SELECT RAISE(ABORT,'Mobile action plans are append only.'); END;"+
    'CREATE TRIGGER IF NOT EXISTS no_vector_mobile_plan_delete BEFORE DELETE ON vector_mobile_action_plans '+
      "BEGIN SELECT RAISE(ABORT,'Mobile action plans are append only.'); END;"
  );

  const auth=db.prepare('SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  const episodeQ=db.prepare('SELECT episode_json FROM vector_decision_episodes WHERE tenant=? AND episode_id=?');
  const decisionQ=db.prepare('SELECT * FROM vector_mobile_recommendation_decisions WHERE decision_key=?');
  const decisionI=db.prepare('INSERT INTO vector_mobile_recommendation_decisions VALUES(?,?,?,?,?,?,?,?,?,?)');
  const actorEpisodeQ=db.prepare('SELECT * FROM vector_mobile_recommendation_decisions WHERE tenant=? AND episode_id=? AND actor_ref=? ORDER BY created_at DESC LIMIT 1');
  const planQ=db.prepare('SELECT plan_json,context_revision FROM vector_mobile_action_plans WHERE tenant=? AND episode_id=? AND option_id=?');
  const planI=db.prepare('INSERT INTO vector_mobile_action_plans VALUES(?,?,?,?,?,?,?)');

  function ctx(req){
    const token=cookieToken(req);
    return token?auth.get(sha256(token),Date.now())||null:null;
  }
  function manager(req,res){
    const c=ctx(req);
    if(!c){writeJson(res,401,{error:'Sign in is required.'});return null;}
    if(String(c.role).toLowerCase()==='employee'){
      writeJson(res,403,{error:'Recommendation approval requires an authorised manager or administrator.'});
      return null;
    }
    return c;
  }
  function requireInternal(req,res){
    if(!internalToken){writeJson(res,503,{error:'Trusted mobile action-plan issuer is not configured.'});return false;}
    if(!secureEqual(req?.headers?.[INTERNAL_HEADER],internalToken)){
      writeJson(res,403,{error:'Trusted mobile action-plan issuer is required.'});return false;
    }
    return true;
  }
  function episode(tenant,episodeId){
    const row=episodeQ.get(tenant,episodeId);
    return row?JSON.parse(row.episode_json):null;
  }
  function eligibleOption(ep,optionId){
    const option=(ep?.options||[]).find(o=>o.id===optionId);
    return option&&option.feasible===true&&option.policyAllowed===true&&option.hardConstraintsPassed===true?option:null;
  }

  async function storeActionPlan(req,res,episodeId){
    if(!requireInternal(req,res)) return true;
    const body=await readJson(req);
    const tenant=compact(body.tenant,120);
    const optionId=compact(body.optionId,120);
    const contextRevision=compact(body.contextRevision,180);
    const sourceRef=compact(body.sourceRef,220)||'trusted-mobile-plan-issuer';
    if(!tenant||!optionId||!contextRevision) return writeJson(res,400,{error:'tenant, optionId and contextRevision are required.'});
    const ep=episode(tenant,episodeId);
    if(!ep) return writeJson(res,404,{error:'Decision episode not found.'});
    if(ep.contextRevision!==contextRevision) return writeJson(res,409,{error:'Decision context changed. Create a new action plan.'});
    if(!eligibleOption(ep,optionId)) return writeJson(res,409,{error:'Selected option is not eligible.'});
    const plan=safePlan(body.plan||{});
    const existing=planQ.get(tenant,episodeId,optionId);
    if(existing){
      const existingPlan=JSON.parse(existing.plan_json);
      if(sha256(JSON.stringify(existingPlan))!==sha256(JSON.stringify(plan))) return writeJson(res,409,{error:'An immutable action plan already exists for this option.'});
      return writeJson(res,200,{status:'ACTION_PLAN_READY',idempotent:true});
    }
    planI.run(tenant,episodeId,optionId,contextRevision,JSON.stringify(plan),sourceRef,nowIso());
    return writeJson(res,201,{status:'ACTION_PLAN_READY',idempotent:false});
  }

  async function decide(req,res,episodeId){
    const c=manager(req,res);if(!c) return true;
    const body=await readJson(req);
    const optionId=compact(body.optionId,120);
    const contextRevision=compact(body.contextRevision,180);
    const decision=compact(body.decision,20).toUpperCase();
    const executionRequested=body.execute===true;
    if(!['APPROVE','REJECT'].includes(decision)) return writeJson(res,400,{error:'decision must be APPROVE or REJECT.'});

    const ep=episode(c.tenant,episodeId);
    if(!ep) return writeJson(res,404,{error:'Decision episode not found.'});
    if(ep.contextRevision!==contextRevision) return writeJson(res,409,{error:'Decision context changed. Refresh before deciding.'});
    if(!eligibleOption(ep,optionId)) return writeJson(res,409,{error:'Selected option is not eligible.'});

    const prior=actorEpisodeQ.get(c.tenant,episodeId,c.email);
    if(prior&&prior.decision!==decision) return writeJson(res,409,{error:'A different mobile decision is already recorded for this episode. Refresh the decision context.'});

    const decisionKey=sha256([c.tenant,episodeId,optionId,contextRevision,decision,c.email].join('|'));
    let row=decisionQ.get(decisionKey);
    let idempotent=true;
    if(!row){
      idempotent=false;
      const createdAt=nowIso();
      const decisionId='mobdec-'+sha256(decisionKey+'|'+createdAt).slice(0,40);
      decisionI.run(decisionId,decisionKey,c.tenant,episodeId,optionId,contextRevision,decision,c.email,executionRequested?1:0,createdAt);
      row=decisionQ.get(decisionKey);
    }

    if(decision==='REJECT') return writeJson(res,200,{status:'REJECTED',auditId:row.decision_id,idempotent,executionPermitted:false});
    if(!executionRequested) return writeJson(res,200,{status:'APPROVED',auditId:row.decision_id,idempotent,executionPermitted:false});

    const stored=planQ.get(c.tenant,episodeId,optionId);
    if(!stored){
      return writeJson(res,202,{
        status:'APPROVED_AWAITING_EXECUTION_PLAN',
        auditId:row.decision_id,
        idempotent,
        executionPermitted:false,
        reason:'No server-authorised reversible action plan is attached to this recommendation.'
      });
    }
    if(stored.context_revision!==contextRevision){
      return writeJson(res,409,{error:'Stored action plan is stale. Re-simulate before execution.',auditId:row.decision_id});
    }
    if(!autopilot?.issueHumanPermit||!autopilot?.executePermit){
      return writeJson(res,202,{status:'APPROVED_EXECUTION_UNAVAILABLE',auditId:row.decision_id,idempotent,executionPermitted:false});
    }

    const plan=JSON.parse(stored.plan_json);
    const permit=autopilot.issueHumanPermit({
      tenant:c.tenant,
      episodeId,
      optionId,
      actorRef:c.email,
      contextRevision,
      plan
    });
    const execution=await autopilot.executePermit({
      tenant:c.tenant,
      permitId:permit.permitId,
      currentContextRevision:contextRevision
    });
    return writeJson(res,execution.state==='VERIFIED'?200:409,{
      status:execution.state==='VERIFIED'?'APPROVED_AND_VERIFIED':'APPROVED_EXECUTION_CONTAINED',
      auditId:row.decision_id,
      permitId:permit.permitId,
      execution
    });
  }

  async function handleRequest(req,res){
    const path=pathOf(req);
    if(!path.startsWith(PREFIX)) return false;
    try{
      const parsed=parseRecommendationPath(path);
      if(!parsed) return writeJson(res,404,{error:'Mobile recommendation endpoint not found.'});
      if(req.method==='POST'&&parsed.action==='decision') return await decide(req,res,parsed.episodeId);
      if(req.method==='POST'&&parsed.action==='action-plan') return await storeActionPlan(req,res,parsed.episodeId);
      return writeJson(res,404,{error:'Mobile recommendation endpoint not found.'});
    }catch(error){
      return writeJson(res,Number(error?.statusCode||500),{error:error?.statusCode?error.message:'Mobile recommendation decision failed safely.'});
    }
  }

  return {handleRequest,close(){try{db.close();}catch{}}};
}

module.exports={createMobileRecommendationService,PREFIX,INTERNAL_HEADER};
