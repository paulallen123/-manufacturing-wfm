/* WFM concept-fidelity shell: preserve authoritative controls, replace visual hierarchy. */
(function(){
'use strict';
const MARKER='WFM_CONCEPT_FIDELITY_V1';
const manager=()=>{try{return !isEmployee()&&['manager','director','supervisor'].includes((typeof F!=='undefined'&&F.actor?.role)||ui?.role);}catch{return false;}};
const text=n=>(n?.textContent||'').replace(/\s+/g,' ').trim();
function classifyAction(node){
 const t=text(node).toLowerCase();
 if(/critical|missing|clock|coverage|risk|blocked|late|gap|unresolved/.test(t))return 'critical';
 if(/review|pending|leave|approve|waiting/.test(t))return 'review';
 return 'normal';
}
function lineStrip(content){
 if(!manager()||ui?.page!=='overview'||content.querySelector('.ux-concept-line-strip'))return;
 const hero=content.querySelector('.fcc-hero');
 if(!hero)return;
 const source=[...content.querySelectorAll('.fcc-dept-grid > *, .fcc-map [class*="dept"], .fcc-map [class*="work"]')].slice(0,4);
 const labels=source.map(n=>text(n)).filter(Boolean).map(s=>s.split(/[\n·]/)[0].trim()).filter(Boolean);
 const fallback=['Factory status','People coverage','Production readiness'];
 const values=(labels.length?labels:fallback).slice(0,4);
 const strip=document.createElement('div');strip.className='ux-concept-line-strip';strip.setAttribute('aria-label','Factory status strip');
 values.forEach((label,i)=>{const chip=document.createElement('span');chip.className='ux-concept-line-chip'+(i===1?' warn':'');chip.textContent=label;strip.appendChild(chip);});
 hero.insertAdjacentElement('afterend',strip);
}
function relabelPulse(content){
 if(!manager()||ui?.page!=='overview')return;
 const cells=[...content.querySelectorAll('.fcc-pulse-grid>div')];
 const labels=['Production','Workforce coverage','Labour cost','Decisions'];
 cells.slice(0,4).forEach((cell,i)=>{
  cell.dataset.uxConceptKpi=labels[i];
  const small=cell.querySelector('small');
  if(small)small.textContent=labels[i];
 });
}
function styleActions(content){
 if(!manager()||ui?.page!=='overview')return;
 content.querySelectorAll('.fcc-action').forEach(a=>a.dataset.uxPriority=classifyAction(a));
}
function closeDrawer(){
 document.querySelector('.ux-concept-decision-drawer')?.classList.remove('open');
 document.querySelector('.ux-concept-drawer-backdrop')?.classList.remove('open');
}
function ensureDrawer(){
 if(document.querySelector('.ux-concept-decision-drawer'))return;
 const backdrop=document.createElement('div');backdrop.className='ux-concept-drawer-backdrop';backdrop.addEventListener('click',closeDrawer);
 const drawer=document.createElement('aside');drawer.className='ux-concept-decision-drawer';drawer.setAttribute('aria-label','Decision path');
 drawer.innerHTML='<div class="ux-concept-drawer-head"><div><span class="eyebrow">DECISION PATH</span><h2>From signal to verified outcome</h2></div><button type="button" class="ux-concept-drawer-close" aria-label="Close">×</button></div><div class="ux-concept-decision-title" data-concept-title>Selected manager action</div><div class="ux-concept-steps"><div class="ux-concept-step active"><span class="ux-concept-step-dot">1</span><div><b>Detected</b><small>The underlying WFM evidence raised this item.</small></div></div><div class="ux-concept-step"><span class="ux-concept-step-dot">2</span><div><b>Analysed</b><small>Coverage, cost and constraints stay in the existing authoritative workflow.</small></div></div><div class="ux-concept-step"><span class="ux-concept-step-dot">3</span><div><b>Your decision</b><small>Approve, change or reject using the original controlled action.</small></div></div><div class="ux-concept-step"><span class="ux-concept-step-dot">4</span><div><b>Applying</b><small>No action bypasses eligibility, payroll or approval controls.</small></div></div><div class="ux-concept-step"><span class="ux-concept-step-dot">5</span><div><b>Verified</b><small>The outcome remains auditable after the controlled workflow finishes.</small></div></div></div><div class="ux-concept-drawer-note">This panel explains the decision journey; it does not manufacture status or bypass the underlying WFM controls.</div>';
 drawer.querySelector('.ux-concept-drawer-close').addEventListener('click',closeDrawer);
 document.body.append(backdrop,drawer);
}
function openDrawer(action){
 ensureDrawer();
 const title=document.querySelector('[data-concept-title]');
 if(title)title.textContent=text(action).slice(0,180)||'Selected manager action';
 document.querySelector('.ux-concept-decision-drawer')?.classList.add('open');
 document.querySelector('.ux-concept-drawer-backdrop')?.classList.add('open');
}
function bindActions(content){
 content.querySelectorAll('.fcc-action').forEach(a=>{
  if(a.dataset.uxConceptBound)return;
  a.dataset.uxConceptBound='1';
  a.style.cursor='pointer';
  a.addEventListener('click',e=>{
   if(e.target.closest('button,a,input,select,textarea,summary'))return;
   openDrawer(a);
  });
 });
}
function apply(){
 document.body.dataset.uxConcept='fidelity-v1';
 const content=document.querySelector('.content');
 if(!content)return;
 lineStrip(content);
 relabelPulse(content);
 styleActions(content);
 bindActions(content);
 ensureDrawer();
}
const prev=window.render;
if(typeof prev==='function')window.render=async function(...args){const result=await prev.apply(this,args);queueMicrotask(apply);return result;};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});
const obs=new MutationObserver(()=>queueMicrotask(apply));obs.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);setTimeout(apply,450);
window.WFMConceptFidelity={marker:MARKER,apply,closeDrawer};
})();