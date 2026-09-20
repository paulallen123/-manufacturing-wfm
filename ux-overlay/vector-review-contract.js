/* Vector review contract.
 * Keeps the existing authenticated payroll-control service reachable after the retired
 * review presentation is removed. Server responses remain authoritative for blockers,
 * revisions, signability, permissions and persisted outcomes.
 */
'use strict';

var PR=WFMPayroll;
var RF={period:'2026-09-07',team:'',report:null,company:null,recoveryActuals:[],financeAttribution:[],epoch:0,employeeOffset:0,employeeLimit:50};

identities.payroll_admin={id:'pay1',name:'Rachel Cooper',title:'Payroll administrator',costs:true,permissions:['payroll.view','payroll.export','payroll.reopen','payroll.remind']};
identities.payrollviewer={id:'pay2',name:'Jamie Taylor',title:'Payroll reviewer · read only',costs:false,permissions:['payroll.view']};
identities.admin={id:'admin1',name:'Chris Walker',title:'IT administrator · no payroll access',costs:false,permissions:[]};

function payrollActor(){
  if(!OFFLINE)return F.actor;
  var actor=sampleActor();
  return {...actor,role:ui.role==='payrollviewer'?'payroll_admin':actor.role,permissions:me().permissions||[]};
}

function vectorReviewManager(actor){return actor&&['manager','director','supervisor'].includes(actor.role);}
function currentTeam(){return RF.report?.teams.find(team=>team.id===RF.team)||RF.report?.teams[0]||null;}
function reviewPayload(extra){var team=currentTeam();if(!team)throw Error('No authorised review team is available.');return {period:RF.period,team:team.id,revision:team.revision,...(extra||{})};}

async function payrollReport(){
  var actor=payrollActor();
  if(OFFLINE)PR.decorate(data);
  if(PR.has(actor,'payroll.view'))RF.company=OFFLINE?PR.payrollDashboard(data,actor,RF.period):await request('/api/payroll-run?period='+encodeURIComponent(RF.period));
  else RF.company=null;
  if(vectorReviewManager(actor)){
    RF.report=OFFLINE?PR.reviewDashboard(data,actor,RF.period):await request('/api/weekly-review?period='+encodeURIComponent(RF.period));
    if(!RF.report.teams.some(team=>team.id===RF.team))RF.team=RF.report.teams[0]?.id||'';
  }else RF.report=null;
}

function vectorReviewStatus(team){return `<span class="pill ${team.status==='signed'?'':'amber'}">${esc(String(team.status||'unknown').replaceAll('_',' '))}</span>`;}
function vectorReviewMinutes(value){return Number.isFinite(Number(value))?(Math.round(Number(value)/6)/10).toLocaleString()+' h':'—';}
function vectorReviewPage(){
  var team=currentTeam();
  if(!team)return heading('Weekly review','No review team is assigned to this authenticated account.')+'<section class="vector-review-panel"><p>Ask an authorised administrator to configure a review owner. No payroll approval was inferred.</p></section>';
  var closed=['signed','stale'].includes(team.status),from=RF.employeeOffset,to=Math.min(team.employees.length,from+RF.employeeLimit),employees=team.employees.slice(from,to);
  var blockers=team.blockers||[],categories=team.categories||[];
  return heading('Weekly review','Check source evidence, every category and every employee before signing. The server decides whether sign-off is allowed.',vectorReviewStatus(team))+
  `<section class="vector-review-summary" data-vector-review-contract="v1"><div><small>Team</small><strong>${esc(team.name)}</strong><span>${esc(team.site||'Current site')}</span></div><div><small>Worked</small><strong>${esc(vectorReviewMinutes(team.workedMinutes))}</strong><span>Recorded evidence</span></div><div><small>Employees checked</small><strong>${esc(team.checkedEmployees)} / ${esc(team.employees.length)}</strong><span>Explicit confirmations</span></div><div><small>Open blockers</small><strong>${esc(blockers.length)}</strong><span>${blockers.length?'Resolve before sign-off':'Evidence clear'}</span></div></section>`+
  `<section class="vector-review-panel"><div class="vector-review-head"><div><h2>Evidence status</h2><p>Original clock events are retained. Missing or disputed evidence moves to the dedicated time or correction workflow.</p></div><select id="vector-review-team" aria-label="Review team">${RF.report.teams.map(row=>`<option value="${esc(row.id)}" ${row.id===team.id?'selected':''}>${esc(row.name)} · ${esc(row.status)}</option>`).join('')}</select></div>${blockers.length?`<div class="vector-review-blockers">${blockers.slice(0,50).map(item=>`<article><b>${esc(item.category||'evidence')}</b><span>${esc(item.message)}</span></article>`).join('')}${blockers.length>50?`<p>${esc(blockers.length-50)} more blockers remain in the authoritative report.</p>`:''}<div class="actions">${button('Open time review','nav','primary','data-page="time-review"')}${button('Open attendance corrections','nav','','data-page="corrections"')}</div></div>`:'<p class="vector-review-clear">Evidence checks are clear for this revision.</p>'}</section>`+
  `<section class="vector-review-panel"><div class="vector-review-head"><div><h2>Five review categories</h2><p>Each confirmation is a separate audited server action.</p></div><span>${categories.filter(row=>row.confirmed).length} / ${categories.length}</span></div><div class="vector-review-list">${categories.map(row=>`<article><div><b>${esc(row.name)}</b><span>${esc(row.description||'')}</span></div>${row.confirmed?'<span class="pill">Checked</span>':button(row.open?'Resolve '+row.open+' issue'+(row.open===1?'':'s'):'Check category','vector-review-category','small primary',`data-category="${esc(row.id)}" ${closed||row.open?'disabled':''}`)}</article>`).join('')}</div></section>`+
  `<section class="vector-review-panel"><div class="vector-review-head"><div><h2>Every employee total</h2><p>Showing ${team.employees.length?from+1:0}–${to} of ${team.employees.length}. No bulk approval.</p></div><div class="actions">${button('Previous','vector-review-page','small',`data-offset="${Math.max(0,from-RF.employeeLimit)}" ${from===0?'disabled':''}`)}${button('Next','vector-review-page','small',`data-offset="${to}" ${to>=team.employees.length?'disabled':''}`)}</div></div><div class="vector-review-list">${employees.map(row=>`<article><div><b>${esc(row.name)}</b><span>${esc(vectorReviewMinutes(row.workedMinutes))} worked · ${esc(vectorReviewMinutes(row.overtimeMinutes))} overtime · ${esc(vectorReviewMinutes(row.holidayMinutes))} holiday</span></div>${row.checked?'<span class="pill">Checked</span>':button('Check total','vector-review-employee','small primary',`data-employee="${esc(row.id)}" ${closed||blockers.length?'disabled':''}`)}</article>`).join('')}</div></section>`+
  `<section class="vector-review-sign"><div><h2>${team.status==='signed'?'Signed and protected':team.canSign?'Ready for manager sign-off':'Finish the evidence checks'}</h2><p>${team.signature?'Signed by '+esc(team.signature.by)+' at '+esc(team.signature.at):'The server rechecks scope, source revision, blockers, employee totals and independent approval.'}</p></div>${team.status==='signed'?vectorReviewStatus(team):button('Sign reviewed week','vector-review-sign','primary',team.canSign?'':'disabled')}</section>`;
}

function payrollPageV4(){
  var run=RF.company;
  if(!run)return heading('Payroll readiness','Explicit payroll permission is required.')+'<section class="vector-review-panel"><p>This role cannot read or release payroll data.</p></section>';
  return heading('Payroll readiness','Reconciled weekly evidence. Release remains a separate permissioned server action.')+
  `<section class="vector-review-summary"><div><small>Employees</small><strong>${esc(run.totals?.employees??'—')}</strong><span>Complete frozen roster</span></div><div><small>Worked</small><strong>${esc(vectorReviewMinutes(run.totals?.workedMinutes))}</strong><span>Reviewed actuals</span></div><div><small>Blockers</small><strong>${esc((run.blockers||[]).length)}</strong><span>${run.canRelease?'Release checks clear':'Release held'}</span></div><div><small>Export batches</small><strong>${esc((run.batches||[]).length)}</strong><span>Immutable history</span></div></section>`+
  `<section class="vector-review-panel"><div class="vector-review-head"><div><h2>Reconciliation and release</h2><p>${esc(run.exportNote||'Review the provider mapping before any hand-off.')}</p></div></div>${(run.blockers||[]).length?`<div class="vector-review-blockers">${run.blockers.map(item=>`<article><span>${esc(item)}</span></article>`).join('')}</div>`:'<p class="vector-review-clear">All manager sign-offs and deterministic reconciliation checks are clear.</p>'}<div class="actions">${button('Open weekly review','nav','','data-page="weekly-review"')}${run.canRelease&&PR.has(payrollActor(),'payroll.export')?button('Review release controls','vector-payroll-release','primary'):''}</div></section>`+
  `<section class="vector-review-panel"><h2>Release history</h2>${(run.batches||[]).length?`<div class="vector-review-list">${run.batches.map(batch=>`<article><div><b>${esc(batch.id)}</b><span>${esc(batch.status)} · ${esc(batch.filename||'reviewed export')} · ${esc(batch.checksum?'SHA-256 '+batch.checksum:'checksum pending')}</span></div></article>`).join('')}</div>`:'<p>No payroll file has been released for this period.</p>'}</section>`;
}

function payrollShell(content){return shell(content);}
function issueDialog(){toast('Open Attendance corrections to review the linked evidence. No change was made.');nav('corrections');}
function amendDialog(){toast('Open Attendance corrections to propose a verified change with independent approval.');nav('corrections');}

var vectorReviewPreviousRender=render;
render=async function(){
  if(!F.ready)return;
  if(!['weekly-review','payroll-run'].includes(ui.page))return vectorReviewPreviousRender();
  var epoch=++RF.epoch,actor=payrollActor();
  try{
    await payrollReport();
    if(epoch!==RF.epoch)return;
    if(ui.page==='weekly-review'&&!vectorReviewManager(actor)){ui.page='overview';return vectorReviewPreviousRender();}
    document.getElementById('root').innerHTML=shell(ui.page==='weekly-review'?vectorReviewPage():payrollPageV4());
    document.title='Vector · '+(ui.page==='weekly-review'?'Weekly review':'Payroll readiness');
  }catch(error){
    if(error.status===401)return showLogin();
    document.getElementById('root').innerHTML=shell(heading('Review needs attention.',error.message));
  }
};

document.addEventListener('change',event=>{if(event.target.id==='vector-review-team'){RF.team=event.target.value;RF.employeeOffset=0;render();}});
document.addEventListener('click',async event=>{
  var target=event.target.closest('[data-act]');if(!target||!String(target.dataset.act||'').startsWith('vector-'))return;
  try{
    target.disabled=true;
    if(target.dataset.act==='vector-review-page'){RF.employeeOffset=Math.max(0,Number(target.dataset.offset)||0);await render();return;}
    if(target.dataset.act==='vector-review-category')await command('review-check',reviewPayload({category:target.dataset.category,checked:true}));
    if(target.dataset.act==='vector-review-employee')await command('review-check',reviewPayload({employee:target.dataset.employee,checked:true}));
    if(target.dataset.act==='vector-review-sign')await command('review-sign',reviewPayload({checked:true,attestation:'confirmed'}));
    if(target.dataset.act==='vector-payroll-release')return modal('Release reviewed payroll file',`<p>This creates one immutable generic payroll CSV. It does not pay employees or prove provider import.</p><label><input type="checkbox" name="checked" required>I checked the complete roster, manager signatures and control totals.</label><label><input type="checkbox" name="schemaReviewed" required>I checked downstream pay-code, rate, rounding and absence mappings.</label>${String(RF.company?.schema||'').includes('time-review')?'<label><input type="checkbox" name="timeReviewMappingReviewed" required>I checked the time-review pay-code mapping.</label>':''}${modalActions('Release locked CSV')}`,async form=>{await command('payroll-release',{period:RF.period,checked:form.get('checked')==='on',schemaReviewed:form.get('schemaReviewed')==='on',timeReviewMappingReviewed:form.get('timeReviewMappingReviewed')==='on'});toast('Reviewed payroll file released. Provider import is not implied.');});
    await payrollReport();await render();
  }catch(error){toast(error.message);await render();}finally{target.disabled=false;}
},true);

window.VectorReviewContract={version:'vector-review-contract-v1',state:RF,actor:payrollActor,refresh:payrollReport,currentTeam};
