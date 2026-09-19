/* WFM UX evolution cycle 12: one governed UX intake for implementation and future operating capabilities. */
(function(){
'use strict';
const registry=new Map();
const sourceState=new Map([
  ['implementation',{cache:[],last:0,busy:false,path:'/api/implementation/autonomous/status',mapper:'implementationSignals'}],
  ['integrations',{cache:[],last:0,busy:false,path:'/api/integrations/autonomous/status',mapper:'integrationSignals'}]
]);
const M=()=>window.WFMUXCycle12Model;
const safe=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
const page=()=>{try{return ui?.page||null;}catch{return null;}};
const role=()=>{try{return (typeof F!=='undefined'&&F.actor?.role)||ui?.role||null;}catch{return null;}};
const employee=()=>{try{return typeof isEmployee==='function'&&isEmployee();}catch{return false;}};
const manager=()=>!employee()&&['manager','director','supervisor'].includes(role());
const labels={implementation:'Implementation',integrations:'Integrations',attendance:'Attendance',agency:'Agency labour','manufacturing-cost':'Cost',energy:'Energy',support:'Support',learning:'Learning',handover:'Shift handover',documents:'Documents',payroll:'Payroll'};
function signals(){return M()?.collect(registry)||[];}
async function refreshSource(providerId,force=false){
  const source=sourceState.get(providerId);if(!source||employee()||source.busy)return;
  const now=Date.now();if(!force&&now-source.last<15000)return;
  source.last=now;source.busy=true;
  try{
    const res=await fetch(source.path,{credentials:'same-origin',headers:{Accept:'application/json'}});
    if(res.status===404||res.status===401||res.status===403){source.cache=[];return;}
    if(!res.ok){source.cache=[];return;}
    const status=await res.json();source.cache=M()?.[source.mapper]?.(status)||[];
  }catch{source.cache=[];}
  finally{source.busy=false;setTimeout(apply,0);}
}
const refreshImplementation=force=>refreshSource('implementation',force);
const refreshIntegrations=force=>refreshSource('integrations',force);
function register(providerId,getter){
  if(!M()?.PROVIDERS?.[providerId])throw new Error('Unknown UX signal provider');
  if(typeof getter!=='function')throw new TypeError('Provider getter must be a function');
  registry.set(providerId,getter);apply();
  return ()=>{registry.delete(providerId);apply();};
}
function sourceName(s){return labels[s]||s;}
function stateText(x){return ({action_required:'Action required',decision_sent:'Decision sent',confirming_source:'Confirming source',needs_verification:'Needs verification',resolved:'Resolved'})[x.lifecycle]||'Action required';}
function card(x){
  const tone=x.urgent?' urgent':x.evidenceState==='current'?'':' review';
  return `<article class="ux11-card${tone}" data-ux12-id="${safe(x.id)}"><div class="ux11-card-top"><span class="ux11-source">${safe(sourceName(x.source))}</span><span class="ux11-state">${safe(stateText(x))}</span></div><h3>${safe(x.title)}</h3><p class="ux11-why"><b>Why now:</b> ${safe(x.whyNow)}</p>${x.consequence?`<p class="ux11-consequence">${safe(x.consequence)}</p>`:''}<details class="ux11-trust"><summary>Why this priority</summary><div><span><b>Evidence</b>${safe(x.evidenceLabel)}</span><span><b>Authority</b>${safe(x.authority)}</span>${x.auditRef?`<span><b>Audit</b>${safe(x.auditRef)}</span>`:''}</div></details><button type="button" class="btn small primary ux12-open" data-ux12-route="${safe(x.route)}" data-ux12-id="${safe(x.id)}" data-ux12-source-id="${safe(x.sourceId)}" data-ux12-source="${safe(x.source)}" data-ux12-reason="${safe(x.reasonCode)}" data-ux12-title="${safe(x.title)}">Open ${safe(sourceName(x.source))}</button></article>`;
}
function renderSpecialistQueue(rows){
  if(employee()||manager()||page()!=='overview')return;
  document.querySelector('.ux12-system-queue')?.remove();
  if(!rows.length)return;
  const model=window.WFMUXCycle11Model?.build?.(rows);if(!model)return;
  const items=model.actions.slice(0,3);if(!items.length)return;
  const host=document.querySelector('.fcc-main')||document.querySelector('.content');if(!host)return;
  const section=document.createElement('section');section.className='ux11-queue ux12-system-queue';section.setAttribute('aria-label','System action queue');
  section.innerHTML=`<div class="ux11-head"><div><span class="eyebrow">NEEDS MY ACTION</span><h2>${model.actions.length} system ${model.actions.length===1?'priority':'priorities'}</h2><p>Implementation, integrations and operating controls use the same evidence-backed decision pattern.</p></div><span class="ux11-count">${model.actions.length}</span></div><div class="ux11-cards">${items.map(card).join('')}</div>${model.actions.length>3?`<details class="ux11-more"><summary>${model.actions.length-3} more actions</summary><div class="ux11-more-grid">${model.actions.slice(3).map(card).join('')}</div></details>`:''}`;
  host.prepend(section);
}
function relabelTools(){
  const drawer=document.getElementById('ux-tool-backdrop');if(!drawer)return;
  drawer.querySelectorAll('.ux-tool-group h3').forEach(h=>{
    if(h.textContent==='People & setup')h.textContent='Launch & configure';
    if(h.textContent==='Evidence & support')h.textContent='Trust & support';
  });
}
function apply(){
  refreshImplementation();refreshIntegrations();
  const rows=signals();
  if(manager()&&page()==='overview'&&window.WFMUXCycle11?.renderQueue)window.WFMUXCycle11.renderQueue(rows);
  else renderSpecialistQueue(rows);
  relabelTools();
}
document.addEventListener('click',e=>{
  const b=e.target.closest('.ux12-open[data-ux12-route]');if(!b)return;e.preventDefault();
  if(window.WFMUXCycle11?.openRoute)window.WFMUXCycle11.openRoute(b.dataset.ux12Route,b.dataset.ux12Id,b.dataset.ux12SourceId,b.dataset.ux12Source,b.dataset.ux12Reason,b.dataset.ux12Title);
});
const priorRender=window.render;if(typeof priorRender==='function')window.render=async function(...args){const out=await priorRender.apply(this,args);apply();return out;};
const observer=new MutationObserver(()=>{try{relabelTools();}catch{}});observer.observe(document.documentElement,{subtree:true,childList:true});
registry.set('implementation',()=>sourceState.get('implementation')?.cache||[]);
registry.set('integrations',()=>sourceState.get('integrations')?.cache||[]);
setTimeout(apply,0);setTimeout(apply,450);
window.WFMUXSignals=Object.freeze({register,list:()=>signals(),providers:()=>Object.keys(M()?.PROVIDERS||{}),refreshImplementation:()=>refreshImplementation(true),refreshIntegrations:()=>refreshIntegrations(true)});
})();
