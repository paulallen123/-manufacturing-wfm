/* WFM UX evolution cycle 12: one governed UX intake for implementation and future operating capabilities. */
(function(){
'use strict';
const registry=new Map();
let implementationCache=[],implementationLast=0,implementationBusy=false;
const M=()=>window.WFMUXCycle12Model;
const page=()=>{try{return ui?.page||null;}catch{return null;}};
const role=()=>{try{return (typeof F!=='undefined'&&F.actor?.role)||ui?.role||null;}catch{return null;}};
const employee=()=>{try{return typeof isEmployee==='function'&&isEmployee();}catch{return false;}};
const manager=()=>!employee()&&['manager','director','supervisor'].includes(role());
function signals(){return M()?.collect(registry)||[];}
async function refreshImplementation(force=false){
  if(employee()||implementationBusy)return;
  const now=Date.now();if(!force&&now-implementationLast<15000)return;
  implementationLast=now;implementationBusy=true;
  try{
    const res=await fetch('/api/implementation/autonomous/status',{credentials:'same-origin',headers:{Accept:'application/json'}});
    if(res.status===404||res.status===401||res.status===403){implementationCache=[];return;}
    if(!res.ok){implementationCache=[];return;}
    const status=await res.json();implementationCache=M()?.implementationSignals?.(status)||[];
  }catch{implementationCache=[];}
  finally{implementationBusy=false;setTimeout(apply,0);}
}
function register(providerId,getter){
  if(!M()?.PROVIDERS?.[providerId])throw new Error('Unknown UX signal provider');
  if(typeof getter!=='function')throw new TypeError('Provider getter must be a function');
  registry.set(providerId,getter);apply();
  return ()=>{registry.delete(providerId);apply();};
}
function renderSpecialistQueue(rows){
  if(employee()||manager()||page()!=='overview')return;
  document.querySelector('.ux12-system-queue')?.remove();
  if(!rows.length)return;
  const model=window.WFMUXCycle11Model?.build?.(rows);
  const renderCard=window.WFMUXCycle11?.renderCard;
  if(!model||typeof renderCard!=='function')return;
  const items=model.actions.slice(0,3);if(!items.length)return;
  const host=document.querySelector('.fcc-main')||document.querySelector('.content');if(!host)return;
  const section=document.createElement('section');section.className='ux11-queue ux12-system-queue';section.setAttribute('aria-label','System action queue');
  section.innerHTML=`<div class="ux11-head"><div><span class="eyebrow">NEEDS MY ACTION</span><h2>${model.actions.length} system ${model.actions.length===1?'priority':'priorities'}</h2><p>Implementation, integrations and operating controls use the same evidence-backed decision pattern.</p></div><span class="ux11-count">${model.actions.length}</span></div><div class="ux11-cards">${items.map(renderCard).join('')}</div>${model.actions.length>3?`<details class="ux11-more"><summary>${model.actions.length-3} more actions</summary><div class="ux11-more-grid">${model.actions.slice(3).map(renderCard).join('')}</div></details>`:''}`;
  host.prepend(section);
  window.WFMUXCycle11?.restoreFocus?.(section);
}
function relabelTools(){
  const drawer=document.getElementById('ux-tool-backdrop');if(!drawer)return;
  drawer.querySelectorAll('.ux-tool-group h3').forEach(h=>{
    if(h.textContent==='People & setup')h.textContent='Launch & configure';
    if(h.textContent==='Evidence & support')h.textContent='Trust & support';
  });
}
function apply(){
  refreshImplementation();
  const rows=signals();
  if(manager()&&page()==='overview'&&window.WFMUXCycle11?.renderQueue)window.WFMUXCycle11.renderQueue(rows);
  else renderSpecialistQueue(rows);
  relabelTools();
}
const priorRender=window.render;if(typeof priorRender==='function')window.render=async function(...args){const out=await priorRender.apply(this,args);apply();return out;};
const observer=new MutationObserver(()=>{try{relabelTools();}catch{}});observer.observe(document.documentElement,{subtree:true,childList:true});
registry.set('implementation',()=>implementationCache);
setTimeout(apply,0);setTimeout(apply,450);
window.WFMUXSignals=Object.freeze({register,list:()=>signals(),providers:()=>Object.keys(M()?.PROVIDERS||{}),refreshImplementation:()=>refreshImplementation(true)});
})();

;/* WFM_CANONICAL_CONCEPT_SHELL_BEGIN */
(function(){
'use strict';
const nonEmployee=()=>{try{return !(typeof isEmployee==='function'&&isEmployee());}catch{return true;}};
const currentPage=()=>{try{return ui?.page||null;}catch{return null;}};
const text=n=>(n?.textContent||'').replace(/\s+/g,' ').trim();

function setNav(){
  if(!nonEmployee())return;
  const nav=document.querySelector('.sidebar nav');if(!nav)return;
  const buttons=[...nav.querySelectorAll('.navbtn[data-page]')];
  const specs=[
    ['Today',['overview']],
    ['People',['leave','attendance','time-review','organisation']],
    ['Plan',['schedule-publication','shifts','readiness','cover']],
    ['Improve',['savings-decisions','costs','insights','forecast']]
  ];
  const keep=new Set();
  for(const [label,pages] of specs){
    const b=buttons.find(x=>pages.includes(x.dataset.page));if(!b)continue;
    keep.add(b.dataset.page);b.classList.add('ux-concept-primary');b.classList.remove('ux-secondary-route');
    const span=b.querySelector('span:not(.count):not(.review-count)');
    if(span)span.textContent=label;else b.textContent=label;
    b.setAttribute('aria-label',label);b.title=label;b.hidden=false;
  }
  for(const b of buttons)if(!keep.has(b.dataset.page)){b.classList.add('ux-secondary-route');b.classList.remove('ux-concept-primary');}
  nav.dataset.uxConceptNav='approved';
  const more=nav.querySelector('.ux-more-button');if(more){more.hidden=false;const s=more.querySelector('span:not(.count):not(.review-count)');if(s)s.textContent='More';}
}
function metric(root,re){
  for(const el of root.querySelectorAll('small,span,p,label')){
    if(!re.test(text(el)))continue;
    let p=el.parentElement;
    for(let i=0;p&&i<4;i++,p=p.parentElement){const strong=p.querySelector('strong');if(strong&&text(strong))return text(strong);}
  }
  return '—';
}
function syncQueue(shell){
  const list=shell.querySelector('.ux-approved-decision-list');if(!list)return;
  const candidates=[...document.querySelectorAll('.ux11-queue')].filter(q=>!list.contains(q));
  const live=candidates.find(q=>q.closest('.fcc-main'))||candidates[0];
  if(live){list.replaceChildren(live);live.classList.add('ux-approved-action-queue');}
  const queue=list.querySelector('.ux11-queue');
  const count=queue?.querySelector('.ux11-count')?.textContent?.trim()||String(list.querySelectorAll('.ux11-card,.fcc-action').length);
  const badge=shell.querySelector('.ux-approved-count');if(badge)badge.textContent=count+' waiting';
}
function build(){
  document.body.dataset.uxConcept='fidelity-v3';
  setNav();
  if(!nonEmployee()||currentPage()!=='overview')return;
  document.body.dataset.uxJob='today';
  const content=document.querySelector('.content');if(!content)return;
  let shell=content.querySelector(':scope > .ux-approved-today');
  if(!shell){
    const old=[...content.children];
    const production=metric(content,/capacity vs demand|production/i);
    const coverage=metric(content,/coverage|work-centre gaps|work center gaps/i);
    const labour=metric(content,/labour cost|labor cost/i);
    shell=document.createElement('section');
    shell.className='ux-approved-today';
    shell.innerHTML=`
      <header class="ux-approved-topbar">
        <div class="ux-approved-greeting">
          <span class="eyebrow">MANUFACTURING COMMAND CENTRE</span>
          <h1>Today</h1>
          <p>Everything needing attention, cost or a decision — without hunting through dashboards.</p>
        </div>
        <div class="ux-approved-top-actions"><span class="ux-approved-live"><i></i>Factory view live</span></div>
      </header>
      <section class="ux-approved-kpis" aria-label="Manufacturing decision KPIs">
        <article class="ux-approved-kpi kpi-0"><span>Production</span><strong>${production}</strong><small>Capacity against demand</small></article>
        <article class="ux-approved-kpi kpi-1"><span>Workforce coverage</span><strong>${coverage}</strong><small>Current coverage evidence</small></article>
        <article class="ux-approved-kpi kpi-2"><span>Labour cost</span><strong>${labour}</strong><small>Verified cost evidence</small></article>
        <article class="ux-approved-kpi kpi-3"><span>Decisions</span><strong>—</strong><small>Items needing attention</small></article>
      </section>
      <div class="ux-approved-main-grid">
        <section class="ux-approved-decisions">
          <div class="ux-approved-section-head"><div><span class="eyebrow">NEEDS MY ACTION</span><h2>What needs your decision</h2><p>Verified priorities from absence, time, sign-off, implementation and operating signals.</p></div><span class="ux-approved-count">0 waiting</span></div>
          <div class="ux-approved-decision-list"></div>
        </section>
        <section class="ux-approved-lines">
          <div class="ux-approved-section-head"><div><span class="eyebrow">FACTORY STATUS</span><h2>Operational picture</h2><p>Calm until evidence needs attention.</p></div></div>
          <div class="ux-approved-line-grid">
            <article class="ux-approved-line-card"><b>Production</b><span>${production}</span></article>
            <article class="ux-approved-line-card" data-ux-line-tone="review"><b>Coverage</b><span>${coverage}</span></article>
            <article class="ux-approved-line-card"><b>Labour</b><span>${labour}</span></article>
          </div>
        </section>
      </div>
      <details class="ux-approved-evidence">
        <summary><span><b>Full factory evidence & controls</b><small>All original WFM functionality remains available here.</small></span><span>Open</span></summary>
        <div class="ux-approved-evidence-body"></div>
      </details>`;
    content.prepend(shell);
    const body=shell.querySelector('.ux-approved-evidence-body');
    for(const node of old)body.appendChild(node);
  }
  syncQueue(shell);
  const count=shell.querySelector('.ux-approved-count')?.textContent?.match(/\d+/)?.[0]||'0';
  const decisionKpi=shell.querySelector('.ux-approved-kpi.kpi-3 strong');if(decisionKpi)decisionKpi.textContent=count;
}
let pending=false;
function apply(){if(pending)return;pending=true;queueMicrotask(()=>{pending=false;try{build();}catch(e){console.warn('Canonical concept shell skipped',e);}});}
const previous=window.render;
if(typeof previous==='function')window.render=async function(...args){const result=await previous.apply(this,args);apply();return result;};
new MutationObserver(apply).observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);setTimeout(apply,500);setTimeout(apply,1200);
window.WFMCanonicalConcept=Object.freeze({apply});
})();
