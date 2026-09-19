/* Vector role-first bridge: project the existing governed Cycle 11/12 priority queue into the approved Vector home without duplicating its renderer or write authority. */
(function(){
'use strict';
const MARKER='VECTOR_PRIORITY_BRIDGE_V1';
const state={queued:false,focusToken:0};
const page=()=>{try{return String(ui?.page||'overview');}catch{return 'overview';}};

function content(){return document.querySelector('.content');}
function vectorHome(){return content()?.querySelector(':scope > .vector-home')||null;}

function repairVectorPageState(){
  const root=content();if(!root)return;
  const current=page();
  if(current!=='overview'&&root.dataset.vectorHome==='1'){
    delete root.dataset.vectorHome;
    root.classList.add('vector-page-content');
    return;
  }
  if(current==='overview'&&root.dataset.vectorHome==='1'&&!root.querySelector(':scope > .vector-home')){
    delete root.dataset.vectorHome;
    window.VectorWorkforceOperations?.apply?.();
  }
}

function ensureSlot(){
  const home=vectorHome();if(!home||page()!=='overview')return null;
  let slot=home.querySelector(':scope > .vector-priority-slot');
  if(slot)return slot;
  slot=document.createElement('div');
  slot.className='vector-priority-slot';
  slot.dataset.vectorPriorityBridge=MARKER;
  slot.hidden=true;
  const welcome=home.querySelector(':scope > .vector-welcome');
  if(welcome)welcome.insertAdjacentElement('afterend',slot);else home.prepend(slot);
  return slot;
}

function newestSourceQueue(){
  const root=content();if(!root)return null;
  const rows=[...root.querySelectorAll('.vector-home-source .ux11-queue')];
  return rows.length?rows[rows.length-1]:null;
}

function restoreProjectedFocus(queue){
  const marker=window.WFMUXCycle11?.returnMarker?.();
  if(!marker?.id||!queue)return false;
  const token=++state.focusToken;
  window.__vectorPriorityFocus={markerId:marker.id,token,attempts:0,targetFound:false,visible:false,focused:false,lastActive:null};
  const focus=(attempt=0)=>{
    if(token!==state.focusToken)return;
    const currentMarker=window.WFMUXCycle11?.returnMarker?.();
    if(!currentMarker||currentMarker.id!==marker.id)return;
    const byId=`.ux11-open[data-ux11-id="${CSS.escape(marker.id)}"]`;
    const byRoute=marker.route&&marker.sourceId?`.ux11-open[data-ux11-route="${CSS.escape(marker.route)}"][data-ux11-source-id="${CSS.escape(marker.sourceId)}"]`:null;
    const target=queue.querySelector(byId)||(byRoute?queue.querySelector(byRoute):null);
    const visible=Boolean(target?.isConnected&&!target.closest('[hidden]')&&target.getClientRects().length);
    window.__vectorPriorityFocus={markerId:marker.id,token,attempts:attempt+1,targetFound:Boolean(target),visible,focused:false,lastActive:document.activeElement?.tagName||null,disabled:Boolean(target?.disabled),tabIndex:target?.tabIndex??null};
    if(visible){
      try{target.focus({preventScroll:true});}catch{try{target.focus();}catch{}}
      const focused=document.activeElement===target;
      window.__vectorPriorityFocus={...window.__vectorPriorityFocus,focused,lastActive:document.activeElement?.tagName||null,activeId:document.activeElement?.dataset?.ux11Id||null};
      if(focused){try{sessionStorage.removeItem('wfmUx11Return');}catch{}return;}
    }
    if(attempt<20)setTimeout(()=>focus(attempt+1),40);
  };
  focus();
  return true;
}

function project(){
  repairVectorPageState();
  if(page()!=='overview')return false;
  const slot=ensureSlot();if(!slot)return false;
  const sourceQueue=newestSourceQueue();
  if(sourceQueue){
    const prior=slot.querySelector(':scope > .ux11-queue');
    if(prior&&prior!==sourceQueue)prior.remove();
    if(sourceQueue.parentElement!==slot)slot.appendChild(sourceQueue);
    sourceQueue.dataset.vectorProjected='true';
  }
  const active=slot.querySelector(':scope > .ux11-queue');
  slot.hidden=!active;
  if(active&&!slot.hidden)restoreProjectedFocus(active);
  return Boolean(active);
}

function schedule(){
  if(state.queued)return;
  state.queued=true;
  queueMicrotask(()=>{state.queued=false;try{project();}catch(error){console.warn('Vector priority projection skipped:',error);}});
}

new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
document.addEventListener('click',schedule,true);
setTimeout(schedule,0);
setTimeout(schedule,500);
window.VectorPriorityBridge=Object.freeze({marker:MARKER,project});
})();
