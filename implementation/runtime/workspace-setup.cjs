'use strict';

const {createHash, randomUUID} = require('node:crypto');
const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+stable(value[k])).join(',') + '}' : JSON.stringify(value);
const digest = value => createHash('sha256').update(stable(value)).digest('hex');
function fail(message, statusCode=400) { throw Object.assign(new Error(message), {statusCode}); }
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k))) {
    fail(label + ' contains unsupported fields or is not an object.');
  }
  return value;
}
function text(value, max, label) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length>max || /[\u0000-\u001f\u007f]/.test(value)) fail(label+' is invalid.');
  return value.trim();
}
function list(value, max, length, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length>max) fail(label+' is invalid.');
  return [...new Set(value.map(v=>text(v,length,label)).filter(Boolean))];
}
function count(value,max,label) {
  if (value == null || value==='') return null;
  if (typeof value!=='number' || !Number.isSafeInteger(value) || value<1 || value>max) fail(label+' is invalid.');
  return value;
}

function normalizeAnswers(input) {
  object(input,['organisation','workforce','capabilities','connections'],'Answers');
  const org=object(input.organisation||{},['name','countries','sites'],'Organisation');
  const workforce=object(input.workforce||{},['count','languages','shiftPatterns'],'Workforce');
  const capabilities=object(input.capabilities||{},['modules','trainingRoles'],'Capabilities');
  const connections=object(input.connections||{},['timing','systems'],'Connections');
  if (org.sites!=null && (!Array.isArray(org.sites)||org.sites.length>100)) fail('Sites are invalid.');
  const sites=(org.sites||[]).map(item=>{
    object(item,['code','name','timezone'],'Site');
    const site={code:text(item.code,40,'Site code').toUpperCase(),name:text(item.name,80,'Site name'),timezone:text(item.timezone,80,'Timezone')};
    if (!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(site.code)||!site.name||!site.timezone) fail('Each site requires a code, name and timezone.');
    try { new Intl.DateTimeFormat('en',{timeZone:site.timezone}).format(); } catch { fail('Site timezone must be a valid IANA timezone.'); }
    return site;
  });
  if (new Set(sites.map(s=>s.code)).size!==sites.length) fail('Site codes must be unique.');
  if(connections.timing!=null && !['now','later'].includes(connections.timing)) fail('Choose whether to connect systems now or later.');
  if(connections.systems!=null && (!Array.isArray(connections.systems)||connections.systems.length>60)) fail('Systems are invalid.');
  const systems=(connections.systems||[]).map(item=>{
    object(item,['provider','mode','objectTypes'],'System');
    const system={provider:text(item.provider,60,'Provider'),mode:text(item.mode,20,'Mode'),objectTypes:list(item.objectTypes,5,40,'Object types')};
    if(!system.provider||!['api','file','webhook'].includes(system.mode)||!system.objectTypes.length||system.objectTypes.some(v=>!['people','demand','time','payroll-output','production'].includes(v))) fail('Each system requires a provider, mode and supported object types.');
    return system;
  });
  return {
    organisation:{name:text(org.name,160,'Organisation name'),countries:list(org.countries,30,80,'Countries'),sites},
    workforce:{count:count(workforce.count,1000000,'Workforce count'),languages:list(workforce.languages,40,20,'Languages'),shiftPatterns:count(workforce.shiftPatterns,1000,'Shift pattern count')},
    capabilities:{modules:list(capabilities.modules,11,40,'Modules'),trainingRoles:list(capabilities.trainingRoles,20,40,'Training roles')},
    connections:{timing:connections.timing||null,systems}
  };
}

function createWorkspaceSetup({db,compiler,candidateSha='',deploymentId='',getAppliedState,applyConfiguration}) {
  if (!db || typeof compiler?.compile!=='function' || typeof getAppliedState!=='function' || typeof applyConfiguration!=='function') throw Error('Workspace setup requires database, compiler and synchronous configuration adapters.');
  db.exec(`CREATE TABLE IF NOT EXISTS workspace_setup_drafts(
    tenant TEXT NOT NULL,run_id TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,
    answers_json TEXT NOT NULL,compiled_json TEXT NOT NULL,base_state_json TEXT NOT NULL,
    applied_json TEXT,applied_review_token TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(tenant,run_id));
    CREATE TABLE IF NOT EXISTS workspace_setup_events(
    id INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT NOT NULL,run_id TEXT NOT NULL,revision INTEGER NOT NULL,
    event TEXT NOT NULL,actor TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS no_workspace_setup_event_update BEFORE UPDATE ON workspace_setup_events
    BEGIN SELECT RAISE(ABORT,'Workspace setup events are append only.'); END;
    CREATE TRIGGER IF NOT EXISTS no_workspace_setup_event_delete BEFORE DELETE ON workspace_setup_events
    BEGIN SELECT RAISE(ABORT,'Workspace setup events are append only.'); END;`);
  const get=db.prepare('SELECT * FROM workspace_setup_drafts WHERE tenant=? AND run_id=?');
  if(!db.prepare('PRAGMA table_info(workspace_setup_drafts)').all().some(c=>c.name==='completed_at')) db.exec('ALTER TABLE workspace_setup_drafts ADD COLUMN completed_at TEXT');
  db.exec(`CREATE TRIGGER IF NOT EXISTS workspace_setup_completion_immutable BEFORE UPDATE ON workspace_setup_drafts
    WHEN OLD.completed_at IS NOT NULL AND NEW.completed_at IS NOT OLD.completed_at
    BEGIN SELECT RAISE(ABORT,'Initial questionnaire completion cannot be reset.'); END;
    CREATE TRIGGER IF NOT EXISTS workspace_setup_completion_no_delete BEFORE DELETE ON workspace_setup_drafts
    WHEN OLD.completed_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'Initial questionnaire completion cannot be reset.'); END;`);
  const event=db.prepare('INSERT INTO workspace_setup_events(tenant,run_id,revision,event,actor,detail_json,created_at) VALUES(?,?,?,?,?,?,?)');
  function atomic(fn) {
    const sp=db.isTransaction ? 'setup_'+randomUUID().replaceAll('-','') : null;
    db.exec(sp?'SAVEPOINT '+sp:'BEGIN IMMEDIATE');
    try { const result=fn(); db.exec(sp?'RELEASE '+sp:'COMMIT'); return result; }
    catch(error) { try { db.exec(sp?'ROLLBACK TO '+sp+'; RELEASE '+sp:'ROLLBACK'); } catch {} throw error; }
  }
  function binding(input) {
    if(!input||typeof input.tenant!=='string'||!input.tenant.trim()||input.tenant.length>120||typeof input.runId!=='string'||!input.runId.trim()||input.runId.length>100) fail('Tenant and run binding are required.');
    return {tenant:input.tenant,runId:input.runId};
  }
  function state(bound) {
    const current=getAppliedState(bound);
    if(!current || typeof current.then==='function') throw Error('Configuration state adapter must be synchronous.');
    return {scopeDigest:current.scopeDigest||null,configurationDigest:current.configurationDigest||null};
  }
  function compile(answers) {
    const questions=[];
    if(!answers.organisation.name) questions.push({code:'organisation-required',question:'What is your organisation name?'});
    if(!answers.organisation.countries.length) questions.push({code:'countries-required',question:'Which countries do you operate in?'});
    if(!answers.workforce.count) questions.push({code:'workforce-required',question:'How many people are in your workforce?'});
    if(!answers.workforce.shiftPatterns) questions.push({code:'patterns-required',question:'How many shift patterns do you use?'});
    if(!answers.connections.timing) questions.push({code:'connections-required',question:'Would you like to connect systems now or later?'});
    let compiled;
    if(answers.workforce.count && answers.workforce.shiftPatterns) {
      try {
        compiled=compiler.compile({sites:answers.organisation.sites,
          modules:answers.capabilities.modules.filter(m=>!(m==='integrations'&&answers.connections.timing==='later')),
          workforce:answers.workforce, trainingRoles:answers.capabilities.trainingRoles,
          integrations:answers.connections.timing==='now'?answers.connections.systems:[]});
      } catch(error) { error.statusCode=Number(error.statusCode||error.status||400); throw error; }
      if(compiled.status==='needs_clarification') questions.push(...compiled.questions);
    }
    return questions.length?{status:'needs_clarification',questions}:compiled;
  }
  function present(row,bound) {
    if(!row) return {...bound,revision:0,status:'EMPTY',answers:null,compiled:null,applied:null,reviewToken:null,operationalReady:false,questionnaireComplete:false,completedAt:null};
    const answers=JSON.parse(row.answers_json), compiled=row.status==='DRAFT'?compile(answers):JSON.parse(row.compiled_json), applied=JSON.parse(row.applied_json||'null');
    const base=JSON.parse(row.base_state_json), current=state(bound);
    const unchanged=stable(base)===stable(current);
    const sourceBound=/^[0-9a-f]{40}$/.test(candidateSha)&&Boolean(deploymentId);
    const reviewToken=row.status==='DRAFT'&&compiled.status==='compiled'&&unchanged&&sourceBound ?
      digest({...bound,revision:row.revision,base,candidateSha,deploymentId,answers,compiled}) : null;
    return {...bound,revision:row.revision,status:row.status,answers,compiled,applied,reviewToken,
      requiresRebase:row.status==='DRAFT'&&!unchanged,
      deferredIntegrations:answers.connections.timing==='later'?answers.connections.systems:[],
      operationalReady:false,updatedAt:row.updated_at,questionnaireComplete:Boolean(row.completed_at),completedAt:row.completed_at||null};
  }
  function read(input) { const bound=binding(input); return present(get.get(bound.tenant,bound.runId),bound); }
  function checkRevision(row,expected) {
    if(!Number.isSafeInteger(expected)||expected<0||expected!==(row?.revision||0)) fail('The questionnaire revision changed. Reload the saved draft before saving or applying.',409);
  }
  function actor(input) { const value=text(input.actor,128,'Actor'); if(!value) fail('An authenticated actor is required.'); return value; }
  function save(input) {
    const bound=binding(input), by=actor(input), answers=normalizeAnswers(input.answers), compiled=compile(answers);
    return atomic(()=>{
      const row=get.get(bound.tenant,bound.runId); checkRevision(row,input.expectedRevision);
      const revision=(row?.revision||0)+1, ts=new Date().toISOString();
      db.prepare(`INSERT INTO workspace_setup_drafts(tenant,run_id,revision,status,answers_json,compiled_json,base_state_json,applied_json,applied_review_token,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(tenant,run_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,
        answers_json=excluded.answers_json,compiled_json=excluded.compiled_json,base_state_json=excluded.base_state_json,
        applied_review_token=NULL,updated_at=excluded.updated_at`).run(bound.tenant,bound.runId,revision,'DRAFT',
          JSON.stringify(answers),JSON.stringify(compiled),JSON.stringify(state(bound)),row?.applied_json||null,null,ts);
      event.run(bound.tenant,bound.runId,revision,'DRAFT_SAVED',by,JSON.stringify({answersDigest:digest(answers),status:compiled.status}),ts);
      return read(bound);
    });
  }
  function apply(input) {
    const bound=binding(input), by=actor(input);
    return atomic(()=>{
      const row=get.get(bound.tenant,bound.runId); checkRevision(row,input.expectedRevision);
      if(!row) fail('Save a questionnaire draft first.',409);
      if(row.status==='APPLIED') {
        const applied=JSON.parse(row.applied_json);
        if(!input.reviewToken||input.reviewToken!==row.applied_review_token||stable(state(bound))!==stable(applied)) fail('The applied configuration changed. Save and review a new draft.',409);
        return present(row,bound);
      }
      const draft=present(row,bound);
      if(draft.compiled.status!=='compiled') fail('Answer the clarification questions before applying.',409);
      if(draft.requiresRebase) fail('The current configuration changed. Save and review your answers again.',409);
      if(!draft.reviewToken||input.reviewToken!==draft.reviewToken) fail('Review this draft on the current deployment before applying.',409);
      const result=applyConfiguration({...bound,actor:by,answers:draft.answers,compiled:draft.compiled});
      if(!result || typeof result.then==='function') throw Error('Configuration application must be synchronous.');
      const applied=state(bound);
      if(!applied.scopeDigest||!applied.configurationDigest||result.scopeDigest!==applied.scopeDigest||result.configurationDigest!==applied.configurationDigest) throw Error('Configuration application readback did not match persisted state.');
      const ts=new Date().toISOString();
      db.prepare("UPDATE workspace_setup_drafts SET status='APPLIED',compiled_json=?,applied_json=?,applied_review_token=?,updated_at=?,completed_at=COALESCE(completed_at,?) WHERE tenant=? AND run_id=?")
        .run(JSON.stringify(draft.compiled),JSON.stringify(applied),input.reviewToken,ts,ts,bound.tenant,bound.runId);
      event.run(bound.tenant,bound.runId,row.revision,'CONFIGURATION_APPLIED',by,JSON.stringify({reviewToken:input.reviewToken,...applied}),ts);
      return read(bound);
    });
  }
  return {read,save,apply};
}

module.exports={createWorkspaceSetup,normalizeAnswers};
