'use strict';
const {createHash}=require('node:crypto');
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const digest=v=>createHash('sha256').update(stable(v)).digest('hex');
const fail=message=>{throw Object.assign(Error(message),{code:'STAFFOLOGY_CONFIGURED_SITE_AUTHORITY_REQUIRED',status:503});};
const parse=text=>{try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))fail('Current applied configuration is unavailable.');return value;}catch{fail('Current applied configuration is unavailable.');}};
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
function createConfiguredSiteAuthority({db}={}){
 if(!db||typeof db.prepare!=='function')throw new TypeError('Canonical database required.');
 function table(name){return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);}
 function snapshotForTenant({tenant}={}){
  if(typeof tenant!=='string'||!tenant||tenant!==tenant.trim()||!['customer_workspaces','implementation_runs','implementation_scope','implementation_events','tenant_environments','workspace_setup_drafts','workspace_setup_events'].every(table))fail('Current applied setup authority is unavailable.');
  const run=db.prepare("SELECT * FROM implementation_runs WHERE tenant=? ORDER BY (id=(SELECT initial_run_id FROM customer_workspaces WHERE tenant=implementation_runs.tenant)) DESC,started_at_ms DESC LIMIT 1").get(tenant);
  const workspace=db.prepare('SELECT initial_run_id FROM customer_workspaces WHERE tenant=?').get(tenant);
  if(!run||workspace?.initial_run_id!==run.id)fail('Current permanent implementation run is unavailable.');
  const scopeRow=db.prepare('SELECT scope_json FROM implementation_scope WHERE run_id=? AND tenant=?').get(run.id,tenant);
  const environment=db.prepare('SELECT * FROM tenant_environments WHERE tenant=?').get(tenant);
  const draft=db.prepare('SELECT * FROM workspace_setup_drafts WHERE tenant=? AND run_id=?').get(tenant,run.id);
  if(!scopeRow||environment?.run_id!==run.id||environment.state!=='READY'||draft?.status!=='APPLIED')fail('Current implementation configuration has not been applied.');
  const scope=parse(scopeRow.scope_json),configuration=parse(environment.configuration_json),applied=parse(draft.applied_json),answers=parse(draft.answers_json),compiled=parse(draft.compiled_json);
  if(digest(configuration)!==environment.configuration_digest||applied.configurationDigest!==environment.configuration_digest||applied.scopeDigest!==digest(scope))fail('Applied configuration source digests do not agree.');
  const events=db.prepare("SELECT * FROM workspace_setup_events WHERE tenant=? AND run_id=? AND revision=? AND event='CONFIGURATION_APPLIED' ORDER BY id DESC").all(tenant,run.id,draft.revision);
  const event=events.find(row=>{const detail=parse(row.detail_json);return detail.reviewToken===draft.applied_review_token&&detail.scopeDigest===applied.scopeDigest&&detail.configurationDigest===applied.configurationDigest;});
  if(!event||!draft.applied_review_token)fail('Current applied setup lacks its bound source event.');
  const sites=scope.sites;
  if(!Array.isArray(sites)||!sites.length||sites.length>100||sites.some(label=>typeof label!=='string'||!label||label.length>120||label!==label.trim()||/[\u0000-\u001f\u007f]/.test(label))||new Set(sites).size!==sites.length||stable(configuration.sites)!==stable(sites)||stable(answers.organisation?.sites?.map(x=>x.name))!==stable(sites)||stable(compiled.scope?.sites?.map(x=>x.name))!==stable(sites))fail('Exact configured sites do not agree with applied setup.');
  const changes=db.prepare("SELECT id,detail_json FROM implementation_events WHERE run_id=? AND tenant=? AND event IN ('CUSTOMER_SCOPE_UPDATED','TRUSTED_CONTRACT_SCOPE_UPDATED') ORDER BY id DESC").all(run.id,tenant);
  const changed=changes.find(row=>parse(row.detail_json).configurationChanged!==false);
  return freeze({tenant,runId:run.id,configurationDigest:environment.configuration_digest,scopeChangeEventId:changed?.id||0,applied:true,siteLabels:sites.slice(),sourceProvenance:{scopeDigest:applied.scopeDigest,setupRevision:draft.revision,appliedEventId:event.id,appliedReviewToken:draft.applied_review_token}});
 }
 function mappingPrerequisitesForTenant(request){const source=snapshotForTenant(request);if(!table('tenants'))fail('Current canonical workforce configuration is unavailable.');const row=db.prepare('SELECT state FROM tenants WHERE id=?').get(source.tenant);const state=parse(row?.state),rules=state.workRules||{},contracts=Object.values(rules.contracts||{}).flat(),jobs=Array.isArray(rules.jobs)?rules.jobs:[],org=Array.isArray(state.org)?state.org:[];const missing=[];
  if(!org.some(x=>typeof x?.id==='string'&&x.id&&typeof x.name==='string'&&x.name))missing.push('configuredManager');
  if(!jobs.some(x=>typeof x?.name==='string'&&x.name))missing.push('configuredJobs');
  if(!contracts.some(x=>typeof x?.type==='string'&&x.type))missing.push('configuredContracts');
  if(!contracts.some(x=>typeof x?.weeklyHours==='number'&&Number.isFinite(x.weeklyHours)&&x.weeklyHours>=0&&x.weeklyHours<=80))missing.push('configuredWeeklyHours');
  return freeze({available:missing.length===0,missing,configurationBinding:{tenant:source.tenant,runId:source.runId,configurationDigest:source.configurationDigest,scopeChangeEventId:source.scopeChangeEventId},sourceProvenance:source.sourceProvenance,mappingAuthorityDigest:digest({org,workRules:rules})});
 }
 return Object.freeze({snapshotForTenant,mappingPrerequisitesForTenant,
  configurationContextForTenant:request=>{const {siteLabels,...context}=snapshotForTenant(request);return freeze(context);},
  configuredSitesForTenant:request=>{const {applied,sourceProvenance,...sites}=snapshotForTenant(request);return freeze(sites);}
 });
}
module.exports={createConfiguredSiteAuthority,stable,digest};
