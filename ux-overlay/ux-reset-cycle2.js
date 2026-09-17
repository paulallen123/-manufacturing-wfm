/* WFM UX evolution cycle 2: make absence decisions operationally relevant and cost-aware without inventing data. */
(function(){
'use strict';
const safe=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const manager=()=>{try{return !isEmployee()&&['manager','director','supervisor'].includes((typeof F!=='undefined'&&F.actor?.role)||ui.role);}catch{return false;}};
const visiblePeople=()=>{try{return people();}catch{return [];}};
const personFor=id=>{try{return person(id);}catch{return visiblePeople().find(p=>p.id===id)||null;}};
function interval(r){if(r?.start&&r?.end){const a=Date.parse(r.start),b=Date.parse(r.end);if(Number.isFinite(a)&&Number.isFinite(b))return [a,b];}if(!r?.date)return [NaN,NaN];const a=Date.parse(`${r.date}T00:00:00`);return [a,a+86400000];}
function overlaps(a,b){const A=interval(a),B=interval(b);return Number.isFinite(A[0])&&Number.isFinite(B[0])&&A[0]<B[1]&&B[0]<A[1];}
function sameOperationalScope(request){const target=personFor(request.employee),all=visiblePeople().filter(p=>p.id!==request.employee);if(!target)return all;let scoped=all;if(target.site)scoped=scoped.filter(p=>!p.site||p.site===target.site);if(target.team){const team=scoped.filter(p=>p.team===target.team);if(team.length)scoped=team;}return scoped;}
function otherLeave(request,status){const ids=new Set(sameOperationalScope(request).map(p=>p.id));return (data.requests||[]).filter(x=>x.id!==request.id&&x.employee!==request.employee&&ids.has(x.employee)&&x.status===status&&overlaps(x,request)).map(x=>personFor(x.employee)?.name||x.employee);}
function compactNames(names){const unique=[...new Set(names.filter(Boolean))];if(!unique.length)return 'Nobody else in the same operational scope.';if(unique.length<=3)return unique.map(safe).join(', ');return `${unique.slice(0,3).map(safe).join(', ')} <span class="ux-muted-inline">+${unique.length-3} more</span>`;}
function scopeText(request){const p=personFor(request.employee);if(p?.team&&p?.site)return `${safe(p.team)} · ${safe(p.site)}`;if(p?.team)return safe(p.team);if(p?.site)return safe(p.site);return 'your visible team';}
function cachedCapacity(requestId){try{const cache=window.WFMUXReset?.state?.capacity;if(!cache)return null;for(const [key,value] of cache.entries())if(String(key).endsWith(`:${requestId}`))return value;}catch{}return null;}
async function capacityFor(r){let value=cachedCapacity(r.id);if(value)return value;const payload={employee:r.employee,requestId:r.id};if(r.start&&r.end){payload.start=r.start;payload.end=r.end;}else{payload.date=r.date;if(r.hours!=null)payload.hours=r.hours;}try{if(typeof OFFLINE!=='undefined'&&!OFFLINE&&typeof request==='function')value=await request('/api/leave-capacity','POST',payload);else if(window.WFMWorkRules?.normaliseLeave&&window.WFMWorkRules?.capacity){const normal=window.WFMWorkRules.normaliseLeave(data,payload);const actor=typeof F!=='undefined'?F.actor:null;value=window.WFMWorkRules.capacity(data,actor,normal);}}catch(e){value={status:'review',warnings:[e.message]};}return value;}
function costCandidate(value,label,currency){if(value&&typeof value==='object'&&Number.isFinite(Number(value.amount)))return {amount:Number(value.amount),label,currency:value.currency||currency||'GBP'};if(Number.isFinite(Number(value)))return {amount:Number(value),label,currency:currency||'GBP'};return null;}
function verifiedCost(c){if(!c)return null;const candidates=[
  costCandidate(c.costImpact,'Estimated cover cost',c.currency),
  costCandidate(c.incrementalCost,'Incremental cost',c.currency),
  costCandidate(c.coverCost,'Estimated cover cost',c.currency),
  costCandidate(c.overtimeCost,'Estimated overtime cost',c.currency),
  costCandidate(c.estimatedCost,'Estimated cost',c.currency),
  costCandidate(c.costs?.incremental,'Incremental cost',c.costs?.currency||c.currency),
  costCandidate(c.costs?.cover,'Estimated cover cost',c.costs?.currency||c.currency),
  costCandidate(c.costs?.overtime,'Estimated overtime cost',c.costs?.currency||c.currency)
];
return candidates.find(Boolean)||null;}
function money(amount,currency){try{return new Intl.NumberFormat('en-GB',{style:'currency',currency:currency||'GBP',maximumFractionDigits:2}).format(amount);}catch{return `£${Number(amount).toFixed(2)}`;}}
function costHtml(c){const found=verifiedCost(c);if(found)return `<b>Cost impact</b><strong>${safe(money(found.amount,found.currency))}</strong><span>${safe(found.label)} returned by the current decision data.</span>`;if(!c)return '<b>Cost impact</b><strong>Checking…</strong><span>Only verified cover/overtime cost will be shown.</span>';if(c.status==='blocked')return '<b>Cost impact</b><strong>Depends on cover</strong><span>Coverage is blocked; do not invent a saving or cost before a replacement plan exists.</span>';return '<b>Cost impact</b><strong>Not quantified</strong><span>The current coverage response did not return a verified incremental-cost figure.</span>';}
function updateScope(card,r){const evidence=card.querySelector('.ux-leave-evidence');if(!evidence)return;const approved=otherLeave(r,'approved'),pending=otherLeave(r,'pending');const first=evidence.children[0];if(first){first.innerHTML=`<b>Who else is off</b><span class="ux-scope-label">Same scope: ${scopeText(r)}</span>${compactNames(approved)}${pending.length?`<br><span>${compactNames(pending)} also pending.</span>`:''}`;}
let cost=evidence.querySelector('.ux-cost-impact');if(!cost){cost=document.createElement('div');cost.className='ux-cost-impact';cost.innerHTML=costHtml(null);evidence.appendChild(cost);}return cost;}
function enhanceLeaveCard(card){if(card.dataset.uxCycle2==='1')return;const id=card.dataset.request,r=(data.requests||[]).find(x=>String(x.id)===String(id));if(!r)return;card.dataset.uxCycle2='1';card.setAttribute('aria-label',`Absence decision for ${personFor(r.employee)?.name||r.employee}`);const cost=updateScope(card,r);const note=card.querySelector('.ux-auto-note');if(note)note.textContent='Approval still runs the existing fresh balance, staffing, skills and policy checks.';setTimeout(()=>capacityFor(r).then(c=>{if(cost?.isConnected)cost.innerHTML=costHtml(c);}),120);}
function enhanceAbsenceDesk(){if(!manager()||ui.page!=='leave')return;const desk=document.querySelector('.ux-leave-desk');if(!desk)return;const intro=desk.querySelector('.ux-leave-desk-head p');if(intro)intro.textContent='See entitlement, the balance after approval, same-team conflicts, live coverage and verified cost impact before deciding.';desk.querySelectorAll('.ux-leave-card').forEach(enhanceLeaveCard);}
function markPageIntent(){document.body.dataset.uxRole=manager()?'manager':(typeof isEmployee==='function'&&isEmployee()?'employee':'other');document.body.dataset.uxJob=ui?.page==='leave'?'absence':ui?.page==='weekly-review'?'signoff':['savings-decisions','costs','insights'].includes(ui?.page)?'performance':'other';}
function apply(){try{markPageIntent();enhanceAbsenceDesk();}catch(e){console.warn('WFM UX cycle 2 skipped:',e);}}
const previousRender=window.render;if(typeof previousRender==='function')window.render=async function(...args){const result=await previousRender.apply(this,args);apply();return result;};
const observer=new MutationObserver(()=>{if(document.querySelector('.ux-leave-card:not([data-ux-cycle2="1"])'))apply();});
observer.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);setTimeout(apply,400);
window.WFMUXCycle2={apply,verifiedCost,sameOperationalScope};
})();
