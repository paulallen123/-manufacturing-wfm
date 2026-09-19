'use strict';

const ROLE_PROFILES = Object.freeze({
  EMPLOYEE:{
    key:'EMPLOYEE',scope:'SELF',defaultHorizon:'TODAY',
    priorities:['MY_SHIFT','MY_LEAVE','MY_ATTENDANCE','MY_TRAINING'],
    allowedCommands:['ANALYSE','NAVIGATE','CREATE_REPORT'],
    promptExamples:['What do I need to do today?','How much holiday do I have left?','Why is my shift different tomorrow?']
  },
  SITE_MANAGER:{
    key:'SITE_MANAGER',scope:'SITE',defaultHorizon:'TODAY',
    priorities:['EXCEPTIONS','PRODUCTION_COVER','PEOPLE_READINESS','LABOUR_COST','COMPLIANCE'],
    allowedCommands:['ANALYSE','CREATE_REPORT','EMAIL_REPORT','CREATE_TASK','CREATE_AUTOMATION','CHANGE_WIDGET','CHANGE_CHART','NAVIGATE'],
    promptExamples:['What needs my attention today?','Why is overtime high?','Create my weekly labour report','Email me this every Friday']
  },
  OPS_MANAGER:{
    key:'OPS_MANAGER',scope:'MULTI_SITE',defaultHorizon:'ROLLING_4_WEEKS',
    priorities:['CROSS_SITE_VARIANCE','SYSTEMIC_RISK','VALUE_DELIVERED','AGENCY_DEPENDENCY','ENERGY','CAPACITY'],
    allowedCommands:['ANALYSE','CREATE_REPORT','EMAIL_REPORT','CREATE_TASK','CREATE_AUTOMATION','CHANGE_WIDGET','CHANGE_CHART','NAVIGATE'],
    promptExamples:['Which site needs attention and why?','Where are we wasting the most money?','Compare agency dependency across sites','Send directors a Monday operations pack']
  },
  DIRECTOR:{
    key:'DIRECTOR',scope:'ENTERPRISE',defaultHorizon:'QUARTER',
    priorities:['VALUE','MARGIN','STRATEGIC_RISK','CAPACITY','ENERGY','RESILIENCE'],
    allowedCommands:['ANALYSE','CREATE_REPORT','EMAIL_REPORT','CREATE_TASK','CREATE_AUTOMATION','CHANGE_WIDGET','CHANGE_CHART','NAVIGATE'],
    promptExamples:['Summarise operational performance','What will affect margin this quarter?','Create a board pack','Email this to the leadership team']
  }
});

const COMMANDS = Object.freeze([
  ['EMAIL_REPORT',/\b(email|send|mail)\b.*\b(report|summary|pack|dashboard|analysis|update)\b/i],
  ['CREATE_REPORT',/\b(create|build|generate|make)\b.*\b(report|summary|pack|analysis)\b/i],
  ['CREATE_AUTOMATION',/\b(every|each|automate|automation|recurring|monitor)\b/i],
  ['CREATE_TASK',/\b(create|set|add|assign)\b.*\b(task|reminder|action)\b/i],
  ['CHANGE_WIDGET',/\b(add|remove|move|resize|replace|change)\b.*\b(widget|tile|card|dashboard)\b/i],
  ['CHANGE_CHART',/\b(change|show|switch|make|turn)\b.*\b(chart|graph|trend|bar|line|pie)\b/i],
  ['NAVIGATE',/\b(open|go to|take me to|show screen|navigate)\b/i],
  ['ANALYSE',/.+/]
]);

const WRITE_INTENTS = new Set(['EMAIL_REPORT','CREATE_TASK','CREATE_AUTOMATION','CHANGE_WIDGET','CHANGE_CHART']);
const HIGH_IMPACT_TERMS = /\b(payroll|pay rate|publish rota|publish schedule|change contract|approve absence|decline absence|payment)\b/i;

function compact(v,max=400){ return String(v??'').trim().replace(/\s+/g,' ').slice(0,max); }
function numberOrNull(v){ const n=Number(v); return Number.isFinite(n)?n:null; }

function normalizeRole(input={}){
  const raw=compact(input.role||input.roleName||input.title||input.jobTitle||'',100).toLowerCase();
  const siteCount=numberOrNull(input.siteCount)??(Array.isArray(input.siteIds)?input.siteIds.length:null);
  if(/director|chief|\bmd\b|executive|vp|vice president/.test(raw)) return ROLE_PROFILES.DIRECTOR;
  if(/ops|operations|regional|area|group|multi.?site/.test(raw)||(siteCount!==null&&siteCount>1)) return ROLE_PROFILES.OPS_MANAGER;
  if(/manager|supervisor|team leader|shift leader|planner/.test(raw)) return ROLE_PROFILES.SITE_MANAGER;
  return ROLE_PROFILES.EMPLOYEE;
}

function classifyCommand(text){
  const q=compact(text,2000);
  for(const [intent,pattern] of COMMANDS){ if(pattern.test(q)) return {intent,text:q}; }
  return {intent:'ANALYSE',text:q};
}

function executionPolicy(command={},context={}){
  const role=normalizeRole(context);
  if(!role.allowedCommands.includes(command.intent)) return {mode:'BLOCK',reason:'ROLE_NOT_AUTHORISED'};
  if(HIGH_IMPACT_TERMS.test(compact(command.text,2000))) return {mode:'EXPLICIT_CONFIRMATION',reason:'HIGH_IMPACT_OPERATION'};
  if(WRITE_INTENTS.has(command.intent)) return {mode:'USER_SCOPED_WRITE',reason:'USER_REQUESTED_ACTION'};
  return {mode:'READ_ONLY',reason:'ANALYSIS_ONLY'};
}

function buildDecisionInsight(input={}){
  const metric=compact(input.metric,120);
  const statement=compact(input.statement||input.whatHappened,280);
  const soWhat=compact(input.soWhat,320);
  const cause=compact(input.cause,320);
  const recommendation=compact(input.recommendation,320);
  const expectedOutcome=compact(input.expectedOutcome,320);
  const confidence=numberOrNull(input.confidence);
  const impactValue=numberOrNull(input.impactValue);
  const impactCurrency=compact(input.impactCurrency||'GBP',8);
  const evidence=Array.isArray(input.evidence)?input.evidence.map(v=>compact(v,120)).filter(Boolean).slice(0,12):[];
  const missing=[];
  if(!statement) missing.push('statement');
  if(!soWhat) missing.push('soWhat');
  if(!recommendation) missing.push('recommendation');
  return {
    metric:metric||null,
    statement:statement||null,
    soWhat:soWhat||null,
    cause:cause||null,
    financialImpact:impactValue===null?null:{value:impactValue,currency:impactCurrency},
    recommendation:recommendation||null,
    expectedOutcome:expectedOutcome||null,
    confidence:confidence===null?null:Math.max(0,Math.min(100,confidence)),
    evidence,
    publishable:missing.length===0,
    missing
  };
}

function metricShouldRender(insight={}){
  return Boolean(insight&&insight.publishable&&insight.statement&&insight.soWhat&&insight.recommendation);
}

function roleView(input={}){
  const role=normalizeRole(input);
  return {
    role:role.key,
    scope:role.scope,
    horizon:role.defaultHorizon,
    priorities:[...role.priorities],
    prompts:[...role.promptExamples],
    principle:role.key==='SITE_MANAGER'
      ? 'Show only decisions that affect today\'s people, production, compliance or cost.'
      : role.key==='OPS_MANAGER'
        ? 'Show cross-site variance, systemic causes, value and interventions that local managers cannot see.'
        : role.key==='DIRECTOR'
          ? 'Show enterprise value, margin, resilience and strategic exceptions; hide operational noise.'
          : 'Show only personal actions and information.'
  };
}

function assistantEnvelope(text,context={}){
  const command=classifyCommand(text);
  const role=normalizeRole(context);
  return {
    command,
    policy:executionPolicy(command,context),
    role:role.key,
    scope:role.scope,
    currentScreen:compact(context.currentScreen||'overview',80),
    siteIds:Array.isArray(context.siteIds)?context.siteIds.map(v=>compact(v,80)).filter(Boolean).slice(0,100):[],
    requestedAt:context.requestedAt||new Date().toISOString()
  };
}

module.exports={
  ROLE_PROFILES,
  normalizeRole,
  classifyCommand,
  executionPolicy,
  buildDecisionInsight,
  metricShouldRender,
  roleView,
  assistantEnvelope
};
