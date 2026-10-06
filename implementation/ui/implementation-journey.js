;(function(){
'use strict';

const IMPL='/api/implementation/autonomous';
const INTEGRATIONS='/api/integrations/autonomous';
const LEARNING='/api/learning/adaptive';
const VERSION='version-d-3';
const S={status:null,integrations:null,learning:null,invitation:null,loading:false,error:'',decisionError:'',timer:null,lastLoad:0};
const inviteToken=()=>{try{return new URL(window.location.href).searchParams.get('implementation_invite')||'';}catch{return '';}};
const currentPage=()=>{try{return typeof ui!=='undefined'?ui.page:null;}catch{return null;}};
const isEmployeeRole=()=>{try{return typeof isEmployee==='function'&&isEmployee();}catch{return false;}};
const safe=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const pct=v=>Math.max(0,Math.min(100,Math.round(Number(v)||0)));

async function request(url,options){
  const response=await fetch(url,{credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json'},...options});
  if(response.status===401||response.status===403)return null;
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
  return {mastered:Number(l.mastered||0),total:Number(l.assignments||0),users:Number(l.users||0),privileged:Boolean(l.privilegedReady),certified:Boolean(l.fullyCertified)};
}
function connectionRows(){
  const live=S.integrations?.connections||[];
  if(live.length)return live.map(x=>({id:x.id,name:x.name||x.productKey,state:x.state,detail:x.failureClass||x.lastReconciliation?.status||'',sourceId:x.id}));
  return (S.integrations?.discovery?.candidates||[]).map(x=>({id:x.id,name:x.name||x.productKey,state:x.status==='CONFIRMED'?'READY_TO_CONNECT':'IDENTIFIED',detail:Math.round(Number(x.confidence||0)*100)+'% confidence',sourceId:x.id}));
}
function stateLabel(value){
  const map={complete:'Complete',progress:'In progress',pending:'Pending',ACTIVE:'Connected',VALIDATING:'Validating',DEGRADED:'Needs review',AUTHORIZATION_REQUIRED:'Authorisation needed',REAUTH_REQUIRED:'Reconnect',CONFIRMED:'Confirmed',IDENTIFIED:'Identified',READY_TO_CONNECT:'Ready to connect',REVALIDATION_REQUIRED:'Evidence needs rechecking for this deployment'};
  return map[value]||String(value||'Pending').replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase());
}
function stateIcon(value){return value==='complete'||value==='ACTIVE'?'✓':value==='progress'||value==='VALIDATING'?'●':'○';}
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
    ['Go live',[],Boolean(S.status?.operationalReady)]
  ];
  return stages.map((stage,index)=>{
    const st=stage[0]==='Go live'?(S.status?.operationalReady?'complete':'pending'):groupState(stage[1],stage[2]);
    const caption=stage[0]==='Training'&&st!=='complete'?'From day one':stateLabel(st);
    return '<div class="wfm-ij-stage '+st+'"><span class="wfm-ij-stage-dot">'+stateIcon(st)+'</span><div><b>'+safe(stage[0])+'</b><small>'+safe(caption)+'</small></div></div>'+(index<stages.length-1?'<span class="wfm-ij-stage-line"></span>':'');
  }).join('');
}
function integrationMarkup(){
  const rows=connectionRows(),provider=S.status?.providerJourney||{},truth=S.status?.integrationTruth||{};
  const providerRows=provider.required?[{
    name:'Staffology payroll',
    detail:provider.proven?'Current provider journey and full-batch receipt are proven.':'Mandatory provider journey remains unproved for the current tenant, workforce and payroll batch.',
    state:provider.proven?'complete':'blocked'
  }]:[];
  const all=[...providerRows,...rows.filter(row=>!providerRows.some(providerRow=>String(row.name||'').toLowerCase().includes('staffology')))];
  if(!all.length)return '<div class="wfm-ij-empty"><b>No systems discovered yet.</b><span>System discovery and connection status will appear here automatically.</span></div>';
  return '<div class="wfm-ij-system-list">'+all.slice(0,8).map(row=>
    '<div class="wfm-ij-system"><div class="wfm-ij-system-name"><span class="wfm-ij-system-glyph">↔</span><div><b>'+safe(row.name)+'</b><small>'+safe(row.detail||'Connection evidence')+'</small></div></div><span class="wfm-ij-pill '+safe(String(row.state||'').toLowerCase())+'">'+safe(stateLabel(row.state))+'</span></div>'
  ).join('')+(truth.unifiedReady===false?'<div class="wfm-ij-empty"><b>Unified integration proof is not ready.</b><span>Source-system and mandatory-provider evidence must agree before go live.</span></div>':'')+'</div>';
}
function requirementCard(key,title,description){
  const item=requirement(key);
  const complete=Boolean(item?.satisfied);
  const status=complete?'complete':(item?.status&&item.status!=='MISSING'?'progress':'pending');
  const detail=item?.detail||{};
  let evidence='';
  if(key==='scenario-validation'&&detail.totalScenarios!=null)evidence=Number(detail.passedScenarios||0).toLocaleString()+' / '+Number(detail.totalScenarios||0).toLocaleString()+' scenarios passed';
  if(key==='test-data-cleanup'&&detail.remainingTestRows!=null)evidence=Number(detail.remainingTestRows).toLocaleString()+' test rows remaining';
  if(key==='live-data-import'&&detail.sourceCount!=null)evidence=Number(detail.importedCount||0).toLocaleString()+' / '+Number(detail.sourceCount||0).toLocaleString()+' records reconciled';
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
  return '<section class="wfm-ij-panel wfm-ij-training"><div class="wfm-ij-panel-head"><div><span class="wfm-ij-kicker">TRAINING · RUNS THROUGHOUT</span><h2>Learn in the test environment from the beginning</h2><p>Role-based learning, guided practice and competency proof continue alongside configuration and testing.</p></div><div class="wfm-ij-training-score"><strong>'+progress+'%</strong><span>'+safe(prestart?'Available now':'team ready')+'</span></div></div><div class="wfm-ij-progress"><span style="width:'+progress+'%"></span></div><div class="wfm-ij-training-meta"><span><b>'+l.mastered+'</b> skills proven</span><span><b>'+l.total+'</b> assignments</span><span><b>'+l.users+'</b> people in learning</span><span><b>'+(l.privileged?'Yes':'Not yet')+'</b> privileged roles ready</span></div><button class="btn small" type="button" data-ij-training>Open my training guide</button></section>';
}
function launchBlockerMarkup(launch){
  const rows=Array.isArray(launch?.blockers)?launch.blockers:[];
  if(!rows.length)return '';
  return '<div class="wfm-ij-import-list" aria-label="Go-live blockers">'+rows.map(code=>'<div class="wfm-ij-import-row"><span><b>'+safe(String(code).replace(/_/g,' '))+'</b><small>Current proof is incomplete or stale for this launch gate.</small></span><span class="wfm-ij-pill blocked">Blocked</span></div>').join('')+'</div>';
}
function liveMarkup(){
  const progress=overallProgress();
  const state=S.status?.state||'BUILDING';
  const integrationReady=S.integrations?.readiness||{};
  const test=requirement('scenario-validation');
  const cleanup=requirement('test-data-cleanup');
  const liveImport=requirement('live-data-import');
  const runtime=S.status?.runtimeIdentity||{},provider=S.status?.providerJourney||{},launch=S.status?.launchBoundary||{};
  const launchReady=S.status?.operationalReady===true&&launch.ready===true&&runtime.fixtureOnly===false&&runtime.productionApproved===true&&S.status?.wholeJourneyProven===true&&(!provider.required||provider.proven===true);
  return '<div class="wfm-ij-shell">'+
    '<header class="wfm-ij-header"><div><span class="wfm-ij-kicker">IMPLEMENTATION IN PROGRESS</span><h1>Your implementation</h1><p>One place to see what is happening, what has been proven and what needs you.</p></div><span class="wfm-ij-status '+(state==='READY'?'ready':state==='AT_RISK'||state==='SLA_MISSED'?'blocked':'working')+'">'+safe(stateLabel(state))+'</span></header>'+
    scopeMarkup()+
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
function renderView(){
  if(currentPage()!=='onboarding'||isEmployeeRole())return;
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
    if(token)calls.push(request(IMPL+'/invitation?token='+encodeURIComponent(token)).catch(error=>({error:error.message,status:error.status})));
    const result=await Promise.all(calls);
    S.status=result[0];S.integrations=result[1];S.learning=result[2];S.invitation=result[3]||null;
    if(!S.status)S.error='Your account does not have access to implementation control.';
    if(S.invitation?.error&&S.status?.state==='AWAITING_CUSTOMER_START')S.error=S.invitation.error;
  }catch(error){S.error=error.message||'Implementation workspace failed to load.';}
  finally{S.loading=false;renderView();schedule();}
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
  if(content.dataset.wfmImplementationJourney!==VERSION){S.status=null;S.error='';renderView();load(true);}
  else if(!S.loading&&!S.timer)schedule();
}
document.addEventListener('submit',event=>{
  const policyForm=event.target.closest('[data-ij-policy-form]');
  if(policyForm){event.preventDefault();submitPolicyDecision(policyForm);return;}
  const form=event.target.closest('[data-ij-scope-form]');
  if(!form)return;
  event.preventDefault();
  saveScope(form);
},true);
document.addEventListener('click',event=>{
  const startButton=event.target.closest('[data-ij-start]');if(startButton){event.preventDefault();start();return;}
  const refresh=event.target.closest('[data-ij-refresh]');if(refresh){event.preventDefault();S.error='';load(true);return;}
  const route=event.target.closest('[data-ij-route]');if(route){event.preventDefault();openRoute(route.dataset.ijRoute);return;}
  const training=event.target.closest('[data-ij-training]');if(training){event.preventDefault();document.querySelector('.wfm-coach-trigger')?.click();return;}
  const accept=event.target.closest('[data-ij-decision-accept]');if(accept){event.preventDefault();acceptDecision(accept.dataset.ijDecisionAccept,accept);return;}
  const review=event.target.closest('[data-ij-decision-review]');if(review){event.preventDefault();openRoute('op-settings');return;}
},true);
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
