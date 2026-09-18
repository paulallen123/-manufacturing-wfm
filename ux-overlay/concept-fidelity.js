/* WFM concept-fidelity shell: approved manufacturing UX, preserving authoritative controls. */
(function(){
'use strict';
const MARKER='WFM_CONCEPT_FIDELITY_V2';
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
const text=n=>(n?.textContent||'').replace(/\s+/g,' ').trim();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function setButtonLabel(button,label){
  if(!button)return;
  const span=button.querySelector('span:not(.count):not(.review-count)');
  if(span){if(span.textContent!==label)span.textContent=label;}else if(button.textContent!==label)button.textContent=label;
  button.setAttribute('aria-label',label);button.setAttribute('title',label);
}
function routeFor(buttons,pages){return pages.find(page=>buttons.some(b=>b.dataset.page===page))||null;}
function drawerBucket(page){
  if(['leave','attendance','time-review','weekly-review','schedule-publication','shifts','readiness','cover','op-breaks','op-swaps','shutdowns','temporary'].includes(page))return 0;
  if(['savings-decisions','costs','forecast','demand','benchmarks','op-sites','payroll-run','payroll','insights'].includes(page))return 1;
  if(['organisation','onboarding','demand-input','op-settings','integrations','compliance'].includes(page))return 2;
  return 3;
}
function ensureDrawerRoute(button){
  const drawer=document.querySelector('.ux-tool-drawer');if(!drawer||!button?.dataset.page)return;
  if(drawer.querySelector('.navbtn[data-page="'+CSS.escape(button.dataset.page)+'"]'))return;
  const lists=[...drawer.querySelectorAll('.ux-tool-list')];if(!lists.length)return;
  const clone=button.cloneNode(true);clone.removeAttribute('id');clone.classList.remove('ux-primary-route','ux-secondary-route');clone.classList.add('ux-drawer-route');
  lists[Math.min(drawerBucket(button.dataset.page),lists.length-1)].appendChild(clone);
}
function approvedNavigation(){
  if(!manager())return;
  const nav=document.querySelector('.sidebar nav');if(!nav)return;
  const buttons=[...nav.querySelectorAll('.navbtn[data-page]')];if(!buttons.length)return;
  const primary=[];
  for(const spec of MANAGER_NAV){
    const page=routeFor(buttons,spec.pages);if(!page)continue;
    const button=buttons.find(b=>b.dataset.page===page);primary.push(page);setButtonLabel(button,spec.label);
  }
  const primarySet=new Set(primary);
  for(const b of buttons){
    if(primarySet.has(b.dataset.page)){
      b.classList.add('ux-primary-route','ux-concept-primary');
      b.classList.remove('ux-secondary-route');
      b.hidden=false;
    }else{
      b.classList.add('ux-secondary-route');
      b.classList.remove('ux-primary-route','ux-concept-primary');
      ensureDrawerRoute(b);
    }
  }
  const more=nav.querySelector('.ux-more-button');if(more)setButtonLabel(more,'More');
  nav.dataset.uxConceptNav='approved';
}
function classifyAction(node){
 const t=text(node).toLowerCase();
 if(/critical|missing|clock|coverage|risk|blocked|late|gap|unresolved|shortfall/.test(t))return 'critical';
 if(/review|pending|leave|approve|waiting|attention/.test(t))return 'review';
 return 'normal';
}
function lineStrip(content){
 if(!manager()||ui?.page!=='overview'||content.querySelector('.ux-concept-line-strip'))return;
 const hero=content.querySelector('.fcc-hero');if(!hero)return;
 const source=[...content.querySelectorAll('.fcc-dept-grid > *, .fcc-map [class*="dept"], .fcc-map [class*="work"]')].slice(0,5);
 const labels=source.map(n=>text(n)).filter(Boolean).map(s=>s.split(/[\n·]/)[0].trim()).filter(Boolean);
 const fallback=['Factory live','People coverage','Production readiness','Clock evidence'];
 const values=(labels.length?labels:fallback).slice(0,4);
 const strip=document.createElement('div');strip.className='ux-concept-line-strip';strip.setAttribute('aria-label','Live manufacturing line status');
 values.forEach((label,i)=>{const chip=document.createElement('span');chip.className='ux-concept-line-chip'+(i===1?' warn':i===3?' risk':'');chip.textContent=label;strip.appendChild(chip);});
 hero.insertAdjacentElement('afterend',strip);
}
function relabelPulse(content){
 if(!manager()||ui?.page!=='overview')return;
 const cells=[...content.querySelectorAll('.fcc-pulse-grid>div')],labels=['Production','Workforce coverage','Labour cost','Decisions'];
 cells.slice(0,4).forEach((cell,i)=>{cell.dataset.uxConceptKpi=labels[i];const small=cell.querySelector('small');if(small)small.textContent=labels[i];});
}
function styleActions(content){
 if(!manager()||ui?.page!=='overview')return;
 content.querySelectorAll('.fcc-action').forEach(a=>a.dataset.uxPriority=classifyAction(a));
}
function closeDrawer(){document.querySelector('.ux-concept-decision-drawer')?.classList.remove('open');document.querySelector('.ux-concept-drawer-backdrop')?.classList.remove('open');}
function ensureDrawer(){
 if(document.querySelector('.ux-concept-decision-drawer'))return;
 const backdrop=document.createElement('div');backdrop.className='ux-concept-drawer-backdrop';backdrop.addEventListener('click',closeDrawer);
 const drawer=document.createElement('aside');drawer.className='ux-concept-decision-drawer';drawer.setAttribute('aria-label','Decision path');
 drawer.innerHTML='<div class="ux-concept-drawer-head"><div><span class="eyebrow">DECISION PATH</span><h2>From signal to verified outcome</h2></div><button type="button" class="ux-concept-drawer-close" aria-label="Close">×</button></div><div class="ux-concept-decision-title" data-concept-title>Selected manager action</div><div class="ux-concept-steps"><div class="ux-concept-step active"><span class="ux-concept-step-dot">1</span><div><b>Detected</b><small>The WFM evidence raised this item.</small></div></div><div class="ux-concept-step active"><span class="ux-concept-step-dot">2</span><div><b>Analysed</b><small>Production, skills, availability, compliance and cost evidence stay underneath the decision.</small></div></div><div class="ux-concept-step active"><span class="ux-concept-step-dot">3</span><div><b>Your Decision</b><small>Approve, change or reject using the original controlled action.</small></div></div><div class="ux-concept-step"><span class="ux-concept-step-dot">4</span><div><b>Applying</b><small>No action bypasses approval, eligibility, attendance or payroll controls.</small></div></div><div class="ux-concept-step"><span class="ux-concept-step-dot">5</span><div><b>Verified</b><small>The result remains auditable and measurable after application.</small></div></div></div><div class="ux-concept-drawer-note">Simple decision on screen. Heavy reasoning underneath. This drawer explains the controlled journey; it never creates authority.</div>';
 drawer.querySelector('.ux-concept-drawer-close').addEventListener('click',closeDrawer);document.body.append(backdrop,drawer);
}
function openDrawer(action){ensureDrawer();const title=document.querySelector('[data-concept-title]');if(title)title.textContent=text(action).slice(0,180)||'Selected manager action';document.querySelector('.ux-concept-decision-drawer')?.classList.add('open');document.querySelector('.ux-concept-drawer-backdrop')?.classList.add('open');}
function bindActions(content){
 content.querySelectorAll('.fcc-action').forEach(a=>{if(a.dataset.uxConceptBound)return;a.dataset.uxConceptBound='1';a.style.cursor='pointer';a.addEventListener('click',e=>{if(e.target.closest('button,a,input,select,textarea,summary'))return;openDrawer(a);});});
}
function siteScope(){
 let site='default';
 try{
   site=String(ui?.site||F?.scope?.site||F?.actor?.site||'default').trim()||'default';
 }catch{}
 return 'site:'+site.replace(/[^A-Za-z0-9_.:-]/g,'_').slice(0,90);
}
async function preferenceApi(method='GET',payload){
 const scope=state.scope||siteScope(),url='/api/ux-preference?scope='+encodeURIComponent(scope);
 const init={method,credentials:'same-origin',headers:{Accept:'application/json'}};
 if(payload){init.headers['Content-Type']='application/json';init.body=JSON.stringify({scope,...payload});}
 const res=await fetch(url,init);let data={};try{data=await res.json();}catch{}
 if(!res.ok)throw new Error(data.error||'Could not save presentation preference.');
 return data;
}
function effectiveMode(){
 if(state.mode!=='site_default')return state.mode;
 const critical=document.querySelectorAll('.fcc-action[data-ux-priority="critical"]').length;
 return critical?'decision_first':'decision_first';
}
function applyMode(){
 const effective=effectiveMode();document.body.dataset.uxViewMode=effective;document.body.dataset.uxViewPreference=state.mode;
 document.querySelectorAll('.ux-view-choice').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.mode));
 if(manager()&&ui?.page==='overview'){
   const details=[...document.querySelectorAll('.ux-today-detail')];
   if(effective==='operational_visual')details.filter(d=>d.classList.contains('readiness')||d.classList.contains('capacity')).forEach(d=>d.open=true);
   if(effective==='compact')details.forEach(d=>d.open=false);
 }
 const label=document.querySelector('[data-ux-view-current]');if(label)label.textContent=MODE_LABELS[state.mode]||MODE_LABELS.site_default;
}
async function loadPreference(){
 if(state.loading||state.loaded||!document.querySelector('.content')||employee())return;
 state.loading=true;state.scope=siteScope();
 try{const data=await preferenceApi();if(MODES.includes(data.mode))state.mode=data.mode;}catch{state.mode=localStorage.getItem('wfm.ux.mode')||'site_default';}
 if(!MODES.includes(state.mode))state.mode='site_default';
 state.loaded=true;state.loading=false;applyMode();
}
function ensureViewSwitcher(content){
 if(!manager()||content.querySelector('.ux-view-switcher'))return;
 const heading=content.querySelector('.heading')||content.querySelector('.fcc-hero');if(!heading)return;
 const bar=document.createElement('section');bar.className='ux-view-switcher';bar.setAttribute('aria-label','Presentation preference');
 bar.innerHTML='<div class="ux-view-copy"><span class="eyebrow">VIEW</span><strong data-ux-view-current>Site Default</strong><small>Presentation can adapt; controls and evidence never disappear.</small></div><div class="ux-view-choices">'+MODES.map(m=>'<button type="button" class="ux-view-choice" data-mode="'+m+'">'+MODE_LABELS[m]+'</button>').join('')+'</div>';
 heading.insertAdjacentElement('beforebegin',bar);
 bar.addEventListener('click',async e=>{
   const button=e.target.closest('.ux-view-choice');if(!button)return;
   const next=button.dataset.mode;if(!MODES.includes(next))return;
   const previous=state.mode;state.mode=next;applyMode();localStorage.setItem('wfm.ux.mode',next);
   try{await preferenceApi('POST',{mode:next});}
   catch(err){state.mode=previous;applyMode();const note=bar.querySelector('small');if(note)note.textContent=err.message||'Could not save view preference.';}
 });
 loadPreference();
}
function enhancePageLabels(content){
 if(!manager())return;
 const page=ui?.page;
 const map={
   leave:['People','Absence, entitlement and coverage decisions in one controlled workspace.'],
   'schedule-publication':['Plan','Build, review and publish the workforce plan without losing operational evidence.'],
   shifts:['Plan','Build, review and publish the workforce plan without losing operational evidence.'],
   readiness:['Plan','Understand whether people, skills and production demand are genuinely covered.'],
   'savings-decisions':['Improve','Prioritise evidenced workforce improvements and financial impact.'],
   costs:['Improve','Prioritise evidenced workforce improvements and financial impact.'],
   insights:['Improve','Prioritise evidenced workforce improvements and financial impact.']
 };
 const spec=map[page];if(!spec)return;
 const h=content.querySelector('.heading h1');const p=content.querySelector('.heading p');
 if(h&&!h.dataset.uxConceptTitle){h.dataset.uxConceptTitle='1';h.textContent=spec[0];}
 if(p&&!p.dataset.uxConceptSubtitle){p.dataset.uxConceptSubtitle='1';p.textContent=spec[1];}
}
function apply(){
 document.body.dataset.uxConcept='fidelity-v2';
 const content=document.querySelector('.content');if(!content)return;
 approvedNavigation();enhancePageLabels(content);lineStrip(content);relabelPulse(content);styleActions(content);bindActions(content);ensureDrawer();ensureViewSwitcher(content);applyMode();
}
const prev=window.render;if(typeof prev==='function')window.render=async function(...args){const result=await prev.apply(this,args);state.loaded=false;queueMicrotask(apply);return result;};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});
const obs=new MutationObserver(()=>queueMicrotask(apply));obs.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);setTimeout(apply,450);
window.WFMConceptFidelity={marker:MARKER,apply,closeDrawer,modes:MODES,state};
})();