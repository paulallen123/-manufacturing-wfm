/* WFM role-first UX reset. Loaded last so it can simplify the composed UI without
   bypassing existing server-side workflow, permissions, or decision controls. */
(function(){
'use strict';
const UX={capacity:new Map(),render:null};
const managerRole=()=>!isEmployee()&&['manager','director','supervisor'].includes((typeof F!=='undefined'&&F.actor?.role)||ui.role);
const routeGroups={
  run:['schedule-publication','shifts','readiness','time-review','attendance','cover','op-breaks','op-swaps','shutdowns','temporary'],
  performance:['savings-decisions','costs','forecast','demand','benchmarks','op-sites','payroll-run','payroll','insights'],
  setup:['organisation','onboarding','demand-input','op-settings','integrations','compliance'],
  evidence:['audit','support']
};
const routeTitles={run:'Run the week',performance:'Cost & efficiency',setup:'People & setup',evidence:'Evidence & support'};
const routeLabel={overview:'Today',leave:'Absence','weekly-review':'Sign off','savings-decisions':'Performance',costs:'Performance',insights:'Performance',shifts:'Shifts','time-review':'My time'};
const minutes=v=>v==null?'Not verified':(Number(v)/60).toLocaleString('en-GB',{maximumFractionDigits:2})+' h';
const requestMinutes=r=>Number.isFinite(Number(r.hours))?Math.round(Number(r.hours)*60):0;
const allowedPeople=()=>{try{return people();}catch{return []}};
const myActor=()=>typeof F!=='undefined'&&F.actor?F.actor:(typeof sampleActor==='function'?sampleActor():null);
function setLabel(button,label){const span=button?.querySelector('span:not(.count):not(.review-count)');if(span)span.textContent=label;button?.setAttribute('aria-label',label);button?.setAttribute('title',label);}
function primaryRoutes(buttons){
  const available=new Set(buttons.map(b=>b.dataset.page));
  if(isEmployee())return ['overview','leave','shifts','time-review'].filter(x=>available.has(x));
  if(!managerRole())return buttons.slice(0,5).map(x=>x.dataset.page);
  const performance=['savings-decisions','costs','insights'].find(x=>available.has(x));
  return ['overview','leave','weekly-review',performance].filter(Boolean).filter(x=>available.has(x));
}
function groupFor(page){for(const [g,items] of Object.entries(routeGroups))if(items.includes(page))return g;return 'evidence';}
function closeTools(){const d=document.getElementById('ux-tool-backdrop');if(d){d.hidden=true;d.setAttribute('aria-hidden','true');}document.querySelector('.ux-more-button')?.setAttribute('aria-expanded','false');}
function openTools(){const d=document.getElementById('ux-tool-backdrop');if(d){d.hidden=false;d.setAttribute('aria-hidden','false');d.querySelector('.ux-tool-close')?.focus();}document.querySelector('.ux-more-button')?.setAttribute('aria-expanded','true');}
function buildTools(secondary){
  document.getElementById('ux-tool-backdrop')?.remove();
  if(!secondary.length)return;
  const backdrop=document.createElement('div');backdrop.id='ux-tool-backdrop';backdrop.className='ux-tool-backdrop';backdrop.hidden=true;backdrop.setAttribute('aria-hidden','true');
  const drawer=document.createElement('aside');drawer.className='ux-tool-drawer';drawer.setAttribute('aria-label','More workforce tools');
  const head=document.createElement('div');head.className='ux-tool-head';head.innerHTML='<div><h2>More tools</h2><p>Specialist workflows stay available without competing with the work you do every day.</p></div><button type="button" class="ux-tool-close" data-ux="close" aria-label="Close more tools">×</button>';drawer.appendChild(head);
  const groups={};for(const b of secondary){const g=groupFor(b.dataset.page);(groups[g]??=[]).push(b);}
  for(const g of ['run','performance','setup','evidence']){if(!groups[g]?.length)continue;const section=document.createElement('section');section.className='ux-tool-group';section.innerHTML=`<h3>${routeTitles[g]}</h3><div class="ux-tool-list"></div>`;const list=section.querySelector('.ux-tool-list');for(const original of groups[g]){const clone=original.cloneNode(true);clone.classList.remove('ux-secondary-route');clone.classList.add('ux-drawer-route');list.appendChild(clone);}drawer.appendChild(section);}
  backdrop.appendChild(drawer);document.body.appendChild(backdrop);
}
function simplifyNav(){
  const nav=document.querySelector('.sidebar nav');if(!nav)return;
  nav.querySelectorAll('.ux-more-button').forEach(x=>x.remove());
  const buttons=[...nav.querySelectorAll('.navbtn[data-page]')];if(!buttons.length)return;
  buttons.forEach(b=>b.classList.remove('ux-primary-route','ux-secondary-route'));
  const primary=new Set(primaryRoutes(buttons));
  for(const b of buttons){if(primary.has(b.dataset.page)){b.classList.add('ux-primary-route');if(routeLabel[b.dataset.page])setLabel(b,routeLabel[b.dataset.page]);}else b.classList.add('ux-secondary-route');}
  const secondary=buttons.filter(b=>!primary.has(b.dataset.page));
  if(secondary.length){const more=document.createElement('button');more.type='button';more.className='navbtn ux-more-button';more.dataset.ux='more';more.setAttribute('aria-expanded','false');more.innerHTML=`${typeof icon==='function'?icon('menu'):''}<span>More</span><span class="ux-chevron">›</span>`;nav.appendChild(more);}
  buildTools(secondary);
}
function foldSection(node,title){if(!node||node.closest('.ux-detail-fold'))return;const details=document.createElement('details');details.className='ux-detail-fold';const summary=document.createElement('summary');summary.textContent=title;const body=document.createElement('div');body.className='ux-fold-body';node.parentNode.insertBefore(details,node);details.append(summary,body);body.appendChild(node);}
function condenseManagerHome(){if(!managerRole()||ui.page!=='overview')return;foldSection(document.querySelector('.fcc-map'),'Explore work-centre readiness');foldSection(document.querySelector('.fcc-week'),'See the end-to-end decision flow');}
function reqInterval(r){
  if(r.start&&r.end){const a=Date.parse(r.start),b=Date.parse(r.end);if(Number.isFinite(a)&&Number.isFinite(b))return [a,b];}
  const d=r.date;if(!d)return [NaN,NaN];const a=Date.parse(d+'T00:00:00+01:00');return [a,a+86400000];
}
function overlaps(a,b){const A=reqInterval(a),B=reqInterval(b);return Number.isFinite(A[0])&&Number.isFinite(B[0])&&A[0]<B[1]&&B[0]<A[1];}
function otherLeave(r,status){const ids=new Set(allowedPeople().map(p=>p.id));return (data.requests||[]).filter(x=>x.id!==r.id&&x.employee!==r.employee&&ids.has(x.employee)&&x.status===status&&overlaps(x,r)).map(x=>person(x.employee)?.name||x.employee);}
function leaveRow(id){try{return window.WFMOps?.leaveRow(data,id);}catch{return null;}}
function entitlementText(row){if(row?.opening?.annualMinutes!=null)return minutes(row.opening.annualMinutes);return 'Needs verified opening';}
function statusClass(s){return s==='prechecks_clear'?'clear':s==='blocked'?'blocked':'review';}
function capacityText(c){if(!c)return '<span class="ux-capacity-state review">Checking</span><span>Checking staffing and skills…</span>';const seg=(c.segments||[]).find(x=>x.status==='blocked')||(c.segments||[])[0];const line=seg?`${seg.present} working · ${seg.off}/${seg.cap===null||seg.cap===undefined?'—':seg.cap} off cap · skills ${seg.qualified}/${seg.requiredSkills}`:'No detailed team segment returned.';const why=(c.blocking||[])[0]?.detail||(c.warnings||[])[0]||'';return `<span class="ux-capacity-state ${statusClass(c.status)}">${esc(c.status==='prechecks_clear'?'coverage clear':c.status)}</span><span>${esc(line)}${why?` · ${esc(why)}`:''}</span>`;}
async function loadCapacity(r){
  const key=`${data.version||0}:${r.id}`;if(UX.capacity.has(key))return UX.capacity.get(key);
  const payload={employee:r.employee,requestId:r.id};if(r.start&&r.end){payload.start=r.start;payload.end=r.end;}else{payload.date=r.date;if(r.hours!=null)payload.hours=r.hours;}
  let value=null;
  try{if(typeof OFFLINE!=='undefined'&&!OFFLINE&&typeof request==='function')value=await request('/api/leave-capacity','POST',payload);else if(window.WFMWorkRules?.normaliseLeave&&window.WFMWorkRules?.capacity){const v=window.WFMWorkRules.normaliseLeave(data,payload);value=window.WFMWorkRules.capacity(data,myActor(),v);}}catch(e){value={status:'review',blocking:[{detail:e.message}],warnings:[],segments:[]};}
  UX.capacity.set(key,value);return value;
}
function requestCard(r){
  const p=person(r.employee),row=leaveRow(r.employee),m=requestMinutes(r),after=row?.remainingMinutes==null?null:Math.max(0,row.remainingMinutes-m),approvedOff=otherLeave(r,'approved'),pendingOff=otherLeave(r,'pending'),capacityId='ux-cap-'+String(r.id).replace(/[^a-zA-Z0-9_-]/g,'_');
  return `<article class="ux-leave-card" data-request="${esc(r.id)}"><div class="ux-leave-top"><div class="ux-leave-person">${typeof avatar==='function'?avatar(p):''}<div><b>${esc(p?.name||r.employee)}</b><span>${esc(p?.team||'')} · ${esc(p?.site||'')}</span></div></div><div class="ux-leave-request">${esc(r.date||r.start?.slice(0,10)||'Requested leave')}<small>${minutes(m)} requested</small></div></div><div class="ux-leave-kpis"><div class="ux-leave-kpi"><small>Annual entitlement</small><strong>${esc(entitlementText(row))}</strong></div><div class="ux-leave-kpi"><small>Remaining now</small><strong>${esc(minutes(row?.remainingMinutes))}</strong></div><div class="ux-leave-kpi"><small>Left if approved</small><strong>${esc(minutes(after))}</strong></div><div class="ux-leave-kpi"><small>Available after all pending</small><strong>${esc(minutes(row?.availableMinutes))}</strong></div></div><div class="ux-leave-evidence"><div><b>Who else is off</b>${approvedOff.length?esc(approvedOff.join(', ')):'Nobody else approved off in this scope.'}${pendingOff.length?`<br><span>${esc(pendingOff.join(', '))} also pending.</span>`:''}</div><div id="${capacityId}">${capacityText(null)}</div></div><div class="ux-leave-actions"><span class="ux-auto-note">Approval still runs the existing fresh balance, staffing and skill checks.</span><button type="button" class="btn small" data-act="request" data-id="${esc(r.id)}">Review</button><button type="button" class="btn small primary" data-act="approve" data-id="${esc(r.id)}">Approve</button></div></article>`;
}
function enhanceManagerLeave(){
  if(!managerRole()||ui.page!=='leave')return;
  const content=document.querySelector('.content');if(!content||content.querySelector('.ux-leave-desk'))return;
  const ids=new Set(allowedPeople().map(p=>p.id)),pending=(data.requests||[]).filter(r=>r.status==='pending'&&ids.has(r.employee));
  const desk=document.createElement('section');desk.className='ux-leave-desk';desk.innerHTML=`<div class="ux-leave-desk-head"><div><h2>Decide with the whole picture</h2><p>Balance, the result after approval, other people off, staffing and skill coverage are shown before you decide.</p></div><span class="ux-leave-count">${pending.length} waiting</span></div><div class="ux-leave-list">${pending.length?pending.map(requestCard).join(''):'<div class="ux-leave-empty">No holiday requests need your decision.</div>'}</div>`;
  const anchor=content.querySelector('.filters')||content.querySelector('.heading');if(anchor)anchor.insertAdjacentElement('afterend',desk);else content.prepend(desk);
  const ledgerNodes=[...content.children].filter(n=>n!==desk&&(n.classList.contains('ops-grid')||n.classList.contains('ops-panel')||n.classList.contains('grid2')||n.classList.contains('ops-callout')||n.classList.contains('ops-footnote')));
  if(ledgerNodes.length){const fold=document.createElement('details');fold.className='ux-detail-fold ux-leave-ledger';fold.innerHTML='<summary>Team balance ledger and request history</summary><div class="ux-fold-body"></div>';desk.insertAdjacentElement('afterend',fold);const body=fold.querySelector('.ux-fold-body');ledgerNodes.forEach(n=>body.appendChild(n));}
  for(const r of pending){loadCapacity(r).then(c=>{if(ui.page!=='leave')return;const id='ux-cap-'+String(r.id).replace(/[^a-zA-Z0-9_-]/g,'_'),el=document.getElementById(id);if(el)el.innerHTML=capacityText(c);});}
}
function enhanceEmployeeHome(){
  if(!isEmployee()||ui.page!=='overview')return;const content=document.querySelector('.content');if(!content||content.querySelector('.ux-employee-balance'))return;
  const row=leaveRow(me().id);if(!row)return;const card=document.createElement('section');card.className='ux-employee-balance';card.innerHTML=`<div class="ux-employee-balance-head"><div><h2>Your time off</h2><p>Your recorded balance and requests in one place.</p></div><button type="button" class="btn small primary" data-act="newleave">Request time off</button></div><div class="ux-employee-balance-grid"><div><small>Entitlement</small><strong>${esc(entitlementText(row))}</strong></div><div><small>Remaining</small><strong>${esc(minutes(row.remainingMinutes))}</strong></div><div><small>Available after pending</small><strong>${esc(minutes(row.availableMinutes))}</strong></div></div>`;
  const hero=content.querySelector('.employee-hero');if(hero)hero.insertAdjacentElement('beforebegin',card);else content.prepend(card);hero?.querySelector(':scope > .panel')?.classList.add('ux-redundant-balance');
}
function apply(){
  document.body.classList.add('ux-reset-active');simplifyNav();condenseManagerHome();enhanceManagerLeave();enhanceEmployeeHome();
}
const originalRender=window.render;UX.render=originalRender;
if(typeof originalRender==='function')window.render=async function(...args){const result=await originalRender.apply(this,args);apply();return result;};
document.addEventListener('click',e=>{const b=e.target.closest('[data-ux]');if(b?.dataset.ux==='more'){e.preventDefault();openTools();return;}if(b?.dataset.ux==='close'){e.preventDefault();closeTools();return;}if(e.target.id==='ux-tool-backdrop'){closeTools();return;}if(e.target.closest('#ux-tool-backdrop .navbtn[data-page]'))closeTools();},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeTools();});
const bootApply=()=>{try{if(typeof F==='undefined'||F.ready)apply();}catch{}};
setTimeout(bootApply,0);setTimeout(bootApply,350);
window.WFMUXReset={apply,closeTools,state:UX};
})();
