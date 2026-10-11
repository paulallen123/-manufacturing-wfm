/* Vector Workforce Operations shell — exact approved visual direction.
 * Presentation only: existing WFM routes, permissions, APIs and audit controls remain authoritative.
 */
(function(){
'use strict';

const MARKER='VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1';
const REVIEW_MARKER='VECTOR_REVIEW_NEUTRAL_V1';
const PLANNING_MARKER='VECTOR_PLANNING_NEUTRAL_V1';
const KPI_MARKER='VECTOR_KPI_EVIDENCE_V1';
const VALUE_MARKER='VECTOR_VERIFIED_VALUE_V1';
const IDENTITY_MARKER='VECTOR_IDENTITY_SOURCE_BOUND_V1';
const LEAVE_MARKER='VECTOR_LEAVE_SOURCE_BOUND_V1';
const ACTION_MARKER='VECTOR_ACTION_SOURCE_BOUND_V1';
const ACTION_EVIDENCE_CONTRACT='WFM_WORKFLOW_ACTION_EVIDENCE_V1';
const TIME_REVIEW_EVIDENCE_PATH='/api/workforce/lifecycle/action-evidence/time-review';
const ACTION_CONTEXT_KEY='VECTOR_ACTION_RETURN_CONTEXT_V1';
const NAV=[
 {label:'Today',icon:'home',routes:['overview'],tabs:[['overview','Today']]},
 {label:'People',icon:'people',routes:['vector-people','personal','attendance','leave','availability-control','availability','temporary'],tabs:[['vector-people','Overview'],['attendance','Attendance'],['leave','Absence & leave'],['availability-control','Availability'],['temporary','Agency']]},
 {label:'Plan',icon:'calendar',routes:['schedule-publication','shifts','work-patterns','demand','cover','offers'],tabs:[['schedule-publication','Shift plan'],['shifts','My shifts'],['work-patterns','Shift patterns'],['demand','Demand'],['cover','Available cover']]},
 {label:'Factory',icon:'planning',routes:['readiness','op-sites','shutdowns','forecast'],tabs:[['readiness','Live factory'],['op-sites','Site performance'],['forecast','What if?'],['shutdowns','Shutdowns']]},
 {label:'Improve',icon:'report',routes:['insights','costs','recommendations','benchmarks','compliance','overtime-watch','reports'],tabs:[['insights','Performance'],['costs','Cost & productivity'],['recommendations','Opportunities'],['benchmarks','Benchmarks'],['compliance','Compliance'],['reports','Reports']]}
];
const DESIGN_ID='VECTOR_FIVE_SECTION_2026_09_19';
let navigationEpoch=0,historyReady=false;
const RETIRED_ROUTE_REDIRECTS=Object.freeze({'weekly-review':'attendance','time-review':'attendance','savings-decisions':'costs'});
const state={queued:false,evidenceEpoch:0,readinessEpoch:0,calendarEpoch:0,employeeHomeEpoch:0,timeReviewEvidence:{status:'idle',items:[],owner:''},readinessEvidence:{status:'idle',departments:[],summary:null,asOf:null,limitations:[]},calendar:{status:'idle',value:null},employeeHome:{status:'idle',owner:'',value:null,error:''},returnFocus:false,settingsOpen:false};
const observerConfig={subtree:true,childList:true};
let shellObserver=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=n=>(n?.textContent||'').replace(/\s+/g,' ').trim();
const page=()=>{try{return String(ui?.page||'overview')}catch{return 'overview'}};
const vectorHomeRequested=()=>{try{return new URL(window.location.href).searchParams.get('vector_home')==='1';}catch{return false;}};
const clearVectorHomeRequest=()=>{try{const u=new URL(window.location.href);if(!u.searchParams.has('vector_home'))return;u.searchParams.delete('vector_home');history.replaceState({},'',u.pathname+(u.search?'?'+u.searchParams.toString():'')+u.hash);}catch{}};

const employee=()=>{try{return typeof isEmployee==='function'&&isEmployee()}catch{return false}};
const sourceButtons=()=>[...document.querySelectorAll('.app > .sidebar nav .navbtn[data-page], .sidebar:not(.vector-sidebar) nav .navbtn[data-page]')];

const GUSTO_API='/api/integrations/autonomous';
const GUSTO_HOSTS=Object.freeze({sandbox:'api.gusto-demo.com',production:'api.gusto.com'});
const GUSTO_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let gustoPanel=null,gustoEpoch=0;
function gustoIdentity(){
 try{
  const own=typeof me==='function'?me():null;
  if(!own||employee()||!available('integrations')||!(own.id||own.email))return null;
  const tenant=own.tenant??own.tenantId??(typeof data!=='undefined'?(data.tenant??data.tenantId):'');
  return JSON.stringify([String(own.id||''),String(own.email||''),String(tenant||''),String(own.role||''),String(typeof ui!=='undefined'?ui.root||'':'')]);
 }catch{return null;}
}
function invalidateGustoPanel(){
 gustoEpoch++;gustoPanel?.controller.abort();gustoPanel?.card.remove();gustoPanel=null;
}
function gustoCurrent(panel){
 return gustoPanel===panel&&panel.epoch===gustoEpoch&&page()==='integrations'&&gustoIdentity()===panel.identity&&panel.card.isConnected;
}
function gustoStale(panel){
 if(gustoPanel===panel)invalidateGustoPanel();
 const error=new Error('Connection context changed.');error.stale=true;return error;
}
async function gustoRequest(panel,path,body){
 if(!gustoCurrent(panel))throw gustoStale(panel);
 const response=await fetch(GUSTO_API+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
  headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:panel.controller.signal});
 if(!gustoCurrent(panel))throw gustoStale(panel);
 if(!response.ok){
  const error=new Error('Gusto request failed.');error.status=response.status;
  let failure;try{failure=await response.json();}catch{}
  if(!gustoCurrent(panel))throw gustoStale(panel);
  if(typeof failure?.code==='string'&&/^GUSTO_[A-Z_]{1,64}$/.test(failure.code))error.code=failure.code;
  throw error;
 }
 const result=await response.json();
 if(!gustoCurrent(panel))throw gustoStale(panel);
 return result;
}
function gustoConnection(value){
 if(!value||value.productKey!=='gusto'||typeof value.id!=='string')return null;
 const metadata=value.gusto;
 return {id:value.id,state:String(value.state||''),sourceInstanceId:String(value.sourceInstanceId||''),
  workforceImported:value.canonicalImport?.status==='PASS'?true:value.canonicalImport===null?false:null,gusto:metadata&&typeof metadata==='object'?{
  companyUuid:String(metadata.companyUuid||''),companyName:String(metadata.companyName||''),environment:String(metadata.environment||''),verifiedAt:String(metadata.verifiedAt||'')
 }:null};
}
function gustoSnapshot(panel,configuration,status){
 const expected=String(configuration?.expectedCompanyUuid||'').trim().toLowerCase();
 panel.configuration={configured:configuration?.configured===true&&Boolean(GUSTO_HOSTS[configuration.environment])&&(!expected||GUSTO_UUID.test(expected)),
  environment:String(configuration?.environment||''),expectedCompanyUuid:expected};
 panel.connection=(Array.isArray(status?.connections)?status.connections:[]).map(gustoConnection).find(Boolean)||null;
 panel.candidates=(Array.isArray(status?.discovery?.candidates)?status.discovery.candidates:[])
  .filter(row=>row.productKey==='gusto'&&typeof row.id==='string').map(row=>({id:row.id,status:String(row.status||'')}));
 panel.companyUuid=expected||panel.companyUuid||panel.connection?.gusto?.companyUuid||panel.connection?.sourceInstanceId||'';
 panel.loaded=true;panel.needsCheck=false;panel.error='';
}
async function readGustoSnapshot(panel){
 const [configuration,status]=await Promise.all([gustoRequest(panel,'/gusto/configuration'),gustoRequest(panel,'/status')]);
 if(!gustoCurrent(panel))throw gustoStale(panel);
 gustoSnapshot(panel,configuration,status);
}
function renderGustoPanel(panel){
 if(!gustoCurrent(panel))return;
 const config=panel.configuration,connection=panel.connection,metadata=connection?.gusto;
 const configured=config?.configured===true,busy=Boolean(panel.busy);
 const verifiedAt=metadata?.verifiedAt?new Date(metadata.verifiedAt):null;
 const verified=Boolean(configured&&!panel.needsCheck&&metadata&&GUSTO_UUID.test(metadata.companyUuid)&&
  metadata.environment===config.environment&&(!config.expectedCompanyUuid||config.expectedCompanyUuid===metadata.companyUuid.toLowerCase())&&
  !['AUTHORIZATION_REQUIRED','REAUTH_REQUIRED'].includes(connection.state)&&verifiedAt&&Number.isFinite(verifiedAt.getTime()));
 let description=!panel.loaded?'Checking Gusto connection…':!config?'Gusto connection status is unavailable.':
  !configured?'VECTOR’s Gusto authorization needs to be configured by an administrator.':
  verified?'Company access verified':panel.needsCheck?'Gusto access needs to be checked.':'Authorize access to your Gusto company.';
 const heading=panel.loaded&&config&&!configured?'Gusto setup required':'Gusto';
 let details=verified?'<p><strong>'+esc(metadata.companyName||'Gusto company')+'</strong></p><p>'+esc(metadata.environment==='sandbox'?'Sandbox':'Production')+
  ' · Last checked <time datetime="'+esc(verifiedAt.toISOString())+'">'+esc(verifiedAt.toLocaleString())+'</time></p><p>This check verifies company access.</p>'+
  (connection.workforceImported===false?'<p>Workforce data has not been imported.</p>':''):'';
 if(configured&&!config.expectedCompanyUuid)details+='<label>Gusto company UUID <input type="text" data-vector-gusto-company value="'+esc(panel.companyUuid)+
  '" maxlength="36" autocomplete="off" spellcheck="false" '+(busy?'disabled':'')+'></label><p>Choose the company you want to connect to this workspace.</p>';
 else if(configured&&!verified)details+='<p>The Gusto company for this workspace is selected.</p>';
 const reconnect=Boolean(connection?.gusto||connection?.state==='REAUTH_REQUIRED'||panel.needsCheck);
 panel.card.setAttribute('aria-busy',String(busy));
 panel.card.innerHTML='<div class="vector-card-head"><div><h2>'+heading+'</h2><p aria-live="polite">'+esc(description)+'</p></div></div>'+
  '<div class="vector-empty">'+details+(panel.error?'<p role="alert">'+esc(panel.error)+'</p>':'')+'</div>'+
  '<div class="vector-card-head"><button type="button" class="btn primary" data-vector-gusto-connect '+(!configured||busy?'disabled':'')+'>'+
  (panel.busy==='authorize'?'Opening Gusto…':reconnect?'Reconnect Gusto':'Connect Gusto')+'</button>'+
  '<button type="button" class="btn" data-vector-gusto-refresh '+(busy?'disabled':'')+'>'+(panel.busy==='check'?'Checking…':'Check connection')+'</button></div>';
}
function gustoFailure(panel,error,action){
 if(!gustoCurrent(panel)||error?.stale||error?.name==='AbortError')return;
 panel.loaded=true;
 const providerFailure=typeof error?.code==='string'&&/^GUSTO_[A-Z_]{1,64}$/.test(error.code);
 if((error?.status===401||error?.status===403)&&!providerFailure){
  panel.configuration=null;panel.connection=null;panel.candidates=[];panel.companyUuid='';
  panel.error='Sign in with an administrator account to manage this connection.';
 }else{
  if(action==='verify'||providerFailure){
   panel.needsCheck=true;
   if(panel.connection)panel.connection.gusto=null;
  }
  panel.error=action==='authorize'?'Gusto authorization could not be started. Check the company selection and try again.':
   action==='verify'?'Gusto access could not be verified. Reconnect Gusto or check again.':'Gusto connection status could not be checked. Try again.';
 }
}
async function checkGustoPanel(panel,verify=false){
 if(!gustoCurrent(panel)||panel.busy)return;
 panel.busy='check';panel.error='';renderGustoPanel(panel);
 try{
  if(verify&&panel.configuration?.configured&&(panel.connection?.gusto||panel.connection?.sourceInstanceId)){
   const result=await gustoRequest(panel,'/gusto/verify',{connectionId:panel.connection.id});
   const connection=gustoConnection(result?.connection);
   if(!connection||connection.id!==panel.connection.id)throw new Error('Unexpected connection.');
   panel.connection=connection;panel.needsCheck=false;
  }else await readGustoSnapshot(panel);
 }catch(error){gustoFailure(panel,error,verify?'verify':'status');}
 finally{if(gustoCurrent(panel)){panel.busy='';renderGustoPanel(panel);}}
}
function syncGustoPanel(content){
 const identity=page()==='integrations'?gustoIdentity():null;
 if(!identity){if(gustoPanel)invalidateGustoPanel();return;}
 if(gustoPanel&&gustoPanel.identity===identity&&gustoPanel.card.parentElement===content)return;
 invalidateGustoPanel();
 const card=document.createElement('section');card.className='vector-card';card.dataset.vectorGustoCard='1';card.style.margin='0 0 16px';
 card.setAttribute('aria-label','Gusto connection');content.prepend(card);
 const panel={card,identity,epoch:gustoEpoch,controller:new AbortController(),configuration:null,connection:null,candidates:[],companyUuid:'',loaded:false,needsCheck:false,busy:'',error:''};
 gustoPanel=panel;renderGustoPanel(panel);void checkGustoPanel(panel);
}
async function authorizeGusto(panel){
 if(!gustoCurrent(panel)||panel.busy||!panel.configuration?.configured)return;
 const input=panel.card.querySelector('[data-vector-gusto-company]');
 const selected=String(panel.configuration.expectedCompanyUuid||input?.value||panel.companyUuid||'').trim().toLowerCase();
 if(!GUSTO_UUID.test(selected)){panel.error='Enter the Gusto company UUID you want to connect.';renderGustoPanel(panel);return;}
 panel.companyUuid=selected;panel.busy='authorize';panel.error='';renderGustoPanel(panel);
 let navigating=false;
 try{
  await readGustoSnapshot(panel);
  if(!panel.configuration.configured)return;
  const expected=panel.configuration.expectedCompanyUuid||selected;
  if(expected!==selected){panel.error='The selected company changed. Review the connection and try again.';return;}
  let connection=panel.connection;
  if(!connection){
   let candidate=panel.candidates[0];
   if(!candidate){
    await gustoRequest(panel,'/discover',{source:'USER',apps:[{productKey:'gusto',name:'Gusto'}]});
    const status=await gustoRequest(panel,'/status');
    gustoSnapshot(panel,panel.configuration,status);
    connection=panel.connection;candidate=panel.candidates[0];
   }
   if(!connection){
    if(!candidate)throw new Error('Gusto candidate unavailable.');
    if(candidate.status!=='CONFIRMED')await gustoRequest(panel,'/confirm',{candidateId:candidate.id,authoritativeFor:['people','payroll']});
    const result=await gustoRequest(panel,'/connect',{candidateId:candidate.id,authMethod:'oauth2'});
    connection=gustoConnection(result?.connection);
    if(!connection)throw new Error('Gusto connection unavailable.');
    panel.connection=connection;
   }
  }
  const result=await gustoRequest(panel,'/gusto/authorize',{connectionId:connection.id,expectedCompanyUuid:expected});
  const url=new URL(result.authorizationUrl),host=GUSTO_HOSTS[result.environment];
  if(!host||result.environment!==panel.configuration.environment||url.origin!=='https://'+host||url.username||url.password||url.hash||url.pathname!=='/oauth/authorize')throw new Error('Invalid Gusto authorization URL.');
  if(!gustoCurrent(panel))throw gustoStale(panel);
  window.location.assign(url.href);navigating=true;
 }catch(error){gustoFailure(panel,error,'authorize');}
 finally{if(gustoCurrent(panel)&&!navigating){panel.busy='';renderGustoPanel(panel);}}
}
document.addEventListener('click',event=>{
 const connect=event.target.closest('[data-vector-gusto-connect]'),refresh=event.target.closest('[data-vector-gusto-refresh]');
 if(!connect&&!refresh)return;
 event.preventDefault();
 const panel=gustoPanel;
 if(!panel||!gustoCurrent(panel)||(connect||refresh).closest('[data-vector-gusto-card]')!==panel.card)return;
 if(connect)void authorizeGusto(panel);else void checkGustoPanel(panel,true);
});
document.addEventListener('input',event=>{
 const input=event.target.closest('[data-vector-gusto-company]'),panel=gustoPanel;
 if(input&&panel&&gustoCurrent(panel)&&input.closest('[data-vector-gusto-card]')===panel.card)panel.companyUuid=input.value;
});
window.addEventListener('pagehide',invalidateGustoPanel);

let staffologyPanel=null,staffologyEpoch=0;
const STAFFOLOGY_PREFIX='/api/integrations/staffology';
function invalidateStaffologyPanel(){staffologyEpoch++;staffologyPanel?.controller.abort();staffologyPanel?.card.remove();staffologyPanel=null;}
function staffologyIdentity(){const actor=sourceIdentity();return `${actor.tenant||''}:${actor.email||actor.id||''}`;}
function staffologyCurrent(panel){return staffologyPanel===panel&&panel.epoch===staffologyEpoch&&panel.identity===staffologyIdentity()&&page()==='integrations'&&panel.card.isConnected;}
function staffologyMessage(panel,message,tone=''){panel.message=message;panel.tone=tone;renderStaffologyPanel(panel);}
function staffologyOptions(values,selected,label){return values.map(row=>{const value=typeof row==='string'?row:row.value,name=typeof row==='string'?row:row.label;return `<option value="${esc(value)}"${value===selected?' selected':''}>${esc(name||label)}</option>`;}).join('');}
function staffologyChoices(panel,operation){const state=panel.bootstrap?.state||{},staff=Array.isArray(state.staff)?state.staff:[],org=Array.isArray(state.org)?state.org:[],configured=operation?.mappingOptions||{},unique=values=>[...new Set(values.filter(value=>value!==undefined&&value!==null&&String(value).trim()).map(value=>String(value).trim()))].sort();return {managers:(configured.managers||org).filter(row=>row?.id&&row?.name).map(row=>({value:row.id,label:row.name})),sites:unique(configured.sites||staff.map(row=>row.site)),jobs:unique(configured.jobs||staff.map(row=>row.job)),contracts:unique(configured.contractTypes||[]),weeklyHours:unique(configured.weeklyHours||[])};}
function staffologyMappingRows(panel,cohort,operation){const choices=staffologyChoices(panel,operation);return (cohort.employeeIds||[]).map(externalId=>{const value=panel.mappingValues?.[externalId]||{},select=(name,values,label)=>values.length?`<select data-vector-staffology-field="${name}" required><option value="">Select ${label}</option>${staffologyOptions(values,value[name],label)}</select>`:`<input data-vector-staffology-field="${name}" value="${esc(value[name]||'')}" required autocomplete="off">`;return `<fieldset data-vector-staffology-mapping="${esc(externalId)}"><legend>Provider employee ${esc(externalId)}</legend><p class="muted">Source employee and payroll identities remain provider-held and cannot be edited here.</p><label>VECTOR email (if missing in Staffology)<input data-vector-staffology-field="email" type="email" maxlength="254" value="${esc(value.email||'')}" autocomplete="off"></label><p class="muted">A reviewed email fills a missing provider email only. Import does not verify identity or grant sign-in access.</p><label>Manager${select('managerId',choices.managers,'manager')}</label><label>Site${select('site',choices.sites,'site')}</label><label>Job${select('job',choices.jobs,'job')}</label><label>Contract${select('contractType',choices.contracts,'contract')}</label><label>Weekly contracted hours${choices.weeklyHours.length?`<select data-vector-staffology-field="weeklyHours" required><option value="">Select weekly hours</option>${staffologyOptions(choices.weeklyHours,String(value.weeklyHours??''),'weekly hours')}</select>`:`<input data-vector-staffology-field="weeklyHours" type="number" min="0" max="80" step="0.01" value="${esc(value.weeklyHours??'')}" required>`}</label></fieldset>`;}).join('');}
function renderStaffologyPanel(panel){
 const operation=panel.snapshot?.staffology?.operation||null,loading=!panel.snapshot,active=operation?.activationAvailable===true,binding=operation?.binding||{},cohort=operation?.cohort||{},payroll=operation?.payroll||{};
 const title=loading?'Loading Staffology status…':active?'Staffology operations':operation?.configured?'Staffology access restricted':'Staffology setup required';
 const detail=loading?'Reading the current authenticated operation scope.':active?`Bound to tenant ${esc(binding.tenant)}, employer ${esc(binding.employerId)}, source ${esc(binding.candidateSha)} and ${Number(cohort.count)||0} reviewed employees.`:operation?.configured?'The current account is not the exact authorised operator for this tenant.':'Operations are dormant until an exact server-held employer and employee cohort are configured.';
 const mappings=active&&!panel.staged?`<div class="vector-staffology-mappings">${staffologyMappingRows(panel,cohort,operation)}<label class="vector-staffology-review"><input type="checkbox" data-vector-staffology-reviewed${panel.reviewed?' checked':''}> I reviewed every email, manager, site, job, contract and weekly-hours mapping for this exact cohort.</label></div>`:'';
 const acquire=active&&!panel.staged?'<button class="btn primary" data-vector-staffology-acquire>Acquire and stage reviewed cohort</button>':'';
 const held=panel.heldReasons?.length?`<div class="vector-staffology-held" role="alert"><strong>Records held for review</strong><ul>${panel.heldReasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul><p>Correct the mapping and acquire again with a new reviewed request.</p><button class="btn" data-vector-staffology-restage>Review mappings again</button></div>`:'';
 const apply=panel.staged&&panel.staged.held===0?'<button class="btn primary" data-vector-staffology-apply>Apply eligible staged people batch</button>':'';
 const payrollButtons=active&&payroll.configured?'<button class="btn primary" data-vector-staffology-deliver>Approve and deliver exact released payroll</button><button class="btn" data-vector-staffology-readback>Fresh provider readback</button>':'<p class="muted">Payroll delivery remains dormant until an exact released-batch scope is server-held.</p>';
 const recovery=active&&payroll.configured?'<details><summary>Recover an uncertain delivery</summary><label>Delivery ID<input data-vector-staffology-delivery autocomplete="off"></label><button class="btn" data-vector-staffology-recover>Recover exact intent</button></details>':'';
 panel.card.innerHTML=`<div class="vector-section-heading"><div><p class="eyebrow">Payroll integration</p><h3>${title}</h3></div><button class="btn" data-vector-staffology-refresh>Refresh status</button></div><p>${detail}</p><p class="muted">Credentials stay on the server. Every write is current-account checked, exact-scope checked and audit recorded.</p>${mappings}${held}<div class="vector-staffology-actions">${acquire}${apply}${payrollButtons}</div>${recovery}<p class="vector-staffology-message ${esc(panel.tone)}" role="status">${esc(panel.message||'')}</p>`;
 panel.card.querySelectorAll('button').forEach(button=>button.disabled=!!panel.busy);
}
async function staffologyRequest(panel,path,body){if(!staffologyCurrent(panel))throw Error('STAFFOLOGY_PANEL_STALE');const options={credentials:'same-origin',cache:'no-store',signal:panel.controller.signal};if(body!==undefined){options.method='POST';options.headers={'content-type':'application/json'};options.body=JSON.stringify(body);}const response=await fetch(path,options),result=await response.json().catch(()=>({}));if(!response.ok){const error=Error(result.message||'Staffology operation was rejected.');error.status=response.status;throw error;}return result;}
async function refreshStaffology(panel){if(!staffologyCurrent(panel)||panel.busy)return;panel.busy='refresh';renderStaffologyPanel(panel);try{[panel.snapshot,panel.bootstrap]=await Promise.all([staffologyRequest(panel,'/api/integrations'),staffologyRequest(panel,'/api/bootstrap')]);staffologyMessage(panel,'Status refreshed. Review the exact cohort mappings before acquisition.','success');}catch{staffologyMessage(panel,'Status could not be read for this signed-in account.','error');}finally{if(staffologyCurrent(panel)){panel.busy='';renderStaffologyPanel(panel);}}}
function staffologyRecoveryOutcome(result){const status=String(result?.status||'unresolved'),success=status==='acknowledged'||status==='reconciled';if(success)return {tone:'success',message:`Recovery status: ${status}.`};const reasons={STAFFOLOGY_READBACK_UNRESOLVED:'Provider readback is not yet conclusive; the delivery remains held and was not blindly resent.',STAFFOLOGY_AUTH_REJECTED:'Provider authentication rejected the recorded dispatch; the delivery is rejected and will not be resent.',STAFFOLOGY_BASELINE_CHANGED:'Provider baseline changed; the delivery remains held for a fresh review.'};return {tone:'error',message:`Recovery status: ${status}. ${reasons[result?.code]||'The delivery remains held for review; no automatic resend was made.'}`};}
async function staffologyAction(panel,action){if(!staffologyCurrent(panel)||panel.busy)return;const operation=panel.snapshot?.staffology?.operation;if(operation?.activationAvailable!==true)return staffologyMessage(panel,'This account cannot activate Staffology operations.','error');if(action==='restage'){panel.staged=null;panel.heldReasons=[];panel.reviewed=false;panel.acquireIntent=null;return staffologyMessage(panel,'Review and correct the held mappings before acquiring again.','');}if(action==='acquire'){panel.mappingValues={};for(const row of panel.card.querySelectorAll('[data-vector-staffology-mapping]')){const externalId=row.dataset.vectorStaffologyMapping,value={externalId};for(const field of row.querySelectorAll('[data-vector-staffology-field]'))value[field.dataset.vectorStaffologyField]=field.dataset.vectorStaffologyField==='weeklyHours'?(field.value===''?Number.NaN:Number(field.value)):field.value;panel.mappingValues[externalId]=value;}panel.reviewed=panel.card.querySelector('[data-vector-staffology-reviewed]')?.checked===true;}if(action==='recover')panel.recovery={deliveryId:panel.card.querySelector('[data-vector-staffology-delivery]')?.value.trim()};panel.busy=action;panel.message='';renderStaffologyPanel(panel);try{
  if(action==='acquire'){if(!panel.reviewed)throw Error('Confirm that every workforce mapping was explicitly reviewed.');const mappings=operation.cohort.employeeIds.map(id=>panel.mappingValues[id]);if(mappings.some(row=>!row||!row.managerId||!row.site||!row.job||!row.contractType||!Number.isFinite(row.weeklyHours)||row.weeklyHours<0))throw Error('Complete every labelled cohort mapping before acquisition.');const fingerprint=JSON.stringify({employeeIds:operation.cohort.employeeIds,mappings,connectorId:operation.connector.id});if(panel.acquireIntent?.fingerprint!==fingerprint)panel.acquireIntent={fingerprint,idempotencyKey:crypto.randomUUID()};panel.staged=await staffologyRequest(panel,`${STAFFOLOGY_PREFIX}/employees/acquire-stage`,{reviewed:true,employeeIds:operation.cohort.employeeIds,mappings,connectorId:operation.connector.id,idempotencyKey:panel.acquireIntent.idempotencyKey});panel.heldReasons=[];const heldBatchId=panel.staged.lifecycleHold?.batchId||(panel.staged.held>0?panel.staged.id:null);if(heldBatchId){const detail=await staffologyRequest(panel,`/api/integrations/${encodeURIComponent(heldBatchId)}`);panel.heldReasons=(detail.records||[]).filter(row=>row.status==='held').map(row=>`${row.externalId}: ${row.reason||'Review required'}`);}const eligible=panel.staged.held===0;staffologyMessage(panel,panel.heldReasons.length&&eligible?`Eligible records are staged in batch ${panel.staged.id}; held lifecycle records will not be applied.`:panel.heldReasons.length?`Batch ${panel.staged.id} is held; no employee was applied.`:`Batch ${panel.staged.id} staged for reviewed application.`,panel.heldReasons.length&&!eligible?'error':'success');}
  if(action==='apply'){const bootstrap=await staffologyRequest(panel,'/api/bootstrap');const applied=await staffologyRequest(panel,'/api/integrations/apply',{version:bootstrap.state.version,id:panel.staged.id,reviewed:true});panel.staged=null;staffologyMessage(panel,`People batch applied as ${applied.outcome?.id||'a reviewed onboarding batch'}.`,'success');}
  if(action==='deliver'){const result=await staffologyRequest(panel,`${STAFFOLOGY_PREFIX}/payroll/approve-deliver`,{reviewed:true,approval:operation.payroll.approval});staffologyMessage(panel,`Delivery ${result.deliveryId} recorded with status ${result.receipt?'reconciled':'uncertain'}.`,result.receipt?'success':'error');}
  if(action==='readback'){const result=await staffologyRequest(panel,`${STAFFOLOGY_PREFIX}/payroll/readback`,{reviewed:true,approval:operation.payroll.approval});staffologyMessage(panel,`Fresh readback observed basic pay ${result.comparison?.observedBasicPay||'unavailable'}; expected ${result.comparison?.expectedBasicPay||'unavailable'}.`,'success');}
  if(action==='recover'){const {deliveryId}=panel.recovery||{};if(!deliveryId)throw Error('Enter the exact uncertain delivery ID.');const result=await staffologyRequest(panel,`${STAFFOLOGY_PREFIX}/payroll/recover`,{approval:operation.payroll.approval,deliveryId}),outcome=staffologyRecoveryOutcome(result);staffologyMessage(panel,outcome.message,outcome.tone);}
 }catch(error){staffologyMessage(panel,error.message||'Staffology operation failed.','error');}finally{if(staffologyCurrent(panel)){panel.busy='';renderStaffologyPanel(panel);}}
}
function syncStaffologyPanel(content){const identity=page()==='integrations'?staffologyIdentity():null;if(!identity){if(staffologyPanel)invalidateStaffologyPanel();return;}if(staffologyPanel&&staffologyPanel.identity===identity&&staffologyPanel.card.parentElement===content)return;invalidateStaffologyPanel();const card=document.createElement('section');card.className='vector-card vector-staffology-card';card.dataset.vectorStaffologyCard='1';card.setAttribute('aria-label','Staffology operations');content.prepend(card);const panel={card,identity,epoch:staffologyEpoch,controller:new AbortController(),snapshot:null,staged:null,mappingValues:{},reviewed:false,heldReasons:[],busy:'',message:'',tone:''};staffologyPanel=panel;renderStaffologyPanel(panel);void refreshStaffology(panel);}
document.addEventListener('click',event=>{const target=event.target.closest('[data-vector-staffology-refresh],[data-vector-staffology-restage],[data-vector-staffology-acquire],[data-vector-staffology-apply],[data-vector-staffology-deliver],[data-vector-staffology-readback],[data-vector-staffology-recover]');if(!target||!staffologyPanel||target.closest('[data-vector-staffology-card]')!==staffologyPanel.card)return;event.preventDefault();if(target.dataset.vectorStaffologyRefresh!=null)void refreshStaffology(staffologyPanel);else for(const action of ['restage','acquire','apply','deliver','readback','recover'])if(target.dataset[`vectorStaffology${action[0].toUpperCase()+action.slice(1)}`]!=null)void staffologyAction(staffologyPanel,action);});
window.addEventListener('pagehide',invalidateStaffologyPanel);

function icon(name){
  const paths={
    home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V21h14V10.5"/><path d="M9 21v-6h6v6"/>',
    people:'<circle cx="9" cy="8" r="3"/><path d="M3 20c.6-4 2.8-6 6-6s5.4 2 6 6"/><circle cx="17" cy="9" r="2.3"/><path d="M15.2 14.5c3.2.2 5 2 5.5 5.5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    leave:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
    calendar:'<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="M8 14h3M13 14h3M8 17h3"/>',
    planning:'<circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="7" r="2.2"/><circle cx="12" cy="17" r="2.2"/><path d="M9 8.5 11 15M15 8.5 13 15M9.3 7h5.4"/>',
    training:'<path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M7 12v4c3 2 7 2 10 0v-4"/><path d="M21 9v6"/>',
    shield:'<path d="M12 3 20 6v6c0 5-3.2 8-8 10-4.8-2-8-5-8-10V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/>',
    cost:'<path d="M12 3v18M17 7.5c-.9-1.5-2.5-2.3-5-2.3-3 0-4.7 1.2-4.7 3.2 0 4.8 10 2.1 10 7 0 2.1-1.9 3.5-5.2 3.5-2.6 0-4.5-.8-5.5-2.5"/>',
    report:'<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M9 17v-4M12 17V9M15 17v-6"/>',
    integrations:'<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/><path d="M10 7h4a3 3 0 0 1 3 3v4M14 17h-4a3 3 0 0 1-3-3v-4"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7a7 7 0 0 0-.7-1.7l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.7-.7L10.5 2h-3l-.7 2a7 7 0 0 0-1.7.7l-1.9-.9-2.1 2.1.9 1.9a7 7 0 0 0-.7 1.7L0 10.5v3l2 .7a7 7 0 0 0 .7 1.7l-.9 1.9 2.1 2.1 1.9-.9a7 7 0 0 0 1.7.7l.7 2h3l.7-2a7 7 0 0 0 1.7-.7l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .7-1.7z" transform="translate(2.5 0) scale(.8)"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.2.9-1.2 1.8M12 17h.01"/>',
    search:'<circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/>',
    sparkle:'<path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/><path d="m19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14Z"/>',
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
    arrow:'<path d="M5 12h14M14 7l5 5-5 5"/>',
    chevron:'<path d="m9 8 4 4-4 4"/>'
  };
  return '<svg class="vector-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]||paths.home)+'</svg>';
}
function resolvedRoute(route){return RETIRED_ROUTE_REDIRECTS[String(route||'')]||String(route||'');}
function available(route){route=resolvedRoute(route);if(employee()&&NAV.slice(3).some(n=>n.routes.includes(route)))return false;return route==='vector-people'?!employee():sourceButtons().some(b=>b.dataset.page===route);}
function firstRoute(routes){return routes.find(available)||null;}
function sectionFor(route){return NAV.find(n=>n.routes.includes(route));}
function sectionItems(spec){
 const labels=new Map(sourceButtons().map(b=>[b.dataset.page,text(b)])),seen=new Set(),items=[];
 for(const [route,label] of [...spec.tabs,...spec.routes.map(route=>[route,labels.get(route)||route])]){
  if(available(route)&&!seen.has(route)){seen.add(route);items.push([route,label]);}
 }
 return items;
}
function activeFor(spec){return spec.routes.includes(page());}
function routeHash(route){return '#vector/'+encodeURIComponent(route);}
function requestedRoute(){try{return location.hash.startsWith('#vector/')?decodeURIComponent(location.hash.slice(8)):null;}catch{return null;}}
async function go(route,{historyMode='push'}={}){
 route=resolvedRoute(route);
 if(!available(route)){if(typeof toast==='function')toast('This page is not available for your role.');return false;}
 const epoch=++navigationEpoch;state.settingsOpen=false;document.getElementById('modal')?.close();document.body.classList.remove('vector-menu-open');
 ui.page=route;
 if(historyMode!=='none'&&location.hash!==routeHash(route))history[historyMode==='replace'?'replaceState':'pushState']({vectorRoute:route},'',routeHash(route));
 await window.render();if(epoch!==navigationEpoch)return false;apply();window.scrollTo(0,0);return true;
}
function restoreRoute(){const route=requestedRoute();if(route&&available(route))void go(route,{historyMode:'none'});else void go('overview',{historyMode:'replace'});}
window.addEventListener('popstate',restoreRoute);
function readActionContext(){try{const raw=sessionStorage.getItem(ACTION_CONTEXT_KEY);if(!raw)return null;const value=JSON.parse(raw),sourceId=String(value?.sourceId||'').trim(),title=String(value?.title||'Time Review item').trim().slice(0,200);if(value?.workflow!=='time-review'||value?.route!=='attendance'||!sourceId)return null;return {workflow:'time-review',route:'attendance',sourceId,title};}catch{return null}}
function rememberActionContext(row){const sourceId=String(row?.sourceId||'').trim();if(row?.workflow!=='time-review'||row?.route!=='attendance'||!sourceId)return false;try{sessionStorage.setItem(ACTION_CONTEXT_KEY,JSON.stringify({workflow:'time-review',route:'attendance',sourceId,title:String(row?.title||'Time Review item').slice(0,200)}));return true;}catch{return false}}
function clearActionContext(){try{sessionStorage.removeItem(ACTION_CONTEXT_KEY);}catch{}}
function focusReturnedActionList(root){if(!state.returnFocus)return;const target=root?.querySelector?.('.vector-alerts');if(!target)return;state.returnFocus=false;target.tabIndex=-1;queueMicrotask(()=>{try{target.focus({preventScroll:false});}catch{target.focus();}});}
function ensureActionContext(content){const existing=content.querySelector(':scope > .vector-action-context'),ctx=readActionContext();if(page()!=='attendance'||!ctx){existing?.remove();clearActionContext();return;}if(existing)return;const bar=document.createElement('section');bar.className='vector-card vector-action-context';bar.dataset.vectorActionContext='1';bar.dataset.vectorSourceId=ctx.sourceId;bar.setAttribute('role','navigation');bar.setAttribute('aria-label','Return to Items to review');bar.style.margin='0 0 12px';bar.innerHTML=`<div class="vector-card-head"><button type="button" data-vector-return-context>← Back to Items to review</button><span>Opened from Home · ${esc(ctx.title)}</span></div>`;content.prepend(bar);}
function sourceIdentity(){try{if(typeof me!=='function')return {};
 const own=me()||{},authenticated=typeof F!=='undefined';
 if(authenticated&&(!F.ready||!F.actor))return {};
 const actor=authenticated?F.actor:own,name=typeof own.name==='string'&&own.name.trim()?own.name.trim():null;
 const siteCandidates=[own.siteName,own.plantName,own.locationName,own.site?.name,own.plant?.name,own.location?.name],site=siteCandidates.find(v=>typeof v==='string'&&v.trim())?.trim()||null;
 const tenant=actor.tenant??actor.tenantId??(!authenticated&&typeof data!=='undefined'?(data.tenant??data.tenantId):null);
 return {id:actor.personId||actor.id||null,email:actor.email||null,tenant:tenant||null,role:actor.role||null,name,site};
}catch{return {}}}
const displayName=()=>sourceIdentity().name||'Signed-in user';
const firstName=()=>{const name=sourceIdentity().name;return name?name.split(/\s+/)[0]:'there';};
const siteName=()=>sourceIdentity().site||'Current workspace';
const siteSentence=()=>sourceIdentity().site?`Here’s what’s happening at ${sourceIdentity().site} today.`:'Here’s what’s happening in your current workspace today.';
const initials=()=>{const name=sourceIdentity().name;return name?name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase():'—';};

function scopedStats(){try{
 if(state.calendar.status!=='ready'||!state.calendar.value)return {authorityUnavailable:true,rows:[],total:null,onsite:null,sick:null,late:null,missing:null,sync:null};
 if(typeof data==='undefined'||typeof WFM==='undefined'||typeof me!=='function'||typeof WFM.scopedStaff!=='function'||typeof WFM.stats!=='function')return {authorityUnavailable:true,rows:[],total:null,onsite:null,sick:null,late:null,missing:null,sync:null};
 const own=me(),rows=WFM.scopedStaff(data,own.id,ui?.root);if(!Array.isArray(rows))return {authorityUnavailable:true,rows:[],total:null,onsite:null,sick:null,late:null,missing:null,sync:null};
 if(rows.length===0)return {authorityUnavailable:false,rows,total:0,onsite:0,sick:0,late:0,missing:0,sync:0};
 const stats=WFM.stats(rows);if(!stats||typeof stats!=='object')return {authorityUnavailable:true,rows,total:rows.length,onsite:null,sick:null,late:null,missing:null,sync:null};
 const numeric=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value);
 return {authorityUnavailable:false,rows,total:rows.length,onsite:numeric(stats.onsite??stats.in),sick:numeric(stats.sick),late:numeric(stats.late),missing:numeric(stats.missing),sync:numeric(stats.sync)};
 }catch{return {authorityUnavailable:true,rows:[],total:null,onsite:null,sick:null,late:null,missing:null,sync:null}}}
function labourCost(){try{const report=typeof VCU!=='undefined'&&VCU?.report?VCU.report():null;const p=report?.summary?.labourCostPence??report?.summary?.totalLabourCostPence??report?.insight?.labourCostPence;if((typeof p==='number'||(typeof p==='string'&&p.trim()!==''))&&Number.isFinite(Number(p)))return Number(p)/100;}catch{}return null;}
function money(v){if(!Number.isFinite(v))return '—';return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:v>=10000?1:0,notation:v>=10000?'compact':'standard'}).format(v);}
function readEvidenceMoney(report,candidates){for(const [path,divisor] of candidates){let value=report;for(const key of path.split('.'))value=value?.[key];if((typeof value==='number'||(typeof value==='string'&&value.trim()!==''))&&Number.isFinite(Number(value)))return Number(value)/(divisor||1);}return null;}
function verifiedValueEvidence(){try{const report=typeof VCU!=='undefined'&&VCU?.report?VCU.report():null;if(!report)return {realised:null,opportunity:null,sourceAvailable:false};const realised=readEvidenceMoney(report,[['summary.verifiedSavingsPence',100],['summary.realisedSavingsPence',100],['summary.realizedSavingsPence',100],['value.verifiedSavingsPence',100],['value.realisedSavingsPence',100],['value.realizedSavingsPence',100],['insight.verifiedSavingsPence',100],['attribution.verifiedSavingsPence',100]]);const opportunity=readEvidenceMoney(report,[['summary.identifiedOpportunityPence',100],['summary.opportunityPence',100],['value.identifiedOpportunityPence',100],['value.opportunityPence',100],['insight.identifiedOpportunityPence',100],['insight.opportunityPence',100]]);return {realised,opportunity,sourceAvailable:realised!=null||opportunity!=null};}catch{return {realised:null,opportunity:null,sourceAvailable:false};}}
function verifiedValueMarkup(){const value=verifiedValueEvidence(),realised=value.realised==null?'—':money(value.realised),opportunity=value.opportunity==null?'—':money(value.opportunity);return `<section class="vector-card vector-verified-value" data-vector-value-evidence="${VALUE_MARKER}" aria-label="Verified financial value. Values appear only when authoritative value evidence is available."><div class="vector-card-head"><div><span class="vector-card-kicker">Evidence-backed value</span><h2>Verified value</h2><p>Realised value and opportunities are kept separate so estimates are never presented as savings.</p></div><button type="button" data-vector-route="costs">Open cost evidence ${icon('arrow')}</button></div><div class="vector-value-grid"><div><small>Realised / verified savings</small><strong>${esc(realised)}</strong><span>${value.realised==null?'No verified saving is available from the current value source.':'Verified by the connected value evidence source.'}</span></div><div><small>Identified opportunity</small><strong>${esc(opportunity)}</strong><span>${value.opportunity==null?'No identified opportunity is available from the current value source.':'Opportunity only — not counted as realised savings.'}</span></div></div></section>`;}
function findMetric(root,pattern){if(!root)return null;const nodes=[...root.querySelectorAll('small,span,b,strong,p,label,h2,h3')];for(const n of nodes){const t=text(n);if(!t||!pattern.test(t))continue;let p=n.parentElement;for(let i=0;p&&i<4;i++,p=p.parentElement){const candidates=[...p.querySelectorAll('strong,b')].map(text).filter(Boolean);const v=candidates.find(x=>x!==t);if(v)return v;}}return null;}
function parseNumber(v){const m=String(v||'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null;}
function metrics(source){const s=scopedStats(),unavailable=s.authorityUnavailable===true;const total=unavailable?null:(s.total??null);const onsite=unavailable?null:s.onsite;const absent=unavailable?null:s.sick;const overtime=null;const cost=labourCost();const onsitePct=total>0&&onsite!=null?Math.round((onsite/total)*100):null;const absencePct=total>0&&absent!=null?((absent/total)*100).toFixed(1):null;const overtimePct=total>0&&overtime!=null?((overtime/total)*100).toFixed(1):null;return [
 {tone:'blue',icon:'people',value:onsite??'—',label:'On site now',detail:onsite==null?'Source unavailable':onsitePct!=null?onsitePct+'% of workforce':'Current attendance',progress:onsitePct},
 {tone:'cyan',icon:'leave',value:absent??'—',label:'Absent today',detail:absent==null?'Source unavailable':absencePct!=null?absencePct+'% absence rate':'Current absence',progress:null},
 {tone:'blue',icon:'clock',value:overtime??'—',label:'In overtime',detail:overtime==null?'Overtime source unavailable':overtimePct!=null?overtimePct+'% of workforce':'Current overtime',progress:null},
 {tone:'blue',icon:'cost',value:money(cost),label:'Labour cost (today)',detail:cost==null?'Connect verified cost data':'Verified cost total',progress:null}
];}
function departmentRows(source){const cards=[...(source?.querySelectorAll('.fcc-dept-grid > *, .ux-approved-line-card')||[])].slice(0,4);if(cards.length){return cards.map((card,i)=>{const label=(card.querySelector('b,strong,h3')?text(card.querySelector('b,strong,h3')):'').slice(0,28)||`Planning area ${i+1}`;return {label,status:'Open source planning',tone:'grey',width:null};});}return [{label:'Workforce planning',status:'Open source planning',tone:'grey',width:null}];}
function visiblePeople(){try{return typeof people==='function'?(people()||[]):[]}catch{return []}}
function sourcePerson(id){try{return typeof person==='function'?person(id)||null:visiblePeople().find(p=>String(p.id)===String(id))||null}catch{return null}}
function payrollReport(){try{return window.payrollPreview?.report?.()||null}catch{return null}}
function scopedReportTeams(report){
  const teams=Array.isArray(report?.teams)?report.teams:[];if(!teams.length)return [];
  const tokens=new Set();let own=null;try{own=typeof me==='function'?me()||null:null}catch{}
  [own?.team,own?.teamId,own?.site,own?.siteId].filter(Boolean).forEach(v=>tokens.add(String(v)));
  visiblePeople().forEach(p=>[p?.team,p?.teamId,p?.site,p?.siteId].filter(Boolean).forEach(v=>tokens.add(String(v))));
  if(!tokens.size)return [];
  return teams.filter(t=>[t?.id,t?.name,t?.team,t?.site,t?.siteId].filter(Boolean).some(v=>tokens.has(String(v))));
}
function teamLabel(team){return String(team?.name||team?.team||team?.site||team?.id||'Team');}
const ACTION_CONFIRMATION_STATES=new Set(['action_required','decision_sent','confirming_source','needs_verification','resolved']);
const ACTION_FRESHNESS_STATES=new Set(['current','stale','unknown']);
function acceptTimeReviewEvidenceItem(item,envelope){
  if(!item||typeof item!=='object'||Array.isArray(item)||!envelope||typeof envelope!=='object')return null;
  if(item.contractVersion!==ACTION_EVIDENCE_CONTRACT||item.workflow!=='time-review')return null;
  if(!String(item.sourceId||'').trim()||!/^[A-Z0-9_]+$/.test(String(item.reasonCode||''))||!String(item.authorityRequired||'').trim())return null;
  const observedAt=Date.parse(String(item.observedAt||'')),asOf=Date.parse(String(envelope.asOf||'')),maxAgeMs=Number(envelope.maxAgeMs);
  if(!Number.isFinite(observedAt)||!Number.isFinite(asOf)||!Number.isFinite(maxAgeMs)||maxAgeMs<=0)return null;
  if(observedAt>asOf+30000||asOf-observedAt>maxAgeMs)return null;
  const confirmation=item.confirmation;
  if(!confirmation||typeof confirmation!=='object'||!ACTION_CONFIRMATION_STATES.has(String(confirmation.state||'').toLowerCase()))return null;
  const confirmationState=String(confirmation.state||'').toLowerCase(),decisionId=String(confirmation.decisionId||'').trim(),slaExpiresAt=confirmation.slaExpiresAt==null?null:Date.parse(String(confirmation.slaExpiresAt));
  if(['decision_sent','confirming_source','needs_verification','resolved'].includes(confirmationState)&&!decisionId)return null;
  if(['decision_sent','confirming_source','needs_verification'].includes(confirmationState)&&!Number.isFinite(slaExpiresAt))return null;
  if(confirmation.slaExpiresAt!=null&&!Number.isFinite(slaExpiresAt))return null;
  if(confirmationState==='needs_verification'&&confirmation.slaExpired!==true)return null;
  if(confirmationState==='confirming_source'&&confirmation.slaExpired===true)return null;
  if(confirmationState==='resolved'&&(!Number.isFinite(Date.parse(String(confirmation.confirmedAt||'')))||!String(confirmation.auditRef||'').trim()))return null;
  return {...item,freshness:{state:'current',policyRef:'server-authoritative-tenant-calendar',validUntil:new Date(observedAt+maxAgeMs).toISOString()}};
}
function actionStatus(value){return ({action_required:'Action required',decision_sent:'Decision sent',confirming_source:'Confirming source',needs_verification:'Needs verification',resolved:'Resolved'})[String(value||'').toLowerCase()]||'Needs review';}
function actionDisposition(row){const sourceState=String(row?.confirmationState||'').toLowerCase();if(sourceState==='resolved')return 'resolved';if(sourceState==='decision_sent'||sourceState==='confirming_source')return 'awaiting-source';return 'needs-action';}
function actionQueueGroups(rows){const needs=[],awaiting=[];for(const row of Array.isArray(rows)?rows:[]){const disposition=actionDisposition(row);if(disposition==='awaiting-source')awaiting.push(row);else if(disposition==='needs-action')needs.push(row);}return {needs,awaiting};}
function actionAffordance(row){return actionDisposition(row)==='awaiting-source'?'View status':String(row?.action||'Review');}
function actionFreshness(value){return value==='current'?'Source reports current evidence':value==='stale'?'Source reports stale evidence':'Freshness not asserted by source';}
function timeReviewEvidenceRows(){
  if(state.timeReviewEvidence.status!=='ready')return [];
  return state.timeReviewEvidence.items.filter(item=>String(item?.confirmation?.state||'').toLowerCase()!=='resolved').map(item=>({
    title:String(item.title||item.reasonCode||'Time Review item'),
    detail:`${String(item.whyNow||'Review source workflow evidence.')} ${actionFreshness(String(item.freshness?.state||'unknown').toLowerCase())}. Authority: ${String(item.authorityRequired)}.`,
    sourceId:String(item.sourceId),workflow:'time-review',route:'attendance',tone:'blue',action:'Review',status:actionStatus(item.confirmation?.state),confirmationState:String(item.confirmation?.state||'').toLowerCase()
  }));
}
function activeTimeReviewSourceIds(){return new Set(state.timeReviewEvidence.status==='ready'?state.timeReviewEvidence.items.filter(item=>String(item?.confirmation?.state||'').toLowerCase()!=='resolved').map(item=>String(item?.sourceId||'').trim()).filter(Boolean):[]);}
function structuredReviewRows(){
  if(employee())return [];
  const contractRows=timeReviewEvidenceRows(),rows=[...contractRows],report=payrollReport(),coveredSourceIds=activeTimeReviewSourceIds();
  for(const team of scopedReportTeams(report)){
    const open=(Array.isArray(team?.issues)?team.issues:[]).filter(issue=>String(issue?.status||'').toLowerCase()==='open');
    const uncovered=open.filter(issue=>{const id=String(issue?.sourceId??issue?.id??'').trim();return !id||!coveredSourceIds.has(id);});
    if(uncovered.length)rows.push({title:`${teamLabel(team)} · ${uncovered.length} time ${uncovered.length===1?'exception needs':'exceptions need'} review`,detail:'Open Time Review work without admissible contract evidence remains visible for source verification.',route:'attendance',tone:'blue',action:'Review',status:'Needs review'});
    const status=String(team?.status||'').toLowerCase();
    if(status==='stale')rows.push({title:`${teamLabel(team)} · signed week changed`,detail:'The source workflow reports that signed evidence changed.',route:'attendance',tone:'blue',action:'Review',status:'Needs review'});
    else if(status==='returned')rows.push({title:`${teamLabel(team)} · week returned for review`,detail:'The source workflow reports that this week was returned.',route:'attendance',tone:'blue',action:'Review',status:'Needs review'});
    else if(!open.length&&team?.canSign===true)rows.push({title:`${teamLabel(team)} · week is ready to sign`,detail:'The source workflow reports sign-off is available.',route:'attendance',tone:'blue',action:'Review',status:'Needs review'});
    else if(!open.length&&Array.isArray(team?.blockers)&&team.blockers.length)rows.push({title:`${teamLabel(team)} · weekly sign-off still blocked`,detail:'The source workflow reports remaining sign-off blockers.',route:'attendance',tone:'blue',action:'Review',status:'Needs review'});
  }
  const visible=new Set(visiblePeople().map(p=>String(p?.id)).filter(Boolean));
  try{if(typeof data!=='undefined'&&Array.isArray(data.requests))for(const request of data.requests){
    if(String(request?.status||'').toLowerCase()!=='pending'||!visible.has(String(request?.employee)))continue;
    const p=sourcePerson(request.employee),calendar=state.calendar.value,currentDay=calendar?.localDate||null,
      requestDay=leaveDate(request.createdAt||request.requestedAt||request.submittedAt||request.date||request.start,calendar?.timeZone),
      stale=Boolean(currentDay&&requestDay&&requestDay<currentDay);
    rows.push({title:`${p?.name||request.employeeName||'Employee'} · leave request`,detail:stale?'Pending leave request is overdue/stale and still requires an explicit manager decision.':'Pending leave request requires a manager decision in Absence & Leave.',sourceId:String(request.id),workflow:'leave',route:'leave',tone:stale?'amber':'blue',action:'Review',status:stale?'Overdue / stale':'Needs review',freshnessState:stale?'stale':'current'});
  }}catch{}
  return rows;
}
function refreshActionSurfaces(){
  const rows=structuredReviewRows(),groups=actionQueueGroups(rows);
  const current=document.querySelector('.vector-alerts');if(current)current.outerHTML=current.classList?.contains?.('vector-priorities')?priorityMarkup(rows):alertsMarkup(rows);
  const badge=document.querySelector('.vector-notification-count');if(badge){badge.textContent=String(groups.needs.length);badge.hidden=!groups.needs.length;}
}
function actionEvidenceOwnerKey(){const identity=sourceIdentity();return [identity.tenant||'',identity.email||'',identity.id||'',identity.role||'',employee()?'employee':'authorised-review'].join(':');}
function timeReviewEvidenceAllowed(){return !employee()&&available('attendance');}
function invalidateTimeReviewEvidence(owner=actionEvidenceOwnerKey()){state.evidenceEpoch++;state.timeReviewEvidence={status:'idle',items:[],owner};}
function syncTimeReviewEvidenceOwner(){const owner=actionEvidenceOwnerKey();if(state.timeReviewEvidence.owner!==owner){invalidateTimeReviewEvidence(owner);return true;}return false;}
function timeReviewEvidenceCurrent(epoch,owner){if(epoch!==state.evidenceEpoch||owner!==actionEvidenceOwnerKey())return false;if(!timeReviewEvidenceAllowed()){invalidateTimeReviewEvidence(owner);return false;}return true;}
async function loadTimeReviewEvidence(){
  syncTimeReviewEvidenceOwner();
  const owner=actionEvidenceOwnerKey();
  if(!timeReviewEvidenceAllowed()){invalidateTimeReviewEvidence(owner);refreshActionSurfaces();return false;}
  if(state.timeReviewEvidence.status!=='idle')return state.timeReviewEvidence.status==='ready';
  const epoch=state.evidenceEpoch;
  state.timeReviewEvidence={status:'loading',items:[],owner};
  try{
    const calendar=await loadTenantCalendar();if(!calendar)throw new Error('tenant calendar unavailable');
    if(!timeReviewEvidenceCurrent(epoch,owner))return false;
    const response=await fetch(TIME_REVIEW_EVIDENCE_PATH,{method:'GET',credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}});
    if(!response.ok)throw new Error('time-review evidence unavailable');
    const body=await response.json();
    if(!body||body.contractVersion!==ACTION_EVIDENCE_CONTRACT||body.workflow!=='time-review'||!Array.isArray(body.items))throw new Error('time-review evidence contract mismatch');
    const envelopeAsOf=Date.parse(String(body.asOf||'')),calendarAsOf=Date.parse(String(calendar.asOf||'')),maxAgeMs=Number(body.maxAgeMs);
    if(String(body.timeZone||'')!==String(calendar.timeZone||'')||maxAgeMs!==Number(calendar.maxAgeMs)||!Number.isFinite(envelopeAsOf)||!Number.isFinite(calendarAsOf)||Math.abs(envelopeAsOf-calendarAsOf)>Math.max(30000,maxAgeMs))throw new Error('time-review evidence calendar mismatch');
    if(!timeReviewEvidenceCurrent(epoch,owner))return false;
    state.timeReviewEvidence={status:'ready',items:body.items.map(item=>acceptTimeReviewEvidenceItem(item,body)).filter(Boolean),owner};
  }catch{
    if(!timeReviewEvidenceCurrent(epoch,owner))return false;
    state.timeReviewEvidence={status:'unavailable',items:[],owner};
  }
  refreshActionSurfaces();return state.timeReviewEvidence.status==='ready';
}
function invalidateTenantCalendar(){state.calendarEpoch++;state.calendar={status:'idle',value:null};}
async function loadTenantCalendar(){
 const tenant=sourceIdentity().tenant||null;
 if(state.calendar.status==='ready'&&state.calendar.value?.tenant===tenant)return state.calendar.value;
 if(state.calendar.status==='ready'&&state.calendar.value?.tenant!==tenant)invalidateTenantCalendar();
 if(state.calendar.status==='loading')return null;
 const epoch=++state.calendarEpoch;state.calendar={status:'loading',value:null};
 try{
  const response=await fetch('/api/tenant-calendar',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}});
  if(!response.ok)throw Error('tenant calendar unavailable');
  const value=await response.json();
  if(value?.schemaVersion!=='tenant-calendar-1'||!value.timeZone||!value.asOf||!/^\d{4}-\d{2}-\d{2}$/.test(String(value.localDate||''))||!Number.isFinite(Number(value.maxAgeMs)))throw Error('tenant calendar contract mismatch');
  try{new Intl.DateTimeFormat('en-GB',{timeZone:value.timeZone}).format(new Date(value.asOf));}catch{throw Error('tenant calendar timezone invalid');}
  if(epoch!==state.calendarEpoch)return null;state.calendar={status:'ready',value};window.WFMTenantCalendarSnapshot=value;return value;
 }catch{if(epoch===state.calendarEpoch)state.calendar={status:'unavailable',value:null};return null;}
}
function serverNowMs(){const value=state.calendar.value?.asOf,ms=Date.parse(value||'');return Number.isFinite(ms)?ms:null;}
function invalidateReadinessEvidence(){state.readinessEpoch++;state.readinessEvidence={status:'idle',departments:[],summary:null,asOf:null,limitations:[]};}
function readinessDepartment(item){
  if(!item||typeof item!=='object'||Array.isArray(item))return null;
  const demand=item.demand&&typeof item.demand==='object'?item.demand:{};
  const required=Number(demand.requiredHours),planned=Number(demand.planAvailableHours??demand.scheduledPaidHours),gap=Number(demand.planGapHours);
  if(!String(item.name||'').trim()||!Number.isFinite(required)||!Number.isFinite(planned))return null;
  return {id:String(item.id||''),name:String(item.name).trim(),requiredHours:Math.max(0,required),plannedHours:Math.max(0,planned),gapHours:Number.isFinite(gap)?Math.max(0,gap):Math.max(0,required-planned),status:String(item.status||'').trim(),counts:item.counts&&typeof item.counts==='object'?item.counts:{}};
}
function refreshReadinessSurfaces(){
  if(page()!=='overview'||employee())return;
  const source=document.querySelector('.vector-home-source');
  const production=document.querySelector('.vector-production-preview');
  if(production)production.outerHTML=productionPreviewMarkup(source);
  const kpis=document.querySelector('.vector-concept-kpis');
  if(kpis)kpis.outerHTML=conceptKpiMarkup(metrics(source),structuredReviewRows(),source);
}
async function loadReadinessEvidence(){
  if(employee()||page()!=='overview'||state.readinessEvidence.status!=='idle')return;
  const epoch=state.readinessEpoch;
  state.readinessEvidence={status:'loading',departments:[],summary:null,asOf:null,limitations:[]};
  try{
    const calendar=await loadTenantCalendar();if(!calendar)throw new Error('tenant calendar unavailable');
    const [response,identityResponse]=await Promise.all([
      fetch('/api/readiness',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}}),
      fetch('/api/runtime-identity',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}})
    ]);
    if(!response.ok||!identityResponse.ok)throw new Error('readiness unavailable');
    const body=await response.json(),runtimeIdentity=await identityResponse.json();
    if(!body||body.schemaVersion!=='readiness-1'||!Array.isArray(body.departments))throw new Error('readiness contract mismatch');
    if(epoch!==state.readinessEpoch||employee()||page()!=='overview')return;
    const asOf=String(body.asOf||''),asOfMs=Date.parse(asOf),nowMs=Date.parse(calendar.asOf),
      maxAgeMs=Number(body.maxAgeMs),timeZone=String(body.timeZone||''),
      freshnessContract=timeZone===calendar.timeZone&&Number.isFinite(maxAgeMs)&&maxAgeMs>0,
      fresh=freshnessContract&&Number.isFinite(asOfMs)&&asOfMs<=nowMs+30000&&nowMs-asOfMs<=maxAgeMs,
      fixtureOnly=body.fixtureOnly===true||runtimeIdentity.fixtureOnly===true;
    state.readinessEvidence={
      status:fixtureOnly?'fixture':fresh?'ready':'stale',
      departments:body.departments.map(readinessDepartment).filter(Boolean),
      summary:body.summary&&typeof body.summary==='object'?body.summary:null,
      asOf,
      limitations:[...(Array.isArray(body.limitations)?body.limitations.map(String).slice(0,6):[]),
        ...(fixtureOnly?['Demonstration/fixture readiness is not current operational truth.']:[]),
        ...(!fixtureOnly&&!fresh?['Readiness evidence failed its timezone/maximum-age Today contract and is not presented as current.']:[])]
    };
  }catch{
    if(epoch!==state.readinessEpoch||employee())return;
    state.readinessEvidence={status:'unavailable',departments:[],summary:null,asOf:null,limitations:[]};
  }
  refreshReadinessSurfaces();
}
function authoritativeTimeZone(){return state.calendar.status==='ready'?String(state.calendar.value?.timeZone||'')||null:null;}
function zonedDate(value,zone){if(!zone)return null;const d=new Date(value);if(!Number.isFinite(d.getTime()))return null;const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day;}
function addDateDays(day,count){if(!/^\d{4}-\d{2}-\d{2}$/.test(day||''))return null;const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);}
function leaveDate(value,zone){if(/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return String(value);return zonedDate(value,zone);}
function leaveWhen(day,zone){if(!day||!zone)return 'Date unavailable';const d=new Date(day+'T12:00:00Z');return new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'short',day:'2-digit',month:'short'}).format(d);}
function leaveRows(){try{if(typeof data==='undefined'||!Array.isArray(data.requests))return [];const zone=authoritativeTimeZone(),nowMs=serverNowMs(),start=nowMs==null?null:zonedDate(nowMs,zone),end=addDateDays(start,7);if(!zone||!start||!end)return [];return data.requests.filter(r=>String(r.status||'').toLowerCase()==='approved').map(r=>({r,date:leaveDate(r.start||r.date,zone)})).filter(x=>x.date&&x.date>=start&&x.date<end).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,4).map(({r,date})=>{let p=null;try{if(typeof person==='function')p=person(r.employee)||null;}catch{}const name=(typeof p?.name==='string'&&p.name.trim())?p.name.trim():(typeof r.employeeName==='string'&&r.employeeName.trim()?r.employeeName.trim():'Employee');const area=[p?.departmentName,p?.teamName,p?.areaName].find(v=>typeof v==='string'&&v.trim())?.trim()||'Source-confirmed leave';const type=(typeof r.typeLabel==='string'&&r.typeLabel.trim())?r.typeLabel.trim():(typeof r.type==='string'&&r.type.trim()?r.type.trim():'Leave');return {name,area,when:leaveWhen(date,zone),type};});}catch{return []}}
function currentDate(){const zone=authoritativeTimeZone(),day=state.calendar.value?.localDate;if(!zone||!day)return {date:'Timezone not verified',week:'—'};const d=new Date(day+'T12:00:00Z');const date=new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'short',day:'2-digit',month:'short',year:'numeric'}).format(d);const jan4=new Date(Date.UTC(d.getUTCFullYear(),0,4)),dow=(d.getUTCDay()+6)%7,thurs=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-dow+3)),janThurs=new Date(Date.UTC(jan4.getUTCFullYear(),0,4-((jan4.getUTCDay()+6)%7)+3)),week=1+Math.round((thurs-janThurs)/604800000);return {date,week};}
function greeting(){const zone=authoritativeTimeZone(),time=String(state.calendar.value?.localTime||'');if(!zone||!/^\d{2}:/.test(time))return 'Hello';const hour=Number(time.slice(0,2));return hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';}

function ensureSidebar(app){let sidebar=app.querySelector(':scope > .vector-sidebar');if(sidebar)return sidebar;sidebar=document.createElement('aside');sidebar.className='vector-sidebar';sidebar.setAttribute('aria-label','Vector primary navigation');sidebar.innerHTML=`
 <div class="vector-brand"><span class="vector-brand-v" aria-hidden="true"><i></i><i></i></span><div><strong>Vector</strong><small>People. Production. A better tomorrow.</small></div></div>
 <nav class="vector-nav" aria-label="Primary sections">${NAV.map((n,i)=>`<button type="button" class="vector-nav-item" data-vector-nav="${i}" aria-label="${esc(n.label)}">${icon(n.icon)}<span>${esc(n.label)}</span></button>`).join('')}</nav>
 <button type="button" class="vector-site-card" data-vector-settings data-vector-identity="${IDENTITY_MARKER}"><span class="vector-site-icon">${icon('settings')}</span><span><b>Settings & more</b><small>${esc(siteName())}</small></span>${icon('chevron')}</button>`;app.prepend(sidebar);return sidebar;}
function ensureTopbar(app){const content=app.querySelector('.content');if(!content)return null;const parent=content.parentElement;let bar=parent.querySelector(':scope > .vector-topbar');if(bar)return bar;bar=document.createElement('header');bar.className='vector-topbar';bar.innerHTML=`
 <button type="button" class="vector-mobile-menu" data-vector-menu aria-label="Open menu">${icon('menu')}</button>
 <label class="vector-global-search">${icon('search')}<input type="search" placeholder='Ask anything... (e.g. "who’s off next week?" or "show overtime this month")' aria-label="Ask Vector"/></label>
 <div class="vector-top-actions"><button type="button" class="vector-icon-button" data-vector-alerts data-vector-action-evidence="${ACTION_MARKER}" aria-label="Source-confirmed items needing my action">${icon('bell')}<span class="vector-notification-count" hidden>0</span></button><button type="button" class="vector-icon-button" data-vector-help aria-label="Help">${icon('help')}</button><button type="button" class="vector-user-button" data-vector-settings data-vector-identity="${IDENTITY_MARKER}"><span class="vector-avatar">${esc(initials())}</span><span class="vector-user-copy"><b>${esc(displayName())}</b><small>${esc(siteName())}</small></span><span class="vector-user-chevron">⌄</span></button></div>`;parent.insertBefore(bar,content);return bar;}
function updateNav(){const sidebar=document.querySelector('.vector-sidebar');if(!sidebar)return;sidebar.querySelectorAll('[data-vector-nav]').forEach((b,i)=>{b.classList.toggle('active',activeFor(NAV[i]));b.setAttribute('aria-current',activeFor(NAV[i])?'page':'false');b.disabled=!firstRoute(NAV[i].routes);b.title=b.disabled?'Not available for your role':'';});const alerts=document.querySelector('.vector-notification-count');const count=actionQueueGroups(structuredReviewRows()).needs.length;if(alerts){alerts.textContent=String(count);alerts.hidden=!count}}
function askWorkforce(message){const launch=document.getElementById('wfm-bot-launch');if(launch&&document.getElementById('wfm-bot')?.hidden)launch.click();setTimeout(()=>{const box=document.getElementById('bot-message');if(box){box.value=String(message||'').slice(0,2000);box.dispatchEvent(new Event('input',{bubbles:true}));box.focus();}},180);}
function buildAssistant(){const prompts=['Show me who’s off next week','Am I over my labour budget?','Find available trained staff','Explain this overtime spike','Create a shift for next week'];return `<aside class="vector-assistant"><div class="vector-assistant-title"><span class="vector-ai-glyph">${icon('sparkle')}</span><h2>Vector AI Assistant</h2><span class="vector-beta">Beta</span></div><p>I can help you with anything — from finding data, to fixing issues, to suggesting actions.</p><div class="vector-prompt-list">${prompts.map(p=>`<button type="button" data-vector-prompt="${esc(p)}">${esc(p)}</button>`).join('')}</div><label class="vector-assistant-input"><input type="text" placeholder="Ask a question..." aria-label="Ask Vector AI Assistant"/><button type="button" data-vector-assistant-send aria-label="Ask">${icon('arrow')}</button></label></aside>`;}
function kpiMarkup(items){return items.map((m,i)=>`<button type="button" class="vector-kpi-card ${m.tone}" data-vector-route="${['attendance','leave','attendance','costs'][i]}"><span class="vector-kpi-icon">${icon(m.icon)}</span><span class="vector-kpi-copy"><strong>${esc(m.value)}</strong><b>${esc(m.label)}</b><small>${esc(m.detail)}</small>${m.progress!=null?`<span class="vector-progress"><i style="width:${Math.max(0,Math.min(100,m.progress))}%"></i></span>`:''}</span></button>`).join('');}
function shiftsMarkup(rows){return `<section class="vector-card vector-shifts" data-vector-planning="${PLANNING_MARKER}"><div class="vector-card-head"><h2>Department planning</h2><button type="button" data-vector-route="schedule-publication">Open schedule planning ${icon('arrow')}</button></div><div class="vector-shift-layout"><div class="vector-shift-chart">${rows.map(r=>`<div class="vector-shift-row"><b>${esc(r.label)}</b><div class="vector-shift-track" style="background:none;border-left:0"><span class="grey" style="width:auto;background:#eef1f5;box-shadow:none;color:#43546d"><em>${esc(r.status)}</em></span></div></div>`).join('')}</div><div class="vector-legend"><span><i class="grey"></i>Status and coverage shown only when verified by the source workflow</span></div></div></section>`;}
function secondaryKpis(m){const s=scopedStats(),vals=[{label:'Absence today',value:m[1].value==='—'?'—':m[1].value+(s.total!=null?' / '+s.total:''),detail:m[1].detail,route:'leave'},{label:'Overtime',value:m[2].value==='—'?'—':m[2].value+' people',detail:m[2].detail,route:'attendance'},{label:'Labour cost',value:m[3].value,detail:m[3].detail,route:'costs'},{label:'Productivity',value:'—',detail:'Open productivity evidence',route:'insights'}];return `<section class="vector-mini-grid" data-vector-kpi-evidence="${KPI_MARKER}" aria-label="Operational KPI summaries. Trend graphics are shown only when verified source history is available.">${vals.map(v=>`<button type="button" class="vector-mini-card" data-vector-route="${v.route}"><span><b>${esc(v.label)}</b><strong>${esc(v.value)}</strong><small>${esc(v.detail)}</small><em>View details ${icon('arrow')}</em></span></button>`).join('')}</section>`;}
function alertRowMarkup(r){const context=r.sourceId&&r.workflow?` data-vector-source-id="${esc(r.sourceId)}" data-vector-workflow="${esc(r.workflow)}"`:'';const action=actionAffordance(r);return `<div class="vector-alert-row" role="group" aria-label="${esc(r.title)}. Status: ${esc(r.status)}. Review source evidence before acting."><i class="${r.tone}" aria-hidden="true"></i><b>${esc(r.title)}<small aria-hidden="true" data-vector-action-status="${esc(r.status)}"> · ${esc(r.status)}</small></b><details class="vector-action-detail"><summary>Why this needs attention</summary><p>${esc(r.detail||'Review source evidence')}</p></details><button type="button" data-vector-route="${esc(r.route)}"${context} aria-label="${esc(action)} ${esc(r.title)}">${esc(action)}</button></div>`;}
function conceptKpiMarkup(m,rows,source){
  const actionCount=actionQueueGroups(rows).needs.length,s=scopedStats(),productionAreas=productionForecastRows(source).length,readinessSummary=state.readinessEvidence.summary;
  const peopleValue=s.total!=null&&s.onsite!=null?String(s.onsite)+' / '+String(s.total):String(s.onsite??'—');
  const readinessGap=Number(readinessSummary?.gaps),readinessDepartments=Number(readinessSummary?.departments);
  const productionValue=state.readinessEvidence.status==='ready'?(Number.isFinite(readinessGap)&&readinessGap>0?readinessGap+' gaps':'On track'):(state.readinessEvidence.status==='loading'?'Loading':'Open');
  const productionDetail=state.readinessEvidence.status==='ready'&&Number.isFinite(readinessDepartments)?readinessDepartments+' departments · readiness source':(productionAreas?productionAreas+' source planning areas':'Open live factory');
  const items=[
    {label:'Production',value:productionValue,detail:productionDetail,route:'readiness',icon:'planning',tone:Number.isFinite(readinessGap)&&readinessGap>0?'attention':'good'},
    {label:'People',value:peopleValue,detail:m?.[0]?.detail||'Current attendance',route:'vector-people',icon:'people',tone:'blue'},
    {label:'Issues',value:String(actionCount),detail:actionCount===1?'1 source-confirmed item waiting':actionCount+' source-confirmed items waiting',route:'attendance',icon:'bell',tone:actionCount?'attention':'good'},
    {label:"Today's cost",value:m?.[3]?.value??'—',detail:m?.[3]?.detail||'Verified cost total',route:'costs',icon:'cost',tone:'blue'}
  ];
  return `<section class="vector-concept-kpis" data-vector-kpi-evidence="${KPI_MARKER}">${items.map(item=>`<button type="button" class="vector-concept-kpi ${item.tone}" data-vector-route="${item.route}"><span class="vector-concept-kpi-icon">${icon(item.icon)}</span><span><small>${esc(item.label)}</small><strong>${esc(item.value)}</strong><em>${esc(item.detail)}</em></span>${icon('chevron')}</button>`).join('')}</section>`;
}
function priorityMarkup(rows){
  const groups=actionQueueGroups(rows),visibleNeeds=groups.needs.slice(0,5),visibleAwaiting=groups.awaiting.slice(0,3);
  const body=visibleNeeds.length?visibleNeeds.map(alertRowMarkup).join(''):'<div class="vector-empty">No source-confirmed items need your action.</div>';
  const awaiting=groups.awaiting.length?`<details data-vector-awaiting-confirmation><summary class="vector-empty">Awaiting source confirmation · ${groups.awaiting.length}</summary><div class="vector-alert-list">${visibleAwaiting.map(alertRowMarkup).join('')}</div></details>`:'';
  return `<section class="vector-card vector-alerts vector-priorities" data-vector-review="${REVIEW_MARKER}" data-vector-action-evidence="${ACTION_MARKER}" aria-labelledby="vector-review-title"><div class="vector-card-head"><div><span class="vector-card-kicker">Priority</span><h2 id="vector-review-title">Top priorities <em>${groups.needs.length}</em></h2></div><button type="button" data-vector-route="time-review">View all ${icon('arrow')}</button></div><div class="vector-alert-list">${body}</div>${awaiting}</section>`;
}
function productionForecastRows(source){
  if(state.readinessEvidence.status==='ready'&&state.readinessEvidence.departments.length){
    return state.readinessEvidence.departments.slice(0,5).map(item=>({label:item.name,required:item.requiredHours,planned:item.plannedHours,gap:item.gapHours,status:item.status}));
  }
  const cards=[...(source?.querySelectorAll('.fcc-dept-grid > *, .ux-approved-line-card')||[])].slice(0,5);
  return cards.map((card,i)=>{
    const label=(card.querySelector('b,strong,h3')?text(card.querySelector('b,strong,h3')):'').slice(0,28)||`Line ${i+1}`;
    return {label,required:null,planned:null,gap:null,status:'Source planning available'};
  });
}
function hours(value){return Number.isFinite(value)?(Math.round(value*10)/10).toFixed(1).replace(/\.0$/,'')+'h':'—';}
function productionPreviewMarkup(source){
  const rows=productionForecastRows(source),numeric=rows.filter(row=>Number.isFinite(row.required)&&Number.isFinite(row.planned));
  let body='';
  if(numeric.length){
    const max=Math.max(1,...numeric.flatMap(row=>[row.required,row.planned]));
    body=`<div class="vector-capacity-legend"><span><i class="required"></i>Required labour hours</span><span><i class="planned"></i>Planned labour hours</span></div><div class="vector-capacity-bars">${numeric.map(row=>{const req=Math.max(8,Math.round(row.required/max*100)),plan=Math.max(8,Math.round(row.planned/max*100));return `<button type="button" class="vector-capacity-column" data-vector-route="readiness" aria-label="${esc(row.label)}. Required ${hours(row.required)}. Planned ${hours(row.planned)}. Gap ${hours(row.gap)}."><span class="vector-capacity-plot"><i class="required" style="height:${req}%"><em>${hours(row.required)}</em></i><i class="planned" style="height:${plan}%"><em>${hours(row.planned)}</em></i></span><b>${esc(row.label)}</b><small class="${row.gap>0?'gap':'good'}">${row.gap>0?'Gap '+hours(row.gap):'Covered'}</small></button>`;}).join('')}</div>`;
  }else if(state.readinessEvidence.status==='loading'){
    body='<div class="vector-capacity-loading" aria-label="Loading production readiness source"><i></i><i></i><i></i><i></i><i></i><i></i></div>';
  }else{
    body=`<button type="button" class="vector-forecast-empty" data-vector-route="readiness">Open Factory to view source production planning ${icon('arrow')}</button>`;
  }
  const asOf=state.readinessEvidence.asOf?new Date(state.readinessEvidence.asOf):null;
  const asOfText=asOf&&Number.isFinite(asOf.getTime())?new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(asOf):'current source snapshot';
  const fresh=state.readinessEvidence.status==='ready',fixture=state.readinessEvidence.status==='fixture';
  return `<section class="vector-card vector-production-preview" data-vector-planning="${PLANNING_MARKER}"><div class="vector-card-head"><div><span class="vector-card-kicker">Production</span><h2>${fresh?'Today’s production forecast':'Production forecast'}</h2><p>Required vs planned labour capacity</p></div><button type="button" data-vector-route="readiness">Open Factory ${icon('arrow')}</button></div><div class="vector-forecast-chart">${body}</div><div class="vector-production-foot"><span></span>${fresh?'Readiness source · '+esc(asOfText):fixture?'Demonstration readiness only; not current operational truth.':'Readiness source is stale or unavailable; it is not labelled as Today.'} No production-output units are invented.</div></section>`;
}
function alertsMarkup(rows){const groups=actionQueueGroups(rows),visibleNeeds=groups.needs.slice(0,4),visibleAwaiting=groups.awaiting.slice(0,3),needsBody=visibleNeeds.length?visibleNeeds.map(alertRowMarkup).join(''):'<div class="vector-empty">No source-confirmed items need your action.</div>',awaitingBody=groups.awaiting.length?`<details data-vector-awaiting-confirmation><summary class="vector-empty">Awaiting source confirmation · ${groups.awaiting.length}</summary><div class="vector-alert-list">${visibleAwaiting.map(alertRowMarkup).join('')}</div></details>`:'';return `<section class="vector-card vector-alerts" data-vector-review="${REVIEW_MARKER}" data-vector-action-evidence="${ACTION_MARKER}" aria-labelledby="vector-review-title"><div class="vector-card-head"><h2 id="vector-review-title"><span class="vector-alert-bell">${icon('bell')}</span>Needs my action <em>${groups.needs.length}</em></h2><button type="button" data-vector-route="time-review">Open Time Review ${icon('arrow')}</button></div><div class="vector-alert-list">${needsBody}</div>${awaitingBody}</section>`;}
function leaveMarkup(rows){const body=rows.length?rows.slice(0,4).map((r,i)=>`<button type="button" class="vector-leave-row" data-vector-route="leave"><span class="vector-person-badge b${i}">${esc(r.name.split(/\s+/).map(x=>x[0]).join('').slice(0,2))}</span><span><b>${esc(r.name)}</b><small>${esc(r.area)}</small></span><em>${esc(r.when)}</em><strong>${esc(r.type)}</strong>${icon('chevron')}</button>`).join(''):`<button type="button" class="vector-leave-row" data-vector-route="leave" aria-label="Open Absence & Leave to review upcoming leave evidence"><span class="vector-person-badge" aria-hidden="true">i</span><span><b>Open Absence & Leave</b><small>No approved leave is available to this summary.</small></span><em>Source check</em><strong>Review</strong>${icon('chevron')}</button>`;return `<section class="vector-card vector-leave" data-vector-leave-evidence="${LEAVE_MARKER}" aria-label="Upcoming leave. Only approved source requests dated within the next seven days are shown."><div class="vector-card-head"><h2>Upcoming leave (next 7 days)</h2><button type="button" data-vector-route="leave">View calendar ${icon('arrow')}</button></div><div class="vector-leave-list">${body}</div></section>`;}
function promoMarkup(){return '<aside class="vector-promo"><div><h2>A more productive<br>tomorrow starts today.</h2><p>Empowered people.<br>Stronger manufacturers.</p></div><div class="vector-promo-brand"><span class="vector-mark small"><i></i><i></i><i></i></span><b>Vector.</b></div></aside>';}
function employeeHomeMarkup(v){
 const zone=String(authoritativeTimeZone()||''),serverTime=state.calendar.value?.asOf||v?.serverTime||null,day=zone&&serverTime?zonedDate(serverTime,zone):null;
 const title=day?'Today':'Current work',name=v?.profile?.fields?.preferredName||v?.identity?.name||displayName(),nowMs=Date.parse(serverTime||'');
 const shifts=(Array.isArray(v?.shifts)?v.shifts:[]).filter(x=>Date.parse(x?.end)>nowMs).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)).slice(0,3);
 const requests=(Array.isArray(v?.requests)?v.requests:[]).slice(0,6),clock=v?.clock||{},leave=v?.leave||{};
 const fmtTime=value=>{try{return zone?new Intl.DateTimeFormat('en-GB',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):String(value||'');}catch{return String(value||'');}};
 return `<section class="vector-welcome" data-vector-employee-home="1"><div><span class="vector-page-kicker">${esc(title)}</span><h1>${esc(name)}</h1><p>Your current assignments, attendance and leave come from your authenticated personal record.</p></div><span class="vector-evidence-label">${esc(zone||'Tenant/site timezone not verified')}</span></section>
 <section class="vector-mini-grid"><button type="button" class="vector-mini-card" data-vector-route="personal"><span><b>Attendance</b><strong>${esc(clock.status||'Current record')}</strong><small>${clock.active?.start?'Started '+esc(fmtTime(clock.active.start)):'Open your personal record for current attendance.'}</small><em>Open Personal</em></span></button><button type="button" class="vector-mini-card" data-vector-route="leave"><span><b>Available leave</b><strong>${Number.isFinite(Number(leave.availableMinutes))?esc((Number(leave.availableMinutes)/60).toLocaleString('en-GB',{maximumFractionDigits:2})+' h'):'—'}</strong><small>Source-saved balance; no sample entitlement is invented.</small><em>Open leave</em></span></button></section>
 <section class="vector-card"><div class="vector-card-head"><h2>Upcoming assignments</h2><button type="button" data-vector-route="shifts">Open shifts ${icon('arrow')}</button></div>${shifts.length?shifts.map(shift=>`<button type="button" class="vector-leave-row" data-vector-route="shifts"><span><b>${esc(shift.job||v?.identity?.job||'Assignment')}</b><small>${esc(shift.site||v?.identity?.site||'Current site')}</small></span><em>${esc(fmtTime(shift.start))}</em><strong>Published</strong>${icon('chevron')}</button>`).join(''):'<div class="vector-empty">No upcoming published assignments are in your current personal record.</div>'}</section>
 <section class="vector-card"><div class="vector-card-head"><h2>Recent leave requests</h2><button type="button" data-vector-route="leave">Open leave ${icon('arrow')}</button></div>${requests.length?requests.map(r=>`<div class="vector-alert-row"><i class="blue"></i><b>${esc(r.kind||'Leave')}<small> · ${esc(r.status||'recorded')}</small></b><span>${esc(r.date||r.start||'')}</span></div>`).join(''):'<div class="vector-empty">No leave requests are recorded.</div>'}</section>`;
}
const employeeHomeRenderCache=new WeakMap();
function updateEmployeeHomeContent(content,value){
 const markup=employeeHomeMarkup(value);
 if(employeeHomeRenderCache.get(content)!==markup||!content.querySelector('[data-vector-employee-home]')){content.innerHTML=markup;employeeHomeRenderCache.set(content,markup);}
 content.dataset.vectorEmployeeHome='1';if(document.title!=='Vector · Workforce')document.title='Vector · Workforce';
}
function renderEmployeeHomeError(content){
 if(!content.querySelector('[data-vector-employee-home-error]'))content.innerHTML='<section class="vector-card" role="alert" data-vector-employee-home-error="1"><h1>Current work is unavailable</h1><p>Vector could not verify your authenticated personal record. No sample shift or legacy date is shown.</p><button type="button" data-vector-retry-employee-home>Try again</button></section>';
}
async function retryEmployeeHome(content){
 if(!employee()||page()!=='overview'||state.employeeHome.status!=='error')return;
 state.employeeHomeEpoch++;state.employeeHome={status:'idle',owner:'',value:null,error:''};
 return renderEmployeeHome(content);
}
document.addEventListener('click',event=>{if(event.target.closest('[data-vector-retry-employee-home]')){const content=document.querySelector('.content');if(content)void retryEmployeeHome(content);}});
function employeeHomeOwnerKey(){const identity=sourceIdentity();return [identity.tenant,identity.email,identity.id].join(':');}
function employeeHomeCurrent(epoch,owner,content){
 if(epoch!==state.employeeHomeEpoch)return false;
 if(owner!==employeeHomeOwnerKey()||!employee()||page()!=='overview'||content.isConnected===false){
  state.employeeHomeEpoch++;state.employeeHome={status:'idle',owner:'',value:null,error:''};queueMicrotask(apply);return false;
 }
 return true;
}
async function renderEmployeeHome(content){
 const renderEpoch=state.employeeHomeEpoch;
 await loadTenantCalendar();
 if(renderEpoch!==state.employeeHomeEpoch||!employee()||page()!=='overview'||content.isConnected===false)return;
 const owner=employeeHomeOwnerKey();
 if(state.employeeHome.owner!==owner){state.employeeHomeEpoch++;state.employeeHome={status:'idle',owner,value:null,error:''};}
 if(state.employeeHome.status==='ready'&&state.employeeHome.value){updateEmployeeHomeContent(content,state.employeeHome.value);return;}
 if(state.employeeHome.status==='error'){renderEmployeeHomeError(content);return;}
 if(state.employeeHome.status==='loading')return;
 const epoch=++state.employeeHomeEpoch;state.employeeHome.status='loading';content.innerHTML='<div class="vector-empty">Loading your current personal record…</div>';
 try{
  const response=await fetch('/api/personal',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}});
  if(!response.ok)throw Error('Personal source unavailable');
  const value=await response.json();
  if(!employeeHomeCurrent(epoch,owner,content))return;
  state.employeeHome={status:'ready',owner,value,error:''};updateEmployeeHomeContent(content,value);
 }catch(error){
  if(!employeeHomeCurrent(epoch,owner,content))return;
  state.employeeHome={status:'error',owner,value:null,error:String(error?.message||'Personal source unavailable')};
  renderEmployeeHomeError(content);
 }
}
function renderHome(content){clearActionContext();if(content.dataset.vectorHome==='1'){focusReturnedActionList(content);return;}
 const source=document.createElement('div');source.className='vector-home-source';while(content.firstChild)source.appendChild(content.firstChild);content.appendChild(source);
 const m=metrics(source),actions=structuredReviewRows(),leaves=leaveRows(),today=currentDate();const home=document.createElement('div');home.className='vector-home vector-concept-home';
 home.innerHTML=`<section class="vector-concept-heading" data-vector-identity="${IDENTITY_MARKER}"><div><span class="vector-page-kicker">Today</span><h1>What needs your attention right now</h1><p>${esc(siteSentence())}</p></div><div class="vector-concept-date"><b>${esc(today.date)}</b><small>Week ${esc(today.week)} · ${esc(siteName())}</small></div></section>
 ${conceptKpiMarkup(m,actions,source)}
 <div class="vector-concept-dashboard">${priorityMarkup(actions)}${productionPreviewMarkup(source)}</div>
 ${verifiedValueMarkup()}
 <div class="vector-concept-lower"><section class="vector-card vector-focus vector-concept-focus"><div class="vector-card-head"><div><span class="vector-card-kicker">Quick access</span><h2>Today’s focus</h2></div></div><p>Review the evidence, then move straight into the working flow.</p>${[['schedule-publication','Review this week’s plan'],['attendance','Check attendance'],['leave','Review time off']].filter(([r])=>available(r)).map(([r,t])=>`<button type="button" data-vector-route="${r}">${icon('arrow')}${t}</button>`).join('')}</section>${leaveMarkup(leaves)}</div>
 <div class="vector-concept-assistant">${buildAssistant()}</div>`;
 content.prepend(home);content.dataset.vectorHome='1';document.title='Vector · Workforce';focusReturnedActionList(home);
}
function sectionTabs(content){
 if(content.querySelector(':scope > .vector-section-tabs'))return;
 const spec=sectionFor(page());if(!spec||spec.label==='Today')return;
 const tabs=sectionItems(spec);if(!tabs.length)return;
 const n=document.createElement('nav');n.className='vector-section-tabs';n.setAttribute('aria-label','Section pages');
 n.innerHTML=tabs.map(([r,t])=>`<button type="button" data-vector-route="${esc(r)}" aria-current="${page()===r?'page':'false'}">${esc(t)}</button>`).join('');content.prepend(n);
}
function generalPage(content){if(content.dataset.vectorHome==='1')return;content.classList.add('vector-page-content');sectionTabs(content);ensureActionContext(content);
 if(page()==='leave'){
  const table=[...content.querySelectorAll('h2')].find(h=>h.textContent.trim()==='Employee balances')?.closest('section');
  if(table&&!table.closest('details')){const d=document.createElement('details');d.className='vector-balances';d.innerHTML='<summary>Employee balances</summary>';table.before(d);d.append(table);}
 }
 if(page()==='readiness'){const h=content.querySelector('h1');if(h)h.textContent='Factory';}
}
function openLeaveReview(id){
 const request=data.requests?.find(r=>String(r.id)===String(id));if(!request||!visiblePeople().some(p=>String(p.id)===String(request.employee)))return;
 const p=sourcePerson(request.employee),d=document.getElementById('modal');d.classList.add('vector-decision-drawer');
 d.innerHTML=`<button type="button" class="vector-drawer-close" data-vector-close-review aria-label="Close review">×</button><span class="vector-evidence-label">Items to review · Leave request</span><h2>${esc(p?.name||'Employee')}</h2><p>${esc(request.kind||'Time off')} · ${esc(request.date||request.start)} · ${esc(request.hours)} hours</p><span class="vector-status">${esc(request.status)}</span><div class="vector-so-what"><h3>So what?</h3><p>This request needs a manager decision. Check the recorded leave balance and coverage for the affected shift before approving. Financial impact has not been established for this request.</p></div><p>Source: ${esc(request.id)}. The next step checks current coverage. A review does not approve the request or change payroll.</p><button type="button" class="btn primary" data-vector-review-coverage="${esc(request.id)}" ${request.status!=='pending'?'disabled':''}>Review coverage</button>`;
 d.addEventListener('close',()=>d.classList.remove('vector-decision-drawer'),{once:true});d.showModal();d.querySelector('button').focus();
}
function peoplePage(){
 const rows=visiblePeople(),stats=scopedStats();
 return `<section class="vector-welcome"><div><h1>People</h1><p>Your workforce, their skills, their potential.</p></div><span class="vector-evidence-label">${rows.length} people in your authorised scope</span></section>
 <section class="vector-people-stats"><div><small>Total people</small><strong>${rows.length}</strong></div><div><small>On site</small><strong>${stats.onsite??'—'}</strong></div><div><small>Reported sick</small><strong>${stats.sick??'—'}</strong></div><div><small>Skills & training</small><b>Evidence required</b><small>No verified skills summary in this snapshot</small></div></section>
 <section class="vector-card vector-people-card"><div class="vector-card-head"><h2>Your people</h2><label class="vector-people-search">${icon('search')}<input type="search" aria-label="Search people" placeholder="Search people, roles or teams…"></label></div><div class="tablewrap"><table class="vector-people-table"><thead><tr><th>Name</th><th>Role</th><th>Team</th><th>Site</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(p=>{const status=state.calendar.status==='ready'&&typeof WFM?.status==='function'?WFM.status(p):'';const label=state.calendar.status!=='ready'?'Source unavailable':(({in:'On site',break:'On break',out:'Clocked out',missing:'No clock-in',sync:'Check source',sick:'Reported sick',leave:'On leave',off:'Off shift',later:'Later today'})[status]||'Review source');return `<tr data-vector-person-row data-search="${esc([p.name,p.job,p.team,p.site].join(' ').toLowerCase())}"><td><span class="vector-person-cell"><span class="vector-person-badge">${esc(String(p.name).split(/\s+/).map(x=>x[0]).slice(0,2).join(''))}</span><b>${esc(p.name)}</b></span></td><td>${esc(p.job)}</td><td>${esc(p.team)}</td><td>${esc(p.site)}</td><td><span class="vector-status">${esc(label)}</span></td><td><button type="button" data-act="person" data-id="${esc(p.id)}" aria-label="Open ${esc(p.name)}">View</button></td></tr>`}).join('')}</tbody></table></div><p class="vector-no-results" hidden>No people match your search.</p></section>`;
}
function syncSettingsMenu(content){
 const existing=content.querySelector(':scope > .vector-settings');if(!state.settingsOpen){existing?.remove();return null;}if(existing)return existing;
 const links=sourceButtons().filter(button=>button.dataset.page&&!NAV.some(section=>section.routes.includes(button.dataset.page))&&available(button.dataset.page));
 const panel=document.createElement('section');panel.className='vector-card vector-settings';panel.dataset.vectorSettingsPanel='1';panel.setAttribute('aria-label','Settings and more');panel.innerHTML='<div class="vector-card-head"><h2>Settings & more</h2><button type="button" data-vector-settings>Close</button></div><div class="vector-settings-links">'+links.map(button=>`<button type="button" data-vector-route="${esc(button.dataset.page)}">${esc(text(button))}</button>`).join('')+'</div>';content.prepend(panel);return panel;
}
function settingsMenu(){const content=document.querySelector('.content');if(!content)return;state.settingsOpen=!state.settingsOpen;const panel=syncSettingsMenu(content);if(panel)panel.scrollIntoView({block:'start'});}
function apply(){if(state.queued)return;state.queued=true;queueMicrotask(()=>{state.queued=false;shellObserver?.disconnect();try{syncTimeReviewEvidenceOwner();const app=document.querySelector('.app'),content=document.querySelector('.content');if(!app||!content){void loadTimeReviewEvidence();return;}document.body.classList.remove('ux-reset-active');document.body.classList.add('vector-ui-active');document.body.dataset.vectorUi=DESIGN_ID;app.dataset.vectorShell=MARKER;const retiredTarget=RETIRED_ROUTE_REDIRECTS[page()];if(retiredTarget){go(retiredTarget);return;}if(vectorHomeRequested()&&page()!=='overview'){clearVectorHomeRequest();go('overview');return;}if(vectorHomeRequested())clearVectorHomeRequest();ensureSidebar(app);ensureTopbar(app);if(state.calendar.status==='idle')void loadTenantCalendar().then(value=>{if(value&&page()==='overview')queueMicrotask(apply);});syncGustoPanel(content);syncStaffologyPanel(content);if(page()==='overview'&&employee())void renderEmployeeHome(content);else if(page()==='overview')renderHome(content);else generalPage(content);syncSettingsMenu(content);updateNav();document.querySelectorAll('[data-vector-route]').forEach(b=>{if(b.tagName==='BUTTON'&&!available(b.dataset.vectorRoute)){b.disabled=true;b.title='This workflow is not available in this release for your role.';}});if(!historyReady){historyReady=true;const r=requestedRoute();if(r&&r!==page()){queueMicrotask(restoreRoute);}else if(!r)history.replaceState({vectorRoute:page()},'',routeHash(page()));}void loadTimeReviewEvidence();void loadReadinessEvidence();}catch(error){document.body.classList.add('vector-ui-active');const root=document.getElementById('root');if(root&&!root.querySelector('.vector-render-error')){root.innerHTML='<div class="vector-render-error" role="alert"><strong>Vector could not render this screen.</strong><span>Reload the page. If this remains visible, the client render failed before the workspace could mount.</span></div>';}}finally{try{shellObserver?.observe(document.documentElement,observerConfig);}catch{}}});}
document.addEventListener('click',e=>{if(e.target.closest('[data-vector-close-review]')){document.getElementById('modal').close();return;}const review=e.target.closest('[data-vector-review-coverage]');if(review){const id=review.dataset.vectorReviewCoverage;const r=data.requests?.find(r=>String(r.id)===id);if(r&&visiblePeople().some(p=>String(p.id)===String(r.employee)))void approveRequest(id);return;}if(e.target.closest('[data-vector-settings]')){settingsMenu();return;}const navButton=e.target.closest('[data-vector-nav]');if(navButton){const spec=NAV[Number(navButton.dataset.vectorNav)];if(spec){const r=firstRoute(spec.routes);if(r)go(r);}return;}if(e.target.closest('[data-vector-return-context]')){clearActionContext();state.returnFocus=true;go('overview');return;}const actionButton=e.target.closest('[data-vector-source-id][data-vector-workflow][data-vector-route]');if(actionButton){if(actionButton.dataset.vectorWorkflow==='leave'){openLeaveReview(actionButton.dataset.vectorSourceId);return;}rememberActionContext({sourceId:actionButton.dataset.vectorSourceId,workflow:actionButton.dataset.vectorWorkflow,route:actionButton.dataset.vectorRoute,title:actionButton.closest('.vector-alert-row')?.querySelector('b')?.textContent||'Time Review item'});go(actionButton.dataset.vectorRoute);return;}const route=e.target.closest('[data-vector-route]')?.dataset.vectorRoute;if(route){go(route);return;}if(e.target.closest('[data-vector-menu]')){document.body.classList.toggle('vector-menu-open');return;}if(e.target.closest('[data-vector-help]')){const launch=document.getElementById('wfm-bot-launch');if(launch)launch.click();else go('support');return;}if(e.target.closest('[data-vector-alerts]')){go('attendance');return;}const prompt=e.target.closest('[data-vector-prompt]')?.dataset.vectorPrompt;if(prompt){askWorkforce(prompt);return;}if(e.target.closest('[data-vector-assistant-send]')){const box=document.querySelector('.vector-assistant-input input');if(box?.value.trim())askWorkforce(box.value.trim());return;}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.body.classList.remove('vector-menu-open');const input=e.target.closest('.vector-global-search input,.vector-assistant-input input');if(input&&e.key==='Enter'&&input.value.trim()){e.preventDefault();askWorkforce(input.value.trim());}});
const previousRender=window.render;
if(typeof previousRender==='function')window.render=async function(...args){invalidateGustoPanel();invalidateStaffologyPanel();invalidateTimeReviewEvidence();invalidateReadinessEvidence();let result;if(page()==='vector-people'&&!employee()){document.getElementById('root').innerHTML=shell(peoplePage());}else result=await previousRender.apply(this,args);syncTimeReviewEvidenceOwner();document.body.classList.remove('vector-menu-open');void loadTimeReviewEvidence();queueMicrotask(apply);return result;};
window.nav=go;
document.addEventListener('input',e=>{if(e.target.matches('[aria-label="Search people"]')){const q=e.target.value.trim().toLowerCase();let count=0;document.querySelectorAll('[data-vector-person-row]').forEach(r=>{r.hidden=!r.dataset.search.includes(q);if(!r.hidden)count++;});const empty=document.querySelector('.vector-no-results');if(empty)empty.hidden=count>0;}});
shellObserver=new MutationObserver(()=>apply());
shellObserver.observe(document.documentElement,observerConfig);
setTimeout(apply,0);setTimeout(apply,350);
window.VectorWorkforceOperations={marker:MARKER,reviewMarker:REVIEW_MARKER,planningMarker:PLANNING_MARKER,kpiMarker:KPI_MARKER,identityMarker:IDENTITY_MARKER,leaveMarker:LEAVE_MARKER,actionMarker:ACTION_MARKER,actionDisposition,actionQueueGroups,apply,go,askWorkforce};
})();
