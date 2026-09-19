/* WFM UX evolution cycle 11: universal manager Action Queue. Deterministic presentation only; authoritative writes remain in source workflows. */
(function(){
'use strict';
const M=()=>window.WFMUXCycle11Model;
const safe=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const page=()=>{try{return ui?.page||null;}catch{return null;}};
const role=()=>{try{return (typeof F!=='undefined'&&F.actor?.role)||ui?.role||null;}catch{return null;}};
const manager=()=>{try{return !(typeof isEmployee==='function'&&isEmployee())&&['manager','director','supervisor'].includes(role());}catch{return false;}};
const actor=()=>{try{return typeof F!=='undefined'?F.actor:null;}catch{return null;}};
const peopleVisible=()=>{try{return typeof people==='function'?people():[];}catch{return [];}};
const personFor=id=>{try{return typeof person==='function'?person(id):peopleVisible().find(p=>String(p.id)===String(id));}catch{return null;}};
const requestMinutes=r=>Number.isFinite(Number(r?.hours))?Math.round(Number(r.hours)*60):null;
const hours=m=>m==null?'not quantified':`${(Number(m)/60).toLocaleString('en-GB',{maximumFractionDigits:1})} h`;
function report(){try{return window.payrollPreview?.report?.()||null;}catch{return null;}}
function reportTeams(r){
 const teams=Array.isArray(r?.teams)?r.teams:[];if(!teams.length)return [];
 const visibleTokens=new Set();
 const a=actor();[a?.team,a?.teamId,a?.site,a?.siteId].filter(Boolean).forEach(x=>visibleTokens.add(String(x)));
 peopleVisible().forEach(p=>[p?.team,p?.teamId,p?.site,p?.siteId].filter(Boolean).forEach(x=>visibleTokens.add(String(x))));
 if(!visibleTokens.size)return teams;
 const scoped=teams.filter(t=>[t?.id,t?.name,t?.team,t?.site].filter(Boolean).some(x=>visibleTokens.has(String(x))));
 return scoped.length?scoped:teams;
}
function teamLabel(t){return String(t?.name||t?.team||t?.site||t?.id||'Team');}
function cachedCapacity(requestId){
 try{const cache=window.WFMUXReset?.state?.capacity;if(!cache)return null;for(const [k,v] of cache.entries())if(String(k).endsWith(`:${requestId}`))return v;}catch{}return null;
}
function leaveSignals(){
 const visible=new Set(peopleVisible().map(p=>String(p.id)));let requests=[];
 try{requests=(data?.requests||[]).filter(r=>r.status==='pending'&&visible.has(String(r.employee)));}catch{return [];}
 return requests.map(r=>{
   const p=personFor(r.employee),c=cachedCapacity(r.id),blocked=c?.status==='blocked';
   const reasonCode=blocked?'LEAVE_COVERAGE_RISK':'LEAVE_DECISION_PENDING';
   const detail=(c?.blocking||[])[0]?.detail||(c?.warnings||[])[0]||'Pending leave request requires a manager decision.';
   return {
     id:`absence:${r.id}`,source:'absence',sourceId:r.id,route:'leave',reasonCode,kind:'action',lifecycle:'action_required',
     mandatory:false,evidenceState:c?'current':'unknown',
     evidenceLabel:c?'Current leave/coverage decision data':'Coverage evidence will be verified in Absence',
     title:`${p?.name||r.employee} · leave request`,
     whyNow:blocked?detail:'A leave request is waiting for a decision.',
     consequence:blocked?'Coverage or skills may be affected.':(requestMinutes(r)!=null?`${hours(requestMinutes(r))} requested.`:'Review entitlement, coverage and cost before deciding.'),
     authority:'Manager approval required',createdAt:r.createdAt||r.requestedAt||r.date||r.start
   };
 });
}
function timeSignals(){
 const r=report();if(!r)return [];
 return reportTeams(r).flatMap(t=>{
   const open=(t.issues||[]).filter(i=>i.status==='open');if(!open.length)return [];
   const peopleIds=[...new Set(open.map(i=>i.employee||i.employeeId).filter(Boolean))];
   const names=peopleIds.slice(0,2).map(id=>personFor(id)?.name||id).filter(Boolean);
   return [{
     id:`time-review:${t.id||t.name||'team'}:open`,source:'time-review',sourceId:t.id||'',route:'time-review',
     reasonCode:'TIME_EXCEPTION_OPEN',kind:'action',lifecycle:'action_required',mandatory:true,evidenceState:'current',
     evidenceLabel:'Current payroll/time review report',
     title:`${teamLabel(t)} · ${open.length} time ${open.length===1?'exception needs':'exceptions need'} review`,
     whyNow:'Unresolved time evidence can affect weekly review and payroll readiness.',
     consequence:names.length?`Includes ${names.join(', ')}${peopleIds.length>2?` +${peopleIds.length-2} more`:''}.`:'Review the open exception evidence.',
     authority:'Manager decision required',createdAt:t.updatedAt||r.generatedAt||null
   }];
 });
}
function signoffSignals(){
 const r=report();if(!r)return [];
 return reportTeams(r).flatMap(t=>{
   const open=(t.issues||[]).filter(i=>i.status==='open').length;
   let reasonCode=null,title='',whyNow='',mandatory=true;
   if(t.status==='stale'){reasonCode='SIGNOFF_STALE';title=`${teamLabel(t)} · signed week changed`;whyNow='The signed evidence changed and must be reviewed before payroll.';}
   else if(t.status==='returned'){reasonCode='SIGNOFF_RETURNED';title=`${teamLabel(t)} · week returned for review`;whyNow='The week was returned and still needs a controlled review.';}
   else if(!open&&t.canSign){reasonCode='SIGNOFF_READY';title=`${teamLabel(t)} · week is ready to sign`;whyNow='Required checks are complete and the authoritative sign-off is available.';}
   else if(!open&&(t.blockers||[]).length){reasonCode='NEEDS_REVIEW';title=`${teamLabel(t)} · weekly sign-off still blocked`;whyNow='The weekly review reports remaining blockers.';}
   if(!reasonCode)return [];
   return [{
     id:`weekly-review:${t.id||t.name||'team'}:${reasonCode}`,source:'weekly-review',sourceId:t.id||'',route:'weekly-review',
     reasonCode,kind:'action',lifecycle:'action_required',mandatory,evidenceState:'current',evidenceLabel:'Current weekly review report',
     title,whyNow,consequence:t.workedMinutes!=null?`${hours(t.workedMinutes)} recorded this week.`:'',
     authority:'Manager sign-off authority required',createdAt:t.updatedAt||r.generatedAt||null
   }];
 });
}
function collectSignals(){return [...timeSignals(),...signoffSignals(),...leaveSignals()];}
function tone(item){return item.urgent?'urgent':item.evidenceState==='current'?'normal':'review';}
function sourceName(source){return ({'time-review':'Time Review','weekly-review':'Weekly Sign-off','absence':'Absence','schedule-publication':'Schedule','today':'Today','automation':'Automation','implementation':'Implementation','integrations':'Integrations','attendance':'Attendance','agency':'Agency labour','manufacturing-cost':'Cost','energy':'Energy','support':'Support','learning':'Learning','handover':'Shift handover','documents':'Documents','payroll':'Payroll'})[source]||source;}
function stateText(item){return ({action_required:'Action required',decision_sent:'Decision sent',confirming_source:'Confirming source',needs_verification:'Needs verification',resolved:'Resolved'})[item.lifecycle]||'Action required';}
function card(item){
 return `<article class="ux11-card ${tone(item)}" data-ux11-id="${safe(item.id)}" data-ux11-reason="${safe(item.reasonCode)}" data-ux11-source="${safe(item.source)}" data-ux11-evidence="${safe(item.evidenceState)}" data-ux11-priority="${safe(item.priority)}"><div class="ux11-card-top"><span class="ux11-source">${safe(sourceName(item.source))}</span><span class="ux11-state">${safe(stateText(item))}</span></div><h3>${safe(item.title)}</h3><p class="ux11-why"><b>Why now:</b> ${safe(item.whyNow)}</p>${item.consequence?`<p class="ux11-consequence">${safe(item.consequence)}</p>`:''}<details class="ux11-trust"><summary>Why this priority</summary><div><span><b>Reason</b>${safe(item.reasonLabel)}</span><span><b>Evidence</b>${safe(item.evidenceLabel)}</span><span><b>Authority</b>${safe(item.authority)}</span></div></details><button type="button" class="btn small primary ux11-open" data-ux11-route="${safe(item.route)}" data-ux11-id="${safe(item.id)}" data-ux11-source-id="${safe(item.sourceId)}" data-ux11-source="${safe(item.source)}" data-ux11-reason="${safe(item.reasonCode)}" data-ux11-title="${safe(item.title)}">Open ${safe(sourceName(item.source))}</button></article>`;
}
function receipt(r){return `<li data-ux11-id="${safe(r.id)}"><b>${safe(r.title)}</b><span>${safe(r.whyNow)}</span><small>${safe(r.auditRef||r.evidenceLabel)}</small></li>`;}
function sourceResolution(marker){
 if(!marker?.id||!marker?.sourceId)return null;
 const base={
   id:String(marker.id),source:String(marker.source||marker.route||'today'),sourceId:String(marker.sourceId),route:String(marker.route||''),
   reasonCode:String(marker.reasonCode||'NEEDS_REVIEW'),kind:'action',lifecycle:'resolved',mandatory:false,evidenceState:'current',
   title:String(marker.title||`${sourceName(marker.source||marker.route)} decision`),authority:'Confirmed by source workflow',automated:false,
   meta:{originId:String(marker.id)}
 };
 if(marker.route==='leave'){
   let requestRow=null;try{requestRow=(data?.requests||[]).find(r=>String(r.id)===String(marker.sourceId))||null;}catch{}
   if(!requestRow)return null;
   const status=String(requestRow.status||'').toLowerCase();
   if(!['approved','rejected','declined','cancelled','withdrawn'].includes(status))return null;
   return {...base,whyNow:`The authoritative Absence workflow now reports this request as ${status}.`,evidenceLabel:'Current absence request status',auditRef:`Source status: ${status}`,createdAt:requestRow.updatedAt||requestRow.decidedAt||requestRow.approvedAt||new Date(marker.at||Date.now()).toISOString()};
 }
 const r=report();if(!r)return null;
 const team=reportTeams(r).find(t=>String(t?.id||'')===String(marker.sourceId));if(!team)return null;
 if(marker.route==='time-review'){
   const open=(team.issues||[]).filter(i=>i.status==='open').length;if(open!==0)return null;
   return {...base,whyNow:'The current Time Review report confirms there are no open exceptions for this team.',evidenceLabel:'Current payroll/time review report',auditRef:'0 open time exceptions',createdAt:team.updatedAt||r.generatedAt||new Date(marker.at||Date.now()).toISOString()};
 }
 if(marker.route==='weekly-review'){
   if(String(team.status||'')!=='signed')return null;
   return {...base,whyNow:'The current Weekly Sign-off report confirms this team is signed.',evidenceLabel:'Current weekly review report',auditRef:'Source status: signed',createdAt:team.updatedAt||r.generatedAt||new Date(marker.at||Date.now()).toISOString()};
 }
 return null;
}
function renderQueue(extra=[]){
 if(!manager()||page()!=='overview')return null;
 const host=document.querySelector('.fcc-main');if(!host)return null;
 host.querySelector(':scope > .ux11-queue')?.remove();
 const confirmed=sourceResolution(returnMarker());
 const bundle=M()?.build([...collectSignals(),...(Array.isArray(extra)?extra:[]),...(confirmed?[confirmed]:[])])||{actions:[],receipts:[],resolved:[],information:[]};
 const section=document.createElement('section');section.className='ux11-queue';section.setAttribute('aria-label','Manager action queue');
 const visible=bundle.actions.slice(0,3),rest=bundle.actions.slice(3);
 section.innerHTML=`<div class="ux11-head"><div><span class="eyebrow">NEEDS MY ACTION</span><h2>${bundle.actions.length?'${COUNT} priorities':'You are clear for now'}</h2><p>${bundle.actions.length?'The most important verified decisions across absence, time and sign-off.':'No verified cross-workflow manager decisions are waiting.'}</p></div><span class="ux11-count">${bundle.actions.length}</span></div><div class="ux11-live" aria-live="polite"></div><div class="ux11-cards"></div>`.replace('${COUNT}',String(bundle.actions.length));
 const cards=section.querySelector('.ux11-cards');visible.forEach(x=>cards.insertAdjacentHTML('beforeend',card(x)));
 if(rest.length){const d=document.createElement('details');d.className='ux11-more';d.innerHTML=`<summary>${rest.length} more action${rest.length===1?'':'s'}</summary><div class="ux11-more-grid">${rest.map(card).join('')}</div>`;section.appendChild(d);}
 if(bundle.resolved.length){const d=document.createElement('details');d.className='ux11-receipts ux11-resolved';d.innerHTML=`<summary>Recently confirmed · ${bundle.resolved.length}</summary><ul>${bundle.resolved.map(receipt).join('')}</ul>`;section.appendChild(d);}
 if(bundle.receipts.length){const d=document.createElement('details');d.className='ux11-receipts';d.innerHTML=`<summary>Handled automatically · ${bundle.receipts.length}</summary><ul>${bundle.receipts.map(receipt).join('')}</ul>`;section.appendChild(d);}
 if(bundle.information.length){const d=document.createElement('details');d.className='ux11-information';d.innerHTML=`<summary>Information · ${bundle.information.length}</summary><ul>${bundle.information.map(receipt).join('')}</ul>`;section.appendChild(d);}
 host.prepend(section);
 restoreFocus(section);
 return bundle;
}
function navButton(route){return document.querySelector(`.sidebar .navbtn[data-page="${CSS.escape(route)}"]`)||document.querySelector(`#ux-tool-backdrop .navbtn[data-page="${CSS.escape(route)}"]`);}
function openRoute(route,id,sourceId,source,reasonCode,title){
 const marker={from:'overview',id:String(id||''),sourceId:String(sourceId||''),route:String(route||''),source:String(source||''),reasonCode:String(reasonCode||''),title:String(title||''),at:Date.now()};
 try{sessionStorage.setItem('wfmUx11Return',JSON.stringify(marker));}catch{}
 const b=navButton(route);if(b){b.click();return true;}
 const live=document.querySelector('.ux11-live');if(live)live.textContent='The source workflow is not available for this role.';return false;
}
function returnMarker(){try{return JSON.parse(sessionStorage.getItem('wfmUx11Return')||'null');}catch{return null;}}
function clearReturnMarker(){try{sessionStorage.removeItem('wfmUx11Return');}catch{}}
function selectSourceScope(controlId,sourceId){
 if(!sourceId)return false;
 const control=document.getElementById(controlId);if(!control)return false;
 const option=[...control.options].find(o=>String(o.value)===String(sourceId));
 if(!option||String(control.value)===String(option.value))return false;
 control.value=option.value;
 control.dispatchEvent(new Event('change',{bubbles:true}));
 return true;
}
function focusNode(target){
 if(!target)return false;
 if(!target.matches?.('button,a[href],input,select,textarea,[tabindex]'))target.setAttribute('tabindex','-1');
 try{target.scrollIntoView({block:'center',behavior:'smooth'});}catch{target.scrollIntoView();}
 setTimeout(()=>{try{target.focus({preventScroll:true});}catch{try{target.focus();}catch{}}},60);
 return true;
}
function focusSourceTarget(marker){
 if(!marker?.sourceId)return false;
 if(marker.route==='time-review'&&selectSourceScope('tri-team',marker.sourceId)){setTimeout(()=>focusSourceTarget(marker),90);return true;}
 if(marker.route==='weekly-review'&&selectSourceScope('review-team',marker.sourceId)){setTimeout(()=>focusSourceTarget(marker),90);return true;}
 let target=null;
 if(marker.route==='leave')target=[...document.querySelectorAll('.ux-leave-card[data-request]')].find(el=>String(el.dataset.request)===String(marker.sourceId))||null;
 else if(marker.route==='time-review')target=document.querySelector('.tr-list .tr-person')||document.querySelector('.tr-list');
 else if(marker.route==='weekly-review')target=document.querySelector('.ux-signoff-desk')||document.querySelector('.review-layout');
 return focusNode(target);
}
function addBackLink(){
 if(page()==='overview')return;
 const marker=returnMarker();if(!marker||marker.from!=='overview')return;
 const head=document.querySelector('.heading');if(!head||head.querySelector('.ux11-back'))return;
 const b=document.createElement('button');b.type='button';b.className='btn small ux11-back';b.textContent='Back to priority queue';b.addEventListener('click',()=>{const o=navButton('overview');o?.click();});head.appendChild(b);focusSourceTarget(marker);
}
function restoreFocus(section){
 const marker=returnMarker();if(!marker||marker.from!=='overview'||!marker.id)return;
 const byId=`[data-ux11-id="${CSS.escape(marker.id)}"] .ux11-open`;
 const byRoute=marker.route&&marker.sourceId?`.ux11-open[data-ux11-route="${CSS.escape(marker.route)}"][data-ux11-source-id="${CSS.escape(marker.sourceId)}"]`:null;
 let target=section.querySelector(byId)|| (byRoute?section.querySelector(byRoute):null);
 if(target){
   const focusProjected=(attempt=0)=>{
     const current=document.querySelector(byId)||(byRoute?document.querySelector(byRoute):null)||target;
     const visible=Boolean(current?.isConnected&&!current.closest('[hidden]')&&current.getClientRects().length);
     if(visible){
       try{current.focus({preventScroll:true});}catch{try{current.focus();}catch{}}
       if(document.activeElement===current){clearReturnMarker();return;}
     }
     if(attempt<20&&returnMarker()?.id===marker.id)setTimeout(()=>focusProjected(attempt+1),40);
   };
   setTimeout(()=>focusProjected(),20);return;
 }
 const confirmed=section.querySelector(`.ux11-resolved [data-ux11-id="${CSS.escape(marker.id)}"]`);
 if(confirmed){const lane=confirmed.closest('details');if(lane)lane.open=true;focusNode(confirmed);const live=section.querySelector('.ux11-live');if(live)live.textContent='The source workflow confirmed the decision.';clearReturnMarker();}
}
function apply(){
 try{
   if(page()==='overview'){if(manager())renderQueue();}
   else if(returnMarker())addBackLink();
 }catch(e){console.warn('WFM UX cycle 11 skipped:',e);}
}
document.addEventListener('click',e=>{const b=e.target.closest('.ux11-open[data-ux11-route]');if(!b)return;e.preventDefault();openRoute(b.dataset.ux11Route,b.dataset.ux11Id,b.dataset.ux11SourceId,b.dataset.ux11Source,b.dataset.ux11Reason,b.dataset.ux11Title);});
const previousRender=window.render;if(typeof previousRender==='function')window.render=async function(...args){const out=await previousRender.apply(this,args);apply();return out;};
const observer=new MutationObserver(()=>{try{if(manager()&&page()==='overview'&&!document.querySelector('.ux11-queue'))apply();else if(page()!=='overview'&&!document.querySelector('.ux11-back')&&returnMarker())addBackLink();}catch{}});
observer.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);setTimeout(apply,400);
window.WFMUXCycle11={apply,collectSignals,renderQueue,renderCard:card,openRoute,returnMarker,restoreFocus,addBackLink,focusSourceTarget,selectSourceScope,focusNode,sourceResolution};
})();