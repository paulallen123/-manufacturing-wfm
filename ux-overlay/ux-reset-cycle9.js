/* WFM UX evolution cycle 9: make specialist workspaces calm by default without removing capability. */
(function(){
'use strict';
const groups={
  run:{title:'Run the week',caption:'Scheduling, cover and operational readiness.',routes:['schedule-publication','shifts','readiness','cover','op-breaks','op-swaps','shutdowns','temporary']},
  performance:{title:'Cost & efficiency',caption:'Deeper labour, demand, forecast and payroll analysis.',routes:['costs','forecast','demand','benchmarks','op-sites','payroll-run','payroll','insights']},
  setup:{title:'People & setup',caption:'Organisation, onboarding, integrations and policy setup.',routes:['organisation','onboarding','demand-input','op-settings','integrations','compliance']},
  evidence:{title:'Evidence & support',caption:'Audit evidence and support tooling.',routes:['audit','support']}
};
const page=()=>{try{return typeof ui!=='undefined'?ui.page:null;}catch{return null;}};
const employee=()=>{try{return typeof isEmployee==='function'&&isEmployee();}catch{return false;}};
const manager=()=>{try{const role=(typeof F!=='undefined'&&F.actor?.role)||(typeof ui!=='undefined'&&ui.role);return !employee()&&['manager','director','supervisor'].includes(role);}catch{return false;}};
function groupFor(route){for(const [key,value] of Object.entries(groups))if(value.routes.includes(route))return [key,value];return null;}
function safe(v){return String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));}
function enhanceDrawer(){
 const drawer=document.querySelector('.ux-tool-drawer');
 if(!drawer||drawer.dataset.uxSpecialistDrawer==='calm')return;
 const head=drawer.querySelector('.ux-tool-head');
 const sections=[...drawer.querySelectorAll(':scope > .ux-tool-group')];
 if(!head||!sections.length)return;
 drawer.dataset.uxSpecialistDrawer='calm';
 const search=document.createElement('label');
 search.className='ux-tool-search';
 search.innerHTML='<span>Find a tool</span><input type="search" autocomplete="off" placeholder="Search scheduling, payroll, integrations…" aria-label="Find a specialist workforce tool">';
 head.insertAdjacentElement('afterend',search);
 const current=page();
 for(const section of sections){
   const title=section.querySelector('h3')?.textContent?.trim()||'More tools';
   const list=section.querySelector('.ux-tool-list');
   if(!list)continue;
   const details=document.createElement('details');
   details.className='ux-tool-group-fold';
   details.dataset.group=title.toLowerCase().replace(/[^a-z0-9]+/g,'-');
   const active=!!list.querySelector('.navbtn.active')||[...list.querySelectorAll('.navbtn[data-page]')].some(b=>b.dataset.page===current);
   details.open=active;
   const summary=document.createElement('summary');
   const count=list.querySelectorAll('.navbtn[data-page]').length;
   const meta=Object.values(groups).find(g=>g.title===title);
   summary.innerHTML=`<span><b>${safe(title)}</b><small>${safe(meta?.caption||'Open only when you need this specialist area.')}</small></span><span class="ux-tool-count">${count}</span>`;
   details.append(summary,list);
   section.replaceWith(details);
 }
 const input=search.querySelector('input');
 input.addEventListener('input',()=>{
   const q=input.value.trim().toLowerCase();
   drawer.querySelectorAll('.ux-tool-group-fold').forEach(fold=>{
     let visible=0;
     fold.querySelectorAll('.navbtn[data-page]').forEach(button=>{
       const match=!q||button.textContent.toLowerCase().includes(q);
       button.hidden=!match;
       if(match)visible++;
     });
     fold.hidden=visible===0;
     if(q&&visible)fold.open=true;
   });
 });
}
function filterOnlyBar(node){
 if(!node||node.closest('.ux-specialist-scope'))return false;
 const fields=node.querySelectorAll('select,input[type="search"],input[type="date"],input[type="text"],input[type="number"]').length;
 if(fields<2)return false;
 if(node.querySelector('.primary,[data-act*="approve"],[data-act*="save"],[data-act*="publish"],[data-act*="run"],[data-act*="lock"],[data-act*="submit"]'))return false;
 return true;
}
function foldScope(node){
 const details=document.createElement('details');
 details.className='ux-specialist-scope';
 details.innerHTML='<summary><span><b>Scope &amp; filters</b><small>Change the view only when you need to narrow the workspace.</small></span><span class="ux-specialist-state">Open</span></summary><div class="ux-specialist-scope-body"></div>';
 node.parentNode.insertBefore(details,node);
 details.querySelector('.ux-specialist-scope-body').appendChild(node);
 return details;
}
function enhanceWorkspace(){
 if(!manager())return;
 const route=page(),found=groupFor(route);
 if(!found)return;
 const content=document.querySelector('.content');
 if(!content||content.dataset.uxSpecialist==='calm')return;
 content.dataset.uxSpecialist='calm';
 const [,meta]=found;
 const heading=content.querySelector(':scope > .heading')||content.querySelector('.heading');
 if(heading){
   heading.classList.add('ux-specialist-heading');
   const tag=document.createElement('div');
   tag.className='ux-specialist-context';
   tag.innerHTML=`<span>${safe(meta.title)}</span><p>${safe(meta.caption)} Daily decisions remain in Today, Absence, Sign off and Performance.</p>`;
   heading.insertAdjacentElement('afterend',tag);
 }
 const candidates=[...content.children].filter(n=>n.matches?.('.filters,.filterbar,.ops-filters,.toolbar'));
 const bar=candidates.find(filterOnlyBar);
 if(bar)foldScope(bar);
 content.querySelectorAll('.tablewrap,.ops-scroll,.dp-table-scroll,.pci-table-wrap').forEach(node=>{if(!node.hasAttribute('tabindex'))node.setAttribute('tabindex','0');});
}
function apply(){
 try{enhanceDrawer();enhanceWorkspace();}catch(e){console.warn('WFM UX cycle 9 skipped:',e);}
}
const previousRender=window.render;
if(typeof previousRender==='function')window.render=async function(...args){const result=await previousRender.apply(this,args);apply();return result;};
const observer=new MutationObserver(()=>apply());
observer.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);setTimeout(apply,250);setTimeout(apply,700);
window.WFMUXCycle9={apply};
})();
