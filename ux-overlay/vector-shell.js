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
const INTELLIGENCE_MARKER='VECTOR_INTELLIGENCE_COMMAND_LAYER_V1';
const NAV=[
  {label:'Home', icon:'home', routes:['overview']},
  {label:'People', icon:'people', routes:['org-admin','organisation','resources']},
  {label:'Time & Attendance', icon:'clock', routes:['time-review','attendance']},
  {label:'Absence & Leave', icon:'leave', routes:['leave']},
  {label:'Scheduling', icon:'calendar', routes:['schedule-publication','shifts']},
  {label:'Labour Planning', icon:'planning', routes:['demand','readiness','cover']},
  {label:'Skills & Training', icon:'training', routes:['resources','readiness']},
  {label:'Compliance', icon:'shield', routes:['compliance','readiness']},
  {label:'Cost & Productivity', icon:'cost', routes:['costs','insights']},
  {label:'Reports', icon:'report', routes:['forecast','payroll-intelligence','payroll-run','insights']},
  {label:'Integrations', icon:'integrations', routes:['integrations']},
  {label:'Admin', icon:'settings', routes:['onboarding','org-admin','company-settings','op-settings']}
];
const RETIRED_ROUTE_REDIRECTS=Object.freeze({'weekly-review':'time-review','savings-decisions':'costs'});
const state={queued:false};
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
function firstRoute(routes){const buttons=sourceButtons();for(const route of routes){if(buttons.some(b=>b.dataset.page===route))return route;}return routes[0]||'overview';}
function go(route){const button=sourceButtons().find(b=>b.dataset.page===route);if(button){button.click();return;}try{if(typeof nav==='function'){nav(route);return;}}catch{}}
function activeFor(spec){const current=page();return spec.routes.includes(current)||firstRoute(spec.routes)===current;}
function sourceIdentity(){try{if(typeof me!=='function')return {};const own=me()||{};const name=typeof own.name==='string'&&own.name.trim()?own.name.trim():null;const siteCandidates=[own.siteName,own.plantName,own.locationName,own.site?.name,own.plant?.name,own.location?.name];const site=siteCandidates.find(v=>typeof v==='string'&&v.trim())?.trim()||null;return {name,site};}catch{return {}}}
const displayName=()=>sourceIdentity().name||'Signed-in user';
const firstName=()=>{const name=sourceIdentity().name;return name?name.split(/\s+/)[0]:'there';};
const siteName=()=>sourceIdentity().site||'Current workspace';
const siteSentence=()=>sourceIdentity().site?`Here’s what’s happening at ${sourceIdentity().site} today.`:'Here’s what’s happening in your current workspace today.';
function roleContext(){
  try{
    const own=typeof me==='function'?(me()||{}):{};
    const raw=[own.role,own.roleName,own.title,own.jobTitle,own.position].find(v=>typeof v==='string'&&v.trim())||'';
    const sites=Array.isArray(own.siteIds)?own.siteIds:Array.isArray(own.sites)?own.sites.map(s=>s?.id||s?.name).filter(Boolean):[];
    const role=String(raw).toLowerCase();
    let key='EMPLOYEE';
    if(/director|chief|\\bmd\\b|executive|vp|vice president/.test(role))key='DIRECTOR';
    else if(/ops|operations|regional|area|group|multi.?site/.test(role)||(sites.length>1&&role!=='employee'))key='OPS_MANAGER';
    else if(/manager|supervisor|team leader|shift leader|planner|admin/.test(role))key='SITE_MANAGER';
    return {key,raw:String(raw||''),siteIds:sites,siteCount:sites.length||null};
  }catch{return {key:employee()?'EMPLOYEE':'SITE_MANAGER',raw:'',siteIds:[],siteCount:null};}
}
function roleViewCopy(){
  const r=roleContext();
  if(r.key==='OPS_MANAGER')return {label:'Multi-site Operations',scope:'Cross-site',horizon:'Rolling 4 weeks',prompts:['Which site needs attention and why?','Where are we wasting the most money?','Compare agency dependency across sites','Create a Monday operations pack','Email this report weekly'],principle:'Focus on cross-site variance, systemic causes, value and interventions local managers cannot see.'};
  if(r.key==='DIRECTOR')return {label:'Director / Executive',scope:'Enterprise',horizon:'Quarter',prompts:['Summarise operational performance','What will affect margin this quarter?','Where is our biggest strategic risk?','Create a board pack','Email this to the leadership team'],principle:'Focus on value, margin, resilience and strategic exceptions; hide operational noise.'};
  if(r.key==='EMPLOYEE')return {label:'Employee',scope:'My work',horizon:'Today',prompts:['What do I need to do today?','How much holiday do I have left?','Why is my shift different tomorrow?'],principle:'Show only personal actions and information.'};
  return {label:'Site Manager',scope:'Current site',horizon:'Today',prompts:['What needs my attention today?','Why is overtime high?','Where is coverage at risk?','Create my weekly labour report','Set a task to review agency spend'],principle:'Focus on today’s exceptions that affect people, production, compliance or cost.'};
}
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
function actionRows(source){const actions=[...(source?.querySelectorAll('.fcc-action,.ux-approved-decision-card')||[])].slice(0,4);return actions.map((a,i)=>{const title=(a.querySelector('b,strong')?text(a.querySelector('b,strong')):text(a)).slice(0,44)||'Workforce item';const p=a.querySelector('p,small');const detail=(p?text(p):text(a).replace(title,'')).slice(0,78);const route=a.dataset.page||a.querySelector('[data-page]')?.dataset.page||['readiness','time-review','resources','time-review'][i];return {title,detail,route,tone:'blue',action:'Review',status:'Needs review'};});}
function leaveDate(value){const d=new Date(value);return Number.isFinite(d.getTime())?d:null;}
function leaveWhen(value){const d=leaveDate(value);return d?new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short'}).format(d):'Date unavailable';}
function leaveRows(){try{if(typeof data==='undefined'||!Array.isArray(data.requests))return [];const now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),now.getDate()),end=new Date(start);end.setDate(end.getDate()+7);return data.requests.filter(r=>String(r.status||'').toLowerCase()==='approved').map(r=>({r,date:leaveDate(r.start||r.date)})).filter(x=>x.date&&x.date>=start&&x.date<end).sort((a,b)=>a.date-b.date).slice(0,4).map(({r,date})=>{let p=null;try{if(typeof person==='function')p=person(r.employee)||null;}catch{}const name=(typeof p?.name==='string'&&p.name.trim())?p.name.trim():(typeof r.employeeName==='string'&&r.employeeName.trim()?r.employeeName.trim():'Employee');const area=[p?.departmentName,p?.teamName,p?.areaName].find(v=>typeof v==='string'&&v.trim())?.trim()||'Source-confirmed leave';const type=(typeof r.typeLabel==='string'&&r.typeLabel.trim())?r.typeLabel.trim():(typeof r.type==='string'&&r.type.trim()?r.type.trim():'Leave');return {name,area,when:leaveWhen(date),type};});}catch{return []}}
function currentDate(){const d=new Date();const date=new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}).format(d);const jan4=new Date(Date.UTC(d.getUTCFullYear(),0,4));const day=(d.getUTCDay()+6)%7;const thurs=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day+3));const janThurs=new Date(Date.UTC(jan4.getUTCFullYear(),0,4-((jan4.getUTCDay()+6)%7)+3));const week=1+Math.round((thurs-janThurs)/604800000);return {date,week};}
function greeting(){const h=new Date().getHours();return h<12?'Good morning':h<18?'Good afternoon':'Good evening';}

function ensureSidebar(app){let sidebar=app.querySelector(':scope > .vector-sidebar');if(sidebar)return sidebar;sidebar=document.createElement('aside');sidebar.className='vector-sidebar';sidebar.setAttribute('aria-label','Vector primary navigation');sidebar.innerHTML=`
 <div class="vector-brand"><span class="vector-mark" aria-hidden="true"><i></i><i></i><i></i></span><div><strong>Vector</strong><small>People. Productivity. Possibility.</small></div></div>
 <nav class="vector-nav">${NAV.map((n,i)=>`<button type="button" class="vector-nav-item" data-vector-nav="${i}" aria-label="${esc(n.label)}">${icon(n.icon)}<span>${esc(n.label)}</span></button>`).join('')}</nav>
 <button type="button" class="vector-site-card" data-vector-route="overview" data-vector-identity="${IDENTITY_MARKER}"><span class="vector-site-icon">▧</span><span><b>Manufacturing</b><small>${esc(siteName())}</small></span>${icon('chevron')}</button>`;app.prepend(sidebar);return sidebar;}
function ensureTopbar(app){const content=app.querySelector('.content');if(!content)return null;const parent=content.parentElement;let bar=parent.querySelector(':scope > .vector-topbar');if(bar)return bar;bar=document.createElement('header');bar.className='vector-topbar';bar.innerHTML=`
 <button type="button" class="vector-mobile-menu" data-vector-menu aria-label="Open menu">${icon('menu')}</button>
 <label class="vector-global-search">${icon('search')}<input type="search" placeholder='Ask anything... (e.g. "who’s off next week?" or "show overtime this month")' aria-label="Ask Vector"/></label>
 <div class="vector-top-actions"><button type="button" class="vector-icon-button" data-vector-alerts aria-label="Notifications">${icon('bell')}<span class="vector-notification-count" hidden>0</span></button><button type="button" class="vector-icon-button" data-vector-help aria-label="Help">${icon('help')}</button><button type="button" class="vector-user-button" data-vector-identity="${IDENTITY_MARKER}"><span class="vector-avatar">${esc(initials())}</span><span class="vector-user-copy"><b>${esc(displayName())}</b><small>${esc(siteName())}</small></span><span class="vector-user-chevron">⌄</span></button></div>`;parent.insertBefore(bar,content);return bar;}
function updateNav(){const sidebar=document.querySelector('.vector-sidebar');if(!sidebar)return;sidebar.querySelectorAll('[data-vector-nav]').forEach((b,i)=>b.classList.toggle('active',activeFor(NAV[i])));const alerts=document.querySelector('.vector-notification-count');const count=document.querySelectorAll('.vector-home-source .fcc-action,.vector-home-source .ux-approved-decision-card').length;if(alerts){alerts.textContent=String(count);alerts.hidden=!count}}
function askWorkforce(message){const launch=document.getElementById('wfm-bot-launch');if(launch&&document.getElementById('wfm-bot')?.hidden)launch.click();setTimeout(()=>{const box=document.getElementById('bot-message');if(box){box.value=String(message||'').slice(0,2000);box.dispatchEvent(new Event('input',{bubbles:true}));box.focus();}},180);}
function commandResultCopy(payload){
  const intent=payload?.envelope?.command?.intent||'ANALYSE';
  const status=payload?.status||'ACCEPTED';
  if(intent==='CREATE_TASK')return {title:'Task created',detail:'The task has been saved in your Vector scope and is auditable.'};
  if(intent==='CHANGE_WIDGET'||intent==='CHANGE_CHART')return {title:'View preference saved',detail:'Vector has stored this dashboard preference for the current screen.'};
  if(intent==='CREATE_AUTOMATION')return {title:'Automation configured',detail:status==='CONFIGURED_PENDING_WORKER'?'The schedule is saved. Execution remains fail-closed until the automation runner is connected.':'The automation is active.'};
  if(intent==='EMAIL_REPORT')return {title:'Email report requested',detail:payload?.capabilities?.emailDelivery?'The report can be generated and delivered through the configured email provider.':'The report request is saved; email delivery remains fail-closed until a provider is configured.'};
  if(intent==='CREATE_REPORT')return {title:'Report requested',detail:'Vector has saved the report request for generation from role-scoped data.'};
  return {title:'Analysing this now',detail:'Vector is handing the question to the analysis assistant with your current screen and role scope.'};
}
function ensureCommandDrawer(){
  let drawer=document.querySelector('.vector-command-drawer');
  if(drawer)return drawer;
  drawer=document.createElement('aside');
  drawer.className='vector-command-drawer';
  drawer.hidden=true;
  drawer.setAttribute('aria-label','Ask Vector');
  document.body.appendChild(drawer);
  return drawer;
}
function renderCommandDrawer(message,payload,error){
  const drawer=ensureCommandDrawer(),rv=roleViewCopy();
  const copy=error?{title:'Vector could not complete that request',detail:error}:commandResultCopy(payload);
  drawer.innerHTML=`<div class="vector-command-head"><span class="vector-ai-glyph">${icon('sparkle')}</span><div><b>Ask Vector</b><small>${esc(rv.label)} · ${esc(rv.scope)}</small></div><button type="button" data-vector-command-close aria-label="Close">×</button></div><div class="vector-command-body"><span class="vector-command-request">${esc(message)}</span><h3>${esc(copy.title)}</h3><p>${esc(copy.detail)}</p><div class="vector-command-policy"><b>Decision lens</b><span>${esc(rv.principle)}</span></div><div class="vector-command-capabilities"><span>Analyse</span><span>Reports</span><span>Email</span><span>Tasks</span><span>Automations</span><span>Widgets</span></div></div>`;
  drawer.hidden=false;
  return drawer;
}
async function askVector(message){
  const textValue=String(message||'').trim().slice(0,2000);
  if(!textValue)return;
  const rv=roleContext();
  renderCommandDrawer(textValue,{envelope:{command:{intent:'ANALYSE'}},status:'ACCEPTED',capabilities:{}});
  try{
    const response=await fetch('/api/intelligence/vector/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:textValue,currentScreen:page(),jobTitle:rv.raw,siteIds:rv.siteIds,siteCount:rv.siteCount})});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload?.error||'Vector refused the request safely.');
    renderCommandDrawer(textValue,payload);
    const intent=payload?.envelope?.command?.intent;
    if(intent==='ANALYSE'||intent==='NAVIGATE')askWorkforce(textValue);
    return payload;
  }catch(error){
    renderCommandDrawer(textValue,null,String(error?.message||error||'Request failed.'));
    askWorkforce(textValue);
  }
}
function buildAssistant(){const rv=roleViewCopy(),prompts=rv.prompts;return `<aside class="vector-assistant" data-vector-intelligence="${INTELLIGENCE_MARKER}"><div class="vector-assistant-title"><span class="vector-ai-glyph">${icon('sparkle')}</span><h2>Ask Vector</h2><span class="vector-beta">${esc(rv.label)}</span></div><p>${esc(rv.principle)} Ask questions, create reports, set tasks or automations, and change how this dashboard is presented.</p><div class="vector-prompt-list">${prompts.map(p=>`<button type="button" data-vector-prompt="${esc(p)}">${esc(p)}</button>`).join('')}</div><label class="vector-assistant-input"><input type="text" placeholder="Ask, report, automate or change this view..." aria-label="Ask Vector"/><button type="button" data-vector-assistant-send aria-label="Ask">${icon('arrow')}</button></label></aside>`;}
function kpiMarkup(items){return items.map((m,i)=>`<button type="button" class="vector-kpi-card ${m.tone}" data-vector-route="${['attendance','leave','time-review','costs'][i]}"><span class="vector-kpi-icon">${icon(m.icon)}</span><span class="vector-kpi-copy"><strong>${esc(m.value)}</strong><b>${esc(m.label)}</b><small>${esc(m.detail)}</small>${m.progress!=null?`<span class="vector-progress"><i style="width:${Math.max(0,Math.min(100,m.progress))}%"></i></span>`:''}</span></button>`).join('');}
function shiftsMarkup(rows){return `<section class="vector-card vector-shifts" data-vector-planning="${PLANNING_MARKER}"><div class="vector-card-head"><h2>Department planning</h2><button type="button" data-vector-route="schedule-publication">Open schedule planning ${icon('arrow')}</button></div><div class="vector-shift-layout"><div class="vector-shift-chart">${rows.map(r=>`<div class="vector-shift-row"><b>${esc(r.label)}</b><div class="vector-shift-track" style="background:none;border-left:0"><span class="grey" style="width:auto;background:#eef1f5;box-shadow:none;color:#43546d"><em>${esc(r.status)}</em></span></div></div>`).join('')}</div><div class="vector-legend"><span><i class="grey"></i>Status and coverage shown only when verified by the source workflow</span></div></div></section>`;}
function secondaryKpis(m){const s=scopedStats(),vals=[{label:'Absence today',value:m[1].value==='—'?'—':m[1].value+(s.total?' / '+s.total:''),detail:m[1].detail,route:'leave'},{label:'Overtime',value:m[2].value==='—'?'—':m[2].value+' people',detail:m[2].detail,route:'time-review'},{label:'Labour cost',value:m[3].value,detail:m[3].detail,route:'costs'},{label:'Productivity',value:'—',detail:'Open productivity evidence',route:'insights'}];return `<section class="vector-mini-grid" data-vector-kpi-evidence="${KPI_MARKER}" aria-label="Operational KPI summaries. Trend graphics are shown only when verified source history is available.">${vals.map(v=>`<button type="button" class="vector-mini-card" data-vector-route="${v.route}"><span><b>${esc(v.label)}</b><strong>${esc(v.value)}</strong><small>${esc(v.detail)}</small><em>View details ${icon('arrow')}</em></span></button>`).join('')}</section>`;}
function alertsMarkup(rows){return `<section class="vector-card vector-alerts" data-vector-review="${REVIEW_MARKER}" aria-labelledby="vector-review-title"><div class="vector-card-head"><h2 id="vector-review-title"><span class="vector-alert-bell">${icon('bell')}</span>Items to review <em>${rows.length}</em></h2><button type="button" data-vector-route="time-review">View all items ${icon('arrow')}</button></div><div class="vector-alert-list">${rows.length?rows.map((r,i)=>`<div class="vector-alert-row" role="group" aria-label="${esc(r.title)}. Status: ${esc(r.status)}. Review source evidence before acting."><i class="${r.tone}" aria-hidden="true"></i><b>${esc(r.title)}</b><span>${esc(r.detail||'Review source evidence')}</span><button type="button" data-vector-route="${esc(r.route)}" aria-label="Review ${esc(r.title)}">${esc(r.action)}</button></div>`).join(''):'<div class="vector-empty">No current items need review.</div>'}</div></section>`;}
function leaveMarkup(rows){const body=rows.length?rows.slice(0,4).map((r,i)=>`<button type="button" class="vector-leave-row" data-vector-route="leave"><span class="vector-person-badge b${i}">${esc(r.name.split(/\s+/).map(x=>x[0]).join('').slice(0,2))}</span><span><b>${esc(r.name)}</b><small>${esc(r.area)}</small></span><em>${esc(r.when)}</em><strong>${esc(r.type)}</strong>${icon('chevron')}</button>`).join(''):`<button type="button" class="vector-leave-row" data-vector-route="leave" aria-label="Open Absence & Leave to review upcoming leave evidence"><span class="vector-person-badge" aria-hidden="true">i</span><span><b>Open Absence & Leave</b><small>No approved leave is available to this summary.</small></span><em>Source check</em><strong>Review</strong>${icon('chevron')}</button>`;return `<section class="vector-card vector-leave" data-vector-leave-evidence="${LEAVE_MARKER}" aria-label="Upcoming leave. Only approved source requests dated within the next seven days are shown."><div class="vector-card-head"><h2>Upcoming leave (next 7 days)</h2><button type="button" data-vector-route="leave">View calendar ${icon('arrow')}</button></div><div class="vector-leave-list">${body}</div></section>`;}
function promoMarkup(){return '<aside class="vector-promo"><div><h2>A more productive<br>tomorrow starts today.</h2><p>Empowered people.<br>Stronger manufacturers.</p></div><div class="vector-promo-brand"><span class="vector-mark small"><i></i><i></i><i></i></span><b>Vector.</b></div></aside>';}
function renderHome(content){if(content.dataset.vectorHome==='1')return;const source=document.createElement('div');source.className='vector-home-source';while(content.firstChild)source.appendChild(content.firstChild);content.appendChild(source);const m=metrics(source),departments=departmentRows(source),actions=actionRows(source),leaves=leaveRows(),d=currentDate();const home=document.createElement('div');home.className='vector-home';home.innerHTML=`<section class="vector-welcome" data-vector-identity="${IDENTITY_MARKER}"><div><h1>${esc(greeting())}, ${esc(firstName())}</h1><p>${esc(siteSentence())}</p></div><div class="vector-date"><b>${esc(d.date)}</b><span>Week ${esc(d.week)}</span></div></section><div class="vector-home-top"><div class="vector-home-main"><section class="vector-kpi-grid" data-vector-kpi-evidence="${KPI_MARKER}">${kpiMarkup(m)}</section>${shiftsMarkup(departments)}</div>${buildAssistant()}</div>${secondaryKpis(m)}<div class="vector-bottom-grid">${alertsMarkup(actions)}${leaveMarkup(leaves)}${promoMarkup()}</div>`;content.prepend(home);content.dataset.vectorHome='1';document.title='Vector · Workforce Operations';}
function screenLens(){
  const current=page(),rv=roleViewCopy();
  const map={
    leave:['So what?','Leave only matters operationally when entitlement, skills or production cover changes.','Review exceptions that change coverage; let safe requests flow automatically.'],
    attendance:['So what?','Attendance data matters when it changes payroll confidence, production coverage or compliance.','Show only mismatches that need judgement; reconcile the rest automatically.'],
    'time-review':['So what?','Time exceptions matter when they can change pay, fatigue risk or productive hours.','Prioritise financially material or low-confidence exceptions.'],
    'schedule-publication':['So what?','A schedule is good only if it covers demand, skills and legal constraints at the lowest safe cost.','Highlight gaps and the cheapest compliant fix before publishing.'],
    shifts:['So what?','A shift change matters when it changes skills, cost, rest or output.','Auto-approve harmless swaps and escalate only consequential changes.'],
    demand:['So what?','Demand data should tell you where labour will be short before the shift starts.','Resolve future gaps with redeployment, training or overtime before agency labour.'],
    readiness:['So what?','Readiness exposes where a missing person or skill can interrupt production.','Protect the highest-value capability gaps first.'],
    cover:['So what?','Cover decisions should compare internal redeployment, overtime and agency by total outcome.','Choose the lowest-cost qualified option without creating a new gap.'],
    resources:['So what?','People data should explain who is ready, who needs development and where resilience is weak.','Act on expiring skills and capability gaps that affect production.'],
    compliance:['So what?','Compliance data matters when it can block work, create safety exposure or invalidate a workforce decision.','Prioritise imminent and operationally consequential breaches.'],
    costs:['So what?','Cost variance is useful only when Vector explains why it moved and what is avoidable.','Prioritise actions with verified £ impact and track realised value afterwards.'],
    insights:['So what?','Insights should surface recurring causes and opportunities, not just describe history.','Fix structural causes and automate high-confidence repetitive decisions.'],
    integrations:['So what?','Integration health matters when stale or missing data can make a workforce decision unsafe.','Show which decisions are affected, then fail closed or use verified fallback evidence.'],
    'payroll-intelligence':['So what?','Payroll intelligence should isolate records that can actually change pay.','Sign off clean records automatically and investigate only material exceptions.'],
    'payroll-run':['So what?','Payroll is ready only when every material exception has evidence and reconciliation.','Block export where confidence is insufficient.']
  };
  const item=map[current]||['So what?','This screen should explain why its data matters to your role, not just display metrics.','Ask Vector to identify the impact, cause, £ consequence and next best action.'];
  return `<section class="vector-screen-lens" data-vector-intelligence="${INTELLIGENCE_MARKER}"><div><b>${esc(item[0])}</b><p>${esc(item[1])}</p></div><div><b>Next best action</b><p>${esc(item[2])}</p></div><div><b>Your view</b><p>${esc(rv.label)} · ${esc(rv.scope)} · ${esc(rv.horizon)}</p></div><button type="button" data-vector-analyse-screen>Analyse this screen ${icon('sparkle')}</button></section>`;
}
function generalPage(content){if(content.dataset.vectorHome==='1')return;content.classList.add('vector-page-content');if(!content.querySelector('.vector-screen-lens')){const lens=document.createElement('div');lens.innerHTML=screenLens();const node=lens.firstElementChild;const heading=content.querySelector(':scope > .heading');if(heading?.nextSibling)content.insertBefore(node,heading.nextSibling);else content.prepend(node);}}
function apply(){if(state.queued)return;state.queued=true;queueMicrotask(()=>{state.queued=false;shellObserver?.disconnect();try{const app=document.querySelector('.app'),content=document.querySelector('.content');if(!app||!content)return;document.body.classList.remove('ux-reset-active');document.body.classList.add('vector-ui-active');document.body.dataset.vectorUi='approved-reference-v1';app.dataset.vectorShell=MARKER;const retiredTarget=RETIRED_ROUTE_REDIRECTS[page()];if(retiredTarget){go(retiredTarget);return;}if(vectorHomeRequested()&&page()!=='overview'){clearVectorHomeRequest();go('overview');return;}if(vectorHomeRequested())clearVectorHomeRequest();ensureSidebar(app);ensureTopbar(app);ensureCommandDrawer();if(page()==='overview')renderHome(content);else generalPage(content);updateNav();}catch(error){document.body.classList.add('vector-ui-active');const root=document.getElementById('root');if(root&&!root.querySelector('.vector-render-error')){root.innerHTML='<div class="vector-render-error" role="alert"><strong>Vector could not render this screen.</strong><span>Reload the page. If this remains visible, the client render failed before the workspace could mount.</span></div>';}}finally{try{shellObserver?.observe(document.documentElement,observerConfig);}catch{}}});}
document.addEventListener('click',e=>{const navButton=e.target.closest('[data-vector-nav]');if(navButton){const spec=NAV[Number(navButton.dataset.vectorNav)];if(spec)go(firstRoute(spec.routes));return;}const route=e.target.closest('[data-vector-route]')?.dataset.vectorRoute;if(route){go(route);return;}if(e.target.closest('[data-vector-menu]')){document.body.classList.toggle('vector-menu-open');return;}if(e.target.closest('[data-vector-help]')){const launch=document.getElementById('wfm-bot-launch');if(launch)launch.click();else go('support');return;}if(e.target.closest('[data-vector-alerts]')){go('time-review');return;}const prompt=e.target.closest('[data-vector-prompt]')?.dataset.vectorPrompt;if(prompt){askVector(prompt);return;}if(e.target.closest('[data-vector-assistant-send]')){const box=document.querySelector('.vector-assistant-input input');if(box?.value.trim())askVector(box.value.trim());return;}if(e.target.closest('[data-vector-analyse-screen]')){askVector('Analyse this screen. Explain what matters, why, the financial or operational impact, the root cause, and the next best actions.');return;}if(e.target.closest('[data-vector-command-close]')){const drawer=document.querySelector('.vector-command-drawer');if(drawer)drawer.hidden=true;return;}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.body.classList.remove('vector-menu-open');const input=e.target.closest('.vector-global-search input,.vector-assistant-input input');if(input&&e.key==='Enter'&&input.value.trim()){e.preventDefault();askVector(input.value.trim());}});
const previousRender=window.render;
if(typeof previousRender==='function')window.render=async function(...args){const result=await previousRender.apply(this,args);document.body.classList.remove('vector-menu-open');queueMicrotask(apply);return result;};
shellObserver=new MutationObserver(()=>apply());
shellObserver.observe(document.documentElement,observerConfig);
setTimeout(apply,0);setTimeout(apply,350);
window.VectorWorkforceOperations={marker:MARKER,reviewMarker:REVIEW_MARKER,planningMarker:PLANNING_MARKER,kpiMarker:KPI_MARKER,identityMarker:IDENTITY_MARKER,leaveMarker:LEAVE_MARKER,intelligenceMarker:INTELLIGENCE_MARKER,apply,go,askWorkforce,askVector,roleContext};
})();