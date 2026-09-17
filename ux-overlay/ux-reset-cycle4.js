/* WFM UX evolution cycle 4: make Performance a focused cost/efficiency decision desk. */
(function(){
'use strict';
const safe=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const managerWithCost=()=>{try{const a=(typeof F!=='undefined'&&F.actor)||null;return !isEmployee()&&['manager','director'].includes(a?.role)&&a?.costs===true;}catch{return false;}};
const report=()=>{try{return typeof VCU!=='undefined'?VCU.report:null;}catch{return null;}};
const money=pence=>{const n=Number(pence);if(!Number.isFinite(n))return 'Not quantified';try{return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(n/100);}catch{return `£${Math.round(n/100).toLocaleString('en-GB')}`;}};
const sumValue=rows=>rows.reduce((n,x)=>n+Number(x?.o?.value?.amountPence||0),0);
function detail(title,caption,rows,kind){
 const d=document.createElement('details');d.className=`ux-performance-detail ${kind||''}`;
 const s=document.createElement('summary');s.innerHTML=`<span><b>${safe(title)}</b><small>${safe(caption)}</small></span><span class="ux-detail-state">Open</span>`;
 const body=document.createElement('div');body.className='ux-performance-detail-body';rows.forEach(({card})=>{card.classList.add('ux-performance-card');body.appendChild(card);});
 d.append(s,body);return d;
}
function enhancePerformance(){
 if(!managerWithCost()||ui?.page!=='savings-decisions'||document.querySelector('.ux-performance-desk'))return;
 const hero=document.querySelector('.vc-hero'),grid=document.querySelector('.vc-grid');
 if(!hero||!grid)return;
 const r=report();if(!r)return;
 const opportunities=Array.isArray(r.opportunities)?r.opportunities:[];
 const cards=[...grid.querySelectorAll(':scope > .vc-card')];
 if(cards.length!==opportunities.length)return;
 const waiting=[],reviewed=[];
 cards.forEach((card,i)=>{const o=opportunities[i];card.dataset.uxOpportunityKey=o.key;card.dataset.uxOpportunityStatus=o.status;const row={card,o};(o.status==='awaiting_decision'?waiting:reviewed).push(row);});
 const waitingValue=Number(r.summary?.predictedValueAwaitingPence||0);
 const avoidable=r.insight?.hardCashAvoidableCostPoolPence;
 const desk=document.createElement('section');desk.className='ux-performance-desk';desk.setAttribute('aria-label','Cost and efficiency decisions');
 desk.innerHTML=`<div class="ux-performance-head"><div><span class="eyebrow">COST &amp; EFFICIENCY</span><h1>${waiting.length?`${waiting.length} ${waiting.length===1?'decision needs':'decisions need'} you`:'No cost decision needs you right now'}</h1><p>${waiting.length?'The existing evidence and cost engines have already narrowed the work. Start with the highest-value evidenced decision, then open more only if needed.':'No fully evidenced YES/NO opportunity is waiting. The system will not manufacture a saving to fill the screen.'}</p></div><div class="ux-performance-total"><small>VALUE AWAITING A DECISION</small><strong>${safe(money(waitingValue))}</strong><span>Estimate · not realised cash</span></div></div><div class="ux-performance-kpis"><div><small>Decisions waiting</small><strong>${waiting.length}</strong><span>human YES / NO required</span></div><div><small>Value waiting</small><strong>${safe(money(waitingValue))}</strong><span>evidence-backed estimate</span></div><div><small>Avoidable-cost context</small><strong>${safe(money(avoidable))}</strong><span>reviewed context · not automatically claimable</span></div></div>`;
 hero.before(desk);
 if(waiting.length){
   const focus=document.createElement('section');focus.className='ux-performance-focus';focus.innerHTML='<div class="ux-performance-focus-label"><span class="eyebrow">NEXT DECISION</span><b>Highest-value evidenced opportunity</b><small>Review the action and choose YES or NO. Evidence remains available on demand.</small></div>';
   const first=waiting.shift();first.card.classList.add('ux-performance-card','ux-performance-card-focus');focus.appendChild(first.card);desk.after(focus);
   let anchor=focus;
   if(waiting.length){const q=detail('More opportunities',`${waiting.length} awaiting · ${money(sumValue(waiting))} estimated value`,waiting,'queue');anchor.after(q);anchor=q;}
   if(reviewed.length){const done=detail('Reviewed decisions',`${reviewed.length} already answered`,reviewed,'reviewed');anchor.after(done);anchor=done;}
   const principle=document.querySelector('.vc-principle');
   if(principle){const controls=document.createElement('details');controls.className='ux-performance-controls';controls.innerHTML='<summary><span><b>Controls &amp; value rules</b><small>How estimates, consent and safeguards are handled</small></span><span class="ux-detail-state">Open</span></summary>';const body=document.createElement('div');body.className='ux-performance-controls-body';body.appendChild(principle);controls.appendChild(body);anchor.after(controls);}
 }else{
   const empty=grid.querySelector('.vc-empty');if(empty){empty.classList.add('ux-performance-empty');desk.after(empty);}
   if(reviewed.length){const done=detail('Reviewed decisions',`${reviewed.length} already answered`,reviewed,'reviewed');(empty||desk).after(done);}
 }
 document.querySelector('.vc-insight')?.remove();
 hero.remove();grid.remove();
 document.body.dataset.uxPerformance='focused';
}
function apply(){try{enhancePerformance();}catch(e){console.warn('WFM UX cycle 4 skipped:',e);}}
const previousRender=window.render;if(typeof previousRender==='function')window.render=async function(...args){const result=await previousRender.apply(this,args);apply();return result;};
const observer=new MutationObserver(()=>{try{if(ui?.page==='savings-decisions'&&!document.querySelector('.ux-performance-desk'))apply();}catch{}});observer.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);setTimeout(apply,450);
window.WFMUXCycle4={apply};
})();
