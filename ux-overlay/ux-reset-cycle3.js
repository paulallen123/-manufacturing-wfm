/* WFM UX evolution cycle 3: turn weekly sign-off into one decision with detail on demand. */
(function(){
'use strict';
const safe=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const manager=()=>{try{return !isEmployee()&&['manager','director','supervisor'].includes((typeof F!=='undefined'&&F.actor?.role)||ui.role);}catch{return false;}};
const report=()=>{try{return window.payrollPreview?.report?.()||null;}catch{return null;}};
const hours=minutes=>`${(Number(minutes||0)/60).toLocaleString('en-GB',{maximumFractionDigits:1})} h`;
function selectedTeam(r){if(!r?.teams?.length)return null;const id=document.getElementById('review-team')?.value;return r.teams.find(t=>String(t.id)===String(id))||r.teams[0];}
function nextState(t){
 const open=(t.issues||[]).filter(i=>i.status==='open').length;
 const cats=t.categories||[],checks=cats.filter(c=>c.confirmed).length;
 const people=t.employees||[],checked=Number(t.checkedEmployees||0),blockers=(t.blockers||[]).length;
 if(t.status==='signed')return {tone:'clear',title:'Week signed and locked',detail:'Payroll receives the exact version that was approved.',target:'controls'};
 if(t.status==='stale')return {tone:'risk',title:'The signed week changed',detail:'Review the changed evidence and sign the new version before payroll.',target:'checks'};
 if(t.status==='returned')return {tone:'risk',title:'This week was returned for review',detail:'Resolve the outstanding evidence, then complete the checks again.',target:open?'checks':checked<people.length?'people':'checks'};
 if(open)return {tone:'risk',title:`${open} ${open===1?'exception needs':'exceptions need'} a decision`,detail:'Start with evidence that can change attendance or payroll.',target:'checks'};
 if(checks<cats.length)return {tone:'attention',title:`${cats.length-checks} weekly ${cats.length-checks===1?'check remains':'checks remain'}`,detail:'Exceptions are clear. Confirm each review section against the evidence.',target:'checks'};
 if(checked<people.length)return {tone:'attention',title:`${people.length-checked} employee ${people.length-checked===1?'total remains':'totals remain'}`,detail:'Confirm every person, including anyone with zero recorded hours.',target:'people'};
 if(t.canSign)return {tone:'clear',title:'Ready to sign',detail:'All required checks are complete. The final approval is unlocked.',target:null};
 if(blockers)return {tone:'risk',title:`${blockers} ${blockers===1?'blocker remains':'blockers remain'}`,detail:'The authoritative weekly review still prevents sign-off.',target:'checks'};
 return {tone:'attention',title:'Final review still required',detail:'The week is not yet eligible for sign-off.',target:'checks'};
}
function detail(key,title,caption,node,open=false){
 const el=document.createElement('details');el.className='ux-signoff-detail';el.dataset.uxSignoffDetail=key;el.open=open;
 const summary=document.createElement('summary');summary.innerHTML=`<span><b>${safe(title)}</b><small>${safe(caption)}</small></span><span class="ux-detail-state">Open</span>`;
 const body=document.createElement('div');body.className='ux-signoff-detail-body';if(node)body.appendChild(node);el.append(summary,body);return el;
}
function enhanceSignoff(){
 if(!manager()||ui?.page!=='weekly-review')return;
 const tabs=document.querySelector('.review-tabs'),layout=document.querySelector('.review-layout');
 if(!tabs||!layout||document.querySelector('.ux-signoff-desk'))return;
 const r=report(),t=selectedTeam(r);if(!t)return;
 const open=(t.issues||[]).filter(i=>i.status==='open').length;
 const cats=t.categories||[],checks=cats.filter(c=>c.confirmed).length;
 const people=t.employees||[],checked=Number(t.checkedEmployees||0);
 const state=nextState(t);
 const parent=tabs.parentElement;
 const hero=parent.querySelector(':scope > .review-hero');
 const metrics=parent.querySelector(':scope > .review-metrics');
 const steps=parent.querySelector(':scope > .review-steps');
 const main=layout.querySelector('.review-main');
 const panels=main?[...main.children].filter(x=>x.classList?.contains('panel')):[];
 const signbar=main?.querySelector('.review-signbar');
 const aside=layout.querySelector('.review-aside');
 if(!main||panels.length<2||!signbar||!steps||!aside)return;

 const desk=document.createElement('section');desk.className=`ux-signoff-desk ${state.tone}`;desk.setAttribute('aria-label','Weekly sign-off decision');
 desk.innerHTML=`<div class="ux-signoff-head"><div><span class="ux-signoff-eyebrow">WEEKLY SIGN-OFF · ${safe(t.site||'')}</span><h2>${safe(state.title)}</h2><p>${safe(state.detail)}</p></div><div class="ux-signoff-status">${safe(t.status==='signed'?'Signed':t.status==='stale'?'Changed':t.status==='returned'?'Returned':'In review')}</div></div><div class="ux-signoff-kpis"><div><small>Exceptions</small><strong>${open}</strong><span>${open?'need evidence':'clear'}</span></div><div><small>Weekly checks</small><strong>${checks}/${cats.length}</strong><span>${checks===cats.length?'complete':'confirmed'}</span></div><div><small>People checked</small><strong>${checked}/${people.length}</strong><span>${checked===people.length?'complete':'totals'}</span></div><div><small>Worked time</small><strong>${safe(hours(t.workedMinutes))}</strong><span>recorded</span></div></div>${state.target?`<button type="button" class="btn primary ux-signoff-next" data-ux-signoff-open="${state.target}">${state.target==='people'?'Check employee totals':open?'Resolve exceptions':'Continue review'}</button>`:''}`;
 tabs.after(desk);
 const directWarnings=[...parent.children].filter(el=>el!==desk&&el.classList?.contains('review-inline-warning'));
 directWarnings.forEach(w=>desk.appendChild(w));
 desk.appendChild(signbar);

 const details=document.createElement('div');details.className='ux-signoff-details';
 const checksWrap=document.createElement('div');checksWrap.className='ux-signoff-checks';checksWrap.appendChild(steps);checksWrap.appendChild(panels[0]);
 details.appendChild(detail('checks','Checks & exceptions',`${open} open · ${checks}/${cats.length} sections confirmed`,checksWrap,false));
 details.appendChild(detail('people','Employee totals',`${checked}/${people.length} people checked`,panels[1],false));
 details.appendChild(detail('controls','Controls & protection','Audit safeguards, review checklist and payroll lock rules',aside,false));
 desk.after(details);
 hero?.remove();metrics?.remove();layout.remove();
 document.body.dataset.uxSignoff='condensed';
}
function apply(){try{enhanceSignoff();}catch(e){console.warn('WFM UX cycle 3 skipped:',e);}}
const previousRender=window.render;if(typeof previousRender==='function')window.render=async function(...args){const result=await previousRender.apply(this,args);apply();return result;};
document.addEventListener('click',e=>{const b=e.target.closest('[data-ux-signoff-open]');if(!b)return;const d=document.querySelector(`[data-ux-signoff-detail="${b.dataset.uxSignoffOpen}"]`);if(!d)return;d.open=true;d.scrollIntoView({behavior:'smooth',block:'start'});});
const observer=new MutationObserver(()=>{if(ui?.page==='weekly-review'&&!document.querySelector('.ux-signoff-desk'))apply();});observer.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);setTimeout(apply,450);
window.WFMUXCycle3={apply,nextState};
})();
