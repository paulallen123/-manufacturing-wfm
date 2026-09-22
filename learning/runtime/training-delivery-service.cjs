'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createTrainingTwin } = require('./training-twin.cjs');
const { buildTrainingModule, workflowFor } = require('./training-workflow-manifest.cjs');
const { scenarioFor, evaluateScenarioAnswer } = require('./training-scenario-engine.cjs');
const { createVideoGenerationJob } = require('./training-video-contract.cjs');
const { createTrainingArtifactRegistry } = require('./training-artifact-registry.cjs');

const PREFIX='/api/learning/training';
const INTERNAL_HEADER='x-wfm-training-factory-internal';

function sha256(v){return createHash('sha256').update(String(v)).digest('hex');}
function secureEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length>0&&x.length===y.length&&timingSafeEqual(x,y);}
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
  const artifacts=createTrainingArtifactRegistry({dbPath});
  const internalToken=options.internalToken||process.env.WFM_TRAINING_FACTORY_INTERNAL_TOKEN||'';
  const auth=db.prepare('SELECT u.email,u.tenant,u.role FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  function context(req){const token=cookieToken(req);return token?auth.get(sha256(token),Date.now())||null:null;}
  function requireUser(req,res){const c=context(req);if(!c){writeJson(res,401,{error:'Sign in is required.'});return null;}return c;}
  function requireInternal(req,res){
    if(!internalToken){writeJson(res,503,{error:'Training factory credential is not configured.'});return false;}
    if(!secureEqual(req?.headers?.[INTERNAL_HEADER],internalToken)){writeJson(res,403,{error:'Trusted training factory is required.'});return false;}
    return true;
  }
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
      video:(()=>{
        const current=artifacts.currentForFingerprint(module.artifactFingerprint);
        if(current) return current;
        if(module.artifactPublishable!==true) return {state:'SOURCE_UNVERIFIED',fingerprint:module.artifactFingerprint};
        if(module.capture?.status!=='READY') return {state:'PENDING_ANCHOR',fingerprint:module.artifactFingerprint};
        if(module.locale!=='en-GB') return {state:'LOCALISATION_REQUIRED',fingerprint:module.artifactFingerprint};
        return {state:'NOT_GENERATED',fingerprint:module.artifactFingerprint};
      })()
    };
  }
  async function handleRequest(req,res){
    const path=pathOf(req);if(!path.startsWith(PREFIX))return false;
    try{
      if(req.method==='POST'&&path===PREFIX+'/generation-job'){
        if(!requireInternal(req,res)) return true;
        const body=await readJson(req);
        const identity=productIdentity();
        const module=buildTrainingModule({
          competencyKey:String(body.competencyKey||''),role:String(body.role||'employee'),mode:'SHOW_ME',
          locale:String(body.locale||'en-GB'),explanationMode:String(body.explanationMode||'step-by-step'),
          permissionClass:String(body.permissionClass||'default'),configurationClass:String(body.configurationClass||identity.configurationClass),
          ...identity
        });
        const targetOrigin=process.env.WFM_TRAINING_CAPTURE_TARGET_ORIGIN||String(body.targetOrigin||'');
        const job=createVideoGenerationJob(module,{targetOrigin});
        return writeJson(res,200,{job});
      }
      if(req.method==='POST'&&path===PREFIX+'/artifact-receipt'){
        if(!requireInternal(req,res)) return true;
        const body=await readJson(req);
        if(!body.job||!body.receipt) return writeJson(res,400,{error:'job and receipt are required.'});
        const result=artifacts.recordReceipt(body.job,body.receipt);
        return writeJson(res,result.validation.ok?200:422,result);
      }
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
  return {handleRequest,planForUser,moduleForUser,close(){twin.close();artifacts.close();try{db.close();}catch{}}};
}
module.exports={createTrainingDeliveryService};
