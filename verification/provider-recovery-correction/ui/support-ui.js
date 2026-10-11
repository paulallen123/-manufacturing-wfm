/* Support extends the existing shell. Customer descriptions remain inert text. */
'use strict';
const SUPPORT={report:null,epoch:0};
function supportActorBinding(){
  const actor=F.ready&&F.actor;
  if(!actor||!actor.tenant||!actor.email)return null;
  return JSON.stringify([actor.tenant,actor.email,actor.personId||actor.id||null,actor.role||null,Array.isArray(actor.permissions)?[...actor.permissions].sort():null]);
}
function supportDate(t){return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(t));}
function supportCards(rows){return rows.map(x=>`<article class="sch-card"><h3>${esc(x.area)} · ${esc(x.symptom)}</h3><p style="white-space:pre-wrap">${esc(x.description)}</p>${(x.notes||[]).map(n=>`<p style="white-space:pre-wrap"><b>Additional detail:</b> ${esc(n.note)}</p>`).join('')}<p>Received ${esc(supportDate(x.created_at))} · Report ${esc(x.id)} · Awaiting investigation</p></article>`).join('')||'<p>No reports recorded.</p>';}
// Capabilities are advisory display data, never execution authority. Older or stale
// reports stay blocked; only the authenticated API can authorize a recovery.
function supportCapability(service){
  if(!service||!Number.isFinite(service.lastScan)||service.collection!=='running'||Date.now()-service.lastScan>120000||service.lastScan>Date.now()+30000)return 'unknown';
  return service.repairWorker==='bounded-provider-recovery'&&service.recoveryMode==='explicit-authority-only'&&service.automaticRepairs===false?'connected':'disconnected';
}
function supportRecoveryLabel(incident,capability){
  if(capability==='unknown')return 'Recovery status unavailable — refresh to verify';
  if(capability!=='connected')return 'Recovery is not connected';
  const recovery=incident.recovery;
  if(!recovery)return 'Manual investigation required';
  switch(recovery.state){
    case 'awaiting-permit':return 'Waiting for authorized action';
    case 'awaiting-verification':return 'Waiting for independent verification';
    case 'blocked-no-authority':return 'Recovery blocked: authority unavailable';
    case 'executing':return 'Authorized recovery executing';
    case 'verifying-recovery':return 'Recovery outcome awaiting verification';
    case 'recovered-internal':return recovery.verified===true?'Recovery verified internally — provider acceptance and customer resolution not established':'Recovery outcome awaiting verification';
    case 'contained':return 'Recovery failed or contained — review required';
    default:return 'Manual investigation required';
  }
}
function supportPage(){const r=SUPPORT.report,service=r.service||{},capability=supportCapability(service);return heading('Help and issues.','Report a problem and track its acknowledgement.',r.enabled?button('Report a problem','support-new','primary'):'')+`<p class="sch-callout">${esc(r.notice)}</p><section class="sch-panel"><h2>Your reports</h2><p>Showing ${r.cases.length} of ${r.caseCount} reports. Support collection: ${esc(service.collection||'unknown')}.</p>${supportCards(r.cases)}</section>${r.canReview===true?`<section class="sch-panel"><h2>Service diagnostics</h2><p>Last scan: ${service.lastScan?esc(supportDate(service.lastScan)):'No scan recorded'}. ${capability==='connected'?'Bounded recovery is connected; each action requires explicit authorization.':capability==='disconnected'?'Recovery is not connected.':'Recovery status unavailable — refresh to verify.'} Automatic repairs are not enabled. External support delivery: ${service.externalDelivery==='not-connected'?'not connected':'status unavailable'}. </p><p>Monitoring covers authenticated application requests while this local server is running. Missing observations do not mean the service is healthy.</p>${r.detectors.map(d=>`<article class="sch-card"><b>${esc(d.area)}</b><p>${esc(d.status)} · Last hour: ${d.long.requests} requests, ${d.long.errors} server errors, ${d.long.slow} slow responses.</p></article>`).join('')}</section><section class="sch-panel"><h2>Investigation queue</h2><p>Showing ${r.incidents.length} of ${r.incidentCount} findings. Similar reports are grouped for investigation; they are not automatically confirmed as the same bug.</p>${r.incidents.map(x=>`<article class="sch-card"><b>${esc(x.area)} · ${esc(x.code)}</b><p>${esc(x.severity)} · ${esc(supportRecoveryLabel(x,capability))}</p><p>Last observed ${esc(supportDate(x.last_seen))}</p></article>`).join('')||'<p>No findings recorded.</p>'}</section><section class="sch-panel"><h2>Customer reports for review</h2><p>Showing ${r.reports.length} of ${r.reportCount} reports. Descriptions are customer statements requiring verification.</p>${supportCards(r.reports)}</section>`:''}`;}
const supportOldShell=shell;
shell=function(content){return supportOldShell(content).replace('</nav>',`<button class="navbtn ${ui.page==='support'?'active':''}" data-act="nav" data-page="support">${icon('activity')}<span>Help and issues</span></button></nav>`);};
const supportOldRender=render;
render=async function(){const epoch=++SUPPORT.epoch,owner=supportActorBinding();SUPPORT.report=null;if(!F.ready)return;if(ui.page!=='support')return supportOldRender();
  if(!owner){document.getElementById('root').innerHTML=shell(heading('Help and issues.','Sign in to load current support status.'));return;}
  if(OFFLINE){document.getElementById('root').innerHTML=shell(heading('Help and issues.','Sign in to the running application to submit and track reports.'));return;}
  document.getElementById('root').innerHTML=shell(heading('Help and issues.','Loading current support status…'));
  try{const report=await request('/api/support');if(epoch!==SUPPORT.epoch||ui.page!=='support'||owner!==supportActorBinding())return;SUPPORT.report=report;document.getElementById('root').innerHTML=shell(supportPage());document.title='Workforce · Help and issues';}
  catch(e){if(epoch!==SUPPORT.epoch||ui.page!=='support'||owner!==supportActorBinding())return;SUPPORT.report=null;if(e.status===401)return showLogin();document.getElementById('root').innerHTML=shell(heading('Support could not be loaded.','Refresh to try again.')+`<p role="alert">${esc(e.message)}</p>`);}
};
function supportNew(){const requestKey=crypto.randomUUID();let submitted=false;modal('Report a problem',`<p>Describe what you tried, what you expected, and what happened. Do not include passwords, access tokens, bank details or sensitive employee information. Your report is visible to your company super user.</p><label>Area<select name="area">${['application','schedule','availability','attendance','payroll','people','resources'].map(x=>`<option>${x}</option>`).join('')}</select></label><label>Problem<select name="symptom">${['error','slow','incorrect-result','missing-data','how-to'].map(x=>`<option>${x}</option>`).join('')}</select></label><label>What happened?<textarea name="description" required minlength="20" maxlength="2000" rows="5"></textarea></label>${modalActions('Submit report')}`,async f=>{if(submitted)return;const r=await request('/api/support/cases','POST',{requestKey,area:String(f.get('area')),symptom:String(f.get('symptom')),description:String(f.get('description'))});submitted=true;toast('Report received: '+r.id+'. Awaiting investigation.');await render();});}
document.addEventListener('click',e=>{if(e.target.closest('[data-act="support-new"]'))supportNew();});
