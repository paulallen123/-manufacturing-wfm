'use strict';

const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createTenantCalendar } = require('./tenant-calendar.cjs');
const {
  CONTRACT_VERSION,
  produceTimeReviewActionEvidence, produceAbsenceActionEvidence,
  produceWeeklySignoffActionEvidence, sourceReportMatches
} = require('./workflow-action-evidence-contract.cjs');

const PREFIX = '/api/workforce/lifecycle/action-evidence';
const TIME_REVIEW_PATH = PREFIX + '/time-review';
const SOURCE_TIME_REVIEW_PATH = '/api/weekly-review';
const ABSENCE_PATH = PREFIX + '/absence';
const WEEKLY_SIGNOFF_PATH = PREFIX + '/weekly-signoff';
const SOURCE_ABSENCE_PATH = '/api/bootstrap';

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function cookieSessionToken(req) {
  const raw = String(req?.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const item = part.trim();
    if (item.startsWith('wfm_session=')) return item.slice('wfm_session='.length);
  }
  return '';
}

function requestPath(req) {
  return String(req?.url || '/').split('?')[0] || '/';
}

function selectors(req, workflow) {
  const url = new URL(String(req?.url || TIME_REVIEW_PATH), 'http://wfm.invalid');
  for (const key of url.searchParams.keys()) {
    if (!['period','team','sourceId'].includes(key) || url.searchParams.getAll(key).length !== 1)
      throw Object.assign(new Error('Invalid evidence selectors.'), {statusCode:400});
  }
  const result={period:url.searchParams.get('period')||'',teamId:url.searchParams.get('team')||'',sourceId:url.searchParams.get('sourceId')||''};
  if ((workflow==='weekly-signoff'&&!result.period)||(workflow==='absence'&&url.searchParams.has('period')))
    throw Object.assign(new Error('A source review period is required only for weekly workflows.'), {statusCode:400});
  if (result.period && (!/^\d{4}-\d{2}-\d{2}$/.test(result.period)
    || !Number.isFinite(Date.parse(result.period+'T00:00:00Z'))
    || new Date(result.period+'T00:00:00Z').toISOString().slice(0,10)!==result.period))
    throw Object.assign(new Error('Requested review period is invalid.'), {statusCode:400});
  for (const value of [result.teamId,result.sourceId]) if(value.length>160||value!==value.trim()||/[\u0000-\u001f\u007f]/.test(value))
    throw Object.assign(new Error('Invalid evidence selectors.'), {statusCode:400});
  return Object.freeze(result);
}
function requestedReviewPeriod(req) { return selectors(req,'time-review').period; }
function sourceTimeReviewPath(req) {
  const period = requestedReviewPeriod(req);
  return period ? SOURCE_TIME_REVIEW_PATH + '?period=' + encodeURIComponent(period) : SOURCE_TIME_REVIEW_PATH;
}

function writeJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return true;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
  return true;
}

function uniqueSourceIds(rows) {
  if(!Array.isArray(rows))return false;
  const ids=rows.map(row=>row?.id??row?.teamId);
  return ids.every(id=>typeof id==='string'&&id.length>0&&id.length<=160&&id===id.trim()&&!/[\u0000-\u001f\u007f]/.test(id))&&new Set(ids).size===ids.length;
}

function sourceReaderRequired() {
  return Object.assign(new Error('An authoritative in-process workflow source reader is required.'), {
    statusCode:503, code:'WFM_ACTION_EVIDENCE_SOURCE_READER_REQUIRED'
  });
}

// Retain the public helper name, but never replay a browser session over loopback.
// The sealed actor() always updates session context, and in direct mode this
// transport/client change can revoke the session. There is no safe read-only
// HTTP adapter in the current source. The owner must inject a source-owned reader
// that preserves the existing auth and workflow permission checks. Request flags,
// forwarded identities and environment modes cannot opt back into this transport.
function fetchAuthoritativeTimeReview() {
  return Promise.reject(sourceReaderRequired());
}

function createWorkflowActionEvidenceBridge(options = {}) {
  const sourceOwner=options.sourceOwner;
  if(sourceOwner!==undefined&&(!sourceOwner||['capture','assertCurrent','release'].some(key=>typeof sourceOwner[key]!=='function')))
    throw new TypeError('Trusted workflow source owner is incomplete.');
  const dbPath = options.dbPath || process.env.WFM_DB;
  if (!dbPath) throw new Error('Workflow action evidence bridge requires WFM_DB.');
  const db = new DatabaseSync(dbPath, {readOnly:true});
  const providers = Object.freeze({
    'time-review': options.timeReviewSourceProvider,
    'absence': options.absenceSourceProvider,
    'weekly-signoff': options.weeklySignoffSourceProvider
  });
  const tenantCalendar = options.tenantCalendar || createTenantCalendar({
    env: options.env || process.env,
    now: typeof options.now === 'function' ? options.now : Date.now
  });
  const calendarProvider = typeof options.calendarProvider === 'function'
    ? options.calendarProvider
    : ctx => {
        const row=tenantState.get(ctx.tenant),state=row?.state?JSON.parse(row.state):{};
        const person=(Array.isArray(state?.staff)?state.staff:[]).find(item=>item?.id===ctx.person_id);
        return tenantCalendar.snapshot({tenant:ctx.tenant,site:person?.site||null});
      };
  const tenantState = db.prepare('SELECT version,state FROM tenants WHERE id=?');
  const auth = db.prepare(`SELECT u.email,u.tenant,u.role,u.person_id,u.permissions,u.costs
    FROM sessions s JOIN users u ON u.email=s.email
    WHERE s.token_hash=? AND s.expires>?`);

  function context(req) {
    const token = cookieSessionToken(req);
    return token ? auth.get(sha256(token), Date.now()) || null : null;
  }

  function requireDecisionRole(req, res) {
    const ctx = context(req);
    if (!ctx) {
      writeJson(res, 401, { error: 'Sign in is required.' });
      return null;
    }
    if (!['manager', 'director', 'supervisor'].includes(String(ctx.role || ''))) {
      writeJson(res, 403, { error: 'Workflow action evidence requires an authorised manager or administrator.' });
      return null;
    }
    return ctx;
  }

  // Reuse the authoritative SQLite context query after EVERY awaited read. An
  // initial request object is not proof that the current session still has access.
  function fence(req,res,initial,token,snapshot,ticket,sourceState) {
    const current=requireDecisionRole(req,res);
    if(!current)return false;
    if(cookieSessionToken(req)!==token||Object.keys(initial).some(key=>initial[key]!==current[key])){
      writeJson(res,403,{error:'Workflow evidence access changed. Refresh the signed-in context.'});return false;
    }
    const state=tenantState.get(initial.tenant);
    if(!state||state.version!==snapshot.version||state.state!==snapshot.state){
      writeJson(res,409,{error:'Workflow source changed during the read. Refresh source evidence.'});return false;
    }
    if(sourceOwner)sourceOwner.assertCurrent(ticket,req,sourceState);
    return true;
  }
  function allowedTeams(state,personId) {
    // Same reporting-branch relation as sealed engine.descendants / P.reviewer.
    if(!state||!Array.isArray(state.org)||!state.org.some(row=>row?.id===personId))return [];
    const ids=new Set([personId]);
    for(let changed=true;changed;){changed=false;for(const row of state.org){
      if(row&&ids.has(row.parent)&&typeof row.id==='string'&&!ids.has(row.id)){ids.add(row.id);changed=true;}
    }}
    return [...ids];
  }
  async function evidence(req, res, workflow) {
    const ctx = requireDecisionRole(req, res);
    if (!ctx) return true;
    let query;
    try{query=selectors(req,workflow);}catch{return writeJson(res,400,{error:'Requested evidence selectors are invalid.'});}
    const token=cookieSessionToken(req),snapshot=tenantState.get(ctx.tenant);
    let state;
    try{state=JSON.parse(snapshot.state);}catch{return writeJson(res,503,{error:'Reporting scope is unavailable.'});}
    const sourceRequest=Object.freeze({url:String(req.url),method:'GET',headers:Object.freeze({...req.headers}),socket:req.socket});
    const ticket=sourceOwner?sourceOwner.capture(req,sourceRequest):undefined;
    try {
    if(sourceOwner)sourceOwner.assertCurrent(ticket,req,state);
    const allowedTeamIds=allowedTeams(state,ctx.person_id);
    if(!allowedTeamIds.length)return writeJson(res,403,{error:'Current reporting scope is required.'});
    if(query.teamId&&!allowedTeamIds.includes(query.teamId))return writeJson(res,403,{error:'Requested team is outside the reporting scope.'});
    let source,sourceFailure=null;
    try {
      const provider=providers[workflow];
      source = await (typeof provider==='function'?provider(sourceRequest,Object.freeze({
        tenant:String(ctx.tenant),role:String(ctx.role),email:String(ctx.email)
      }),ticket):Promise.reject(sourceReaderRequired()));
    } catch (error) { sourceFailure=error||true; }
    if(!fence(req,res,ctx,token,snapshot,ticket,state))return true;
    if(sourceFailure?.code==='WFM_NATIVE_WORKFLOW_OWNER_REQUIRED'&&[401,403,503].includes(Number(sourceFailure.statusCode)))
      return writeJson(res,Number(sourceFailure.statusCode),{error:'Current workflow source authority is required.',code:sourceFailure.code});
    if(sourceFailure)return sourceFailure.code==='WFM_ACTION_EVIDENCE_SOURCE_READER_REQUIRED'
      ? writeJson(res,503,{error:'Authoritative workflow evidence is unavailable until a source reader is configured.',code:sourceFailure.code})
      : writeJson(res,502,{error:'Authoritative workflow evidence is unavailable.'});
    if (source && [401,403].includes(Number(source.status))) {
      return writeJson(res, Number(source.status), {error: Number(source.status) === 401
        ? 'Sign in is required.' : 'Workflow action evidence requires authorised source access.'});
    }
    const report=source?.body;
    if (!source || Number(source.status)!==200 || !sourceReportMatches(report,workflow,{tenant:ctx.tenant,period:query.period||null}))
      return writeJson(res,502,{error:'Authoritative workflow evidence scope did not match or is unavailable.'});
    const period=workflow==='absence'?null:report.period;
    if(workflow!=='absence'&&(!/^\d{4}-\d{2}-\d{2}$/.test(String(period||''))||!Array.isArray(report.teams)))
      return writeJson(res,502,{error:'Authoritative review period or teams are unavailable.'});
    if(report.version!=null&&report.version!==snapshot.version)
      return writeJson(res,502,{error:'Authoritative source revision did not match.'});
    if(workflow==='absence'){
      const actor=report.actor,rows=report.state;
      if(!actor||actor.tenant!==ctx.tenant||actor.email!==ctx.email||actor.role!==ctx.role||actor.personId!==ctx.person_id
        ||!sourceReportMatches(rows,'absence',{tenant:ctx.tenant})||rows.version!==snapshot.version||!uniqueSourceIds(rows.staff)||!uniqueSourceIds(rows.requests)||!Array.isArray(rows.audit))
        return writeJson(res,502,{error:'Authoritative absence scope is unavailable.'});
      // Bootstrap is already sanitised by the source; also bind every request to
      // the current database staff/manager relationship before emitting even diagnostics.
      if(rows.staff.some(person=>!state.staff?.some(current=>current.id===person?.id&&current.manager===person.manager))
        ||rows.requests.some(row=>!sourceReportMatches(row,'absence',{tenant:ctx.tenant})
          ||(row.sourceId!=null&&row.sourceId!==row.id)
          ||!rows.staff.some(person=>person.id===row?.employee&&allowedTeamIds.includes(person.manager)
            &&(row.teamId==null||row.teamId===person.manager)&&(row.team==null||row.team===person.manager))))
        return writeJson(res,502,{error:'Authoritative absence scope did not match.'});
    }else if(!uniqueSourceIds(report.teams)||report.teams.some(team=>!team||
      (workflow==='weekly-signoff'&&(team.period!==period||typeof team.id!=='string'))
      ||(team.sourceId!=null&&team.sourceId!==(team.id??team.teamId))
      ||(team.id!=null&&team.teamId!=null&&team.id!==team.teamId)||!allowedTeamIds.includes(team.id??team.teamId)
      ||(team.period!=null&&team.period!==period)||!sourceReportMatches(team,workflow,{tenant:ctx.tenant})
      ||(team.issues!=null&&!uniqueSourceIds(team.issues))
      ||(Array.isArray(team.issues)&&team.issues.some(issue=>!sourceReportMatches(issue,workflow,{tenant:ctx.tenant})
        ||(issue.sourceId!=null&&issue.id!=null&&issue.sourceId!==issue.id)
        ||(issue.team!=null&&issue.team!==(team.id??team.teamId))||(issue.period!=null&&issue.period!==period)))))
      return writeJson(res,502,{error:'Authoritative team or workflow scope did not match.'});

    let calendar,calendarFailure=false;
    try { calendar=await calendarProvider(Object.freeze({
      tenant:String(ctx.tenant),role:String(ctx.role),email:String(ctx.email),person_id:String(ctx.person_id||'')
    })); } catch {calendarFailure=true;}
    if(!fence(req,res,ctx,token,snapshot,ticket,state))return true;
    if(calendarFailure||!calendar||calendar.schemaVersion!=='tenant-calendar-1'||!calendar.timeZone||!calendar.asOf
      ||(calendar.tenant!=null&&calendar.tenant!==ctx.tenant)||!Number.isFinite(Number(calendar.maxAgeMs))||Number(calendar.maxAgeMs)<=0)
      return writeJson(res,503,{error:'Tenant calendar authority is unavailable.'});
    const scope={tenant:String(ctx.tenant),personId:String(ctx.person_id),role:String(ctx.role),period,
      allowedTeamIds:query.teamId?[query.teamId]:allowedTeamIds,
      freshnessEnvelope:{timeZone:calendar.timeZone,asOf:calendar.asOf,maxAgeMs:Number(calendar.maxAgeMs)}};
    let produced;
    if(workflow==='absence')produced=produceAbsenceActionEvidence(report,scope);
    else if(workflow==='weekly-signoff')produced=produceWeeklySignoffActionEvidence(report,scope);
    else {
      const items=[],unavailable=[];
      for(const team of report.teams){
        if(!scope.allowedTeamIds.includes(team.id??team.teamId))continue;
        for(const item of produceTimeReviewActionEvidence({...report,teams:[team]},scope))items.push(Object.freeze({...item,
          binding:Object.freeze({workflow,tenant:scope.tenant,teamId:team.id??team.teamId,period,sourceId:item.sourceId})}));
        for(const issue of (Array.isArray(team.issues)?team.issues:[])){
          if(issue.status!=='open'||items.some(item=>item.binding.teamId===(team.id??team.teamId)&&item.sourceId===(issue.sourceId??issue.id)))continue;
          unavailable.push({binding:{workflow,tenant:scope.tenant,teamId:team.id??team.teamId,period,sourceId:issue.sourceId??issue.id},
            reasonCode:'SOURCE_EVIDENCE_UNAVAILABLE',freshness:{state:'unknown',policyRef:null,validUntil:null},
            missingFields:issue.confirmation&&issue.confirmation.state!=='action_required'?['sourceDecisionProtocol','confirmationSla','sourceAudit']:['observedAtOrStructuredReasonOrAuthority']});
        }
      }
      produced={items,unavailable};
    }
    const items=produced.items.filter(item=>!query.sourceId||item.sourceId===query.sourceId);
    const unavailable=produced.unavailable.filter(item=>!query.sourceId||item.binding.sourceId===query.sourceId);
    return writeJson(res,200,{
      contractVersion:CONTRACT_VERSION,workflow,source:workflow==='absence'?SOURCE_ABSENCE_PATH:SOURCE_TIME_REVIEW_PATH,
      scope:{tenant:scope.tenant,personId:scope.personId,period,teamId:query.teamId||null,sourceId:query.sourceId||null},
      // Consumers must retain their own request epoch as well as comparing scope;
      // no response can declare itself the latest response in a browser.
      contextKey:sha256(JSON.stringify([sha256(token),ctx,snapshot.version,snapshot.state])),
      timeZone:calendar.timeZone,asOf:calendar.asOf,maxAgeMs:Number(calendar.maxAgeMs),
      availability:unavailable.length?(items.length?'partial':'unavailable'):(query.sourceId&&!items.length?'unavailable':'available'),
      items,unavailable
    });
    } catch(error) {
      // The native owner fence runs outside provider/calendar failure handling.
      // Its denial must retain its status without disclosing internal context.
      if(sourceOwner&&[401,403,503].includes(Number(error?.statusCode)))
        return writeJson(res,Number(error.statusCode),{error:'Current workflow source authority is required.'});
      throw error;
    } finally {if(sourceOwner)sourceOwner.release(ticket,req);}
  }

  async function handleRequest(req, res) {
    const path = requestPath(req);
    if (!path.startsWith(PREFIX)) return false;
    if (String(req.method || 'GET').toUpperCase() !== 'GET') {
      return writeJson(res, 405, { error: 'Workflow action evidence is read-only.' });
    }
    if (path === TIME_REVIEW_PATH) return await evidence(req, res, 'time-review');
    if (path === ABSENCE_PATH) return await evidence(req, res, 'absence');
    if (path === WEEKLY_SIGNOFF_PATH) return await evidence(req, res, 'weekly-signoff');
    return writeJson(res, 404, { error: 'Workflow action evidence endpoint not found.' });
  }

  return Object.freeze({
    handleRequest,
    close() { try { db.close(); } catch {} }
  });
}

module.exports = Object.freeze({
  PREFIX,
  TIME_REVIEW_PATH, ABSENCE_PATH, WEEKLY_SIGNOFF_PATH, SOURCE_ABSENCE_PATH,
  SOURCE_TIME_REVIEW_PATH,
  cookieSessionToken,
  requestedReviewPeriod,
  sourceTimeReviewPath,
  fetchAuthoritativeTimeReview,
  createWorkflowActionEvidenceBridge
});
