/* WFM approved concept-fidelity shell.
 * This presentation layer moves existing authoritative controls into the approved
 * manufacturing command-centre hierarchy. It does not replace server permissions,
 * attendance/payroll authority, scheduling rules or audit behaviour.
 */
(function(){
'use strict';

const MARKER='WFM_CONCEPT_FIDELITY_V3';
const MODES=['site_default','decision_first','operational_visual','compact'];
const MODE_LABELS={site_default:'Site Default',decision_first:'Decision First',operational_visual:'Operational Visual',compact:'Compact'};
const MANAGER_NAV=[
  {label:'Today',pages:['overview']},
  {label:'People',pages:['leave','attendance','time-review','organisation']},
  {label:'Plan',pages:['schedule-publication','shifts','readiness','cover']},
  {label:'Improve',pages:['savings-decisions','costs','insights','forecast']}
];
const state={mode:'site_default',loaded:false,loading:false,scope:null};

const manager=()=>{try{return !isEmployee()&&['manager','director','supervisor'].includes((typeof F!=='undefined'&&F.actor?.role)||ui?.role);}catch{return false;}};
const employee=()=>{try{return isEmployee();}catch{return false;}};
const text=node=>(node?.textContent||'').replace(/\s+/g,' ').trim();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function setButtonLabel(button,label){
  if(!button)return;
  const span=button.querySelector('span:not(.count):not(.review-count)');
  if(span){if(span.textContent!==label)span.textContent=label;}
  else if(button.textContent!==label)button.textContent=label;
  button.setAttribute('aria-label',label);
  button.setAttribute('title',label);
}
function routeFor(buttons,pages){return pages.find(page=>buttons.some(b=>b.dataset.page===page))||null;}
function drawerBucket(page){
  if(['leave','attendance','time-review','weekly-review','schedule-publication','shifts','readiness','cover','op-breaks','op-swaps','shutdowns','temporary'].includes(page))return 0;
  if(['savings-decisions','costs','forecast','demand','benchmarks','op-sites','payroll-run','payroll','insights'].includes(page))return 1;
  if(['organisation','onboarding','demand-input','op-settings','integrations','compliance'].includes(page))return 2;
  return 3;
}
function ensureDrawerRoute(button){
  const drawer=document.querySelector('.ux-tool-drawer');
  if(!drawer||!button?.dataset.page)return;
  if(drawer.querySelector('.navbtn[data-page="'+CSS.escape(button.dataset.page)+'"]'))return;
  const lists=[...drawer.querySelectorAll('.ux-tool-list')];
  if(!lists.length)return;
  const clone=button.cloneNode(true);
  clone.removeAttribute('id');
  clone.classList.remove('ux-primary-route','ux-secondary-route');
  clone.classList.add('ux-drawer-route');
  lists[Math.min(drawerBucket(button.dataset.page),lists.length-1)].appendChild(clone);
}
function approvedNavigation(){
  if(!manager())return;
  const nav=document.querySelector('.sidebar nav');
  if(!nav)return;
  const buttons=[...nav.querySelectorAll('.navbtn[data-page]')];
  if(!buttons.length)return;
  const primary=[];
  for(const spec of MANAGER_NAV){
    const page=routeFor(buttons,spec.pages);
    if(!page)continue;
    const button=buttons.find(b=>b.dataset.page===page);
    primary.push(page);
    setButtonLabel(button,spec.label);
  }
  const primarySet=new Set(primary);
  for(const button of buttons){
    if(primarySet.has(button.dataset.page)){
      button.classList.add('ux-primary-route','ux-concept-primary');
      button.classList.remove('ux-secondary-route');
      button.hidden=false;
    }else{
      button.classList.add('ux-secondary-route');
      button.classList.remove('ux-primary-route','ux-concept-primary');
      ensureDrawerRoute(button);
    }
  }
  const currentOrder=[...nav.querySelectorAll('.navbtn.ux-concept-primary[data-page]')].map(b=>b.dataset.page);
  if(currentOrder.join('|')!==primary.join('|')){
    const anchor=buttons.find(b=>!primarySet.has(b.dataset.page))||nav.querySelector('.ux-more-button')||null;
    primary.map(page=>buttons.find(b=>b.dataset.page===page)).filter(Boolean).forEach(b=>nav.insertBefore(b,anchor));
  }
  const more=nav.querySelector('.ux-more-button');
  if(more)setButtonLabel(more,'More');
  nav.dataset.uxConceptNav='approved';
}
function classifyAction(node){
  const value=text(node).toLowerCase();
  if(/critical|missing|clock|coverage|risk|blocked|late|gap|unresolved|shortfall/.test(value))return 'critical';
  if(/review|pending|leave|approve|waiting|attention/.test(value))return 'review';
  return 'normal';
}
function findMetric(root,pattern){
  const labels=[...root.querySelectorAll('small,span,b,p,label')];
  for(const label of labels){
    const value=text(label);
    if(!value||!pattern.test(value))continue;
    let parent=label.parentElement;
    for(let depth=0;parent&&depth<4;depth++,parent=parent.parentElement){
      const strong=parent.querySelector('strong');
      if(strong&&text(strong)&&text(strong)!==value)return {value:text(strong),detail:value};
    }
  }
  return null;
}
function actorName(){
  try{
    const own=typeof me==='function'?me():null;
    if(own?.name)return own.name.split(' ')[0];
  }catch{}
  try{
    const a=typeof F!=='undefined'?F.actor:null;
    const id=a?.person_id||a?.personId;
    const p=id&&typeof person==='function'?person(id):null;
    if(p?.name)return p.name.split(' ')[0];
    const email=a?.email||'';
    if(email)return email.split('@')[0].split(/[._-]/)[0].replace(/^./,c=>c.toUpperCase());
  }catch{}
  return 'there';
}
function siteName(){
  try{
    const own=typeof me==='function'?me():null;
    const raw=F?.scope?.site||F?.actor?.site||own?.site||ui?.site||'Factory';
    return String(raw).replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  }catch{return 'Factory';}
}
function greeting(){
  const hour=new Date().getHours();
  return hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';
}
function decisionCount(content){
  const hero=content.querySelector('.fcc-decision-number strong');
  const parsed=Number((text(hero)||'').replace(/[^\d.]/g,''));
  if(Number.isFinite(parsed)&&parsed>=0)return String(parsed);
  return String(content.querySelectorAll('.fcc-action').length);
}
function labourMetric(){
  try{
    const report=typeof VCU!=='undefined'&&VCU?.report?VCU.report():null;
    const actual=report?.summary?.labourCostPence??report?.summary?.totalLabourCostPence??report?.insight?.labourCostPence;
    if(Number.isFinite(Number(actual))){
      return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(Number(actual)/100);
    }
  }catch{}
  return '—';
}
function topMetrics(content){
  const production=findMetric(content,/scheduled capacity vs demand|capacity vs demand/i);
  const gaps=findMetric(content,/work-centre gaps|work center gaps/i);
  return [
    {label:'Production',value:production?.value||'—',detail:production?.detail||'Capacity vs demand evidence'},
    {label:'Workforce coverage',value:gaps?.value?gaps.value+' gap'+(gaps.value==='1'?'':'s'):'—',detail:gaps?.detail||'Work-centre coverage evidence'},
    {label:'Labour cost',value:labourMetric(),detail:'Only quantified when a verified cost total is available'},
    {label:'Decisions',value:decisionCount(content),detail:'Items needing a controlled decision'}
  ];
}
function styleAction(action){
  action.dataset.uxPriority=classifyAction(action);
  action.classList.add('ux-approved-decision-card');
  if(!action.querySelector('.ux-approved-decision-badge')){
    const badge=document.createElement('span');
    badge.className='ux-approved-decision-badge '+action.dataset.uxPriority;
    badge.textContent=action.dataset.uxPriority==='critical'?'Needs attention':action.dataset.uxPriority==='review'?'Review':'Decision';
    action.insertAdjacentElement('afterbegin',badge);
  }
  if(!action.dataset.uxConceptBound){
    action.dataset.uxConceptBound='1';
    action.addEventListener('click',event=>{
      if(event.target.closest('button,a,input,select,textarea,summary'))return;
      openDrawer(action);
    });
  }
}
function ensureDecisionDrawer(){
  if(document.querySelector('.ux-concept-decision-drawer'))return;
  const backdrop=document.createElement('div');
  backdrop.className='ux-concept-drawer-backdrop';
  backdrop.addEventListener('click',closeDrawer);
  const drawer=document.createElement('aside');
  drawer.className='ux-concept-decision-drawer';
  drawer.setAttribute('aria-label','Decision path');
  drawer.innerHTML='<div class="ux-concept-drawer-head"><div><span class="eyebrow">DECISION PATH</span><h2>From signal to verified outcome</h2></div><button type="button" class="ux-concept-drawer-close" aria-label="Close">×</button></div><div class="ux-concept-decision-title" data-concept-title>Selected manager action</div><div class="ux-concept-steps"><div class="ux-concept-step active"><span class="ux-concept-step-dot">1</span><div><b>Detected</b><small>The WFM evidence raised this item.</small></div></div><div class="ux-concept-step active"><span class="ux-concept-step-dot">2</span><div><b>Analysed</b><small>Production, skills, availability, compliance and cost evidence remain underneath the decision.</small></div></div><div class="ux-concept-step active"><span class="ux-concept-step-dot">3</span><div><b>Your Decision</b><small>Approve, change or reject using the original controlled action.</small></div></div><div class="ux-concept-step"><span class="ux-concept-step-dot">4</span><div><b>Applying</b><small>No action bypasses approval, attendance, eligibility or payroll controls.</small></div></div><div class="ux-concept-step"><span class="ux-concept-step-dot">5</span><div><b>Verified</b><small>The result remains auditable and measurable after application.</small></div></div></div><div class="ux-concept-drawer-note">Simple decision on screen. Heavy reasoning underneath. This panel explains the controlled journey; it never creates authority.</div>';
  drawer.querySelector('.ux-concept-drawer-close').addEventListener('click',closeDrawer);
  document.body.append(backdrop,drawer);
}
function closeDrawer(){
  document.querySelector('.ux-concept-decision-drawer')?.classList.remove('open');
  document.querySelector('.ux-concept-drawer-backdrop')?.classList.remove('open');
}
function openDrawer(action){
  ensureDecisionDrawer();
  const title=document.querySelector('[data-concept-title]');
  if(title)title.textContent=text(action).replace(/Needs attention|Review|Decision/g,'').trim().slice(0,180)||'Selected manager action';
  document.querySelector('.ux-concept-decision-drawer')?.classList.add('open');
  document.querySelector('.ux-concept-drawer-backdrop')?.classList.add('open');
}
function siteScope(){
  let site='default';
  try{site=String(ui?.site||F?.scope?.site||F?.actor?.site||'default').trim()||'default';}catch{}
  return 'site:'+site.replace(/[^A-Za-z0-9_.:-]/g,'_').slice(0,90);
}
async function preferenceApi(method='GET',payload){
  const scope=state.scope||siteScope();
  const url='/api/ux-preference?scope='+encodeURIComponent(scope);
  const init={method,credentials:'same-origin',headers:{Accept:'application/json'}};
  if(payload){init.headers['Content-Type']='application/json';init.body=JSON.stringify({scope,...payload});}
  const response=await fetch(url,init);
  let data={};try{data=await response.json();}catch{}
  if(!response.ok)throw new Error(data.error||'Could not save presentation preference.');
  return data;
}
function effectiveMode(){
  if(state.mode!=='site_default')return state.mode;
  return document.querySelectorAll('.ux-approved-decision-card[data-ux-priority="critical"]').length?'decision_first':'decision_first';
}
function applyMode(){
  const effective=effectiveMode();
  document.body.dataset.uxViewMode=effective;
  document.body.dataset.uxViewPreference=state.mode;
  document.querySelectorAll('.ux-view-choice').forEach(button=>button.classList.toggle('active',button.dataset.mode===state.mode));
  const label=document.querySelector('[data-ux-view-current]');
  const nextLabel=MODE_LABELS[state.mode]||MODE_LABELS.site_default;
  if(label&&label.textContent!==nextLabel)label.textContent=nextLabel;
  if(manager()&&ui?.page==='overview'){
    const details=[...document.querySelectorAll('.ux-today-detail')];
    if(effective==='operational_visual')details.filter(d=>d.classList.contains('readiness')||d.classList.contains('capacity')).forEach(d=>d.open=true);
    if(effective==='compact')details.forEach(d=>d.open=false);
  }
}
async function loadPreference(){
  if(state.loading||state.loaded||!document.querySelector('.content')||employee())return;
  state.loading=true;state.scope=siteScope();
  try{
    const data=await preferenceApi();
    if(MODES.includes(data.mode))state.mode=data.mode;
  }catch{
    state.mode=localStorage.getItem('wfm.ux.mode')||'site_default';
  }
  if(!MODES.includes(state.mode))state.mode='site_default';
  state.loaded=true;state.loading=false;applyMode();
}
function viewSettingsMarkup(){
  return '<div class="ux-approved-view"><button type="button" class="ux-approved-view-button" data-ux-view-toggle aria-expanded="false"><span>View settings</span><b data-ux-view-current>'+esc(MODE_LABELS[state.mode])+'</b></button><div class="ux-approved-view-menu" data-ux-view-menu hidden><span class="eyebrow">PRESENTATION</span><p>Change how this site is presented. Controls and evidence stay available.</p><div class="ux-view-choices">'+MODES.map(mode=>'<button type="button" class="ux-view-choice" data-mode="'+mode+'">'+MODE_LABELS[mode]+'</button>').join('')+'</div></div></div>';
}
function wireViewSettings(shell){
  const toggle=shell.querySelector('[data-ux-view-toggle]');
  const menu=shell.querySelector('[data-ux-view-menu]');
  if(toggle&&menu){
    toggle.addEventListener('click',()=>{
      const opening=menu.hidden;
      menu.hidden=!opening;
      toggle.setAttribute('aria-expanded',String(opening));
    });
    menu.addEventListener('click',async event=>{
      const button=event.target.closest('.ux-view-choice');
      if(!button)return;
      const next=button.dataset.mode;
      if(!MODES.includes(next))return;
      const previous=state.mode;
      state.mode=next;applyMode();localStorage.setItem('wfm.ux.mode',next);
      try{
        await preferenceApi('POST',{mode:next});
        menu.hidden=true;toggle.setAttribute('aria-expanded','false');
      }catch(err){
        state.mode=previous;applyMode();
        const note=menu.querySelector('p');if(note)note.textContent=err.message||'Could not save view preference.';
      }
    });
  }
  loadPreference();
}
function buildKpiRow(metrics){
  const row=document.createElement('section');
  row.className='ux-approved-kpis';
  row.setAttribute('aria-label','Manufacturing decision KPIs');
  row.innerHTML=metrics.map((metric,index)=>'<article class="ux-approved-kpi kpi-'+index+'"><span>'+esc(metric.label)+'</span><strong>'+esc(metric.value)+'</strong><small>'+esc(metric.detail)+'</small></article>').join('');
  return row;
}
function buildApprovedToday(content){
  if(!manager()||ui?.page!=='overview'||content.querySelector('.ux-approved-today'))return;

  const existingHero=content.querySelector('.fcc-hero');
  const existingMain=content.querySelector('.fcc-main');
  const existingPulse=content.querySelector('.fcc-pulse-grid');
  const existingDept=content.querySelector('.fcc-dept-grid');
  const actions=existingMain?[...existingMain.querySelectorAll('.fcc-action')]:[...content.querySelectorAll('.fcc-action')];
  const metrics=topMetrics(content);

  const shell=document.createElement('div');
  shell.className='ux-approved-today';
  shell.innerHTML='<header class="ux-approved-topbar"><div class="ux-approved-greeting"><span class="eyebrow">'+esc(siteName())+'</span><h1>'+esc(greeting()+', '+actorName()+'.')+'</h1><p>Everything needing attention, cost or a decision — without making you hunt through dashboards.</p></div><div class="ux-approved-top-actions"><span class="ux-approved-live"><i></i>Factory view live</span>'+viewSettingsMarkup()+'</div></header>';

  const kpis=buildKpiRow(metrics);
  shell.appendChild(kpis);

  const mainGrid=document.createElement('div');
  mainGrid.className='ux-approved-main-grid';

  const decisions=document.createElement('section');
  decisions.className='ux-approved-decisions';
  decisions.innerHTML='<div class="ux-approved-section-head"><div><span class="eyebrow">YOUR DECISIONS</span><h2>What needs your decision</h2><p>The system has already narrowed the work. Open an item to see the controlled path, or use its existing action.</p></div><span class="ux-approved-count">'+actions.length+' waiting</span></div><div class="ux-approved-decision-list"></div>';
  const decisionList=decisions.querySelector('.ux-approved-decision-list');
  actions.forEach(action=>{styleAction(action);decisionList.appendChild(action);});
  if(!actions.length)decisionList.innerHTML='<div class="ux-approved-empty">Nothing needs a manager decision right now.</div>';
  mainGrid.appendChild(decisions);

  const live=document.createElement('section');
  live.className='ux-approved-lines';
  live.innerHTML='<div class="ux-approved-section-head"><div><span class="eyebrow">PRODUCTION LIVE</span><h2>Live line status</h2><p>Work-centre readiness stays evidence-based; a green card is not a safety clearance.</p></div></div><div class="ux-approved-line-grid"></div>';
  const lineGrid=live.querySelector('.ux-approved-line-grid');
  if(existingDept){
    [...existingDept.children].forEach((node,index)=>{
      node.classList.add('ux-approved-line-card');
      node.dataset.uxLineTone=index===1?'review':'clear';
      lineGrid.appendChild(node);
    });
  }
  if(!lineGrid.children.length){
    ['Production','People coverage','Readiness'].forEach((label,index)=>{
      const card=document.createElement('article');card.className='ux-approved-line-card';card.dataset.uxLineTone=index===1?'review':'clear';card.innerHTML='<b>'+esc(label)+'</b><span>Open Plan for detailed evidence</span>';lineGrid.appendChild(card);
    });
  }
  mainGrid.appendChild(live);
  shell.appendChild(mainGrid);

  content.prepend(shell);
  wireViewSettings(shell);

  if(existingHero)existingHero.classList.add('ux-concept-source-hidden');
  if(existingMain)existingMain.classList.add('ux-concept-source-hidden');
  if(existingPulse)existingPulse.classList.add('ux-concept-source-hidden');
  if(existingDept)existingDept.classList.add('ux-concept-source-grid');
  content.dataset.uxApprovedToday='1';
  ensureDecisionDrawer();
  applyMode();
}
function enhancePageLabels(content){
  if(!manager())return;
  const spec={
    leave:['People','Absence, entitlement, attendance and coverage decisions in one controlled workspace.'],
    attendance:['People','Attendance evidence, exceptions and corrective action without losing auditability.'],
    'time-review':['People','Review only the time evidence that needs attention.'],
    'schedule-publication':['Plan','Build, review and publish the workforce plan with production evidence attached.'],
    shifts:['Plan','Build, review and publish the workforce plan with production evidence attached.'],
    readiness:['Plan','Understand whether people, skills and demand are genuinely covered.'],
    'savings-decisions':['Improve','Prioritise evidenced workforce improvements and financial impact.'],
    costs:['Improve','Understand cost, efficiency and the decisions that can change them.'],
    insights:['Improve','Understand cost, efficiency and the decisions that can change them.']
  }[ui?.page];
  if(!spec)return;
  const heading=content.querySelector('.heading');
  if(!heading)return;
  const h=heading.querySelector('h1'),p=heading.querySelector('p');
  if(h&&!h.dataset.uxConceptTitle){h.dataset.uxConceptTitle='1';h.textContent=spec[0];}
  if(p&&!p.dataset.uxConceptSubtitle){p.dataset.uxConceptSubtitle='1';p.textContent=spec[1];}
}
function apply(){
  document.body.dataset.uxConcept='fidelity-v3';
  const content=document.querySelector('.content');
  if(!content)return;
  approvedNavigation();
  enhancePageLabels(content);
  buildApprovedToday(content);
  ensureDecisionDrawer();
  applyMode();
}

const previousRender=window.render;
if(typeof previousRender==='function')window.render=async function(...args){
  const result=await previousRender.apply(this,args);
  state.loaded=false;
  queueMicrotask(apply);
  return result;
};
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeDrawer();const menu=document.querySelector('[data-ux-view-menu]');if(menu)menu.hidden=true;}});
const observer=new MutationObserver(()=>queueMicrotask(apply));
observer.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);
setTimeout(apply,450);
window.WFMConceptFidelity={marker:MARKER,apply,closeDrawer,modes:MODES,state};
})();