(function(){
'use strict';
const MARKER='VECTOR_DEMAND_DECISION_INTELLIGENCE_V1';
let summary=null,loading=false,lastLoad=0,queued=false;
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function label(key){return String(key||'').split('-').filter(Boolean).map(x=>x[0].toUpperCase()+x.slice(1)).join(' ');}
function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;render();});}
async function load(force=false){
  const now=Date.now(); if(loading||(!force&&now-lastLoad<30000))return;
  loading=true;lastLoad=now;
  try{
    const r=await fetch('/api/operations/intelligence/summary',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
    if(!r.ok){summary=null;return;}
    summary=await r.json();
  }catch{summary=null;}finally{loading=false;schedule();}
}
function render(){
  const host=document.querySelector('.vector-concept-dashboard');
  const existing=document.querySelector('[data-vector-demand-decision-intelligence]');
  if(!host){if(existing)existing.remove();return;}
  const demand=summary?.topDemand||null,decision=summary?.recentShadowDecision||null;
  if(!demand&&!decision){if(existing)existing.remove();return;}
  const card=existing||document.createElement('section');
  card.className='vector-card vector-decision-intelligence';
  card.dataset.vectorDemandDecisionIntelligence=MARKER;
  const demandHtml=demand?'<div class="vector-decision-intel-block"><small>Demand signal</small><b>'+esc(label(demand.decisionKey))+'</b><span>'+esc(demand.signalCount)+' signals · '+esc(demand.silentDemandSignals)+' silent-demand observations</span></div>':'';
  const rec=decision?.recommendation?.optionId;
  const decisionHtml=decision?'<div class="vector-decision-intel-block"><small>Shadow recommendation</small><b>'+esc(label(rec||'No eligible option'))+'</b><span>'+esc(label(decision.decisionType))+' · no execution authority</span></div>':'';
  card.innerHTML='<div class="vector-card-head"><div><span class="vector-card-kicker">Decision intelligence</span><h2>What the evidence says to improve next</h2></div><span class="vector-decision-shadow">Shadow only</span></div><div class="vector-decision-intel-grid">'+demandHtml+decisionHtml+'</div>';
  if(!existing){
    const production=host.querySelector('.vector-production-preview');
    if(production)production.insertAdjacentElement('afterend',card);else host.appendChild(card);
  }
}
const observer=new MutationObserver(()=>{schedule();void load(false);});
observer.observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('hashchange',()=>{void load(true);});
setTimeout(()=>void load(true),500);
window.VectorDemandDecisionIntelligence={marker:MARKER,refresh:()=>load(true)};
})();