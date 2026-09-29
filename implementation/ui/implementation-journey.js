;(function(){
'use strict';

const IMPL='/api/implementation/autonomous';
const INTEGRATIONS='/api/integrations/autonomous';
const LEARNING='/api/learning/adaptive';
const VERSION='version-d-4';
const S={status:null,integrations:null,learning:null,invitation:null,loading:false,error:'',timer:null,lastLoad:0};
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
  const connectedCandidateIds=new Set(live.map(x=>x.candidateId).filter(Boolean));
  const liveRows=live.map(x=>({
    id:x.id,
    candidateId:x.candidateId||null,
    kind:'connection',
    name:x.name||x.productKey,
    state:x.state,
    detail:x.failureClass||x.lastReconciliation?.status||'',
    semanticScopes:Array.isArray(x.semanticScopes)?x.semanticScopes:[],
    sourceId:x.id
  }));
  const candidateRows=(S.integrations?.discovery?.candidates||[])
    .filter(x=>!connectedCandidateIds.has(x.id))
    .map(x=>({
      id:x.id,
      candidateId:x.id,
      kind:'candidate',
      name:x.name||x.productKey,
      state:x.status==='CONFIRMED'?'READY_TO_CONNECT':'IDENTIFIED',
      detail:Math.round(Number(x.confidence||0)*100)+'% confidence',
      semanticScopes:[],
      authoritativeFor:Array.isArray(x.authoritativeFor)?x.authoritativeFor:[],
      sourceId:x.id
    }));
  return [...liveRows,...candidateRows];
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
  const rows=connectionRows();
  if(!rows.length)return '<div class="wfm-ij-empty"><b>No systems discovered yet.</b><span>System discovery and connection status will appear here automatically.</span></div>';
  return '<div class="wfm-ij-system-list">'+rows.slice(0,8).map(row=>
    '<div class="wfm-ij-system"><div class="wfm-ij-system-name"><span class="wfm-ij-system-glyph">↔</span><div><b>'+safe(row.name)+'</b><small>'+safe(row.detail||'Connection evidence')+'</small></div></div><span class="wfm-ij-pill '+safe(String(row.state||'').toLowerCase())+'">'+safe(stateLabel(row.state))+'</span></div>'
  ).join('')+'</div>';
}
function scopeLabel(scope){
  const map={
    'people.read':'employees',
    'organisation.read':'sites and departments',
    'absence.read':'absence',
    'time.read':'time and attendance',
    'payroll.read':'payroll data',
    'finance.read':'finance data',
    'cost-centres.read':'cost centres',
    'production.read':'production data',
    'procurement.read':'procurement data'
  };
  return map[scope]||String(scope||'').replace('.read','').replaceAll('-',' ');
}
function integrationAccessRows(){
  return connectionRows().filter(row=>['AUTHORIZATION_REQUIRED','REAUTH_REQUIRED','READY_TO_CONNECT','IDENTIFIED'].includes(row.state));
}
function integrationAccessMarkup(){
  const rows=integrationAccessRows();
  const declared=[
    S.status?.customerScope?.hcmSystem,
    S.status?.customerScope?.payrollSystem,
    S.status?.customerScope?.erpSystem,
    ...(S.status?.customerScope?.sourceSystems||[])
  ].filter(Boolean);
  if(!rows.length&&(!declared.length||requirementComplete('source-systems')))return '';

  const content=rows.length?rows.slice(0,8).map(row=>{
    const scopes=(row.semanticScopes||[]).map(scopeLabel);
    const need=scopes.length?'Read-only access needed for '+scopes.join(', ')+'.':'VECTOR has identified this system and needs its role in the implementation confirmed.';
    let action='';
    if(row.state==='READY_TO_CONNECT'){
      action='<div class="wfm-ij-access-actions"><button type="button" class="btn small primary" data-ij-access-prepare="'+safe(row.candidateId)+'">I can approve access</button><button type="button" class="btn small" data-ij-route="integrations">I need our system admin</button></div>';
    }else if(row.state==='AUTHORIZATION_REQUIRED'||row.state==='REAUTH_REQUIRED'){
      action='<div class="wfm-ij-access-actions"><button type="button" class="btn small primary" data-ij-route="integrations">'+(row.state==='REAUTH_REQUIRED'?'Reconnect securely':'Continue secure authorisation')+'</button><button type="button" class="btn small" data-ij-route="integrations">I need our system admin</button></div>';
    }else{
      action='<div class="wfm-ij-access-actions"><button type="button" class="btn small primary" data-ij-route="integrations">Yes, this is a source system</button><button type="button" class="btn small" data-ij-route="integrations">I am not sure who owns it</button></div>';
    }
    return '<article class="wfm-ij-access-item"><div><div class="wfm-ij-access-title"><b>'+safe(row.name)+'</b><span class="wfm-ij-pill '+safe(String(row.state||'').toLowerCase())+'">'+safe(stateLabel(row.state))+'</span></div><p>'+safe(need)+'</p><small>VECTOR will not ask you to paste a password, API key or secret here.</small></div>'+action+'</article>';
  }).join(''):'<article class="wfm-ij-access-item"><div><div class="wfm-ij-access-title"><b>Secure system access</b><span class="wfm-ij-pill authorization_required">Access needed</span></div><p>Tell VECTOR which systems are authoritative, then an authorised system owner approves the minimum access required.</p><small>Declared systems: '+safe(declared.join(', '))+'. Credentials stay in the provider or managed-secret boundary.</small></div><button type="button" class="btn small primary" data-ij-route="integrations">Review access</button></article>';

  return '<section class="wfm-ij-panel wfm-ij-access"><div class="wfm-ij-panel-head"><div><span class="wfm-ij-kicker">YOUR ACTION · SECURE ACCESS</span><h2>Connect the systems VECTOR needs</h2><p>VECTOR asks for permission, purpose and the minimum data scope — never for credentials in free text. If you cannot approve access, hand this step to the system owner.</p></div><span class="wfm-ij-status '+(rows.some(r=>r.state==='AUTHORIZATION_REQUIRED'||r.state==='REAUTH_REQUIRED')?'blocked':'working')+'">'+safe(rows.length?rows.length+' access item'+(rows.length===1?'':'s'):'Access required')+'</span></div><div class="wfm-ij-access-list">'+content+'</div><div class="wfm-ij-access-rule"><b>Default security:</b> read-only first · write access off · tenant-bound · explicit production approval · auditable authorisation.</div></section>';
}
function fallbackQuestionMarkup(question){
  const suggestion=question?.suggestions?.[0]?.name||'';
  return '<form class="wfm-ij-source-question" data-ij-source-form>'+
    '<input type="hidden" name="domain" value="'+safe(question.domain)+'">'+
    '<div class="wfm-ij-source-question-copy"><span>'+safe(question.label||question.domain)+'</span><b>'+safe(question.question)+'</b>'+(suggestion?'<small>VECTOR found a likely answer: '+safe(suggestion)+'. Confirm it or replace it.</small>':'<small>Answer the business question; VECTOR handles the technical setup afterwards.</small>')+'</div>'+
    '<div class="wfm-ij-source-question-fields">'+
      '<input name="systemName" required maxlength="160" value="'+safe(suggestion)+'" placeholder="System name">'+
      '<select name="accessState"><option value="UNKNOWN">Not sure about access yet</option><option value="CAN_AUTHORIZE">I can approve access</option><option value="NEEDS_ADMIN">Our system admin must approve</option><option value="NO_DIRECT_ACCESS">We cannot provide direct access</option></select>'+
      '<input name="ownerHint" maxlength="160" placeholder="System owner/team (optional)">'+
      '<button class="btn small primary" type="submit">Save answer</button>'+
    '</div>'+
  '</form>';
}
function sourceFallbackMarkup(){
  const fallback=S.integrations?.fallback;
  if(!fallback||requirementComplete('source-systems'))return '';
  const questions=Array.isArray(fallback.questions)?fallback.questions:[];
  const answers=Array.isArray(fallback.answers)?fallback.answers:[];
  const independent=Array.isArray(fallback.independentWork)?fallback.independentWork:[];
  if(!questions.length&&!answers.length&&!fallback.accessBlocked)return '';

  const answered=answers.length?'<div class="wfm-ij-source-answers">'+answers.map(answer=>
    '<span><b>'+safe(String(answer.domain||'source').replaceAll('-',' '))+'</b>'+safe(answer.systemName)+' · '+safe(stateLabel(answer.accessState))+'</span>'
  ).join('')+'</div>':'';
  const questionMarkup=questions.map(fallbackQuestionMarkup).join('');
  const workMarkup=independent.length?'<div class="wfm-ij-independent"><b>VECTOR is still working while access is unresolved</b><div>'+independent.slice(0,6).map(item=>{
    const label=requirement(item.requirementKey)?.label||String(item.requirementKey||'').replaceAll('-',' ');
    return '<span>• '+safe(label)+'</span>';
  }).join('')+'</div></div>':'';
  const methods=(fallback.alternativeAccessMethods||[]).slice(0,6).map(method=>
    '<span><b>'+safe(method.label)+'</b><small>'+safe(method.readinessEffect==='does-not-prove-go-live'?'Configuration preparation only':'Can become an authoritative route after validation and reconciliation')+'</small></span>'
  ).join('');

  return '<section class="wfm-ij-panel wfm-ij-fallback"><div class="wfm-ij-panel-head"><div><span class="wfm-ij-kicker">NO DIRECTORY ACCESS? IMPLEMENTATION CONTINUES</span><h2>VECTOR only asks for what it still cannot discover</h2><p>Entra/Okta discovery is optional. Tell VECTOR where the missing records live; direct API access can be replaced by an approved read-only feed where necessary.</p></div><span class="wfm-ij-status working">'+safe(questions.length?questions.length+' answer'+(questions.length===1?'':'s')+' needed':'Fallback active')+'</span></div>'+
    answered+
    (questionMarkup?'<div class="wfm-ij-source-questions">'+questionMarkup+'</div>':'')+
    workMarkup+
    '<details class="wfm-ij-fallback-methods"><summary>Other secure ways to provide source evidence</summary><div>'+methods+'</div><p>'+safe(fallback.goLiveRule||'')+'</p></details>'+
  '</section>';
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
function decisionOwner(d){
  if(d?.proposal?.ownerRole)return String(d.proposal.ownerRole);
  const key=String(d?.key||'').toLowerCase();
  if(key.includes('overtime')||key.includes('break')||key.includes('payroll'))return 'Payroll';
  if(key.includes('absence')||key.includes('leave'))return 'HR';
  if(key.includes('schedule')||key.includes('shift')||key.includes('structure'))return 'Operations';
  return 'Authorised owner';
}
function decisionEvidence(d){
  if(d?.proposal?.evidenceSummary)return String(d.proposal.evidenceSummary);
  if(d?.proposal?.detail?.sampleCount!=null){
    const confidence=Math.round(Number(d.proposal.detail.confidence||d.confidence||0)*1000)/10;
    return Number(d.proposal.detail.sampleCount).toLocaleString()+' historical records · '+confidence+'% consistency';
  }
  return proposalSummary(d?.proposal);
}
function decisionsMarkup(){
  const rows=S.status?.blockingDecisions||[];
  if(!rows.length)return '';
  return '<section class="wfm-ij-panel wfm-ij-decisions"><div class="wfm-ij-panel-head"><div><span class="wfm-ij-kicker">POLICY INTERVIEW · ONLY WHAT VECTOR CANNOT PROVE</span><h2>'+rows.length+' decision'+(rows.length===1?'':'s')+' need a human answer</h2><p>VECTOR uses source data and history first. It asks only where evidence is ambiguous, conflicting or too risky to infer safely.</p></div></div><div class="wfm-ij-decision-list">'+rows.map(d=>{
    const evidence=decisionEvidence(d);
    return '<article><div class="wfm-ij-decision-copy"><div class="wfm-ij-decision-meta"><span>ASKING · '+safe(decisionOwner(d))+'</span><span>'+safe(d.risk)+' risk</span></div><b>'+safe(d.question)+'</b>'+(evidence?'<small>'+safe(evidence)+'</small>':'')+'</div><div class="wfm-ij-decision-actions"><button class="btn small primary" type="button" data-ij-decision-accept="'+safe(d.key)+'">Yes, use this policy</button><button class="btn small" type="button" data-ij-decision-change="'+safe(d.key)+'">It is different</button></div></article>';
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
function liveMarkup(){
  const progress=overallProgress();
  const state=S.status?.state||'BUILDING';
  const integrationReady=S.integrations?.readiness||{};
  const test=requirement('scenario-validation');
  const cleanup=requirement('test-data-cleanup');
  const liveImport=requirement('live-data-import');
  return '<div class="wfm-ij-shell">'+
    '<header class="wfm-ij-header"><div><span class="wfm-ij-kicker">IMPLEMENTATION IN PROGRESS</span><h1>Your implementation</h1><p>One place to see what is happening, what has been proven and what needs you.</p></div><span class="wfm-ij-status '+(state==='READY'?'ready':state==='AT_RISK'||state==='SLA_MISSED'?'blocked':'working')+'">'+safe(stateLabel(state))+'</span></header>'+
    scopeMarkup()+
    '<section class="wfm-ij-overall"><div class="wfm-ij-overall-top"><div><b>Overall progress</b><span>'+progress+'% · '+Number(S.status?.completedRequirements||0)+' of '+Number(S.status?.totalRequirements||(S.status?.requirements||[]).length)+' controls proven</span></div><strong>'+progress+'%</strong></div><div class="wfm-ij-progress"><span style="width:'+progress+'%"></span></div><div class="wfm-ij-stagebar">'+stageMarkup()+'</div></section>'+
    decisionsMarkup()+
    integrationAccessMarkup()+
    sourceFallbackMarkup()+
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
    '<section class="wfm-ij-panel wfm-ij-golive"><div><span class="wfm-ij-kicker">GO LIVE</span><h2>'+(S.status?.operationalReady?'Everything required for launch is proven':'Go live remains protected')+'</h2><p>'+(S.status?.operationalReady?'All implementation controls and training gates are complete. Review the final readiness evidence before activation.':'The launch control stays locked until environment, integrations, scenario testing, cleanup, live import and role competence are all proven.')+'</p></div><button type="button" class="btn primary" data-ij-route="readiness" '+(S.status?.operationalReady?'':'disabled')+'>'+(S.status?.operationalReady?'Review go-live readiness':'Not ready yet')+'</button></section>'+
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
async function acceptDecision(key,button){
  if(!S.status?.runId||!key)return;
  if(button){button.disabled=true;button.textContent='Confirming…';}
  try{
    S.status=await request(IMPL+'/decision',{method:'POST',body:JSON.stringify({
      runId:S.status.runId,
      key,
      action:'ACCEPTED',
      detail:{source:'implementation-dashboard'}
    })});
    renderView();
  }catch(error){
    S.error=error.message||'The decision could not be recorded.';
    renderView();
  }
}
async function changeDecision(key,button){
  if(!S.status?.runId||!key)return;
  const decision=(S.status?.blockingDecisions||[]).find(item=>item.key===key);
  const answer=window.prompt(
    decision?.question
      ? decision.question+'\n\nTell VECTOR what is different. It will remain blocked until the changed rule is tested and reconciled.'
      : 'Tell VECTOR what is different. The changed rule will remain blocked until it is tested and reconciled.'
  );
  if(answer==null||!String(answer).trim())return;
  if(button){button.disabled=true;button.textContent='Recording…';}
  try{
    S.status=await request(IMPL+'/decision',{method:'POST',body:JSON.stringify({
      runId:S.status.runId,
      key,
      action:'CHANGED',
      value:{customerAnswer:String(answer).trim().slice(0,2000),source:'implementation-dashboard'}
    })});
    renderView();
  }catch(error){
    S.error=error.message||'The changed policy could not be recorded.';
    renderView();
  }
}
async function prepareIntegration(candidateId,button){
  if(!candidateId)return;
  if(button){button.disabled=true;button.textContent='Preparing…';}
  try{
    await request(INTEGRATIONS+'/connect',{method:'POST',body:JSON.stringify({candidateId})});
    await load(true);
  }catch(error){
    S.error=error.message||'The secure connection could not be prepared.';
    renderView();
  }
}
async function saveSourceAnswer(form){
  const button=form.querySelector('button[type="submit"]');
  if(button){button.disabled=true;button.textContent='Saving…';}
  const data=new FormData(form);
  const payload={
    domain:String(data.get('domain')||'').trim(),
    systemName:String(data.get('systemName')||'').trim(),
    accessState:String(data.get('accessState')||'UNKNOWN').trim(),
    ownerHint:String(data.get('ownerHint')||'').trim()
  };
  try{
    await request(INTEGRATIONS+'/source-answer',{method:'POST',body:JSON.stringify(payload)});
    await load(true);
  }catch(error){
    S.error=error.message||'The source-system answer could not be saved.';
    renderView();
  }
}
function apply(){
  if(currentPage()!=='onboarding'||isEmployeeRole()){stop();return;}
  const nav=document.querySelector('.sidebar .navbtn[data-page="onboarding"] span:not(.count):not(.review-count)');
  if(nav)nav.textContent='Implementation';
  const content=document.querySelector('.content');if(!content)return;
  if(content.dataset.wfmImplementationJourney!==VERSION){S.status=null;S.error='';renderView();load(true);}
  else if(!S.loading&&!S.timer)schedule();
}
document.addEventListener('submit',event=>{
  const sourceForm=event.target.closest('[data-ij-source-form]');
  if(sourceForm){event.preventDefault();saveSourceAnswer(sourceForm);return;}
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
  const change=event.target.closest('[data-ij-decision-change]');if(change){event.preventDefault();changeDecision(change.dataset.ijDecisionChange,change);return;}
  const prepare=event.target.closest('[data-ij-access-prepare]');if(prepare){event.preventDefault();prepareIntegration(prepare.dataset.ijAccessPrepare,prepare);return;}
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
