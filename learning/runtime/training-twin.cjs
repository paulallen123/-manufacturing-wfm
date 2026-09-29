'use strict';

const { DatabaseSync } = require('node:sqlite');
const { createAdaptiveLearningEngine } = require('./adaptive-learning-engine.cjs');
const { canonicalRole, workflowFor } = require('./training-workflow-manifest.cjs');

const DAY=24*60*60*1000;
const EXPLANATION_MODES=new Set(['concise','detailed','step-by-step','example-led']);

function compact(v,max=240){return String(v??'').trim().slice(0,max);}
function locale(v){
  const value=compact(v||'en-GB',40);
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)?value:'en-GB';
}
function recommendation(row,helpCount,skipExplanation){
  const score=Number(row?.score||0),status=String(row?.status||'DUE');
  const due=Number(row?.due_at_ms||0)<=Date.now();
  if(status==='MASTERED'&&!due&&helpCount<3) return 'NONE';
  if(skipExplanation) return score>=80?'TEST_ME':'PRACTISE';
  if(status==='REFRESH_DUE'||(score>=80&&due)) return 'TEST_ME';
  if(helpCount>=3) return 'GUIDE_ME';
  if(score<=0) return 'SHOW_ME';
  if(score<55) return 'GUIDE_ME';
  if(score<80) return 'PRACTISE';
  return 'TEST_ME';
}

function createTrainingTwin(options={}){
  const dbPath=options.dbPath||process.env.WFM_DB;
  if(!dbPath) throw new Error('Training Twin requires WFM_DB.');
  const learning=createAdaptiveLearningEngine({dbPath});
  const db=new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500;'+
    'CREATE TABLE IF NOT EXISTS training_preferences('+
      'tenant TEXT NOT NULL,email TEXT NOT NULL,locale TEXT NOT NULL DEFAULT \'en-GB\','+
      'explanation_mode TEXT NOT NULL DEFAULT \'step-by-step\',skip_explanation INTEGER NOT NULL DEFAULT 0,'+
      'updated_at TEXT NOT NULL,PRIMARY KEY(tenant,email));'
  );
  const assignments=db.prepare('SELECT competency_key,status,score,due_at_ms,mastered_at_ms,source FROM learning_assignments WHERE tenant=? AND email=? ORDER BY competency_key');
  const help=db.prepare('SELECT COUNT(*) AS count FROM learning_help WHERE tenant=? AND email=? AND competency_key=? AND created_at_ms>=?');
  const preference=db.prepare('SELECT * FROM training_preferences WHERE tenant=? AND email=?');
  const upsertPreference=db.prepare(
    'INSERT INTO training_preferences(tenant,email,locale,explanation_mode,skip_explanation,updated_at) VALUES(?,?,?,?,?,?) '+
    'ON CONFLICT(tenant,email) DO UPDATE SET locale=excluded.locale,explanation_mode=excluded.explanation_mode,skip_explanation=excluded.skip_explanation,updated_at=excluded.updated_at'
  );
  function preferencesFor(user){
    const row=preference.get(user.tenant,user.email);
    return {
      locale:locale(row?.locale||'en-GB'),
      explanationMode:EXPLANATION_MODES.has(row?.explanation_mode)?row.explanation_mode:'step-by-step',
      skipExplanation:Number(row?.skip_explanation||0)===1
    };
  }
  function setPreferences(user,input={}){
    const existing=preferencesFor(user);
    const explanationMode=compact(input.explanationMode||existing.explanationMode,40);
    if(!EXPLANATION_MODES.has(explanationMode)) throw new Error('Unsupported explanation mode.');
    const next={locale:locale(input.locale||existing.locale),explanationMode,skipExplanation:input.skipExplanation===undefined?existing.skipExplanation:input.skipExplanation===true};
    upsertPreference.run(user.tenant,user.email,next.locale,next.explanationMode,next.skipExplanation?1:0,new Date().toISOString());
    return next;
  }
  function profileForUser(user){
    const active=new Set(learning.planForUser(user).all.map(item=>item.competencyKey));
    const pref=preferencesFor(user),role=canonicalRole(user.role),rows=assignments.all(user.tenant,user.email).filter(row=>active.has(row.competency_key));
    const competencies=rows.map(row=>{
      const recentHelp=Number(help.get(user.tenant,user.email,row.competency_key,Date.now()-7*DAY)?.count||0);
      const workflow=workflowFor(row.competency_key);
      return {
        competencyKey:row.competency_key,
        title:workflow?.title||row.competency_key,
        status:row.status,
        score:Number(row.score||0),
        dueAt:new Date(Number(row.due_at_ms||Date.now())).toISOString(),
        masteredAt:row.mastered_at_ms?new Date(Number(row.mastered_at_ms)).toISOString():null,
        recentHelp,
        recommendedMode:recommendation(row,recentHelp,pref.skipExplanation)
      };
    });
    return {
      contractVersion:'VECTOR_TRAINING_TWIN_V1',
      role,
      preferences:pref,
      competencies,
      due:competencies.filter(x=>x.recommendedMode!=='NONE')
    };
  }
  return {profileForUser,preferencesFor,setPreferences,close(){learning.close();try{db.close();}catch{}}};
}

module.exports={createTrainingTwin,recommendation,EXPLANATION_MODES};

