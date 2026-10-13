'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PREFIX = '/api/reporting';
const MAX_BODY_BYTES = 96 * 1024;
const MAX_COLUMNS = 24;
const MAX_FILTERS = 20;
const MAX_SORTS = 4;
const MAX_LIMIT = 5000;
const MAX_CALCULATIONS = 8;
const MAX_DASHBOARD_PINS = 12;
const REPORT_CLAIM_BOUNDARY = 'Source-bound report. Estimates and opportunities must not be presented as realised outcomes without authoritative evidence.';
const CADENCES = new Set(['daily','weekly','monthly']);
const DELIVERY_MODES = new Set(['in_app','email_link','sftp']);

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
const CALCULATION_OPERATORS = new Set(['sum','difference','product','ratio','percent_change']);

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
    limits:{maxColumns:MAX_COLUMNS,maxCalculations:MAX_CALCULATIONS,maxFilters:MAX_FILTERS,maxSorts:MAX_SORTS,maxRows:MAX_LIMIT}
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
function normaliseDashboard(input={}){
  const title=compact(input.title,120)||'My reporting dashboard';
  const pins=[...new Set((Array.isArray(input.reportIds)?input.reportIds:[]).map(v=>compact(v,100)).filter(Boolean))].slice(0,MAX_DASHBOARD_PINS);
  return Object.freeze({
    schemaVersion:'VECTOR_REPORT_DASHBOARD_V1',
    title,
    reportIds:pins,
    layout:'responsive-grid',
    claimBoundary:'Dashboard tiles retain the source report permission and evidence boundaries. A dashboard never widens report access.'
  });
}
function normaliseSchedule(input={},deliveryAdapter){
  const reportId=compact(input.reportId,100);
  if(!reportId) throw new Error('reportId is required.');
  const cadence=compact(input.cadence||'weekly',20).toLowerCase();
  if(!CADENCES.has(cadence)) throw new Error('Unsupported schedule cadence.');
  const hour=Number(input.hour),minute=Number(input.minute);
  if(!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59) throw new Error('Schedule hour/minute are invalid.');
  const timeZone=compact(input.timeZone,80)||'UTC';
  try{new Intl.DateTimeFormat('en-GB',{timeZone}).format(new Date());}catch{throw new Error('Schedule timeZone must be a valid IANA time zone.');}
  const weekday=cadence==='weekly'?Number(input.weekday):null;
  if(cadence==='weekly'&&(!Number.isInteger(weekday)||weekday<0||weekday>6)) throw new Error('Weekly schedule requires weekday 0-6.');
  const dayOfMonth=cadence==='monthly'?Number(input.dayOfMonth):null;
  if(cadence==='monthly'&&(!Number.isInteger(dayOfMonth)||dayOfMonth<1||dayOfMonth>28)) throw new Error('Monthly schedule requires dayOfMonth 1-28.');
  const delivery=compact(input.delivery||'in_app',24).toLowerCase();
  if(!DELIVERY_MODES.has(delivery)) throw new Error('Unsupported delivery mode.');
  if(delivery!=='in_app'&&(!deliveryAdapter||typeof deliveryAdapter.deliver!=='function')) throw new Error('External report delivery adapter is not configured.');
  const destination=delivery==='in_app'?null:compact(input.destination,320);
  if(delivery!=='in_app'&&!destination) throw new Error('External delivery destination is required.');
  return Object.freeze({
    schemaVersion:'VECTOR_REPORT_SCHEDULE_V1',reportId,cadence,hour,minute,timeZone,weekday,dayOfMonth,delivery,destination,
    claimBoundary:delivery==='in_app'
      ?'Scheduled in-product delivery opens the governed live report; it is not a frozen historical snapshot.'
      :'External delivery remains subject to the configured independently verified delivery adapter.'
  });
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
  const calculations=(Array.isArray(input.calculations)?input.calculations:[]).slice(0,MAX_CALCULATIONS).map((calc,index)=>{
    if(!calc||typeof calc!=='object'||Array.isArray(calc))throw new Error('Invalid calculated metric.');
    const left=compact(calc.left,80),right=compact(calc.right,80),operator=compact(calc.operator,30).toLowerCase(),label=compact(calc.label,80)||('Calculated '+(index+1));
    if(!allowed.has(left)||!allowed.has(right))throw new Error('Calculated metrics may use only approved source fields.');
    if(!CALCULATION_OPERATORS.has(operator))throw new Error('Unsupported calculated metric operator.');
    return {id:'calc_'+(index+1),label,left,right,operator};
  });
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
  const claimBoundary=REPORT_CLAIM_BOUNDARY;
  return Object.freeze({
    schemaVersion:'VECTOR_REPORT_DEFINITION_V1',
    title,sourceId,endpoint:source.endpoint,evidenceClass:source.evidenceClass,
    columns,calculations,filters,sorts,visualisation,comparison,limit,narrative,
    includeEvidence:true,
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
  const deliveryAdapter=options.deliveryAdapter||null;
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
    CREATE TABLE IF NOT EXISTS vector_report_dashboards(
      id TEXT PRIMARY KEY,
      tenant TEXT NOT NULL,
      created_by TEXT NOT NULL,
      dashboard_json TEXT NOT NULL,
      dashboard_digest TEXT NOT NULL,
      version_of TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS vector_report_dashboards_tenant_created
      ON vector_report_dashboards(tenant,created_at DESC);
    CREATE TABLE IF NOT EXISTS vector_report_schedules(
      id TEXT PRIMARY KEY,
      tenant TEXT NOT NULL,
      created_by TEXT NOT NULL,
      schedule_json TEXT NOT NULL,
      schedule_digest TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS vector_report_schedules_tenant_created
      ON vector_report_schedules(tenant,created_at DESC);
    CREATE TABLE IF NOT EXISTS vector_report_schedule_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS vector_report_schedule_events_lookup
      ON vector_report_schedule_events(tenant,schedule_id,id DESC);
    CREATE TABLE IF NOT EXISTS vector_report_deliveries(
      delivery_key TEXT PRIMARY KEY,
      tenant TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS vector_report_deliveries_tenant_created
      ON vector_report_deliveries(tenant,created_at DESC);
    CREATE TRIGGER IF NOT EXISTS no_vector_report_update
      BEFORE UPDATE ON vector_report_definitions BEGIN SELECT RAISE(ABORT,'Report definitions are immutable; create a new version.'); END;
    CREATE TRIGGER IF NOT EXISTS no_vector_report_delete
      BEFORE DELETE ON vector_report_definitions BEGIN SELECT RAISE(ABORT,'Report definitions are immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS no_vector_dashboard_update
      BEFORE UPDATE ON vector_report_dashboards BEGIN SELECT RAISE(ABORT,'Dashboards are immutable; create a new version.'); END;
    CREATE TRIGGER IF NOT EXISTS no_vector_dashboard_delete
      BEFORE DELETE ON vector_report_dashboards BEGIN SELECT RAISE(ABORT,'Dashboards are immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS no_vector_schedule_update
      BEFORE UPDATE ON vector_report_schedules BEGIN SELECT RAISE(ABORT,'Schedules are immutable; create a replacement.'); END;
    CREATE TRIGGER IF NOT EXISTS no_vector_schedule_delete
      BEFORE DELETE ON vector_report_schedules BEGIN SELECT RAISE(ABORT,'Schedules are immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS no_vector_schedule_event_update
      BEFORE UPDATE ON vector_report_schedule_events BEGIN SELECT RAISE(ABORT,'Schedule state events are append only.'); END;
    CREATE TRIGGER IF NOT EXISTS no_vector_schedule_event_delete
      BEFORE DELETE ON vector_report_schedule_events BEGIN SELECT RAISE(ABORT,'Schedule state events are append only.'); END;
    CREATE TRIGGER IF NOT EXISTS no_vector_delivery_update
      BEFORE UPDATE ON vector_report_deliveries BEGIN SELECT RAISE(ABORT,'Delivery receipts are append only.'); END;
    CREATE TRIGGER IF NOT EXISTS no_vector_delivery_delete
      BEFORE DELETE ON vector_report_deliveries BEGIN SELECT RAISE(ABORT,'Delivery receipts are append only.'); END;
    CREATE TRIGGER IF NOT EXISTS no_vector_report_audit_update
      BEFORE UPDATE ON vector_report_audit BEGIN SELECT RAISE(ABORT,'Report audit is append only.'); END;
    CREATE TRIGGER IF NOT EXISTS no_vector_report_audit_delete
      BEFORE DELETE ON vector_report_audit BEGIN SELECT RAISE(ABORT,'Report audit is append only.'); END;
  `);
  const auth=db.prepare('SELECT u.email,u.tenant,u.role,s.expires FROM sessions s JOIN users u ON u.email=s.email WHERE s.token_hash=? AND s.expires>?');
  const insert=db.prepare('INSERT INTO vector_report_definitions(id,tenant,created_by,role_at_creation,title,source_id,definition_json,definition_digest,version_of,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  const audit=db.prepare('INSERT INTO vector_report_audit(tenant,report_id,actor,event,detail_json,created_at) VALUES(?,?,?,?,?,?)');
  const list=db.prepare('SELECT * FROM vector_report_definitions WHERE tenant=? AND created_by=? ORDER BY created_at DESC LIMIT 200');
  const one=db.prepare('SELECT * FROM vector_report_definitions WHERE tenant=? AND id=?');
  const auditRows=db.prepare('SELECT id,report_id,actor,event,detail_json,created_at FROM vector_report_audit WHERE tenant=? ORDER BY id DESC LIMIT 250');
  const dashboardInsert=db.prepare('INSERT INTO vector_report_dashboards(id,tenant,created_by,dashboard_json,dashboard_digest,version_of,created_at) VALUES(?,?,?,?,?,?,?)');
  const dashboardList=db.prepare('SELECT * FROM vector_report_dashboards WHERE tenant=? AND created_by=? ORDER BY created_at DESC LIMIT 100');
  const dashboardOne=db.prepare('SELECT * FROM vector_report_dashboards WHERE tenant=? AND id=?');
  const scheduleInsert=db.prepare('INSERT INTO vector_report_schedules(id,tenant,created_by,schedule_json,schedule_digest,created_at) VALUES(?,?,?,?,?,?)');
  const scheduleList=db.prepare('SELECT id,tenant,created_by,schedule_json,schedule_digest,created_at FROM vector_report_schedules WHERE tenant=? AND created_by=? ORDER BY created_at DESC LIMIT 100');
  const scheduleOne=db.prepare('SELECT id,tenant,created_by,schedule_json,schedule_digest,created_at FROM vector_report_schedules WHERE tenant=? AND id=?');
  const scheduleEvent=db.prepare('INSERT INTO vector_report_schedule_events(tenant,schedule_id,enabled,actor,created_at) VALUES(?,?,?,?,?)');
  const scheduleState=db.prepare('SELECT enabled,actor,created_at FROM vector_report_schedule_events WHERE tenant=? AND schedule_id=? ORDER BY id DESC LIMIT 1');
  const allSchedules=db.prepare('SELECT id,tenant,created_by,schedule_json,schedule_digest,created_at FROM vector_report_schedules ORDER BY created_at ASC');
  const deliveryInsert=db.prepare('INSERT OR IGNORE INTO vector_report_deliveries(delivery_key,tenant,schedule_id,report_id,mode,status,receipt_json,created_at) VALUES(?,?,?,?,?,?,?,?)');
  const deliveryList=db.prepare('SELECT d.* FROM vector_report_deliveries d JOIN vector_report_schedules s ON s.id=d.schedule_id AND s.tenant=d.tenant WHERE d.tenant=? AND s.created_by=? ORDER BY d.created_at DESC LIMIT 100');
  const deliveryOne=db.prepare('SELECT delivery_key FROM vector_report_deliveries WHERE delivery_key=?');
  const currentUser=db.prepare('SELECT email,tenant,role FROM users WHERE tenant=? AND email=?');
  const hasTable=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  async function currentIdentity(c){
    try{
      const actor=options.currentUserReader?await options.currentUserReader({tenant:c.tenant,email:c.email}):currentUser.get(c.tenant,c.email);
      if(!actor||actor.email!==c.email||actor.tenant!==c.tenant)return null;
      if(hasTable('identity_tenant_control')&&Number(db.prepare('SELECT privileged_freeze FROM identity_tenant_control WHERE tenant=?').get(c.tenant)?.privileged_freeze)===1)return null;
      return actor;
    }catch{return null;}
  }
  // One deny-only predicate for personal artifacts and every immutable reference.
  // Current authority comes from the user store, never role_at_creation.
  async function access(c,row,kind='report',seen=new Set()){
    const actor=await currentIdentity(c);
    if(!actor||!row||row.tenant!==actor.tenant||row.created_by!==actor.email||roleLevel(actor.role)<1)return false;
    const key=kind+':'+row.id;if(seen.has(key)||seen.size>=200)return false;seen.add(key);
    try{
      if(kind==='report'){
        const source=sourceById(row.source_id);
        if(!source||!permitted(actor.role,source.minRole))return false;
        const definition=JSON.parse(row.definition_json);
        if(definition.includeEvidence!==true||definition.claimBoundary!==REPORT_CLAIM_BOUNDARY)return false;
        return !row.version_of||access(actor,one.get(actor.tenant,row.version_of),'report',seen);
      }
      if(kind==='dashboard'){
        const dashboard=JSON.parse(row.dashboard_json);
        for(const id of dashboard.reportIds)if(!await access(actor,one.get(actor.tenant,id),'report',new Set(seen)))return false;
        return !row.version_of||access(actor,dashboardOne.get(actor.tenant,row.version_of),'dashboard',seen);
      }
      const schedule=JSON.parse(row.schedule_json);
      if(!await access(actor,one.get(actor.tenant,schedule.reportId),'report',seen))return false;
      if(schedule.delivery==='in_app')return true;
      if(typeof deliveryAdapter?.deliver!=='function'||typeof deliveryAdapter?.authorize!=='function')return false;
      const allowed=await deliveryAdapter.authorize({tenant:actor.tenant,actor:actor.email,role:actor.role,reportId:schedule.reportId,scheduleId:row.id||null,delivery:schedule.delivery,destination:schedule.destination});
      if(allowed!==true||!await access(c,one.get(actor.tenant,schedule.reportId),'report'))return false;
      const current=await currentIdentity(c);
      return Boolean(current&&current.email===actor.email&&current.tenant===actor.tenant&&current.role===actor.role);
    }catch{return false;}
  }
  async function authorised(c,rows,kind){
    const result=[];for(const row of rows)if(await access(c,row,kind))result.push(row);return result;
  }

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
  function dashboardRow(row){
    if(!row)return null;
    return {id:row.id,dashboard:JSON.parse(row.dashboard_json),dashboardDigest:row.dashboard_digest,versionOf:row.version_of||null,createdBy:row.created_by,createdAt:row.created_at};
  }
  function scheduleRow(row){
    if(!row)return null;
    const control=scheduleState.get(row.tenant||'',row.id);
    return {id:row.id,schedule:JSON.parse(row.schedule_json),scheduleDigest:row.schedule_digest,enabled:control?Boolean(control.enabled):true,control:control?{actor:control.actor,createdAt:control.created_at}:null,createdBy:row.created_by,createdAt:row.created_at};
  }
  function localParts(date,timeZone){
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'}).formatToParts(date);
    const get=t=>parts.find(p=>p.type===t)?.value||'';
    const weekdays={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
    return {year:get('year'),month:get('month'),day:get('day'),hour:Number(get('hour')),minute:Number(get('minute')),weekday:weekdays[get('weekday')]};
  }
  function dueKey(schedule,now=new Date()){
    const p=localParts(now,schedule.timeZone);
    if(p.hour!==schedule.hour||p.minute!==schedule.minute)return null;
    if(schedule.cadence==='weekly'&&p.weekday!==schedule.weekday)return null;
    if(schedule.cadence==='monthly'&&Number(p.day)!==schedule.dayOfMonth)return null;
    return [p.year,p.month,p.day,String(p.hour).padStart(2,'0'),String(p.minute).padStart(2,'0')].join('-');
  }
  async function runDueSchedules(now=new Date()){
    const results=[];
    for(const row of allSchedules.all()){
      const control=scheduleState.get(row.tenant,row.id);if(control&&Number(control.enabled)!==1)continue;
      let schedule;try{schedule=JSON.parse(row.schedule_json);}catch{continue;}
      const slot=dueKey(schedule,now);if(!slot)continue;
      const report=one.get(row.tenant,schedule.reportId);if(!report)continue;
      const key=row.id+':'+slot;
      if(deliveryOne.get(key)||inFlight.has(key))continue;
      inFlight.add(key);
      try{
      let status='READY',externalReceipt=null;
      const c={tenant:row.tenant,email:row.created_by};
      if(!await access(c,row,'schedule'))status='BLOCKED_AUTHORITY_DRIFT';
      else if(schedule.delivery!=='in_app'){
        if(!deliveryAdapter||typeof deliveryAdapter.deliver!=='function')status='BLOCKED_NO_ADAPTER';
        else{
          try{
            externalReceipt=await deliveryAdapter.deliver({tenant:row.tenant,actor:row.created_by,scheduleId:row.id,reportId:schedule.reportId,definitionDigest:report.definition_digest,delivery:schedule.delivery,destination:schedule.destination,slot,idempotencyKey:key});
            status='SENT';
          }catch(error){status='FAILED';externalReceipt={errorDigest:digest(compact(error?.message||'delivery failure',240))};}
        }
      }
      const receipt={schemaVersion:'VECTOR_REPORT_DELIVERY_V1',scheduleId:row.id,reportId:schedule.reportId,definitionDigest:report.definition_digest,slot,mode:schedule.delivery,status,externalReceipt,claimBoundary:schedule.claimBoundary};
      const createdAt=new Date().toISOString();
      const inserted=deliveryInsert.run(key,row.tenant,row.id,schedule.reportId,schedule.delivery,status,JSON.stringify(receipt),createdAt).changes;
      if(inserted){
        if(status==='BLOCKED_AUTHORITY_DRIFT')record(c,schedule.reportId,status,{scheduleId:row.id,slot,definitionDigest:report.definition_digest});
        results.push({...receipt,deliveryKey:key,createdAt});
      }
      }finally{inFlight.delete(key);}
    }
    return results;
  }
  const inFlight=new Set();
  const schedulerTimer=setInterval(()=>{runDueSchedules().catch(()=>{});},Math.max(10000,Number(options.schedulerTickMs)||30000));
  if(schedulerTimer.unref)schedulerTimer.unref();

  async function handleRequest(req,res){
    const path=requestPath(req);
    if(!path.startsWith(PREFIX)) return false;
    const session=context(req),c=session?await currentIdentity(session):null;
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
        const definition=normaliseDefinition(body.definition||body,(await currentIdentity(c))?.role||'');
        return writeJson(res,200,{valid:true,definition,definitionDigest:digest(definition)});
      }catch(error){
        return writeJson(res,400,{valid:false,error:compact(error?.message||'Invalid report definition.',300)});
      }
    }

    if(path===PREFIX+'/reports'&&method==='GET'){
      return writeJson(res,200,{schemaVersion:'VECTOR_REPORT_LIST_V1',reports:(await authorised(c,list.all(c.tenant,c.email),'report')).map(safeRow)});
    }

    if(path===PREFIX+'/reports'&&method==='POST'){
      try{
        const body=await readJson(req);
        const definition=normaliseDefinition(body.definition||body,(await currentIdentity(c))?.role||'');
        const versionOf=compact(body.versionOf,80)||null;
        if(versionOf&&!await access(c,one.get(c.tenant,versionOf))) return writeJson(res,404,{error:'Previous report version was not found.'});
        const id='vr-'+randomUUID();
        const createdAt=new Date().toISOString();
        const definitionDigest=digest(definition);
        if(!await access(c,{id,tenant:c.tenant,created_by:c.email,source_id:definition.sourceId,definition_json:JSON.stringify(definition),version_of:versionOf}))return writeJson(res,404,{error:'Report authority is unavailable.'});
        insert.run(id,c.tenant,c.email,c.role,definition.title,definition.sourceId,JSON.stringify(definition),definitionDigest,versionOf,createdAt);
        record(c,id,versionOf?'REPORT_VERSION_CREATED':'REPORT_CREATED',{sourceId:definition.sourceId,definitionDigest,versionOf});
        return writeJson(res,201,{report:{id,title:definition.title,sourceId:definition.sourceId,definition,definitionDigest,versionOf,createdBy:c.email,createdAt}});
      }catch(error){
        return writeJson(res,400,{error:compact(error?.message||'Unable to save report.',300)});
      }
    }

    if(path===PREFIX+'/dashboards'&&method==='GET'){
      return writeJson(res,200,{schemaVersion:'VECTOR_REPORT_DASHBOARD_LIST_V1',dashboards:(await authorised(c,dashboardList.all(c.tenant,c.email),'dashboard')).map(dashboardRow)});
    }

    if(path===PREFIX+'/dashboards/pin'&&method==='POST'){
      try{
        const body=await readJson(req),reportId=compact(body.reportId,100);
        if(!reportId||!await access(c,one.get(c.tenant,reportId))) return writeJson(res,404,{error:'Report not found.'});
        const latest=(await authorised(c,dashboardList.all(c.tenant,c.email),'dashboard'))[0]||null;
        const previous=latest?dashboardRow(latest):null;
        const ids=[...(previous?.dashboard?.reportIds||[]),reportId];
        const dashboard=normaliseDashboard({title:body.title||previous?.dashboard?.title||'My reporting dashboard',reportIds:ids});
        const id='vd-'+randomUUID(),createdAt=new Date().toISOString(),dashboardDigest=digest(dashboard);
        if(!await access(c,one.get(c.tenant,reportId)))return writeJson(res,404,{error:'Report not found.'});
        dashboardInsert.run(id,c.tenant,c.email,JSON.stringify(dashboard),dashboardDigest,previous?.id||null,createdAt);
        record(c,reportId,'REPORT_PINNED',{dashboardId:id,dashboardDigest,versionOf:previous?.id||null});
        return writeJson(res,201,{dashboard:{id,dashboard,dashboardDigest,versionOf:previous?.id||null,createdBy:c.email,createdAt}});
      }catch(error){return writeJson(res,400,{error:compact(error?.message||'Unable to pin report.',300)});}
    }

    if(path===PREFIX+'/dashboards/unpin'&&method==='POST'){
      try{
        const body=await readJson(req),reportId=compact(body.reportId,100);
        if(!await access(c,one.get(c.tenant,reportId)))return writeJson(res,404,{error:'Report not found.'});
        const latest=(await authorised(c,dashboardList.all(c.tenant,c.email),'dashboard'))[0]||null;
        if(!latest)return writeJson(res,404,{error:'Dashboard not found.'});
        const previous=dashboardRow(latest),dashboard=normaliseDashboard({title:previous.dashboard.title,reportIds:(previous.dashboard.reportIds||[]).filter(id=>id!==reportId)});
        const id='vd-'+randomUUID(),createdAt=new Date().toISOString(),dashboardDigest=digest(dashboard);
        if(!await access(c,one.get(c.tenant,reportId)))return writeJson(res,404,{error:'Report not found.'});
        dashboardInsert.run(id,c.tenant,c.email,JSON.stringify(dashboard),dashboardDigest,previous.id,createdAt);
        record(c,reportId,'REPORT_UNPINNED',{dashboardId:id,dashboardDigest,versionOf:previous.id});
        return writeJson(res,201,{dashboard:{id,dashboard,dashboardDigest,versionOf:previous.id,createdBy:c.email,createdAt}});
      }catch(error){return writeJson(res,400,{error:compact(error?.message||'Unable to unpin report.',300)});}
    }

    if(path===PREFIX+'/schedules'&&method==='GET'){
      return writeJson(res,200,{schemaVersion:'VECTOR_REPORT_SCHEDULE_LIST_V1',schedules:(await authorised(c,scheduleList.all(c.tenant,c.email),'schedule')).map(scheduleRow)});
    }

    if(path===PREFIX+'/schedules'&&method==='POST'){
      try{
        const body=await readJson(req),schedule=normaliseSchedule(body.schedule||body,deliveryAdapter);
        const report=one.get(c.tenant,schedule.reportId);
        if(!await access(c,report))return writeJson(res,404,{error:'Report not found.'});
        if(!await access(c,{tenant:c.tenant,created_by:c.email,schedule_json:JSON.stringify(schedule)},'schedule'))return writeJson(res,403,{error:'Current delivery authority is unavailable.'});
        const id='vs-'+randomUUID(),createdAt=new Date().toISOString(),scheduleDigest=digest(schedule);
        scheduleInsert.run(id,c.tenant,c.email,JSON.stringify(schedule),scheduleDigest,createdAt);
        scheduleEvent.run(c.tenant,id,1,c.email,createdAt);
        record(c,schedule.reportId,'REPORT_SCHEDULE_CREATED',{scheduleId:id,scheduleDigest,delivery:schedule.delivery,cadence:schedule.cadence});
        return writeJson(res,201,{schedule:{id,schedule,scheduleDigest,enabled:true,createdBy:c.email,createdAt}});
      }catch(error){return writeJson(res,400,{error:compact(error?.message||'Unable to schedule report.',300)});}
    }

    const scheduleStateMatch=path.match(/^\/api\/reporting\/schedules\/([^/]+)\/state$/);
    if(scheduleStateMatch&&method==='POST'){
      try{
        const id=decodeURIComponent(scheduleStateMatch[1]),row=scheduleOne.get(c.tenant,id);
        const body=await readJson(req);if(typeof body.enabled!=='boolean')return writeJson(res,400,{error:'enabled must be true or false.'});
        if(!await access(c,row,'schedule'))return writeJson(res,404,{error:'Schedule not found.'});
        const createdAt=new Date().toISOString();scheduleEvent.run(c.tenant,id,body.enabled?1:0,c.email,createdAt);
        const schedule=JSON.parse(row.schedule_json);
        record(c,schedule.reportId,body.enabled?'REPORT_SCHEDULE_RESUMED':'REPORT_SCHEDULE_PAUSED',{scheduleId:id});
        return writeJson(res,200,{schedule:{...scheduleRow(row),enabled:body.enabled,control:{actor:c.email,createdAt}}});
      }catch(error){return writeJson(res,400,{error:compact(error?.message||'Unable to change schedule state.',300)});}
    }

    if(path===PREFIX+'/deliveries'&&method==='GET'){
      const rows=[];for(const r of deliveryList.all(c.tenant,c.email))if(await access(c,scheduleOne.get(c.tenant,r.schedule_id),'schedule')&&await access(c,one.get(c.tenant,r.report_id)))rows.push(r);
      return writeJson(res,200,{schemaVersion:'VECTOR_REPORT_DELIVERY_LIST_V1',deliveries:rows.map(r=>({
        deliveryKey:r.delivery_key,scheduleId:r.schedule_id,reportId:r.report_id,mode:r.mode,status:r.status,receipt:JSON.parse(r.receipt_json),createdAt:r.created_at
      }))});
    }

    const match=path.match(/^\/api\/reporting\/reports\/([^/]+)$/);
    if(match&&method==='GET'){
      const row=one.get(c.tenant,decodeURIComponent(match[1]));
      if(!await access(c,row)) return writeJson(res,404,{error:'Report not found.'});
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
    validateDashboard:normaliseDashboard,
    validateSchedule:input=>normaliseSchedule(input,deliveryAdapter),
    runDueSchedules,
    close(){clearInterval(schedulerTimer);try{db.close();}catch{}}
  });
}

module.exports=Object.freeze({
  PREFIX,SOURCES,TEMPLATES,ROLE_LEVEL,visibleCatalog,normaliseDefinition,normaliseDashboard,normaliseSchedule,createVectorReportingService,digest
});
