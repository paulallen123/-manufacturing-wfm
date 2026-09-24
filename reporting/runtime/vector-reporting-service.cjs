'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PREFIX = '/api/reporting';
const MAX_BODY_BYTES = 96 * 1024;
const MAX_COLUMNS = 24;
const MAX_FILTERS = 20;
const MAX_SORTS = 4;
const MAX_LIMIT = 5000;

const ROLE_LEVEL = Object.freeze({
  employee: 0,
  manager: 1,
  payroll_admin: 2,
  director: 3,
  admin: 4,
  superuser: 4
});

const OPERATORS = new Set(['eq','neq','in','not_in','contains','gte','lte','gt','lt','between','is_empty','not_empty']);
const VISUALISATIONS = new Set(['table','kpi','bar','line']);
const COMPARISONS = new Set(['none','previous_period','previous_week','previous_month','baseline']);

const SOURCES = Object.freeze([
  {
    id:'factory-readiness',
    label:'Factory readiness',
    description:'Demand, planned capacity, gaps and operating readiness by site or department.',
    endpoint:'/api/readiness',
    minRole:'manager',
    evidenceClass:'OPERATIONAL',
    fields:['site','department','status','requiredHours','plannedHours','gapHours','headcount','exceptions','asOf']
  },
  {
    id:'weekly-review',
    label:'Weekly review',
    description:'Sign-off readiness, open exceptions and management workload.',
    endpoint:'/api/weekly-review',
    minRole:'manager',
    evidenceClass:'OPERATIONAL',
    fields:['site','team','status','openExceptions','signOffReady','blockers','asOf']
  },
  {
    id:'schedule-publication',
    label:'Schedule & coverage',
    description:'Published plan, coverage, staffing gaps and schedule state.',
    endpoint:'/api/schedule-publication',
    minRole:'manager',
    evidenceClass:'OPERATIONAL',
    fields:['site','department','shift','date','required','planned','gap','status','publishedAt']
  },
  {
    id:'time-review',
    label:'Time & attendance',
    description:'Attendance exceptions, correction state and weekly control evidence.',
    endpoint:'/api/time-review',
    minRole:'manager',
    evidenceClass:'OPERATIONAL',
    fields:['site','team','employee','date','exceptionType','status','workedHours','scheduledHours','overtimeHours','evidenceRef']
  },
  {
    id:'payroll-control',
    label:'Payroll control',
    description:'Payroll readiness and exception status. Payroll access remains role restricted.',
    endpoint:'/api/payroll-run',
    minRole:'payroll_admin',
    evidenceClass:'CONTROLLED_FINANCIAL',
    fields:['site','team','period','status','issues','canRelease','workedHours','paidHours','grossCost','evidenceRef']
  },
  {
    id:'value-realisation',
    label:'Cost & value',
    description:'Source-bound workforce cost, realised value and identified opportunities.',
    endpoint:'/api/cost/realization',
    minRole:'manager',
    evidenceClass:'FINANCIAL',
    fields:['site','metric','classification','baseline','result','improvement','currency','measurementWindow','evidenceRef']
  },
  {
    id:'decision-outcomes',
    label:'Decision outcomes',
    description:'Recommendations, decisions, verification and measured outcomes.',
    endpoint:'/api/operations/intelligence/decisions',
    minRole:'manager',
    evidenceClass:'DECISION',
    fields:['site','decisionType','status','selectedOption','risk','confidence','predictedImpact','actualImpact','verification','evidenceRef']
  },
  {
    id:'audit-evidence',
    label:'Audit & proof',
    description:'Governed evidence for actions, authority, execution, recovery and verification.',
    endpoint:'/api/proof',
    minRole:'director',
    evidenceClass:'AUDIT',
    fields:['event','site','actor','authority','action','status','observedAt','buildId','evidenceRef']
  }
]);

const TEMPLATES = Object.freeze([
  {id:'today-factory',label:'What needs attention today?',sourceId:'factory-readiness',visualisation:'table',columns:['department','status','requiredHours','plannedHours','gapHours','exceptions'],comparison:'none',narrative:true},
  {id:'weekly-signoff',label:'What blocks weekly sign-off?',sourceId:'weekly-review',visualisation:'table',columns:['team','status','openExceptions','signOffReady','blockers'],comparison:'previous_week',narrative:true},
  {id:'schedule-risk',label:'Where is the plan under-covered?',sourceId:'schedule-publication',visualisation:'table',columns:['department','shift','required','planned','gap','status'],comparison:'none',narrative:true},
  {id:'time-exceptions',label:'Which time issues need action?',sourceId:'time-review',visualisation:'table',columns:['team','employee','date','exceptionType','status','overtimeHours'],comparison:'previous_week',narrative:true},
  {id:'payroll-readiness',label:'Is payroll ready?',sourceId:'payroll-control',visualisation:'table',columns:['team','period','status','issues','canRelease','evidenceRef'],comparison:'previous_period',narrative:true},
  {id:'value-proof',label:'What value have we actually realised?',sourceId:'value-realisation',visualisation:'table',columns:['metric','classification','baseline','result','improvement','currency','evidenceRef'],comparison:'baseline',narrative:true},
  {id:'decision-learning',label:'Which VECTOR decisions worked?',sourceId:'decision-outcomes',visualisation:'table',columns:['decisionType','selectedOption','verification','predictedImpact','actualImpact','evidenceRef'],comparison:'baseline',narrative:true},
  {id:'audit-pack',label:'Show me the evidence trail',sourceId:'audit-evidence',visualisation:'table',columns:['observedAt','actor','authority','action','status','buildId','evidenceRef'],comparison:'none',narrative:false}
]);

function stable(value){
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function digest(value){ return createHash('sha256').update(stable(value)).digest('hex'); }
function compact(value,max=240){ return String(value??'').trim().slice(0,max); }
function requestPath(req){ return String(req?.url||'/').split('?')[0]||'/'; }
function cookieToken(req){
  for(const part of String(req?.headers?.cookie||'').split(';')){
    const p=part.trim();
    if(p.startsWith('wfm_session=')) return p.slice(12);
  }
  return '';
}
function roleLevel(role){ return ROLE_LEVEL[compact(role,40).toLowerCase()] ?? -1; }
function permitted(role,minRole){ return roleLevel(role)>=roleLevel(minRole); }
function sourceById(id){ return SOURCES.find(s=>s.id===id)||null; }
function visibleCatalog(role){
  const sources=SOURCES.filter(s=>permitted(role,s.minRole));
  const ids=new Set(sources.map(s=>s.id));
  return {
    schemaVersion:'VECTOR_REPORTING_V1',
    principles:[
      'goal-first-progressive-disclosure',
      'source-bound-no-silent-mocks',
      'tenant-and-role-governed',
      'realised-value-separated-from-opportunity',
      'evidence-visible-at-point-of-decision'
    ],
    sources,
    templates:TEMPLATES.filter(t=>ids.has(t.sourceId)),
    limits:{maxColumns:MAX_COLUMNS,maxFilters:MAX_FILTERS,maxSorts:MAX_SORTS,maxRows:MAX_LIMIT}
  };
}
function cleanFilter(filter,allowed){
  if(!filter||typeof filter!=='object'||Array.isArray(filter)) throw new Error('Invalid filter.');
  const field=compact(filter.field,80),operator=compact(filter.operator,24).toLowerCase();
  if(!allowed.has(field)) throw new Error('Filter field is not allowed for this source.');
  if(!OPERATORS.has(operator)) throw new Error('Unsupported filter operator.');
  let value=filter.value;
  if(Array.isArray(value)) value=value.slice(0,100).map(v=>compact(v,240));
  else if(value!=null&&typeof value==='object') throw new Error('Filter values must be scalar or list values.');
  else if(typeof value==='string') value=compact(value,500);
  return {field,operator,value:value??null};
}
function normaliseDefinition(input,role){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('Report definition is required.');
  const sourceId=compact(input.sourceId,80),source=sourceById(sourceId);
  if(!source) throw new Error('Unknown report source.');
  if(!permitted(role,source.minRole)) throw new Error('Role is not permitted to use this report source.');
  const allowed=new Set(source.fields);
  const title=compact(input.title,120)||source.label;
  const requested=Array.isArray(input.columns)?input.columns.map(v=>compact(v,80)).filter(Boolean):[];
  const columns=[...new Set(requested.length?requested:source.fields.slice(0,8))].slice(0,MAX_COLUMNS);
  if(columns.some(c=>!allowed.has(c))) throw new Error('Report column is not allowed for this source.');
  const filters=(Array.isArray(input.filters)?input.filters:[]).slice(0,MAX_FILTERS).map(f=>cleanFilter(f,allowed));
  const sorts=(Array.isArray(input.sorts)?input.sorts:[]).slice(0,MAX_SORTS).map(s=>{
    const field=compact(s?.field,80),direction=compact(s?.direction,8).toLowerCase();
    if(!allowed.has(field)) throw new Error('Sort field is not allowed for this source.');
    if(!['asc','desc'].includes(direction)) throw new Error('Sort direction must be asc or desc.');
    return {field,direction};
  });
  const visualisation=compact(input.visualisation||'table',20).toLowerCase();
  if(!VISUALISATIONS.has(visualisation)) throw new Error('Unsupported visualisation.');
  const comparison=compact(input.comparison||'none',30).toLowerCase();
  if(!COMPARISONS.has(comparison)) throw new Error('Unsupported comparison.');
  const limit=Math.max(1,Math.min(MAX_LIMIT,Number(input.limit)||500));
  const narrative=input.narrative!==false;
  const claimBoundary=compact(input.claimBoundary,500)||'Source-bound report. Estimates and opportunities must not be presented as realised outcomes without authoritative evidence.';
  return Object.freeze({
    schemaVersion:'VECTOR_REPORT_DEFINITION_V1',
    title,sourceId,endpoint:source.endpoint,evidenceClass:source.evidenceClass,
    columns,filters,sorts,visualisation,comparison,limit,narrative,
    includeEvidence:input.includeEvidence!==false,
    claimBoundary
  });
}
function writeJson(res,status,body){
  if(res.headersSent||res.writableEnded) return true;
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(body));
  return true;
}
async function readJson(req){
  let size=0,body='';
  for await(const chunk of req){
    size+=chunk.length;
    if(size>MAX_BODY_BYTES) throw new Error('Request body is too large.');
    body+=chunk;
  }
  if(!body.trim()) return {};
  return JSON.parse(body);
}

function createVectorReportingService(options={}){
  const dbPath=options.dbPath||process.env.WFM_DB;
  if(!dbPath) throw new Error('VECTOR reporting service requires WFM_DB.');
  const db=new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=1500;
    CREATE TABLE IF NOT EXISTS vector_report_definitions(
      id TEXT PRIMARY KEY,
      tenant TEXT NOT NULL,
      created_by TEXT NOT NULL,
      role_at_creation TEXT NOT NULL,
      title TEXT NOT NULL,
      source_id TEXT NOT NULL,
      definition_json TEXT NOT NULL,
      definition_digest TEXT NOT NULL,
      version_of TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS vector_report_definitions_tenant_created
      ON vector_report_definitions(tenant,created_at DESC);
    CREATE TABLE IF NOT EXISTS vector_report_audit(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant TEXT NOT NULL,
      report_id TEXT,
      actor TEXT NOT NULL,
      event TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS no_vector_report_update
      BEFORE UPDATE ON vector_report_definitions BEGIN SELECT RAISE(ABORT,'Report definitions are immutable; create a new version.'); END;
    CREATE TRIGGER IF NOT EXISTS no_vector_report_delete
      BEFORE DELETE ON vector_report_definitions BEGIN SELECT RAISE(ABORT,'Report definitions are immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS no_vector_report_audit_update
      BEFORE UPDATE ON vector_report_audit BEGIN SELECT RAISE(ABORT,'Report audit is append only.'); END;
    CREATE TRIGGER IF NOT EXISTS no_vector_report_audit_delete
      BEFORE DELETE ON vector_report_audit BEGIN SELECT RAISE(ABORT,'Report audit is append only.'); END;
  `);
  const auth=db.prepare('SELECT u.email,u.tenant,u.role,s.expires FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  const insert=db.prepare('INSERT INTO vector_report_definitions(id,tenant,created_by,role_at_creation,title,source_id,definition_json,definition_digest,version_of,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  const audit=db.prepare('INSERT INTO vector_report_audit(tenant,report_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?,?)');
  const list=db.prepare('SELECT id,title,source_id,definition_json,definition_digest,version_of,created_by,created_at FROM vector_report_definitions WHERE tenant=? ORDER BY created_at DESC LIMIT 200');
  const one=db.prepare('SELECT id,title,source_id,definition_json,definition_digest,version_of,created_by,created_at FROM vector_report_definitions WHERE tenant=? AND id=?');
  const auditRows=db.prepare('SELECT id,report_id,actor,event,detail_json,created_at FROM vector_report_audit WHERE tenant=? ORDER BY id DESC LIMIT 250');

  function context(req){
    const token=cookieToken(req);
    if(!token) return null;
    return auth.get(createHash('sha256').update(token).digest('hex'),Date.now())||null;
  }
  function safeRow(row){
    if(!row) return null;
    return {
      id:row.id,title:row.title,sourceId:row.source_id,
      definition:JSON.parse(row.definition_json),
      definitionDigest:row.definition_digest,
      versionOf:row.version_of||null,
      createdBy:row.created_by,
      createdAt:row.created_at
    };
  }
  function record(c,reportId,event,detail){
    audit.run(c.tenant,reportId||null,c.email,event,JSON.stringify(detail||{}),new Date().toISOString());
  }
  async function handleRequest(req,res){
    const path=requestPath(req);
    if(!path.startsWith(PREFIX)) return false;
    const c=context(req);
    if(!c) return writeJson(res,401,{error:'Sign in is required.'});
    if(roleLevel(c.role)<1) return writeJson(res,403,{error:'Reporting is available to governed operational roles.'});

    const method=String(req.method||'GET').toUpperCase();

    if(path===PREFIX+'/catalog'&&method==='GET'){
      record(c,null,'CATALOG_VIEWED',{role:c.role});
      return writeJson(res,200,{...visibleCatalog(c.role),role:c.role});
    }

    if(path===PREFIX+'/validate'&&method==='POST'){
      try{
        const body=await readJson(req);
        const definition=normaliseDefinition(body.definition||body,c.role);
        return writeJson(res,200,{valid:true,definition,definitionDigest:digest(definition)});
      }catch(error){
        return writeJson(res,400,{valid:false,error:compact(error?.message||'Invalid report definition.',300)});
      }
    }

    if(path===PREFIX+'/reports'&&method==='GET'){
      return writeJson(res,200,{schemaVersion:'VECTOR_REPORT_LIST_V1',reports:list.all(c.tenant).map(safeRow)});
    }

    if(path===PREFIX+'/reports'&&method==='POST'){
      try{
        const body=await readJson(req);
        const definition=normaliseDefinition(body.definition||body,c.role);
        const versionOf=compact(body.versionOf,80)||null;
        if(versionOf&&!one.get(c.tenant,versionOf)) return writeJson(res,404,{error:'Previous report version was not found for this tenant.'});
        const id='vr-'+randomUUID();
        const createdAt=new Date().toISOString();
        const definitionDigest=digest(definition);
        insert.run(id,c.tenant,c.email,c.role,definition.title,definition.sourceId,JSON.stringify(definition),definitionDigest,versionOf,createdAt);
        record(c,id,versionOf?'REPORT_VERSION_CREATED':'REPORT_CREATED',{sourceId:definition.sourceId,definitionDigest,versionOf});
        return writeJson(res,201,{report:{id,title:definition.title,sourceId:definition.sourceId,definition,definitionDigest,versionOf,createdBy:c.email,createdAt}});
      }catch(error){
        return writeJson(res,400,{error:compact(error?.message||'Unable to save report.',300)});
      }
    }

    const match=path.match(/^\/api\/reporting\/reports\/([^/]+)$/);
    if(match&&method==='GET'){
      const row=one.get(c.tenant,decodeURIComponent(match[1]));
      if(!row) return writeJson(res,404,{error:'Report not found.'});
      record(c,row.id,'REPORT_VIEWED',{definitionDigest:row.definition_digest});
      return writeJson(res,200,{report:safeRow(row)});
    }

    if(path===PREFIX+'/audit'&&method==='GET'){
      if(!permitted(c.role,'director')) return writeJson(res,403,{error:'Reporting audit requires director or administrator authority.'});
      return writeJson(res,200,{schemaVersion:'VECTOR_REPORT_AUDIT_V1',events:auditRows.all(c.tenant).map(r=>({
        id:r.id,reportId:r.report_id,actor:r.actor,event:r.event,detail:JSON.parse(r.detail_json),createdAt:r.created_at
      }))});
    }

    res.setHeader('Allow','GET, POST');
    return writeJson(res,404,{error:'Unknown reporting endpoint.'});
  }

  return Object.freeze({
    handleRequest,
    catalogForRole:visibleCatalog,
    validateDefinition:normaliseDefinition,
    close(){try{db.close();}catch{}}
  });
}

module.exports=Object.freeze({
  PREFIX,SOURCES,TEMPLATES,ROLE_LEVEL,visibleCatalog,normaliseDefinition,createVectorReportingService,digest
});
