'use strict';
const {createHash}=require('node:crypto');
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const digest=v=>createHash('sha256').update(stable(v)).digest('hex');
const fail=message=>{throw Object.assign(Error(message),{code:'STAFFOLOGY_CONFIGURED_SITE_AUTHORITY_REQUIRED',status:503});};
const parse=text=>{try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))fail('Current applied configuration is unavailable.');return value;}catch{fail('Current applied configuration is unavailable.');}};
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
function siteCatalog(value){
 if(!Array.isArray(value)||!value.length||value.length>100)fail('Exact configured site records are unavailable.');
 const sites=value.map(site=>{
  if(!site||typeof site!=='object'||Array.isArray(site)||Object.keys(site).some(key=>!['code','name','timezone'].includes(key))||
   typeof site.code!=='string'||!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(site.code)||
   typeof site.name!=='string'||!site.name||site.name.length>80||site.name!==site.name.trim()||/[\u0000-\u001f\u007f]/.test(site.name)||
   typeof site.timezone!=='string'||!site.timezone||site.timezone.length>80||site.timezone!==site.timezone.trim())fail('Exact configured site records are invalid.');
  try{new Intl.DateTimeFormat('en',{timeZone:site.timezone}).format();}catch{fail('Exact configured site timezone is invalid.');}
  return {code:site.code,name:site.name,timezone:site.timezone};
 });
 if(new Set(sites.map(site=>site.code)).size!==sites.length)fail('Configured site codes are ambiguous.');
 return sites.sort((a,b)=>a.code.localeCompare(b.code));
}
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
  // The reviewed catalog owns site identity. Legacy scope.sites is only its
  // unique label projection; it cannot distinguish two codes with one name.
  const sites=siteCatalog(answers.organisation?.sites),catalog=stable(sites);
  for(const source of [compiled.scope?.sites,compiled.manifests?.organisation?.sites,scope.workspaceSetup?.organisation?.sites,configuration.workspaceSetup?.organisation?.sites]){
   if(stable(siteCatalog(source))!==catalog)fail('Exact configured sites do not agree with applied setup.');
  }
  const siteLabels=sites.map(site=>site.name),legacyLabels=[...new Set(siteLabels)];
  if(stable(scope.sites)!==stable(legacyLabels)||stable(configuration.sites)!==stable(legacyLabels))fail('Exact configured site label projection does not agree with applied setup.');
  const changes=db.prepare("SELECT id,detail_json FROM implementation_events WHERE run_id=? AND tenant=? AND event IN ('CUSTOMER_SCOPE_UPDATED','TRUSTED_CONTRACT_SCOPE_UPDATED') ORDER BY id DESC").all(run.id,tenant);
  const changed=changes.find(row=>parse(row.detail_json).configurationChanged!==false);
  return freeze({tenant,runId:run.id,configurationDigest:environment.configuration_digest,scopeChangeEventId:changed?.id||0,applied:true,sites,siteLabels,sourceProvenance:{scopeDigest:applied.scopeDigest,setupRevision:draft.revision,appliedEventId:event.id,appliedReviewToken:draft.applied_review_token}});
 }
 function mappingPrerequisitesForTenant(request){const source=snapshotForTenant(request);if(!table('tenants'))fail('Current canonical workforce configuration is unavailable.');const row=db.prepare('SELECT state FROM tenants WHERE id=?').get(source.tenant);const state=parse(row?.state),rules=state.workRules||{},contracts=Object.values(rules.contracts||{}).flat(),jobs=Array.isArray(rules.jobs)?rules.jobs:[],org=Array.isArray(state.org)?state.org:[];const missing=[];
  if(!org.some(x=>typeof x?.id==='string'&&x.id&&typeof x.name==='string'&&x.name))missing.push('configuredManager');
  if(!jobs.some(x=>typeof x?.name==='string'&&x.name))missing.push('configuredJobs');
  if(!contracts.some(x=>typeof x?.type==='string'&&x.type))missing.push('configuredContracts');
  if(!contracts.some(x=>typeof x?.weeklyHours==='number'&&Number.isFinite(x.weeklyHours)&&x.weeklyHours>=0&&x.weeklyHours<=80))missing.push('configuredWeeklyHours');
  return freeze({available:missing.length===0,missing,configurationBinding:{tenant:source.tenant,runId:source.runId,configurationDigest:source.configurationDigest,scopeChangeEventId:source.scopeChangeEventId},sourceProvenance:source.sourceProvenance,mappingAuthorityDigest:digest({org,workRules:rules})});
 }
 return Object.freeze({snapshotForTenant,mappingPrerequisitesForTenant,
  configurationContextForTenant:request=>{const {sites,siteLabels,...context}=snapshotForTenant(request);return freeze(context);},
  configuredSitesForTenant:request=>{
   const {applied,sourceProvenance,sites,...legacy}=snapshotForTenant(request);
   if(new Set(legacy.siteLabels).size!==legacy.siteLabels.length)fail('Configured site labels are ambiguous; an explicit coded-site mapping is required.');
   return freeze(legacy);
  }
 });
}
module.exports={createConfiguredSiteAuthority,stable,digest};
