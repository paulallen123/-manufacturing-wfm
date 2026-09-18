;(function(){
'use strict';

const IMPL='/api/implementation/autonomous';
const INTEGRATIONS='/api/integrations/autonomous';
const LEARNING='/api/learning/adaptive';
const VERSION='version-d-1';
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
  if(live.length)return live.map(x=>({id:x.id,name:x.name||x.productKey,state:x.state,detail:x.failureClass||x.lastReconciliation?.status||'',sourceId:x.id}));
  return (S.integrations?.discovery?.candidates||[]).map(x=>({id:x.id,name:x.name||x.productKey,state:x.status==='CONFIRMED'?'READY_TO_CONNECT':'IDENTIFIED',detail:Math.round(Number(x.confidence||0)*100)+'% confidence',sourceId:x.id}));
}
function stateLabel(value){
  const map={complete:'Complete',progress:'In progress',pending:'Pending',ACTIVE:'Connected',VALIDATING:'Validating',DEGRADED:'Needs review',AUTHORIZATION_REQUIRED:'Authorisation needed',REAUTH_REQUIRED:'Reconnect',CONFIRMED:'Confirmed',IDENTIFIED:'Identified',READY_TO_CONNECT:'Ready to connect'};
  return map[value]||String(value||'Pending').replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase());
}
function stateIcon(value){return value==='complete'||value==='ACTIVE'?'✓':value==='progress'||value==='VALIDATING'?'●':'○';}
function stageMarkup(){
  const integrationStarted=(S.integrations?.connections?.length||0)>0||(S.integrations?.discovery?.candidateCount||0)>0;
  const stages=[
    ['Environment',['tenant-environment','identity-access','security-controls'],false],
    ['Integrations',['source-systems'],integrationStarted],
    ['Testing',['scenario-validation'],false],
    ['Clean up',['test-data-cleanup'],false],
    ['Data import',['live-data-import'],false],
    ['Go live',[],Boolean(S.status?.operationalReady)]
  ];
  return stages.map((stage,index)=>{
    const st=stage[0]==='Go live'?(S.status?.operationalReady?'complete':'pending'):groupState(stage[1],stage[2]);
    return '<div class="wfm-ij-stage '+st+'"><span class="wfm-ij-stage-dot">'+stateIcon(st)+'</span><div><b>'+safe(stage[0])+'</b><small>'+stateLabel(st)+'</small></div></div>'+(index<stages.length-1?'<span class="wfm-ij-stage-line"></span>':'');
  }).join('');
}
function integrationMarkup(){
  const rows=connectionRows();
  if(!rows.length)return '<div class="wfm-ij-empty"><b>No systems discovered yet.</b><span>System discovery and connection status will appear here automatically.</span></div>';
  return '<div class="wfm-ij-system-list">'+rows.slice(0,8).map(row=>
    '<div class="wfm-ij-system"><div class="wfm-ij-system-name"><span class="wfm-ij-system-glyph">↔</span><div><b>'+safe(row.name)+'</b><small>'+safe(row.detail||'Connection evidence')+'</small></div></div><span class="wfm-ij-pill '+safe(String(row.state||'').toLowerCase())+'">'+safe(stateLabel(row.state))+'</span></div>'
  ).join('')+'</div>';
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
function decisionsMarkup(){
  const rows=S.status?.blockingDecisions||[];
  if(!rows.length)return '';
  return '<section class="wfm-ij-panel wfm-ij-decisions"><div class="wfm-ij-panel-head"><div><span class="wfm-ij-kicker">YOUR DECISION</span><h2>'+rows.length+' item'+(rows.length===1?'':'s')+' need confirmation</h2></div></div><div class="wfm-ij-decision-list">'+rows.map(d=>
    '<article><div><b>'+safe(d.question)+'</b><small>'+safe(d.risk)+' risk · '+safe(d.status)+'</small></div><button class="btn small primary" type="button" data-ij-decision="'+safe(d.key)+'">Review</button></article>'
  ).join('')+'</div></section>';
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
function apply(){
  if(currentPage()!=='onboarding'||isEmployeeRole()){stop();return;}
  const nav=document.querySelector('.sidebar .navbtn[data-page="onboarding"] span:not(.count):not(.review-count)');
  if(nav)nav.textContent='Implementation';
  const content=document.querySelector('.content');if(!content)return;
  if(content.dataset.wfmImplementationJourney!==VERSION){S.status=null;S.error='';renderView();load(true);}
  else if(!S.loading&&!S.timer)schedule();
}
document.addEventListener('click',event=>{
  const startButton=event.target.closest('[data-ij-start]');if(startButton){event.preventDefault();start();return;}
  const refresh=event.target.closest('[data-ij-refresh]');if(refresh){event.preventDefault();S.error='';load(true);return;}
  const route=event.target.closest('[data-ij-route]');if(route){event.preventDefault();openRoute(route.dataset.ijRoute);return;}
  const training=event.target.closest('[data-ij-training]');if(training){event.preventDefault();document.querySelector('.wfm-coach-trigger')?.click();return;}
  const decision=event.target.closest('[data-ij-decision]');if(decision){event.preventDefault();openRoute('onboarding');return;}
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