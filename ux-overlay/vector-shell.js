/* Vector Workforce Operations shell — exact approved visual direction.
 * Presentation only: existing WFM routes, permissions, APIs and audit controls remain authoritative.
 */
(function(){
'use strict';

const MARKER='VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1';
const REVIEW_MARKER='VECTOR_REVIEW_NEUTRAL_V1';
const PLANNING_MARKER='VECTOR_PLANNING_NEUTRAL_V1';
const KPI_MARKER='VECTOR_KPI_EVIDENCE_V1';
const IDENTITY_MARKER='VECTOR_IDENTITY_SOURCE_BOUND_V1';
const LEAVE_MARKER='VECTOR_LEAVE_SOURCE_BOUND_V1';
const ACTION_MARKER='VECTOR_ACTION_SOURCE_BOUND_V1';
const ACTION_EVIDENCE_CONTRACT='WFM_WORKFLOW_ACTION_EVIDENCE_V1';
const TIME_REVIEW_EVIDENCE_PATH='/api/workforce/lifecycle/action-evidence/time-review';
const ACTION_CONTEXT_KEY='VECTOR_ACTION_RETURN_CONTEXT_V1';
const RELEASE='VECTOR_UI_V2_20260921';
const NAV=[
  {label:'Today',icon:'home',routes:['overview']},
  {label:'People',icon:'people',routes:['organisation','org-admin','resources','training']},
  {label:'Plan',icon:'calendar',routes:['schedule-publication','shifts','demand','cover','availability','offers']},
  {label:'Factory',icon:'planning',routes:['readiness','attendance','compliance']},
  {label:'Absence',icon:'leave',routes:['leave']},
  {label:'Time & Attendance',icon:'clock',routes:['time-review','timesheet','corrections']},
  {label:'Payroll',icon:'report',routes:['payroll-run','payroll-intelligence','payroll']},
  {label:'Improve',icon:'sparkle',routes:['insights','costs','forecast','recommendations']},
  {label:'Integrations',icon:'integrations',routes:['integrations']},
  {label:'Settings',icon:'settings',routes:['company-settings','op-settings','onboarding','audit']}
];
const ROUTE_LABELS={overview:'Today',organisation:'Overview','org-admin':'Manage people',resources:'Skills & training',shifts:'My shifts','schedule-publication':'Shift plan',demand:'Demand',readiness:'Production readiness',attendance:'Attendance',compliance:'Compliance',leave:'Absence & leave','time-review':'Weekly review',timesheet:'My timesheet',cover:'Available cover',availability:'My availability',offers:'Cover offers',insights:'Performance',costs:'Labour cost',forecast:'Cost forecast','payroll-run':'Payroll run','payroll-intelligence':'Payroll checks',payroll:'Payroll import',integrations:'Connected systems','company-settings':'Company settings','op-settings':'Operational settings',onboarding:'Implementation',audit:'Activity log'};
const RETIRED_ROUTE_REDIRECTS=Object.freeze({'weekly-review':'time-review','savings-decisions':'costs'});
const state={queued:false,timeReviewEvidence:{status:'idle',items:[]},returnFocus:false};
const observerConfig={subtree:true,childList:true};
let shellObserver=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=n=>(n?.textContent||'').replace(/\s+/g,' ').trim();
const page=()=>{try{return String(ui?.page||'overview')}catch{return 'overview'}};
const vectorHomeRequested=()=>{try{return new URL(window.location.href).searchParams.get('vector_home')==='1';}catch{return false;}};
const clearVectorHomeRequest=()=>{try{const u=new URL(window.location.href);if(!u.searchParams.has('vector_home'))return;u.searchParams.delete('vector_home');history.replaceState({},'',u.pathname+(u.search?'?'+u.searchParams.toString():'')+u.hash);}catch{}};

const employee=()=>{try{return typeof isEmployee==='function'&&isEmployee()}catch{return false}};
const sourceButtons=()=>[...document.querySelectorAll('.app > .sidebar nav .navbtn[data-page], .sidebar:not(.vector-sidebar) nav .navbtn[data-page]')];

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
function navigationModel(){
  const available=new Map(sourceButtons().filter(b=>b.dataset.page).map(b=>[b.dataset.page,b]));
  const used=new Set(),groups=[];
  for(const spec of NAV){const items=spec.routes.filter(r=>available.has(r)&&!used.has(r)).map(route=>{used.add(route);return {route,label:ROUTE_LABELS[route]||text(available.get(route))||route};});if(items.length)groups.push({...spec,items});}
  const remaining=[...available.keys()].filter(r=>!used.has(r)).map(route=>({route,label:ROUTE_LABELS[route]||text(available.get(route))||route}));
  if(remaining.length)groups.push({label:'More',icon:'report',items:remaining});
  return groups;
}
function firstRoute(routes){return routes.find(route=>sourceButtons().some(b=>b.dataset.page===route))||null;}
function go(route){const button=sourceButtons().find(b=>b.dataset.page===route);if(!button)return false;button.click();document.body?.classList?.remove('vector-menu-open');return true;}
function activeFor(spec){return (spec.items||[]).some(item=>item.route===page());}
function readActionContext(){try{const raw=sessionStorage.getItem(ACTION_CONTEXT_KEY);if(!raw)return null;const value=JSON.parse(raw),sourceId=String(value?.sourceId||'').trim(),title=String(value?.title||'Time Review item').trim().slice(0,200);if(value?.workflow!=='time-review'||value?.route!=='time-review'||!sourceId)return null;return {workflow:'time-review',route:'time-review',sourceId,title};}catch{return null}}
function rememberActionContext(row){const sourceId=String(row?.sourceId||'').trim();if(row?.workflow!=='time-review'||row?.route!=='time-review'||!sourceId)return false;try{sessionStorage.setItem(ACTION_CONTEXT_KEY,JSON.stringify({workflow:'time-review',route:'time-review',sourceId,title:String(row?.title||'Time Review item').slice(0,200)}));return true;}catch{return false}}
function clearActionContext(){try{sessionStorage.removeItem(ACTION_CONTEXT_KEY);}catch{}}
function focusReturnedActionList(root){if(!state.returnFocus)return;const target=root?.querySelector?.('.vector-alerts');if(!target)return;state.returnFocus=false;target.tabIndex=-1;queueMicrotask(()=>{try{target.focus({preventScroll:false});}catch{target.focus();}});}
function ensureActionContext(content){const existing=content.querySelector(':scope > .vector-action-context'),ctx=readActionContext();if(page()!=='time-review'||!ctx){existing?.remove();clearActionContext();return;}if(existing)return;const bar=document.createElement('section');bar.className='vector-card vector-action-context';bar.dataset.vectorActionContext='1';bar.dataset.vectorSourceId=ctx.sourceId;bar.setAttribute('role','navigation');bar.setAttribute('aria-label','Return to Items to review');bar.style.margin='0 0 12px';bar.innerHTML=`<div class="vector-card-head"><button type="button" data-vector-return-context>← Back to Items to review</button><span>Opened from Home · ${esc(ctx.title)}</span></div>`;content.prepend(bar);}
function sourceIdentity(){try{if(typeof me!=='function')return {};const own=me()||{};const name=typeof own.name==='string'&&own.name.trim()?own.name.trim():null;const siteCandidates=[own.siteName,own.plantName,own.locationName,own.site?.name,own.plant?.name,own.location?.name];const site=siteCandidates.find(v=>typeof v==='string'&&v.trim())?.trim()||null;return {name,site};}catch{return {}}}
const displayName=()=>sourceIdentity().name||'Signed-in user';
const firstName=()=>{const name=sourceIdentity().name;return name?name.split(/\s+/)[0]:'there';};
const siteName=()=>sourceIdentity().site||'Current workspace';
const siteSentence=()=>sourceIdentity().site?`Here’s what’s happening at ${sourceIdentity().site} today.`:'Here’s what’s happening in your current workspace today.';
const initials=()=>{const name=sourceIdentity().name;return name?name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase():'—';};

function scopedStats(){try{if(typeof data==='undefined'||typeof WFM==='undefined'||typeof me!=='function')return {};const own=me(),rows=WFM.scopedStaff(data,own.id,ui?.root);const s=rows?.length?WFM.stats(rows):{};return {rows,total:rows?.length||0,onsite:s?.onsite??s?.in??0,sick:s?.sick??0,late:s?.late??0,missing:s?.missing??0,sync:s?.sync??0};}catch{return {}}}
function labourCost(){try{const report=typeof VCU!=='undefined'&&VCU?.report?VCU.report():null;const p=report?.summary?.labourCostPence??report?.summary?.totalLabourCostPence??report?.insight?.labourCostPence;if(Number.isFinite(Number(p)))return Number(p)/100;}catch{}return null;}
function money(v){if(!Number.isFinite(v))return '—';return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:v>=10000?1:0,notation:v>=10000?'compact':'standard'}).format(v);}
function findMetric(root,pattern){if(!root)return null;const nodes=[...root.querySelectorAll('small,span,b,strong,p,label,h2,h3')];for(const n of nodes){const t=text(n);if(!t||!pattern.test(t))continue;let p=n.parentElement;for(let i=0;p&&i<4;i++,p=p.parentElement){const candidates=[...p.querySelectorAll('strong,b')].map(text).filter(Boolean);const v=candidates.find(x=>x!==t);if(v)return v;}}return null;}
function parseNumber(v){const m=String(v||'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null;}
function metrics(source){const s=scopedStats();const total=s.total||parseNumber(findMetric(source,/total|workforce|people/i))||null;const onsite=s.onsite||parseNumber(findMetric(source,/working now|on site/i))||null;const absent=s.sick||parseNumber(findMetric(source,/reported sick|absent today|absence/i))||null;const overtime=parseNumber(findMetric(source,/overtime/i));const cost=labourCost();const onsitePct=total&&onsite!=null?Math.round((onsite/total)*100):null;const absencePct=total&&absent!=null?((absent/total)*100).toFixed(1):null;const overtimePct=total&&overtime!=null?((overtime/total)*100).toFixed(1):null;return [
 {tone:'blue',icon:'people',value:onsite??'—',label:'On site now',detail:onsitePct!=null?onsitePct+'% of workforce':'Current attendance',progress:onsitePct},
 {tone:'cyan',icon:'leave',value:absent??'—',label:'Absent today',detail:absencePct!=null?absencePct+'% absence rate':'Current absence',progress:null},
 {tone:'blue',icon:'clock',value:overtime??'—',label:'In overtime',detail:overtimePct!=null?overtimePct+'% of workforce':'Overtime evidence',progress:null},
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
function acceptTimeReviewEvidenceItem(item){
  if(!item||typeof item!=='object'||Array.isArray(item))return null;
  if(item.contractVersion!==ACTION_EVIDENCE_CONTRACT||item.workflow!=='time-review')return null;
  if(!String(item.sourceId||'').trim()||!/^[A-Z0-9_]+$/.test(String(item.reasonCode||''))||!String(item.authorityRequired||'').trim())return null;
  if(!Number.isFinite(Date.parse(String(item.observedAt||''))))return null;
  const freshness=item.freshness,confirmation=item.confirmation;
  if(!freshness||typeof freshness!=='object'||!ACTION_FRESHNESS_STATES.has(String(freshness.state||'').toLowerCase()))return null;
  const freshnessState=String(freshness.state||'').toLowerCase(),validUntil=freshness.validUntil==null?null:Date.parse(String(freshness.validUntil));
  if(freshnessState!=='unknown'&&!String(freshness.policyRef||'').trim())return null;
  if(freshnessState==='current'&&!Number.isFinite(validUntil))return null;
  if(freshness.validUntil!=null&&!Number.isFinite(validUntil))return null;
  if(!confirmation||typeof confirmation!=='object'||!ACTION_CONFIRMATION_STATES.has(String(confirmation.state||'').toLowerCase()))return null;
  const confirmationState=String(confirmation.state||'').toLowerCase(),decisionId=String(confirmation.decisionId||'').trim(),slaExpiresAt=confirmation.slaExpiresAt==null?null:Date.parse(String(confirmation.slaExpiresAt));
  if(['decision_sent','confirming_source','needs_verification','resolved'].includes(confirmationState)&&!decisionId)return null;
  if(['decision_sent','confirming_source','needs_verification'].includes(confirmationState)&&!Number.isFinite(slaExpiresAt))return null;
  if(confirmation.slaExpiresAt!=null&&!Number.isFinite(slaExpiresAt))return null;
  if(confirmationState==='needs_verification'&&confirmation.slaExpired!==true)return null;
  if(confirmationState==='confirming_source'&&confirmation.slaExpired===true)return null;
  if(confirmationState==='resolved'&&(!Number.isFinite(Date.parse(String(confirmation.confirmedAt||'')))||!String(confirmation.auditRef||'').trim()))return null;
  return item;
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
    sourceId:String(item.sourceId),workflow:'time-review',route:'time-review',tone:'blue',action:'Review',status:actionStatus(item.confirmation?.state),confirmationState:String(item.confirmation?.state||'').toLowerCase()
  }));
}
function activeTimeReviewSourceIds(){return new Set(state.timeReviewEvidence.status==='ready'?state.timeReviewEvidence.items.filter(item=>String(item?.confirmation?.state||'').toLowerCase()!=='resolved').map(item=>String(item?.sourceId||'').trim()).filter(Boolean):[]);}
function structuredReviewRows(){
  if(employee())return [];
  const contractRows=timeReviewEvidenceRows(),rows=[...contractRows],report=payrollReport(),coveredSourceIds=activeTimeReviewSourceIds();
  for(const team of scopedReportTeams(report)){
    const open=(Array.isArray(team?.issues)?team.issues:[]).filter(issue=>String(issue?.status||'').toLowerCase()==='open');
    const uncovered=open.filter(issue=>{const id=String(issue?.sourceId??issue?.id??'').trim();return !id||!coveredSourceIds.has(id);});
    if(uncovered.length)rows.push({title:`${teamLabel(team)} · ${uncovered.length} time ${uncovered.length===1?'exception needs':'exceptions need'} review`,detail:'Open Time Review work without admissible contract evidence remains visible for source verification.',route:'time-review',tone:'blue',action:'Review',status:'Needs review'});
    const status=String(team?.status||'').toLowerCase();
    if(status==='stale')rows.push({title:`${teamLabel(team)} · signed week changed`,detail:'The source workflow reports that signed evidence changed.',route:'time-review',tone:'blue',action:'Review',status:'Needs review'});
    else if(status==='returned')rows.push({title:`${teamLabel(team)} · week returned for review`,detail:'The source workflow reports that this week was returned.',route:'time-review',tone:'blue',action:'Review',status:'Needs review'});
    else if(!open.length&&team?.canSign===true)rows.push({title:`${teamLabel(team)} · week is ready to sign`,detail:'The source workflow reports sign-off is available.',route:'time-review',tone:'blue',action:'Review',status:'Needs review'});
    else if(!open.length&&Array.isArray(team?.blockers)&&team.blockers.length)rows.push({title:`${teamLabel(team)} · weekly sign-off still blocked`,detail:'The source workflow reports remaining sign-off blockers.',route:'time-review',tone:'blue',action:'Review',status:'Needs review'});
  }
  const visible=new Set(visiblePeople().map(p=>String(p?.id)).filter(Boolean));
  try{if(typeof data!=='undefined'&&Array.isArray(data.requests))for(const request of data.requests){
    if(String(request?.status||'').toLowerCase()!=='pending'||!visible.has(String(request?.employee)))continue;
    const p=sourcePerson(request.employee);
    rows.push({title:`${p?.name||request.employeeName||'Employee'} · leave request`,detail:'Pending leave request requires a manager decision in Absence & Leave.',route:'leave',tone:'blue',action:'Review',status:'Needs review'});
  }}catch{}
  return rows;
}
function refreshActionSurfaces(){
  const rows=structuredReviewRows(),groups=actionQueueGroups(rows);
  const current=document.querySelector('.vector-alerts');if(current)current.outerHTML=alertsMarkup(rows);
  const attention=document.querySelector('[data-vector-attention-count]');if(attention)attention.textContent=String(groups.needs.length);
  const badge=document.querySelector('.vector-notification-count');if(badge){badge.textContent=String(groups.needs.length);badge.hidden=!groups.needs.length;}
}
async function loadTimeReviewEvidence(){
  if(employee()||state.timeReviewEvidence.status!=='idle')return;
  state.timeReviewEvidence={status:'loading',items:[]};
  try{
    const response=await fetch(TIME_REVIEW_EVIDENCE_PATH,{method:'GET',credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}});
    if(!response.ok)throw new Error('time-review evidence unavailable');
    const body=await response.json();
    if(!body||body.contractVersion!==ACTION_EVIDENCE_CONTRACT||body.workflow!=='time-review'||!Array.isArray(body.items))throw new Error('time-review evidence contract mismatch');
    state.timeReviewEvidence={status:'ready',items:body.items.map(acceptTimeReviewEvidenceItem).filter(Boolean)};
  }catch{
    state.timeReviewEvidence={status:'unavailable',items:[]};
  }
  refreshActionSurfaces();
}
function leaveDate(value){const d=new Date(value);return Number.isFinite(d.getTime())?d:null;}
function leaveWhen(value){const d=leaveDate(value);return d?new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short'}).format(d):'Date unavailable';}
function leaveRows(){try{if(typeof data==='undefined'||!Array.isArray(data.requests))return [];const now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),now.getDate()),end=new Date(start);end.setDate(end.getDate()+7);return data.requests.filter(r=>String(r.status||'').toLowerCase()==='approved').map(r=>({r,date:leaveDate(r.start||r.date)})).filter(x=>x.date&&x.date>=start&&x.date<end).sort((a,b)=>a.date-b.date).slice(0,4).map(({r,date})=>{let p=null;try{if(typeof person==='function')p=person(r.employee)||null;}catch{}const name=(typeof p?.name==='string'&&p.name.trim())?p.name.trim():(typeof r.employeeName==='string'&&r.employeeName.trim()?r.employeeName.trim():'Employee');const area=[p?.departmentName,p?.teamName,p?.areaName].find(v=>typeof v==='string'&&v.trim())?.trim()||'Source-confirmed leave';const type=(typeof r.typeLabel==='string'&&r.typeLabel.trim())?r.typeLabel.trim():(typeof r.type==='string'&&r.type.trim()?r.type.trim():'Leave');return {name,area,when:leaveWhen(date),type};});}catch{return []}}
function currentDate(){const d=new Date();const date=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}).format(d);const jan4=new Date(Date.UTC(d.getUTCFullYear(),0,4));const day=(d.getUTCDay()+6)%7;const thurs=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day+3));const janThurs=new Date(Date.UTC(jan4.getUTCFullYear(),0,4-((jan4.getUTCDay()+6)%7)+3));const week=1+Math.round((thurs-janThurs)/604800000);return {date,week};}
function greeting(){const h=new Date().getHours();return h<12?'Good morning':h<18?'Good afternoon':'Good evening';}

function ensureSidebar(app){
  const model=navigationModel(),key=JSON.stringify(model.map(g=>[g.label,g.items]));
  let sidebar=app.querySelector(':scope > .vector-sidebar');
  if(sidebar?.dataset.navigationKey===key)return sidebar;
  if(!sidebar){sidebar=document.createElement('aside');sidebar.className='vector-sidebar';sidebar.setAttribute('aria-label','Vector primary navigation');app.prepend(sidebar);}
  sidebar.dataset.navigationKey=key;
  sidebar.innerHTML=`<a class="vector-brand" href="#" data-vector-route="overview" aria-label="Vector Today"><span class="vector-mark" aria-hidden="true"><i></i><i></i><i></i></span><div><strong>Vector</strong></div></a><p class="vector-nav-caption">YOUR WORKSPACE</p><nav class="vector-nav">${model.map(g=>`<button type="button" class="vector-nav-item" data-vector-route="${esc(g.items[0].route)}" data-vector-group="${esc(g.label)}">${icon(g.icon)}<span>${esc(g.label)}</span></button>`).join('')}</nav><div class="vector-sidebar-bottom"><button type="button" class="vector-nav-item" data-vector-help>${icon('help')}<span>Help & guidance</span></button><div class="vector-site-card" data-vector-identity="${IDENTITY_MARKER}"><span class="vector-avatar">${esc(initials())}</span><span><b>${esc(displayName())}</b><small>${esc(siteName())}</small></span></div><small class="vector-release-label">Vector · Release 2</small></div>`;
  return sidebar;
}
function ensureTopbar(app){
  const content=app.querySelector('.content');if(!content)return null;
  const parent=content.parentElement;let bar=parent.querySelector(':scope > .vector-topbar');if(bar)return bar;
  bar=document.createElement('header');bar.className='vector-topbar';
  bar.innerHTML=`<button type="button" class="vector-mobile-menu" data-vector-menu aria-label="Open navigation menu" aria-expanded="false">${icon('menu')}</button><p class="vector-topline">People. Production. <strong>A better tomorrow.</strong></p><label class="vector-global-search">${icon('search')}<input type="search" placeholder="Ask Vector about your workforce…" aria-label="Ask Vector"/></label><div class="vector-top-actions"><button type="button" class="vector-icon-button" data-vector-alerts aria-label="Open items needing attention">${icon('bell')}<span class="vector-notification-count" hidden>0</span></button><button type="button" class="vector-ai-toggle" data-vector-help aria-label="Ask Vector">${icon('sparkle')}<span>Ask Vector</span></button><span class="vector-avatar" aria-label="${esc(displayName())}">${esc(initials())}</span></div>`;
  parent.insertBefore(bar,content);return bar;
}
function updateNav(){
  const model=navigationModel(),active=model.find(activeFor),sidebar=document.querySelector('.vector-sidebar');
  sidebar?.querySelectorAll('[data-vector-group]').forEach(b=>{const selected=b.dataset.vectorGroup===active?.label;b.classList.toggle('active',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  const content=document.querySelector('.content');if(content){let tabs=content.querySelector(':scope > .vector-section-tabs');const items=active?.items||[];if(items.length>1){if(!tabs){tabs=document.createElement('nav');tabs.className='vector-section-tabs';tabs.setAttribute('aria-label',active.label+' sections');content.prepend(tabs);}const key=JSON.stringify([page(),items]);if(tabs.dataset.key!==key){tabs.dataset.key=key;tabs.innerHTML=items.map(i=>`<button type="button" data-vector-route="${esc(i.route)}" ${i.route===page()?'aria-current="page"':''}>${esc(i.label)}</button>`).join('');}}else tabs?.remove();}
  const badge=document.querySelector('.vector-notification-count'),count=actionQueueGroups(structuredReviewRows()).needs.length;if(badge){badge.textContent=String(count);badge.hidden=!count;}
  const menu=document.querySelector('[data-vector-menu]');menu?.setAttribute('aria-expanded',String(document.body.classList.contains('vector-menu-open')));
}
function askWorkforce(message){const launch=document.getElementById('wfm-bot-launch');if(launch&&document.getElementById('wfm-bot')?.hidden)launch.click();setTimeout(()=>{const box=document.getElementById('bot-message');if(box){box.value=String(message||'').slice(0,2000);box.dispatchEvent(new Event('input',{bubbles:true}));box.focus();}},180);}
function buildAssistant(){const prompts=['Show me who’s off next week','Am I over my labour budget?','Find available trained staff','Explain this overtime spike','Create a shift for next week'];return `<aside class="vector-assistant"><div class="vector-assistant-title"><span class="vector-ai-glyph">${icon('sparkle')}</span><h2>Vector AI Assistant</h2><span class="vector-beta">Beta</span></div><p>I can help you with anything — from finding data, to fixing issues, to suggesting actions.</p><div class="vector-prompt-list">${prompts.map(p=>`<button type="button" data-vector-prompt="${esc(p)}">${esc(p)}</button>`).join('')}</div><label class="vector-assistant-input"><input type="text" placeholder="Ask a question..." aria-label="Ask Vector AI Assistant"/><button type="button" data-vector-assistant-send aria-label="Ask">${icon('arrow')}</button></label></aside>`;}
function kpiMarkup(items){return items.map((m,i)=>`<button type="button" class="vector-kpi-card ${m.tone}" data-vector-route="${['attendance','leave','time-review','costs'][i]}"><span class="vector-kpi-icon">${icon(m.icon)}</span><span class="vector-kpi-copy"><strong>${esc(m.value)}</strong><b>${esc(m.label)}</b><small>${esc(m.detail)}</small>${m.progress!=null?`<span class="vector-progress"><i style="width:${Math.max(0,Math.min(100,m.progress))}%"></i></span>`:''}</span></button>`).join('');}
function shiftsMarkup(rows){return `<section class="vector-card vector-shifts" data-vector-planning="${PLANNING_MARKER}"><div class="vector-card-head"><h2>Department planning</h2><button type="button" data-vector-route="schedule-publication">Open schedule planning ${icon('arrow')}</button></div><div class="vector-shift-layout"><div class="vector-shift-chart">${rows.map(r=>`<div class="vector-shift-row"><b>${esc(r.label)}</b><div class="vector-shift-track" style="background:none;border-left:0"><span class="grey" style="width:auto;background:#eef1f5;box-shadow:none;color:#43546d"><em>${esc(r.status)}</em></span></div></div>`).join('')}</div><div class="vector-legend"><span><i class="grey"></i>Status and coverage shown only when verified by the source workflow</span></div></div></section>`;}
function secondaryKpis(m){const s=scopedStats(),vals=[{label:'Absence today',value:m[1].value==='—'?'—':m[1].value+(s.total?' / '+s.total:''),detail:m[1].detail,route:'leave'},{label:'Overtime',value:m[2].value==='—'?'—':m[2].value+' people',detail:m[2].detail,route:'time-review'},{label:'Labour cost',value:m[3].value,detail:m[3].detail,route:'costs'},{label:'Productivity',value:'—',detail:'Open productivity evidence',route:'insights'}];return `<section class="vector-mini-grid" data-vector-kpi-evidence="${KPI_MARKER}" aria-label="Operational KPI summaries. Trend graphics are shown only when verified source history is available.">${vals.map(v=>`<button type="button" class="vector-mini-card" data-vector-route="${v.route}"><span><b>${esc(v.label)}</b><strong>${esc(v.value)}</strong><small>${esc(v.detail)}</small><em>View details ${icon('arrow')}</em></span></button>`).join('')}</section>`;}
function alertRowMarkup(r){const context=r.sourceId&&r.workflow?` data-vector-source-id="${esc(r.sourceId)}" data-vector-workflow="${esc(r.workflow)}"`:'';const action=actionAffordance(r);return `<div class="vector-alert-row" role="group" aria-label="${esc(r.title)}. Status: ${esc(r.status)}. Review source evidence before acting."><i class="${r.tone}" aria-hidden="true"></i><b>${esc(r.title)}<small aria-hidden="true" data-vector-action-status="${esc(r.status)}"> · ${esc(r.status)}</small></b><details class="vector-action-detail"><summary>Why this needs attention</summary><p>${esc(r.detail||'Review source evidence')}</p></details><button type="button" data-vector-route="${esc(r.route)}"${context} aria-label="${esc(action)} ${esc(r.title)}">${esc(action)}</button></div>`;}
function alertsMarkup(rows){const groups=actionQueueGroups(rows),visibleNeeds=groups.needs.slice(0,4),visibleAwaiting=groups.awaiting.slice(0,3),needsBody=visibleNeeds.length?visibleNeeds.map(alertRowMarkup).join(''):'<div class="vector-empty">No source-confirmed items need your action.</div>',awaitingBody=groups.awaiting.length?`<details data-vector-awaiting-confirmation><summary class="vector-empty">Awaiting source confirmation · ${groups.awaiting.length}</summary><div class="vector-alert-list">${visibleAwaiting.map(alertRowMarkup).join('')}</div></details>`:'';return `<section class="vector-card vector-alerts" data-vector-review="${REVIEW_MARKER}" data-vector-action-evidence="${ACTION_MARKER}" aria-labelledby="vector-review-title"><div class="vector-card-head"><h2 id="vector-review-title"><span class="vector-alert-bell">${icon('bell')}</span>Needs my action <em>${groups.needs.length}</em></h2><button type="button" data-vector-route="time-review">Open Time Review ${icon('arrow')}</button></div><div class="vector-alert-list">${needsBody}</div>${awaitingBody}</section>`;}
function leaveMarkup(rows){const body=rows.length?rows.slice(0,4).map((r,i)=>`<button type="button" class="vector-leave-row" data-vector-route="leave"><span class="vector-person-badge b${i}">${esc(r.name.split(/\s+/).map(x=>x[0]).join('').slice(0,2))}</span><span><b>${esc(r.name)}</b><small>${esc(r.area)}</small></span><em>${esc(r.when)}</em><strong>${esc(r.type)}</strong>${icon('chevron')}</button>`).join(''):`<button type="button" class="vector-leave-row" data-vector-route="leave" aria-label="Open Absence & Leave to review upcoming leave evidence"><span class="vector-person-badge" aria-hidden="true">i</span><span><b>Open Absence & Leave</b><small>No approved leave is available to this summary.</small></span><em>Source check</em><strong>Review</strong>${icon('chevron')}</button>`;return `<section class="vector-card vector-leave" data-vector-leave-evidence="${LEAVE_MARKER}" aria-label="Upcoming leave. Only approved source requests dated within the next seven days are shown."><div class="vector-card-head"><h2>Upcoming leave (next 7 days)</h2><button type="button" data-vector-route="leave">View calendar ${icon('arrow')}</button></div><div class="vector-leave-list">${body}</div></section>`;}
function promoMarkup(){return '<aside class="vector-promo"><div><h2>A more productive<br>tomorrow starts today.</h2><p>Empowered people.<br>Stronger manufacturers.</p></div><div class="vector-promo-brand"><span class="vector-mark small"><i></i><i></i><i></i></span><b>Vector.</b></div></aside>';}
function todayKpis(){
  const s=scopedStats(),actions=actionQueueGroups(structuredReviewRows()).needs;
  const visible=new Set((s.rows||[]).map(p=>String(p.id)));
  let pending=0;try{pending=(data.requests||[]).filter(r=>r.status==='pending'&&visible.has(String(r.employee))).length;}catch{}
  return [{label:'People on site',value:s.total?`${s.onsite} / ${s.total}`:'—',detail:'Current attendance records',route:'attendance',icon:'people',tone:'blue'},{label:'Reported sickness',value:s.total?s.sick:'—',detail:'People recorded as sick',route:'leave',icon:'leave',tone:'cyan'},{label:'Leave to review',value:pending,detail:'Awaiting a manager decision',route:'leave',icon:'calendar',tone:pending?'amber':'green'},{label:'Items needing attention',value:actions.length,detail:'Open the record before acting',route:'overview',icon:'clock',tone:actions.length?'amber':'green'}];
}
function focusMarkup(){
  const targets=[['schedule-publication','Review the week','Shifts, coverage and draft changes','calendar'],['leave','Manage time off','Requests, balances and overlapping leave','leave'],['time-review','Sign off time','Exceptions and weekly approval','clock'],['readiness','Check factory readiness','People, skills and production needs','planning']].filter(([r])=>firstRoute([r]));
  return `<aside class="vector-card vector-focus"><div class="vector-card-head"><h2>Today’s focus</h2></div><div class="vector-focus-list">${targets.map(([r,title,detail,ic])=>`<button type="button" data-vector-route="${r}"><span class="vector-focus-icon">${icon(ic)}</span><span><b>${title}</b><small>${detail}</small></span>${icon('chevron')}</button>`).join('')}</div></aside>`;
}
function workforceMarkup(){
  const stats=scopedStats(),groups=new Map();
  for(const p of stats.rows||[]){const name=String(p.departmentName||p.teamName||p.team||p.siteName||p.site||'Current workforce');const g=groups.get(name)||{name,total:0,onsite:0};g.total++;try{if(['in','break'].includes(WFM.status(p)))g.onsite++;}catch{}groups.set(name,g);}
  return `<section class="vector-card vector-workforce"><div class="vector-card-head"><div><h2>Your workforce</h2><p>Attendance across the teams you can access.</p></div><button type="button" data-vector-route="${esc(firstRoute(['organisation','org-admin'])||'overview')}">View people ${icon('arrow')}</button></div><div class="vector-team-grid">${[...groups.values()].slice(0,6).map(g=>`<button type="button" data-vector-route="attendance"><span>${esc(g.name)}</span><strong>${g.onsite}<small> / ${g.total} on site</small></strong><span class="vector-progress"><i style="width:${Math.round(100*g.onsite/g.total)}%"></i></span></button>`).join('')||'<p class="vector-empty">No workforce records in your current scope.</p>'}</div></section>`;
}
function renderHome(content){
  clearActionContext();if(content.dataset.vectorHome==='1'){focusReturnedActionList(content);return;}
  const source=document.createElement('div');source.className='vector-home-source';while(content.firstChild)source.appendChild(content.firstChild);content.appendChild(source);
  const d=currentDate(),home=document.createElement('div');home.className='vector-home vector-today-v2';home.dataset.vectorRelease=RELEASE;
  home.innerHTML=`<section class="vector-welcome"><div><span class="vector-eyebrow">TODAY · ${esc(siteName())}</span><h1>${esc(greeting())}, ${esc(firstName())}.</h1><p>Your people, priorities and next decisions. All in one place.</p></div><div class="vector-date"><b>${esc(d.date)}</b><span>Week ${d.week} · Current workspace</span></div></section><section class="vector-kpi-grid" data-vector-kpi-evidence="${KPI_MARKER}" aria-label="Current workforce summary">${todayKpis().map(m=>`<button type="button" class="vector-kpi-card ${m.tone}" data-vector-route="${esc(m.route)}"><span class="vector-kpi-icon">${icon(m.icon)}</span><span class="vector-kpi-copy" ${m.label==='Items needing attention'?'data-vector-focus-attention':''}><b>${esc(m.label)}</b><strong ${m.label==='Items needing attention'?'data-vector-attention-count':''}>${esc(m.value)}</strong><small>${esc(m.detail)}</small></span></button>`).join('')}</section><div class="vector-decision-grid">${alertsMarkup(structuredReviewRows())}${focusMarkup()}</div>${workforceMarkup()}<div class="vector-today-bottom">${leaveMarkup(leaveRows())}<aside class="vector-next"><span class="vector-ai-glyph">${icon('sparkle')}</span><h2>Less searching.<br>More moving forward.</h2><p>Ask a question, find the right record and take the next step with Vector.</p><button type="button" data-vector-help>Ask Vector ${icon('arrow')}</button></aside></div><p class="vector-data-note">${source.querySelector('.opsbar')?'':'Development workspace · Fictional workforce records. Open an item to review its details.'}</p>`;
  content.prepend(home);content.dataset.vectorHome='1';document.title='Vector · Today';focusReturnedActionList(home);
}
function generalPage(content){if(content.dataset.vectorHome==='1')return;content.classList.add('vector-page-content');ensureActionContext(content);}
function apply(){if(state.queued)return;state.queued=true;queueMicrotask(()=>{state.queued=false;shellObserver?.disconnect();try{const app=document.querySelector('.app'),content=document.querySelector('.content');if(!app||!content)return;document.body.classList.remove('ux-reset-active');document.body.classList.add('vector-ui-active');document.body.dataset.vectorUi='vector-v2';document.body.dataset.vectorRelease=RELEASE;app.dataset.vectorShell=MARKER;const retiredTarget=RETIRED_ROUTE_REDIRECTS[page()];if(retiredTarget){go(retiredTarget);return;}if(vectorHomeRequested()&&page()!=='overview'){clearVectorHomeRequest();go('overview');return;}if(vectorHomeRequested())clearVectorHomeRequest();ensureSidebar(app);ensureTopbar(app);if(page()==='overview'&&!employee())renderHome(content);else generalPage(content);updateNav();void loadTimeReviewEvidence();}catch(error){document.body.classList.add('vector-ui-active');const root=document.getElementById('root');if(root&&!root.querySelector('.vector-render-error')){root.innerHTML='<div class="vector-render-error" role="alert"><strong>Vector could not render this screen.</strong><span>Reload the page. If this remains visible, the client render failed before the workspace could mount.</span></div>';}}finally{try{shellObserver?.observe(document.documentElement,observerConfig);}catch{}}});}
document.addEventListener('click',e=>{if(e.target.closest('[data-vector-focus-attention]')){state.returnFocus=true;go('overview');return;}const navButton=e.target.closest('[data-vector-nav]');if(navButton){const spec=NAV[Number(navButton.dataset.vectorNav)];if(spec)go(firstRoute(spec.routes));return;}if(e.target.closest('[data-vector-return-context]')){clearActionContext();state.returnFocus=true;go('overview');return;}const actionButton=e.target.closest('[data-vector-source-id][data-vector-workflow][data-vector-route]');if(actionButton){rememberActionContext({sourceId:actionButton.dataset.vectorSourceId,workflow:actionButton.dataset.vectorWorkflow,route:actionButton.dataset.vectorRoute,title:actionButton.closest('.vector-alert-row')?.querySelector('b')?.textContent||'Time Review item'});go(actionButton.dataset.vectorRoute);return;}const route=e.target.closest('[data-vector-route]')?.dataset.vectorRoute;if(route){e.preventDefault();go(route);return;}if(e.target.closest('[data-vector-menu]')){document.body.classList.toggle('vector-menu-open');updateNav();return;}if(e.target.closest('[data-vector-help]')){const launch=document.getElementById('wfm-bot-launch');if(launch)launch.click();else go('support');return;}if(e.target.closest('[data-vector-alerts]')){go('time-review');return;}const prompt=e.target.closest('[data-vector-prompt]')?.dataset.vectorPrompt;if(prompt){askWorkforce(prompt);return;}if(e.target.closest('[data-vector-assistant-send]')){const box=document.querySelector('.vector-assistant-input input');if(box?.value.trim())askWorkforce(box.value.trim());return;}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.body.classList.remove('vector-menu-open');const input=e.target.closest('.vector-global-search input,.vector-assistant-input input');if(input&&e.key==='Enter'&&input.value.trim()){e.preventDefault();askWorkforce(input.value.trim());}});
const previousRender=window.render;
if(typeof previousRender==='function')window.render=async function(...args){const result=await previousRender.apply(this,args);document.body.classList.remove('vector-menu-open');queueMicrotask(apply);return result;};
shellObserver=new MutationObserver(()=>apply());
shellObserver.observe(document.documentElement,observerConfig);
setTimeout(apply,0);setTimeout(apply,350);
window.VectorWorkforceOperations={marker:MARKER,release:RELEASE,navigationModel,reviewMarker:REVIEW_MARKER,planningMarker:PLANNING_MARKER,kpiMarker:KPI_MARKER,identityMarker:IDENTITY_MARKER,leaveMarker:LEAVE_MARKER,actionMarker:ACTION_MARKER,actionDisposition,actionQueueGroups,apply,go,askWorkforce};
})();
