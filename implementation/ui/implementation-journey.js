;(function(){
'use strict';

const IMPL='/api/implementation/autonomous';
const INTEGRATIONS='/api/integrations/autonomous';
const LEARNING='/api/learning/adaptive';
const VERSION='version-d-3';
const S={status:null,integrations:null,learning:null,invitation:null,loading:false,error:'',decisionError:'',timer:null,lastLoad:0,setup:null,setupDirty:false,setupSaving:false,setupError:'',setupInput:null,setupEditGeneration:0,setupSettings:false,setupSaveTimer:null,setupEpoch:0,setupAutosavePaused:false};
const inviteToken=()=>{try{return new URL(window.location.href).searchParams.get('implementation_invite')||'';}catch{return '';}};
const currentPage=()=>{try{return typeof ui!=='undefined'?ui.page:null;}catch{return null;}};
const isEmployeeRole=()=>{try{return typeof isEmployee==='function'&&isEmployee();}catch{return false;}};
const safe=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const pct=v=>Math.max(0,Math.min(100,Math.round(Number(v)||0)));

async function request(url,options){
  const response=await fetch(url,{credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json'},...options});
  if((response.status===401||response.status===403)&&(!options?.method||options.method==='GET'))return null;
  const body=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(body.error||'Request failed');error.status=response.status;throw error;}
  return body;
}

function requirement(key){
  return (S.status?.requirements||[]).find(item=>item.key===key)||null;
}
function requirementComplete(key){return Boolean(requirement(key)?.satisfied);}
function requirementStarted(key){
  const item=requirement(key);
  return Boolean(item&&item.status&&item.status!=='MISSING');
}
function groupState(keys,extraStarted){
  const complete=keys.length&&keys.every(requirementComplete);
  if(complete)return 'complete';
  if(extraStarted||keys.some(requirementStarted))return 'progress';
  return 'pending';
}
function overallProgress(){
  const rows=S.status?.requirements||[];
  if(!rows.length)return 0;
  return pct(rows.filter(x=>x.satisfied).length/rows.length*100);
}
function trainingProgress(){
  return pct(S.status?.learningSummary?.masteryPercent??S.learning?.masteryPercent??0);
}
function learningCounts(){
  const l=S.status?.learningSummary||S.learning||{};
  return {mastered:Number(l.mastered||0),total:Number(l.assignments||0),users:Number(l.users||0),requiredPopulation:Number(l.requiredPopulation||0),populationReady:l.roleLearningPopulationReady===true,combinedReady:l.populationAndRoleCoverageReady===true,privileged:l.privilegedCoverageReady===true&&requirementComplete('privileged-competency'),certified:Boolean(l.fullyCertified)};
}
function connectionRows(){
  const currentStates=new Set(['ACTIVE','VALIDATING','DEGRADED','AUTHORIZATION_REQUIRED','REAUTH_REQUIRED']);
  return (S.integrations?.connections||[]).filter(x=>x&&currentStates.has(String(x.state||''))&&x.archived!==true&&x.historical!==true)
    .map(x=>({id:x.id,name:x.name||x.productKey,state:x.state,detail:x.failureClass||x.lastReconciliation?.status||'',sourceId:x.id}));
}
function nonCurrentIntegrationRows(){
  const currentIds=new Set(connectionRows().map(row=>row.id)),historical=(S.integrations?.connections||[]).filter(x=>x&&!currentIds.has(x.id))
    .map(x=>({id:x.id,name:x.name||x.productKey,state:x.state||'HISTORICAL',detail:'Historical connection evidence — not current readiness proof.',sourceId:x.id}));
  const discovery=(S.integrations?.discovery?.candidates||[]).map(x=>({id:x.id,name:x.name||x.productKey,state:x.status==='CONFIRMED'?'READY_TO_CONNECT':'IDENTIFIED',detail:Math.round(Number(x.confidence||0)*100)+'% confidence · discovery only',sourceId:x.id}));
  return [...historical,...discovery];
}
function stateLabel(value){
  const map={complete:'Complete',progress:'In progress',pending:'Pending',ACTIVE:'Connected',VALIDATING:'Validating',DEGRADED:'Needs review',AUTHORIZATION_REQUIRED:'Authorisation needed',REAUTH_REQUIRED:'Reconnect',CONFIRMED:'Confirmed',IDENTIFIED:'Identified',READY_TO_CONNECT:'Ready to connect',REVALIDATION_REQUIRED:'Evidence needs rechecking for this deployment'};
  return map[value]||String(value||'Pending').replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase());
}
function stateIcon(value){return value==='complete'||value==='ACTIVE'?'✓':value==='progress'||value==='VALIDATING'?'●':'○';}
function launchIsReady(){
  const runtime=S.status?.runtimeIdentity||{},provider=S.status?.providerJourney||{},launch=S.status?.launchBoundary||{};
  return S.status?.operationalReady===true&&launch.ready===true&&runtime.fixtureOnly===false&&runtime.productionApproved===true&&S.status?.wholeJourneyProven===true&&(!provider.required||provider.proven===true);
}
function stageMarkup(){
  const integrationStarted=(S.integrations?.connections?.length||0)>0||(S.integrations?.discovery?.candidateCount||0)>0;
  const trainingStarted=trainingProgress()>0||Number((S.status?.learningSummary||S.learning||{}).assignments||0)>0;
  const stages=[
    ['Environment',['tenant-environment','identity-access','security-controls'],false],
    ['Training',['role-learning','privileged-competency','frontline-readiness'],trainingStarted],
    ['Integrations',['source-systems'],integrationStarted],
    ['Testing',['scenario-validation'],false],
    ['Clean up',['test-data-cleanup'],false],
    ['Data import',['live-data-import'],false],
    ['Go live',[],launchIsReady()]
  ];
  return stages.map((stage,index)=>{
    let st=stage[0]==='Go live'?(launchIsReady()?'complete':'pending'):groupState(stage[1],stage[2]);
    if(stage[0]==='Integrations'&&st==='complete'&&(S.status?.integrationTruth?.unifiedReady!==true||(S.status?.providerJourney?.required&&S.status?.providerJourney?.proven!==true)))st='progress';
    if(stage[0]==='Training'&&st==='complete'&&!(learningCounts().populationReady&&learningCounts().combinedReady))st='progress';
    const caption=stage[0]==='Training'&&st!=='complete'?'From day one':stateLabel(st);
    return '<div class="wfm-ij-stage '+st+'"><span class="wfm-ij-stage-dot">'+stateIcon(st)+'</span><div><b>'+safe(stage[0])+'</b><small>'+safe(caption)+'</small></div></div>'+(index<stages.length-1?'<span class="wfm-ij-stage-line"></span>':'');
  }).join('');
}
function integrationMarkup(){
  const rows=connectionRows(),other=nonCurrentIntegrationRows(),provider=S.status?.providerJourney||{},truth=S.status?.integrationTruth||{};
  const providerRows=provider.required?[{
    name:'Staffology payroll',
    detail:provider.proven?'Current provider journey and full-batch receipt are proven.':'Mandatory provider journey remains unproved for the current tenant, workforce and payroll batch.',
    state:provider.proven?'complete':'blocked'
  }]:[];
  const current=[...providerRows,...rows.filter(row=>!providerRows.some(providerRow=>String(row.name||'').toLowerCase().includes('staffology')))];
  const currentMarkup=current.length?'<div class="wfm-ij-system-list">'+current.slice(0,8).map(row=>
    '<div class="wfm-ij-system"><div class="wfm-ij-system-name"><span class="wfm-ij-system-glyph">↔</span><div><b>'+safe(row.name)+'</b><small>'+safe(row.detail||'Current connection evidence')+'</small></div></div><span class="wfm-ij-pill '+safe(String(row.state||'').toLowerCase())+'">'+safe(stateLabel(row.state))+'</span></div>'
  ).join('')+'</div>':'<div class="wfm-ij-empty"><b>No current required systems are proven yet.</b><span>Discovery results do not count as readiness evidence.</span></div>';
  const secondary=other.length?'<details class="wfm-ij-integration-history"><summary>Discovery & historical systems ('+other.length+')</summary><p>These rows are context only and do not count toward current launch readiness.</p><div class="wfm-ij-system-list">'+other.slice(0,8).map(row=>
    '<div class="wfm-ij-system"><div class="wfm-ij-system-name"><span class="wfm-ij-system-glyph">↔</span><div><b>'+safe(row.name)+'</b><small>'+safe(row.detail||'Non-current evidence')+'</small></div></div><span class="wfm-ij-pill '+safe(String(row.state||'').toLowerCase())+'">'+safe(stateLabel(row.state))+'</span></div>'
  ).join('')+'</div></details>':'';
  return currentMarkup+(truth.unifiedReady===false?'<div class="wfm-ij-empty"><b>Unified integration proof is not ready.</b><span>Current source identities, operating workforce and mandatory provider evidence must reconcile before go live.</span></div>':'')+secondary;
}
function requirementCard(key,title,description){
  const item=requirement(key);
  const complete=Boolean(item?.satisfied);
  const status=complete?'complete':(item?.status&&item.status!=='MISSING'?'progress':'pending');
  const detail=item?.detail||{};
  let evidence='';
  if(key==='scenario-validation'&&detail.totalScenarios!=null)evidence=Number(detail.passedScenarios||0).toLocaleString()+' / '+Number(detail.totalScenarios||0).toLocaleString()+' scenarios passed';
  if(key==='test-data-cleanup'&&detail.remainingTestRows!=null)evidence=Number(detail.remainingTestRows).toLocaleString()+' test rows remaining';
  if(key==='live-data-import'&&detail.sourceCount!=null){
    const measured=Number.isSafeInteger(detail.sourceCount)&&detail.sourceCount>=0&&Number.isSafeInteger(detail.importedCount)&&detail.importedCount>=0;
    const reconciled=measured&&item.satisfied===true&&item.status==='PASS'&&detail.importedCount===detail.sourceCount;
    evidence=measured?detail.importedCount.toLocaleString()+' / '+detail.sourceCount.toLocaleString()+(reconciled?' records reconciled':' records reported; reconciliation needs rechecking.'):'Record counts need verification.';
  }
  return '<section class="wfm-ij-mini '+status+'"><div class="wfm-ij-mini-icon">'+stateIcon(status)+'</div><div><small>'+safe(stateLabel(status))+'</small><h3>'+safe(title)+'</h3><p>'+safe(description)+'</p>'+(evidence?'<strong>'+safe(evidence)+'</strong>':'')+'</div></section>';
}
function importAdvice(){
  const needs=[];
  if(!requirementComplete('source-systems'))needs.push('Finish connecting and validating authoritative source systems.');
  if(!requirementComplete('people-data'))needs.push('Verify employee IDs, employment status and reporting hierarchy.');
  if(!requirementComplete('organisation-model'))needs.push('Confirm sites, departments and cost structure.');
  if(!requirementComplete('payroll-mapping'))needs.push('Reconcile payroll codes and mappings before the live load.');
  if(!requirementComplete('test-data-cleanup'))needs.push('Live import remains locked until test data is proven clean.');
  if(!needs.length&&!requirementComplete('live-data-import'))needs.push('Source data is ready. The live import can now be reconciled.');
  if(requirementComplete('live-data-import'))needs.push('Live data has been imported and reconciled.');
  return '<ul>'+needs.slice(0,5).map(x=>'<li>'+safe(x)+'</li>').join('')+'</ul>';
}
function activeWork(){
  if(!(S.status?.requirements||[]).length)return '<div class="wfm-ij-empty"><b>Waiting for implementation control evidence.</b><span>Readiness remains unproven until the required controls are available.</span></div>';
  const missing=(S.status?.requirements||[]).filter(x=>!x.satisfied);
  if(!missing.length)return '<div class="wfm-ij-empty"><b>All implementation controls are proven.</b><span>Review the go-live readiness evidence.</span></div>';
  return '<div class="wfm-ij-work-list">'+missing.slice(0,6).map(x=>{
    const tone=x.status==='FAIL'?'blocked':x.status==='WARN'?'review':'working';
    return '<div class="wfm-ij-work"><span class="'+tone+'">'+(tone==='blocked'?'!':'•')+'</span><div><b>'+safe(x.label)+'</b><small>'+safe(x.status==='MISSING'?'Waiting for required evidence':stateLabel(x.status))+'</small></div></div>';
  }).join('')+'</div>';
}
function proposalSummary(proposal){
  if(!proposal||typeof proposal!=='object')return '';
  const entries=Object.entries(proposal).slice(0,4);
  return entries.map(([key,value])=>String(key).replaceAll('_',' ') + ': ' + (typeof value==='object'?JSON.stringify(value):String(value))).join(' · ');
}
function listText(value){return Array.isArray(value)?value.join(', '):'';}
function scopeFields(scope={}){
  return '<div class="wfm-ij-scope-grid">'+
    '<label><span>Company / implementation name</span><input name="companyName" required maxlength="160" value="'+safe(scope.companyName||'')+'" placeholder="e.g. Northstar Manufacturing"></label>'+
    '<label><span>Employees in scope</span><input name="employeeCount" required type="number" min="1" max="1000000" value="'+safe(scope.employeeCount||'')+'" placeholder="e.g. 10000"></label>'+
    '<label><span>Countries</span><input name="countries" required value="'+safe(listText(scope.countries))+'" placeholder="United Kingdom, Germany"></label>'+
    '<label><span>Sites / plants</span><input name="sites" required value="'+safe(listText(scope.sites))+'" placeholder="Tamworth Plant, Birmingham DC"></label>'+
    '<label><span>Payroll system</span><input name="payrollSystem" value="'+safe(scope.payrollSystem||'')+'" placeholder="Current payroll provider"></label>'+
    '<label><span>HCM / HR system</span><input name="hcmSystem" value="'+safe(scope.hcmSystem||'')+'" placeholder="Current HCM / HRIS"></label>'+
    '<label><span>ERP / production system</span><input name="erpSystem" value="'+safe(scope.erpSystem||'')+'" placeholder="SAP, NetSuite, Dynamics…"></label>'+
    '<label><span>Other source systems</span><input name="sourceSystems" value="'+safe(listText(scope.sourceSystems))+'" placeholder="Access control, MES, agency portal…"></label>'+
    '<label class="wide"><span>What needs to be live?</span><input name="features" value="'+safe(listText(scope.features))+'" placeholder="Scheduling, time & attendance, absence, payroll output, agency labour…"></label>'+
    '<label><span>Work / shift patterns</span><input name="workPatterns" value="'+safe(listText(scope.workPatterns))+'" placeholder="24/7 rotation, 4-on-4-off…"></label>'+
    '<label><span>Clocking methods available</span><input name="clockingMethods" value="'+safe(listText(scope.clockingMethods))+'" placeholder="Access control, mobile, terminals…"></label>'+
    '<label class="wide"><span>Top implementation priorities</span><textarea name="priorities" maxlength="1000" placeholder="What must this implementation get right?">'+safe(scope.priorities||'')+'</textarea></label>'+
    '<label class="wide"><span>Anything else we must account for?</span><textarea name="notes" maxlength="2000">'+safe(scope.notes||'')+'</textarea></label>'+
    '<label class="wide wfm-ij-check"><input name="agencyLabour" type="checkbox" '+(scope.agencyLabour?'checked':'')+'><span>Agency / temporary labour is in scope</span></label>'+
  '</div>';
}
function scopeMarkup(){
  const scope=S.status?.customerScope||{};
  if(S.status?.scopeCaptured){
    return '<section class="wfm-ij-panel wfm-ij-scope captured"><div class="wfm-ij-panel-head"><div><span class="wfm-ij-kicker">CONFIGURATION SCOPE · CAPTURED</span><h2>This is what the system is building and proving</h2><p>Your scope is stored against this implementation and is part of the readiness evidence.</p></div><span class="wfm-ij-status ready">Scope confirmed</span></div>'+
      '<div class="wfm-ij-scope-summary"><span><b>'+Number(scope.employeeCount||0).toLocaleString()+'</b> employees</span><span><b>'+Number(scope.sites?.length||0)+'</b> sites</span><span><b>'+Number(scope.countries?.length||0)+'</b> countries</span><span><b>'+Number(scope.sourceSystems?.length||0)+'</b> source systems</span></div>'+
      '<details class="wfm-ij-scope-edit"><summary>Review or update configuration scope</summary><form data-ij-scope-form>'+scopeFields(scope)+'<div class="wfm-ij-scope-actions"><p>Changes are audit-recorded. High-risk payroll rules are never silently accepted from this form.</p><button class="btn primary" type="submit">Save updated scope</button></div></form></details></section>';
  }
  return '<section class="wfm-ij-panel wfm-ij-scope required"><div class="wfm-ij-panel-head"><div><span class="wfm-ij-kicker">STEP 1 · TELL US WHAT TO BUILD</span><h2>Confirm your configuration scope</h2><p>Give the system the operating boundary. It uses connected source data to propose the detailed configuration; ambiguous or high-risk rules come back to you for confirmation.</p></div><span class="wfm-ij-status blocked">Required</span></div>'+
    '<form data-ij-scope-form>'+scopeFields(scope)+'<div class="wfm-ij-scope-actions"><p>No passwords or API secrets belong here. Payroll rules remain protected until independently reconciled and, where needed, explicitly approved.</p><button class="btn primary" type="submit">Confirm scope and continue</button></div></form></section>';
}
const SETUP_MODULES=[['core','Core workforce'],['onboarding','Onboarding'],['scheduling','Scheduling'],['time-attendance','Time and attendance'],['skills','Skills'],['absence','Absence'],['payroll-assurance','Payroll assurance'],['demand','Demand'],['integrations','Connected systems'],['decision-intelligence','Decision support'],['support','Support']];
const SETUP_ROLES=[['employee','Employees'],['supervisor','Supervisors'],['manager','Managers'],['company-admin','Administrators'],['payroll','Payroll team']];
function setupInput(name,label,value='',extra=''){
  return '<label><span>'+safe(label)+'</span><input name="'+safe(name)+'" value="'+safe(value)+'" '+extra+'></label>';
}
function setupChecks(name,choices,selected){
  return choices.map(([value,label])=>'<label class="wfm-ij-check"><input type="checkbox" name="'+name+'" value="'+value+'" '+(selected.includes(value)?'checked':'')+'><span>'+safe(label)+'</span></label>').join('');
}
function workspaceSetupMarkup(){
  if(!S.setup)return '<section class="wfm-ij-panel"><h2>Set up your workspace</h2><p>'+safe(S.setupError||'Loading your saved questionnaire…')+'</p></section>';
  if(S.setup.questionnaireComplete&&!S.setupSettings)return '<section class="wfm-ij-panel wfm-ij-setup"><span class="wfm-ij-kicker">YOUR WORKSPACE</span><h2>Workspace setup applied</h2><p>Your initial questionnaire is complete. You will not need to fill it in again. Later changes belong in workspace settings.</p><p>Operational readiness, policies and connection checks remain visible below.</p><div class="wfm-ij-scope-actions"><button type="button" class="btn primary" data-ij-route="overview">Open workspace</button><button type="button" class="btn" data-ij-setup-settings>Workspace settings</button></div></section>';
  const d=S.setup, previous=S.status?.customerScope||{};
  const a=S.setupInput||d.answers||previous.workspaceSetup||{
    organisation:{name:previous.companyName||'',countries:previous.countries||[],sites:(previous.sites||[]).map(name=>({name,code:'',timezone:''}))},
    workforce:{count:previous.employeeCount||'',languages:[],shiftPatterns:''},
    capabilities:{modules:['core'],trainingRoles:['employee','manager']},connections:{timing:null,systems:[]}};
  const org=a.organisation||{},workforce=a.workforce||{},capabilities=a.capabilities||{},connections=a.connections||{};
  const sites=org.sites?.length?org.sites:[{}], systems=connections.systems?.length?connections.systems:[{}];
  const applied=d.status==='APPLIED';
  return '<section class="wfm-ij-panel wfm-ij-setup"><div class="wfm-ij-panel-head"><div><span class="wfm-ij-kicker">'+(S.setupSettings?'WORKSPACE SETTINGS':'WORKSPACE SETUP')+'</span><h2>'+ (S.setupSettings?'Workspace settings':applied?'Workspace setup applied':'Four questions to get started')+'</h2><p>'+(S.setupSettings?'Update your workspace details, then save and review the changes. Your initial questionnaire remains complete.':'Tell us about your organisation. Save your answers, review the proposed setup and apply it when ready.')+'</p></div><span class="wfm-ij-status '+(applied?'ready':'working')+'">'+(applied?'Applied':d.revision?'Draft saved':'Start here')+'</span></div>'+
    '<div role="alert" data-ij-setup-error class="wfm-ij-setup-message">'+safe(S.setupError)+'</div>'+
    (applied?'<p class="wfm-ij-note">Your workspace settings are saved. Policies, access, connected systems and operational readiness still need their own checks below.</p>':'')+
    '<form data-ij-setup-form novalidate>'+
    '<fieldset><legend>'+(S.setupSettings?'Organisation and sites':'1. Where does your organisation operate?')+'</legend><div class="wfm-ij-scope-grid">'+setupInput('organisationName','Organisation name',org.name,'maxlength="160"')+setupInput('countries','Countries',listText(org.countries),'placeholder="United Kingdom, Germany"')+'</div>'+
    '<div class="wfm-ij-setup-rows">'+sites.map((site,index)=>'<div class="wfm-ij-setup-row">'+setupInput('siteCode','Site code',site.code,'maxlength="40" placeholder="e.g. PLANT-1"')+setupInput('siteName','Site name',site.name,'maxlength="80"')+setupInput('siteTimezone','Site timezone',site.timezone,'maxlength="80" placeholder="e.g. Europe/London"')+'<button type="button" class="btn small" data-ij-remove-site="'+index+'" aria-label="Remove site '+(index+1)+'">Remove</button></div>').join('')+'</div><button type="button" class="btn small" data-ij-add-site>Add another site</button></fieldset>'+
    '<fieldset><legend>'+(S.setupSettings?'Workforce':'2. What does your workforce look like?')+'</legend><div class="wfm-ij-scope-grid">'+setupInput('workforceCount','People in scope',workforce.count??'','type="number" min="1" max="1000000"')+setupInput('shiftPatterns','Number of shift patterns',workforce.shiftPatterns??'','type="number" min="1" max="1000"')+setupInput('languages','Working languages',listText(workforce.languages),'placeholder="e.g. en, de"')+'</div></fieldset>'+
    '<fieldset><legend>'+(S.setupSettings?'Capabilities and training':'3. What would you like to set up?')+'</legend><p>Select the capabilities you need and the teams who will need training.</p><div class="wfm-ij-setup-checks">'+setupChecks('module',SETUP_MODULES,capabilities.modules||[])+'</div><h3>Teams to train</h3><div class="wfm-ij-setup-checks">'+setupChecks('trainingRole',SETUP_ROLES,capabilities.trainingRoles||[])+'</div><p>Training choices do not change anyone’s access.</p></fieldset>'+
    '<fieldset><legend>'+(S.setupSettings?'Connection plan':'4. When would you like to connect your systems?')+'</legend><div class="wfm-ij-setup-checks">'+[['now','Plan connections now'],['later','Connect later']].map(([value,label])=>'<label class="wfm-ij-check"><input type="radio" name="connectionTiming" value="'+value+'" '+(connections.timing===value?'checked':'')+'><span>'+label+'</span></label>').join('')+'</div><p>You can start using the setup workspace while connections are pending.</p>'+
    '<div class="wfm-ij-setup-rows">'+systems.map((system,index)=>'<div class="wfm-ij-setup-row">'+setupInput('systemProvider','System name',system.provider,'maxlength="60" placeholder="e.g. your HR system"')+'<label><span>Connection method</span><select name="systemMode">'+[['api','Direct connection'],['file','File import'],['webhook','Event updates']].map(([value,label])=>'<option value="'+value+'" '+((system.mode||'api')===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+setupInput('systemObjects','Data to connect',listText(system.objectTypes),'placeholder="people, time, payroll-output, demand, production"')+'<button type="button" class="btn small" data-ij-remove-system="'+index+'" aria-label="Remove system '+(index+1)+'">Remove</button></div>').join('')+'</div><button type="button" class="btn small" data-ij-add-system>Add another system</button><p>System names describe your plan. Authorisation and connection checks happen separately.</p></fieldset>'+
    '<div class="wfm-ij-scope-actions"><p data-ij-setup-save-status role="status" aria-live="polite">'+safe(setupSaveStatus())+'</p><button type="submit" class="btn primary">Save and review</button></div></form>'+
    '<div data-ij-setup-review-host>'+workspaceSetupReviewMarkup(d,a)+'</div>'+
    '<button type="button" class="btn small" data-ij-setup-reload>Discard edits and reload saved answers</button>'+(S.setupSettings?'<button type="button" class="btn small" data-ij-setup-close>Back to workspace</button>':'')+'</section>';
}
function workspaceSetupReviewMarkup(d,a){
  const org=a.organisation||{},workforce=a.workforce||{},capabilities=a.capabilities||{},connections=a.connections||{};
  const review=d.compiled?.status==='compiled'&&d.reviewToken,questions=d.compiled?.questions||[];
  return (questions.length?'<div class="wfm-ij-note"><b>A few details are still needed</b><ul>'+questions.map(q=>'<li>'+safe(q.question)+'</li>').join('')+'</ul></div>':'')+
    (d.requiresRebase?'<p class="wfm-ij-note">Your current configuration changed. Save your answers again to prepare a fresh review.</p>':'')+
    (review?'<section class="wfm-ij-setup-review"><h3>Review your setup</h3><p>'+safe(org.name||'Your organisation')+' · '+Number(workforce.count||0)+' people · '+(org.sites?.length||0)+' sites · '+Number(workforce.shiftPatterns||0)+' shift patterns</p><p>'+safe((capabilities.modules||[]).map(code=>SETUP_MODULES.find(m=>m[0]===code)?.[1]||code).join(', '))+'</p><p>'+(connections.timing==='later'?'Connections are deferred. They remain outstanding for operational readiness.':'Connection requests will be saved for separate authorisation and validation.')+'</p><p>Policy exceptions remain below for the responsible person to confirm.</p><button type="button" class="btn primary" data-ij-setup-apply '+(S.setupDirty?'disabled':'')+'>Apply reviewed setup</button></section>':'');
}
function setupSaveStatus(){
  if(S.setupSaving)return 'Saving your draft…';
  if(S.setupDirty)return 'Your latest answers have not been saved yet.';
  return S.setup?.revision?'Draft saved. Review the proposed setup before applying it.':'Answers save as you go. Review the proposed setup before applying it.';
}
function updateSetupFeedback(review=false){
  if(currentPage()!=='onboarding'||!document.querySelector('[data-ij-setup-form]'))return;
  const status=document.querySelector('[data-ij-setup-save-status]');if(status)status.textContent=setupSaveStatus();
  if(review){const host=document.querySelector('[data-ij-setup-review-host]');if(host&&S.setup)host.innerHTML=workspaceSetupReviewMarkup(S.setup,S.setup.answers||{});}
}
function cancelSetupSave(){clearTimeout(S.setupSaveTimer);S.setupSaveTimer=null;}
function resetSetupBinding(preservePause=false){
  cancelSetupSave();S.setupEpoch++;S.setupSaving=false;if(!preservePause)S.setupAutosavePaused=false;
}
function currentSetupBinding(epoch,tenant,runId){
  return epoch===S.setupEpoch&&!!S.status&&(!tenant||S.setup?.tenant===tenant)&&(!runId||!S.status.runId||S.status.runId===runId);
}
function scheduleSetupSave(){
  cancelSetupSave();
  if(!S.setupDirty||!S.setupInput||!S.status||!S.setup?.tenant||!S.setup?.runId||S.setupAutosavePaused||isEmployeeRole())return;
  const epoch=S.setupEpoch,tenant=S.setup.tenant,runId=S.setup.runId;
  S.setupSaveTimer=setTimeout(()=>{
    S.setupSaveTimer=null;
    if(currentSetupBinding(epoch,tenant,runId)&&S.setupDirty&&!S.setupSaving&&!S.setupAutosavePaused)saveSetup(null,true);
  },500);
}
function openSetupSettings(){S.setupSettings=true;renderView(true);}
function closeSetupSettings(){S.setupSettings=false;renderView(true);}
function rememberSetupInput(form){
  S.setupInput=collectSetupAnswers(form);S.setupDirty=true;S.setupEditGeneration++;
  updateSetupFeedback();scheduleSetupSave();
}
function collectSetupAnswers(form){
  const data=new FormData(form),get=name=>String(data.get(name)||'').trim(),split=value=>String(value||'').split(',').map(x=>x.trim()).filter(Boolean);
  const codes=data.getAll('siteCode'),names=data.getAll('siteName'),zones=data.getAll('siteTimezone');
  const providers=data.getAll('systemProvider'),modes=data.getAll('systemMode'),objects=data.getAll('systemObjects');
  return {organisation:{name:get('organisationName'),countries:split(get('countries')),sites:codes.map((code,i)=>({code:String(code).trim(),name:String(names[i]||'').trim(),timezone:String(zones[i]||'').trim()})).filter(s=>s.code||s.name||s.timezone)},
    workforce:{count:get('workforceCount')?Number(get('workforceCount')):null,languages:split(get('languages')),shiftPatterns:get('shiftPatterns')?Number(get('shiftPatterns')):null},
    capabilities:{modules:data.getAll('module'),trainingRoles:data.getAll('trainingRole')},
    connections:{timing:get('connectionTiming')||null,systems:providers.map((provider,i)=>({provider:String(provider).trim(),mode:String(modes[i]||'api'),objectTypes:split(objects[i])})).filter(s=>s.provider||s.objectTypes.length)}};
}
function setupError(message){
  S.setupError=message;const box=document.querySelector('[data-ij-setup-error]');if(box)box.textContent=message;
}
async function saveSetup(form,background=false){
  cancelSetupSave();
  if(!background){
    const input=collectSetupAnswers(form);
    if(JSON.stringify(input)!==JSON.stringify(S.setupInput)){S.setupInput=input;S.setupEditGeneration++;}
    S.setupDirty=true;S.setupAutosavePaused=false;
  }
  if(S.setupSaving||!S.setupInput)return;
  const answers=JSON.parse(JSON.stringify(S.setupInput));
  const generation=S.setupEditGeneration,epoch=S.setupEpoch,runId=S.setup?.runId||S.status?.runId,tenant=S.setup?.tenant;
  const currentWorkspace=()=>currentSetupBinding(epoch,tenant,runId);
  const button=form?.querySelector('button[type="submit"]');if(button){button.disabled=true;button.textContent='Saving…';}
  S.setupSaving=true;updateSetupFeedback();let followUp=false;
  try{
    const saved=await request(IMPL+'/setup',{method:'POST',body:JSON.stringify({setupBinding:S.setup?.setupBinding,expectedRevision:S.setup?.revision||0,answers})});
    if(!currentWorkspace())return;
    if(!saved)throw Error('Sign in to save your workspace setup.');
    if((saved.tenant&&tenant&&saved.tenant!==tenant)||(saved.runId&&runId&&saved.runId!==runId))throw Error('The workspace changed. Reload your saved answers before retrying.');
    // Input events retain the newest model even if navigation has removed the form.
    const currentForm=document.querySelector('[data-ij-setup-form]');
    if(form&&currentForm===form&&generation===S.setupEditGeneration){
      const current=collectSetupAnswers(form);
      if(JSON.stringify(current)!==JSON.stringify(answers)){S.setupInput=current;S.setupEditGeneration++;}
    }
    S.setup=saved;setupError('');
    if(generation!==S.setupEditGeneration){S.setupDirty=true;followUp=true;return;}
    S.setupDirty=false;S.setupInput=null;
    if(background)updateSetupFeedback(true);else renderView();
  }catch(error){
    if(!currentWorkspace())return;
    cancelSetupSave();
    if([401,403,409].includes(error.status))S.setupAutosavePaused=true;
    followUp=error.status===400&&generation!==S.setupEditGeneration;
    setupError(error.message||'Your draft could not be saved. Your answers are still here.');
  }finally{
    if(currentWorkspace()){
      S.setupSaving=false;if(button){button.disabled=false;button.textContent='Save and review';}
      updateSetupFeedback();if(followUp)scheduleSetupSave();
    }
  }
}
async function applySetup(){
  if(S.setupDirty||S.setupSaving||!S.setup?.reviewToken)return;
  cancelSetupSave();
  const generation=S.setupEditGeneration,epoch=S.setupEpoch,runId=S.setup.runId||S.status?.runId,tenant=S.setup.tenant;
  const currentWorkspace=()=>currentSetupBinding(epoch,tenant,runId);
  S.setupSaving=true;const button=document.querySelector('[data-ij-setup-apply]');if(button)button.disabled=true;
  let followUp=false;
  try{
    const result=await request(IMPL+'/setup/apply',{method:'POST',body:JSON.stringify({setupBinding:S.setup.setupBinding,expectedRevision:S.setup.revision,reviewToken:S.setup.reviewToken})});
    if(!currentWorkspace())return;
    if(!result||result.status!=='APPLIED')throw Error('The setup was not applied. Reload the saved review and try again.');
    if(generation!==S.setupEditGeneration){
      S.setup=result;S.setupDirty=true;S.setupSettings=true;followUp=true;
      S.setupError='Reviewed settings applied. Your newer edits are still here; save and review them to apply another update.';
      renderView(true);return;
    }
    S.setup=result;S.setupError='';S.setupInput=null;S.setupSettings=false;renderView();
  }catch(error){if(currentWorkspace()){cancelSetupSave();setupError(error.message||'The setup could not be applied. Your saved draft is available to retry.');}}
  finally{if(currentWorkspace()){S.setupSaving=false;if(button)button.disabled=S.setupDirty;updateSetupFeedback();if(followUp)scheduleSetupSave();}}
}
function changeSetupRows(kind,index){
  const form=document.querySelector('[data-ij-setup-form]');if(!form)return;
  const answers=collectSetupAnswers(form),rows=kind==='site'?answers.organisation.sites:answers.connections.systems;
  if(index==null)rows.push({});else rows.splice(index,1);
  S.setupInput=answers;S.setupDirty=true;S.setupEditGeneration++;renderView(true);scheduleSetupSave();
}
function policyCheck(name,label,required=true){
  return '<label class="wfm-ij-policy-check"><input type="checkbox" name="'+safe(name)+'" '+(required?'required':'')+'><span>'+safe(label)+'</span></label>';
}
function policyDecisionMarkup(d){
  const time=d.key==='time-policy-authority';
  const absence=d.key==='absence-policy-authority';
  if(!time&&!absence)return '';
  const checks=time
    ? [
        ['breakRulesVerified','Break rules are verified against the authoritative source'],
        ['overtimeRulesVerified','Overtime rules and thresholds are verified'],
        ['workingTimeRulesVerified','Working-time limits and related rules are verified'],
        ['timeZoneVerified','Site timezone and DST handling are verified']
      ]
    : [
        ['leaveYearVerified','Leave year is verified'],
        ['entitlementMethodVerified','Entitlement method is verified'],
        ['approvalRulesVerified','Approval and delegation rules are verified'],
        ['absenceTypesVerified','Absence types and their rules are verified']
      ];
  const absenceFields=absence
    ? '<div class="wfm-ij-policy-opening"><label><span>Opening leave balance</span><select name="usesOpeningBalance"><option value="no">No opening balance is being relied on</option><option value="yes">Yes, an opening balance is required</option></select></label>'+policyCheck('openingBalanceSourceVerified','If an opening balance is used, I have verified its authoritative source',false)+'</div>'
    : '';
  return '<article class="wfm-ij-policy-decision"><div class="wfm-ij-policy-head"><div><b>'+safe(d.question)+'</b><small>HIGH risk · VECTOR will not guess or activate this policy without your confirmation.</small></div></div>'+
    '<form data-ij-policy-form="'+safe(d.key)+'"><div class="wfm-ij-policy-fields">'+
      '<label><span>Authoritative source reference</span><input name="sourceRef" required maxlength="300" placeholder="e.g. approved HR policy, payroll rule set, contract schedule"></label>'+
      '<label><span>Effective from</span><input name="effectiveDate" required type="date"></label>'+
    '</div><div class="wfm-ij-policy-checks">'+
      checks.map(([name,label])=>policyCheck(name,label)).join('')+
      policyCheck('policyComplete','I confirm there are no unresolved rules or unknown policy fields')+
      policyCheck('authoritativeConfirmation','I am authorised to confirm this policy for this implementation')+
    '</div>'+absenceFields+
    '<div class="wfm-ij-policy-actions"><span>VECTOR records the source and effective date; it does not treat a click alone as evidence.</span><button class="btn small primary" type="submit">Confirm authoritative policy</button></div></form></article>';
}
function decisionsMarkup(){
  const rows=S.status?.blockingDecisions||[];
  if(!rows.length)return '';
  return '<section class="wfm-ij-panel wfm-ij-decisions"><div class="wfm-ij-panel-head"><div><span class="wfm-ij-kicker">YOUR DECISION</span><h2>'+rows.length+' item'+(rows.length===1?'':'s')+' need confirmation</h2><p>High-risk settings stay blocked until an authorised customer supplies or confirms the required source evidence.</p></div></div>'+
    (S.decisionError?'<div class="wfm-ij-decision-error">'+safe(S.decisionError)+'</div>':'')+
    '<div class="wfm-ij-decision-list">'+rows.map(d=>{
      const policy=policyDecisionMarkup(d);
      if(policy)return policy;
      const summary=proposalSummary(d.proposal);
      return '<article><div><b>'+safe(d.question)+'</b><small>'+safe(d.risk)+' risk · '+safe(d.status)+(summary?' · '+safe(summary):'')+'</small></div><div class="wfm-ij-decision-actions"><button class="btn small primary" type="button" data-ij-decision-accept="'+safe(d.key)+'">Accept proposal</button><button class="btn small" type="button" data-ij-decision-review="'+safe(d.key)+'">Review setup</button></div></article>';
    }).join('')+'</div></section>';
}
function welcomeMarkup(){
  const invitation=S.invitation?.invitation||S.status?.invitation||null;
  const expired=S.status?.state==='INVITATION_EXPIRED'||invitation?.state==='EXPIRED';
  const token=inviteToken();
  return '<div class="wfm-ij-shell wfm-ij-welcome">'+
    '<section class="wfm-ij-welcome-card"><div class="wfm-ij-welcome-art"><span class="wfm-ij-kicker">IMPLEMENTATION</span><h1>Your new workforce system is ready to begin</h1><p>We will build the environment, connect your systems, test real-world scenarios, clean the test environment, import live data and prove your team is ready.</p><div class="wfm-ij-welcome-checks"><span>✓ Nothing starts until you approve</span><span>✓ Training is available from day one</span><span>✓ Progress and evidence stay on this screen</span><span>✓ Go live stays locked until every control is proven</span></div></div>'+
    '<div class="wfm-ij-start-card"><span class="wfm-ij-status '+(expired?'blocked':'ready')+'">'+(expired?'Invitation expired':'Ready when you are')+'</span><h2>'+(expired?'Request a new implementation link':'Start your implementation')+'</h2><p>'+(expired?'This secure invitation is no longer valid.':'Your implementation clock and automated setup begin only after you press the button below.')+'</p>'+
    (!expired&&token?'<button type="button" class="btn primary wfm-ij-start" data-ij-start>Go ahead and start</button>':'')+
    (!expired&&!token?'<div class="wfm-ij-note">Open the secure link in your implementation email to start.</div>':'')+
    '<small>'+(invitation?.expiresAt?'Secure link expires '+safe(new Date(invitation.expiresAt).toLocaleString('en-GB'))+'.':'Secure, customer-specific invitation.')+'</small></div></section>'+
    '<section class="wfm-ij-preflight"><div><span class="wfm-ij-kicker">WHAT WILL HAPPEN</span><h2>One calm implementation journey</h2></div><div class="wfm-ij-stagebar">'+stageMarkup()+'</div></section>'+
    trainingPanel(true)+
  '</div>';
}
function trainingPanel(prestart){
  const l=learningCounts(),progress=trainingProgress();
  const ready=!prestart&&l.populationReady&&l.combinedReady&&['role-learning','privileged-competency','frontline-readiness'].every(requirementComplete);
  const readiness=prestart?'':('<p class="wfm-ij-note">'+(ready?'Team ready':(l.populationReady?'Training readiness evidence incomplete':'Population coverage incomplete'))+(l.requiredPopulation?' · '+l.requiredPopulation+' people required':'')+'</p>');
  return '<section class="wfm-ij-panel wfm-ij-training"><div class="wfm-ij-panel-head"><div><span class="wfm-ij-kicker">TRAINING · RUNS THROUGHOUT</span><h2>Learn in the test environment from the beginning</h2><p>Role-based learning, guided practice and competency proof continue alongside configuration and testing.</p></div><div class="wfm-ij-training-score"><strong>'+progress+'%</strong><span>'+safe(prestart?'Available now':'learning completion')+'</span></div></div><div class="wfm-ij-progress"><span style="width:'+progress+'%"></span></div><div class="wfm-ij-training-meta"><span><b>'+l.mastered+'</b> skills proven</span><span><b>'+l.total+'</b> assignments</span><span><b>'+l.users+'</b> people in learning</span><span><b>'+(l.privileged?'Yes':'Not yet')+'</b> privileged roles ready</span></div>'+readiness+'<button class="btn small" type="button" data-ij-training>Open my training guide</button></section>';
}
function launchBlockerMarkup(launch){
  const rows=Array.isArray(launch?.blockers)?launch.blockers:[];
  if(!rows.length)return '';
  return '<div class="wfm-ij-import-list" aria-label="Go-live blockers">'+rows.map(code=>'<div class="wfm-ij-import-row"><span><b>'+safe(String(code).replace(/_/g,' '))+'</b><small>Current proof is incomplete or stale for this launch gate.</small></span><span class="wfm-ij-pill blocked">Blocked</span></div>').join('')+'</div>';
}
function liveMarkup(){
  const progress=overallProgress();
  const integrationReady=S.integrations?.readiness||{};
  const test=requirement('scenario-validation');
  const cleanup=requirement('test-data-cleanup');
  const liveImport=requirement('live-data-import');
  const launch=S.status?.launchBoundary||{};
  const launchReady=launchIsReady();
  const sourceState=S.status?.state||'BUILDING';
  const state=sourceState==='READY'&&!launchReady?'BUILDING':sourceState;
  return '<div class="wfm-ij-shell">'+
    '<header class="wfm-ij-header"><div><span class="wfm-ij-kicker">IMPLEMENTATION IN PROGRESS</span><h1>Your implementation</h1><p>One place to see what is happening, what has been proven and what needs you.</p></div><span class="wfm-ij-status '+(state==='READY'?'ready':state==='AT_RISK'||state==='SLA_MISSED'?'blocked':'working')+'">'+safe(stateLabel(state))+'</span></header>'+
    workspaceSetupMarkup()+
    '<section class="wfm-ij-overall"><div class="wfm-ij-overall-top"><div><b>Overall progress</b><span>'+progress+'% · '+Number(S.status?.completedRequirements||0)+' of '+Number(S.status?.totalRequirements||(S.status?.requirements||[]).length)+' controls proven</span></div><strong>'+progress+'%</strong></div><div class="wfm-ij-progress"><span style="width:'+progress+'%"></span></div><div class="wfm-ij-stagebar">'+stageMarkup()+'</div></section>'+
    decisionsMarkup()+
    '<div class="wfm-ij-grid">'+
      '<section class="wfm-ij-panel wfm-ij-activity"><div class="wfm-ij-panel-head"><div><span class="wfm-ij-kicker">CURRENT ACTIVITY</span><h2>What the implementation is working through</h2></div></div>'+activeWork()+'</section>'+
      '<section class="wfm-ij-panel wfm-ij-integrations"><div class="wfm-ij-panel-head"><div><span class="wfm-ij-kicker">INTEGRATIONS</span><h2>Your connected systems</h2><p>'+Number(S.integrations?.connections?.length||0)+' connections · '+Number(integrationReady.needsAdminAction||0)+' need admin action · '+Number(integrationReady.needsValidation||0)+' validating</p></div><button type="button" class="btn small" data-ij-route="integrations">Manage integrations</button></div>'+integrationMarkup()+'</section>'+
    '</div>'+
    '<div class="wfm-ij-three">'+
      requirementCard('scenario-validation','Rigorous testing','Automated end-to-end scenarios cover configuration, workflows, payroll, security, resilience and exceptions.')+
      requirementCard('test-data-cleanup','Clean test environment','Test employees, transactions and configuration samples are removed only after testing is proven.')+
      requirementCard('live-data-import','Live data import','Authoritative data is imported only after cleanup, then counts and checksums are reconciled.')+
    '</div>'+
    '<section class="wfm-ij-panel wfm-ij-import-advice"><div class="wfm-ij-panel-head"><div><span class="wfm-ij-kicker">DATA READINESS</span><h2>What is needed before live import</h2><p>The system explains the remaining prerequisites rather than leaving the customer to work them out.</p></div><span class="wfm-ij-pill '+(liveImport?.satisfied?'active':'validating')+'">'+(liveImport?.satisfied?'Reconciled':'Preparing')+'</span></div>'+importAdvice()+'</section>'+
    trainingPanel(false)+
    '<section class="wfm-ij-panel wfm-ij-golive"><div><span class="wfm-ij-kicker">GO LIVE</span><h2>'+(launchReady?'Everything required for launch is proven':'Go live remains protected')+'</h2><p>'+(launchReady?'All implementation, runtime, provider and Golden Journey gates are current and proven. Review the final readiness evidence before activation.':'Launch stays locked until current non-fixture runtime identity, production approval, workforce readiness, provider journey, Golden Journey, integrations, cleanup, live import and role competence are all proven.')+'</p>'+launchBlockerMarkup(launch)+'</div><button type="button" class="btn primary" data-ij-route="readiness" '+(launchReady?'':'disabled')+'>'+(launchReady?'Review go-live readiness':'Not ready yet')+'</button></section>'+
    '<p class="wfm-ij-footnote">Testing '+safe(test?.status||'MISSING')+' · Cleanup '+safe(cleanup?.status||'MISSING')+' · Live import '+safe(liveImport?.status||'MISSING')+'. Progress comes from implementation evidence, not manually ticked boxes.</p>'+
  '</div>';
}
function errorMarkup(){
  return '<div class="wfm-ij-shell"><section class="wfm-ij-panel wfm-ij-error"><span class="wfm-ij-kicker">IMPLEMENTATION</span><h1>We could not load the implementation workspace</h1><p>'+safe(S.error||'Please refresh and try again.')+'</p><button class="btn primary" type="button" data-ij-refresh>Try again</button></section></div>';
}
function renderView(force=false){
  if(currentPage()!=='onboarding'||isEmployeeRole())return;
  if(S.setupDirty&&!force&&!S.error&&S.status&&document.querySelector('[data-ij-setup-form]'))return;
  const content=document.querySelector('.content');if(!content)return;
  content.dataset.wfmImplementationJourney=VERSION;
  if(S.error){content.innerHTML=errorMarkup();return;}
  if(!S.status){content.innerHTML='<div class="wfm-ij-shell"><div class="wfm-ij-loading">Preparing your implementation workspace…</div></div>';return;}
  const prestart=['NOT_STARTED','AWAITING_CUSTOMER_START','INVITATION_EXPIRED'].includes(S.status.state);
  content.innerHTML=prestart?welcomeMarkup():liveMarkup();
}
async function load(force){
  if(currentPage()!=='onboarding'||isEmployeeRole())return;
  const now=Date.now();if(S.loading||(!force&&now-S.lastLoad<3500))return;
  S.loading=true;S.lastLoad=now;S.error='';renderView();
  try{
    const token=inviteToken();
    const calls=[
      request(IMPL+'/status'),
      request(INTEGRATIONS+'/status').catch(()=>null),
      request(LEARNING+'/tenant-summary').catch(()=>null)
    ];
    calls.push(request(IMPL+'/setup').catch(error=>{S.setupError=error.message;return null;}));
    if(token)calls.push(request(IMPL+'/invitation?token='+encodeURIComponent(token)).catch(error=>({error:error.message,status:error.status})));
    const result=await Promise.all(calls);
    S.status=result[0];S.integrations=result[1];S.learning=result[2];S.invitation=result[4]||null;
    const changedBinding=S.setup&&result[3]&&(S.setup.tenant!==result[3].tenant||S.setup.runId!==result[3].runId||S.setup.setupBinding!==result[3].setupBinding);
    if(changedBinding){resetSetupBinding();S.setupDirty=false;S.setupInput=null;S.setupSettings=false;S.setupEditGeneration++;}
    if((changedBinding||!S.setupDirty&&!S.setupSaving)&&result[3]&&(!S.setup||changedBinding||result[3].revision>=S.setup.revision))S.setup=result[3];
    if(!S.status){resetSetupBinding();S.error='Your account does not have access to implementation control.';S.setupDirty=false;S.setup=null;S.setupInput=null;S.setupSettings=false;S.setupEditGeneration++;}
    if(S.invitation?.error&&S.status?.state==='AWAITING_CUSTOMER_START')S.error=S.invitation.error;
  }catch(error){resetSetupBinding(true);S.status=null;S.integrations=null;S.learning=null;S.invitation=null;S.error=error.message||'Implementation workspace failed to load.';}
  finally{S.loading=false;renderView();schedule();if(S.status&&S.setupDirty&&!S.setupSaving)scheduleSetupSave();}
}
function schedule(){
  clearTimeout(S.timer);
  if(currentPage()==='onboarding')S.timer=setTimeout(()=>load(true),12000);
}
function stop(){clearTimeout(S.timer);S.timer=null;}
function openRoute(route){
  if(window.WFMUXCycle11?.openRoute&&window.WFMUXCycle11.openRoute(route,'implementation-journey','implementation-journey','implementation','NEEDS_REVIEW','Implementation'))return;
  const button=document.querySelector('.sidebar .navbtn[data-page="'+CSS.escape(route)+'"]')||document.querySelector('#ux-tool-backdrop .navbtn[data-page="'+CSS.escape(route)+'"]');
  button?.click();
}
async function start(){
  const token=inviteToken();if(!token)return;
  const button=document.querySelector('[data-ij-start]');if(button){button.disabled=true;button.textContent='Starting safely…';}
  try{
    S.status=await request(IMPL+'/start',{method:'POST',body:JSON.stringify({token})});
    const url=new URL(window.location.href);url.searchParams.delete('implementation_invite');history.replaceState({},'',url.pathname+url.search+url.hash);
    S.invitation=null;await load(true);
  }catch(error){S.error=error.message||'Implementation could not be started.';renderView();}
}
async function saveScope(form){
  const button=form.querySelector('button[type="submit"]');
  if(button){button.disabled=true;button.textContent='Saving scope…';}
  const data=new FormData(form);
  const split=name=>String(data.get(name)||'').split(',').map(x=>x.trim()).filter(Boolean);
  const payload={
    companyName:String(data.get('companyName')||'').trim(),
    employeeCount:Number(data.get('employeeCount')),
    countries:split('countries'),
    sites:split('sites'),
    payrollSystem:String(data.get('payrollSystem')||'').trim(),
    hcmSystem:String(data.get('hcmSystem')||'').trim(),
    erpSystem:String(data.get('erpSystem')||'').trim(),
    sourceSystems:split('sourceSystems'),
    features:split('features'),
    workPatterns:split('workPatterns'),
    clockingMethods:split('clockingMethods'),
    priorities:String(data.get('priorities')||'').trim(),
    notes:String(data.get('notes')||'').trim(),
    agencyLabour:data.get('agencyLabour')==='on'
  };
  try{
    S.status=await request(IMPL+'/scope',{method:'POST',body:JSON.stringify(payload)});
    renderView();
  }catch(error){
    S.error=error.message||'Configuration scope could not be saved.';
    renderView();
  }
}
async function submitPolicyDecision(form){
  if(!S.status?.runId)return;
  const key=String(form.dataset.ijPolicyForm||'');
  const data=new FormData(form);
  const button=form.querySelector('button[type="submit"]');
  if(button){button.disabled=true;button.textContent='Confirming policy…';}
  const complete=data.get('policyComplete')==='on';
  const detail={
    authoritativeConfirmation:data.get('authoritativeConfirmation')==='on',
    sourceRef:String(data.get('sourceRef')||'').trim(),
    effectiveDate:String(data.get('effectiveDate')||'').trim(),
    unresolvedRules:complete?0:1,
    unknownPolicyFields:complete?0:1
  };
  if(key==='time-policy-authority'){
    Object.assign(detail,{
      breakRulesVerified:data.get('breakRulesVerified')==='on',
      overtimeRulesVerified:data.get('overtimeRulesVerified')==='on',
      workingTimeRulesVerified:data.get('workingTimeRulesVerified')==='on',
      timeZoneVerified:data.get('timeZoneVerified')==='on'
    });
  }else if(key==='absence-policy-authority'){
    const usesOpeningBalance=data.get('usesOpeningBalance')==='yes';
    Object.assign(detail,{
      leaveYearVerified:data.get('leaveYearVerified')==='on',
      entitlementMethodVerified:data.get('entitlementMethodVerified')==='on',
      approvalRulesVerified:data.get('approvalRulesVerified')==='on',
      absenceTypesVerified:data.get('absenceTypesVerified')==='on',
      usesOpeningBalance,
      openingBalanceFictional:false,
      openingBalanceSourceVerified:data.get('openingBalanceSourceVerified')==='on'
    });
  }
  try{
    S.decisionError='';
    S.status=await request(IMPL+'/decision',{method:'POST',body:JSON.stringify({
      runId:S.status.runId,key,action:'ACCEPTED',detail
    })});
    renderView();
  }catch(error){
    S.decisionError=error.message||'The policy confirmation could not be recorded.';
    renderView();
  }
}
async function acceptDecision(key,button){
  if(!S.status?.runId||!key)return;
  if(button){button.disabled=true;button.textContent='Confirming…';}
  try{
    S.decisionError='';
    S.status=await request(IMPL+'/decision',{method:'POST',body:JSON.stringify({
      runId:S.status.runId,
      key,
      action:'ACCEPTED',
      detail:{source:'implementation-dashboard'}
    })});
    renderView();
  }catch(error){
    S.decisionError=error.message||'The decision could not be recorded.';
    renderView();
  }
}
function apply(){
  if(currentPage()!=='onboarding'||isEmployeeRole()){stop();return;}
  const nav=document.querySelector('.sidebar .navbtn[data-page="onboarding"] span:not(.count):not(.review-count)');
  if(nav&&nav.textContent!=='Implementation')nav.textContent='Implementation';
  const content=document.querySelector('.content');if(!content)return;
  if(content.dataset.wfmImplementationJourney!==VERSION){S.error='';renderView(true);load(true);}
  else if(!S.loading&&!S.timer)schedule();
}
document.addEventListener('submit',event=>{
  const setupForm=event.target.closest('[data-ij-setup-form]');
  if(setupForm){event.preventDefault();saveSetup(setupForm);return;}
  const policyForm=event.target.closest('[data-ij-policy-form]');
  if(policyForm){event.preventDefault();submitPolicyDecision(policyForm);return;}
  const form=event.target.closest('[data-ij-scope-form]');
  if(!form)return;
  event.preventDefault();
  saveScope(form);
},true);
document.addEventListener('click',event=>{
  if(event.target.closest('[data-ij-setup-settings]')){event.preventDefault();openSetupSettings();return;}
  if(event.target.closest('[data-ij-setup-close]')){event.preventDefault();closeSetupSettings();return;}
  const applyButton=event.target.closest('[data-ij-setup-apply]');if(applyButton){event.preventDefault();applySetup();return;}
  const reloadSetup=event.target.closest('[data-ij-setup-reload]');if(reloadSetup){event.preventDefault();resetSetupBinding();S.setupDirty=false;S.setupInput=null;S.setupError='';load(true);return;}
  const addSite=event.target.closest('[data-ij-add-site]');if(addSite){event.preventDefault();changeSetupRows('site');return;}
  const addSystem=event.target.closest('[data-ij-add-system]');if(addSystem){event.preventDefault();changeSetupRows('system');return;}
  const removeSite=event.target.closest('[data-ij-remove-site]');if(removeSite){event.preventDefault();changeSetupRows('site',Number(removeSite.dataset.ijRemoveSite));return;}
  const removeSystem=event.target.closest('[data-ij-remove-system]');if(removeSystem){event.preventDefault();changeSetupRows('system',Number(removeSystem.dataset.ijRemoveSystem));return;}
  const startButton=event.target.closest('[data-ij-start]');if(startButton){event.preventDefault();start();return;}
  const refresh=event.target.closest('[data-ij-refresh]');if(refresh){event.preventDefault();S.error='';load(true);return;}
  const route=event.target.closest('[data-ij-route]');if(route){event.preventDefault();openRoute(route.dataset.ijRoute);return;}
  const training=event.target.closest('[data-ij-training]');if(training){event.preventDefault();document.querySelector('.wfm-coach-trigger')?.click();return;}
  const accept=event.target.closest('[data-ij-decision-accept]');if(accept){event.preventDefault();acceptDecision(accept.dataset.ijDecisionAccept,accept);return;}
  const review=event.target.closest('[data-ij-decision-review]');if(review){event.preventDefault();openRoute('op-settings');return;}
},true);
function setupEdited(event){
  const form=event.target.closest('[data-ij-setup-form]');if(!form)return;
  rememberSetupInput(form);
  const button=document.querySelector('[data-ij-setup-apply]');if(button)button.disabled=true;
}
document.addEventListener('input',setupEdited,true);
document.addEventListener('change',setupEdited,true);
const priorRender=window.render;
if(typeof priorRender==='function')window.render=async function(...args){const out=await priorRender.apply(this,args);apply();return out;};
const observer=new MutationObserver(()=>apply());
observer.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(()=>{
  if(inviteToken()&&!isEmployeeRole()&&currentPage()!=='onboarding'){
    const button=document.querySelector('.sidebar .navbtn[data-page="onboarding"]')||document.querySelector('#ux-tool-backdrop .navbtn[data-page="onboarding"]');
    if(button)button.click();
  }
  apply();
},120);
setTimeout(apply,600);
window.WFMImplementationJourney=Object.freeze({refresh:()=>load(true),version:VERSION});
})();

