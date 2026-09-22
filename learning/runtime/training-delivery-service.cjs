'use strict';

const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createTrainingTwin } = require('./training-twin.cjs');
const { buildTrainingModule, workflowFor } = require('./training-workflow-manifest.cjs');
const { scenarioFor, evaluateScenarioAnswer } = require('./training-scenario-engine.cjs');

const PREFIX='/api/learning/training';

function sha256(v){return createHash('sha256').update(String(v)).digest('hex');}
function cookieToken(req){for(const part of String(req?.headers?.cookie||'').split(';')){const p=part.trim();if(p.startsWith('wfm_session='))return p.slice(12);}return '';}
function pathOf(req){return String(req?.url||'/').split('?')[0]||'/';}
function queryOf(req){try{return new URL(String(req?.url||'/'),'https://vector.invalid').searchParams;}catch{return new URLSearchParams();}}
function writeJson(res,status,body){if(res.headersSent||res.writableEnded)return true;res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(body));return true;}
async function readJson(req,max=64*1024){let size=0,chunks=[];for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=b.length;if(size>max){const e=new Error('Request body too large.');e.statusCode=413;throw e;}chunks.push(b);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const e=new Error('Invalid JSON body.');e.statusCode=400;throw e;}}
function createTrainingDeliveryService(options={}){
  const dbPath=options.dbPath||process.env.WFM_DB;
  if(!dbPath) throw new Error('Training delivery service requires WFM_DB.');
  const db=new DatabaseSync(dbPath);
  const twin=createTrainingTwin({dbPath});
  const auth=db.prepare('SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  function context(req){const token=cookieToken(req);return token?auth.get(sha256(token),Date.now())||null:null;}
  function requireUser(req,res){const c=context(req);if(!c){writeJson(res,401,{error:'Sign in is required.'});return null;}return c;}
  function productIdentity(){
    return {
      productSha:process.env.RAILWAY_GIT_COMMIT_SHA||process.env.WFM_RELEASE_SHA||'unverified',
      uiVersion:'VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1',
      configurationClass:process.env.WFM_TRAINING_CONFIGURATION_CLASS||'standard'
    };
  }
  function planForUser(user){
    const profile=twin.profileForUser(user);
    return {
      ...profile,
      next:profile.due.slice(0,3),
      deliveryPrinciple:'Guidance never counts as mastery. Independent or observed task evidence is required.'
    };
  }
  function moduleForUser(user,competencyKey,mode){
    const profile=twin.profileForUser(user);
    const item=profile.competencies.find(x=>x.competencyKey===competencyKey);
    if(!item||!workflowFor(competencyKey)) throw Object.assign(new Error('This competency is not assigned to your role.'),{statusCode:403});
    const selectedMode=String(mode||item.recommendedMode||'GUIDE_ME').toUpperCase();
    const module=buildTrainingModule({
      competencyKey,role:user.role,mode:selectedMode,
      locale:profile.preferences.locale,explanationMode:profile.preferences.explanationMode,
      ...productIdentity()
    });
    const scenario=selectedMode==='PRACTISE'?scenarioFor(competencyKey,{role:user.role,revealRecommendation:false}):null;
    return {
      ...module,
      recommendedMode:item.recommendedMode,
      readiness:{status:item.status,score:item.score,dueAt:item.dueAt,recentHelp:item.recentHelp},
      scenario,
      video:module.artifactPublishable
        ? {state:'NOT_GENERATED',fingerprint:module.artifactFingerprint}
        : {state:'SOURCE_UNVERIFIED',fingerprint:module.artifactFingerprint}
    };
  }
  async function handleRequest(req,res){
    const path=pathOf(req);if(!path.startsWith(PREFIX))return false;
    try{
      const user=requireUser(req,res);if(!user)return true;
      if(req.method==='GET'&&path===PREFIX+'/plan') return writeJson(res,200,planForUser(user));
      if(req.method==='GET'&&path===PREFIX+'/module'){
        const q=queryOf(req),key=String(q.get('competencyKey')||''),mode=String(q.get('mode')||'');
        return writeJson(res,200,moduleForUser(user,key,mode));
      }
      if(req.method==='POST'&&path===PREFIX+'/preferences'){
        const body=await readJson(req),preferences=twin.setPreferences(user,body);
        return writeJson(res,200,{preferences,plan:planForUser(user)});
      }
      if(req.method==='POST'&&path===PREFIX+'/scenario/answer'){
        const body=await readJson(req);
        const result=evaluateScenarioAnswer(String(body.competencyKey||''),String(body.optionId||''),{role:user.role});
        return writeJson(res,200,result);
      }
      return writeJson(res,404,{error:'Training endpoint not found.'});
    }catch(error){
      return writeJson(res,Number(error?.statusCode||500),{error:error?.statusCode?error.message:'Training delivery failed safely.'});
    }
  }
  return {handleRequest,planForUser,moduleForUser,close(){twin.close();try{db.close();}catch{}}};
}
module.exports={createTrainingDeliveryService};
