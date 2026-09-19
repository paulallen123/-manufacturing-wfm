/* WFM UX evolution cycle 12: one governed UX intake for implementation and future operating capabilities. */
(function(){
'use strict';
const registry=new Map();
const sourceState=new Map([
  ['implementation',{cache:[],last:0,busy:false,path:'/api/implementation/autonomous/status',mapper:'implementationSignals'}],
  ['integrations',{cache:[],last:0,busy:false,path:'/api/integrations/autonomous/status',mapper:'integrationSignals'}]
]);
const M=()=>window.WFMUXCycle12Model;
const page=()=>{try{return ui?.page||null;}catch{return null;}};
const role=()=>{try{return (typeof F!=='undefined'&&F.actor?.role)||ui?.role||null;}catch{return null;}};
const employee=()=>{try{return typeof isEmployee==='function'&&isEmployee();}catch{return false;}};
const manager=()=>!employee()&&['manager','director','supervisor'].includes(role());
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
function renderSpecialistQueue(rows){
  if(employee()||manager()||page()!=='overview')return;
  document.querySelector('.ux12-system-queue')?.remove();
  if(!rows.length)return;
  const shared=window.WFMUXCycle11;
  if(typeof shared?.renderCard!=='function')return;
  const model=window.WFMUXCycle11Model?.build?.(rows);if(!model)return;
  const items=model.actions.slice(0,3);if(!items.length)return;
  const host=document.querySelector('.fcc-main')||document.querySelector('.content');if(!host)return;
  const section=document.createElement('section');section.className='ux11-queue ux12-system-queue';section.setAttribute('aria-label','System action queue');
  section.innerHTML=`<div class="ux11-head"><div><span class="eyebrow">NEEDS MY ACTION</span><h2>${model.actions.length} system ${model.actions.length===1?'priority':'priorities'}</h2><p>Implementation, integrations and operating controls use the same evidence-backed decision pattern.</p></div><span class="ux11-count">${model.actions.length}</span></div><div class="ux11-live" role="status" aria-live="polite" aria-atomic="true"></div><div class="ux11-cards">${items.map(shared.renderCard).join('')}</div>${model.actions.length>3?`<details class="ux11-more"><summary>${model.actions.length-3} more actions</summary><div class="ux11-more-grid">${model.actions.slice(3).map(shared.renderCard).join('')}</div></details>`:''}`;
  host.prepend(section);
  shared.announceLifecycle?.(model,section);
  shared.restoreFocus?.(section);
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
const priorRender=window.render;if(typeof priorRender==='function')window.render=async function(...args){const out=await priorRender.apply(this,args);apply();return out;};
const observer=new MutationObserver(()=>{try{relabelTools();}catch{}});observer.observe(document.documentElement,{subtree:true,childList:true});
registry.set('implementation',()=>sourceState.get('implementation')?.cache||[]);
registry.set('integrations',()=>sourceState.get('integrations')?.cache||[]);
setTimeout(apply,0);setTimeout(apply,450);
window.WFMUXSignals=Object.freeze({register,list:()=>signals(),providers:()=>Object.keys(M()?.PROVIDERS||{}),refreshImplementation:()=>refreshImplementation(true),refreshIntegrations:()=>refreshIntegrations(true)});
})();