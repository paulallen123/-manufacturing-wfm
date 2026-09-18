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
