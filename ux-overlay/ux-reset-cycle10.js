/* WFM UX evolution cycle 10: planner focus mode for schedule publication. */
(function(){
'use strict';
const route=()=>{try{return typeof ui!=='undefined'?ui.page:null;}catch{return null;}};
const employee=()=>{try{return typeof isEmployee==='function'&&isEmployee();}catch{return false;}};
const manager=()=>{try{const role=(typeof F!=='undefined'&&F.actor?.role)||(typeof ui!=='undefined'&&ui.role);return !employee()&&['manager','director','supervisor'].includes(role);}catch{return false;}};
const text=node=>(node?.textContent||'').replace(/\s+/g,' ').trim();
function findIssuePanel(content){
 const pattern=/(coverage|gap|unfilled|conflict|shortage|skill|overtime|agency|exception|risk)/i;
 const nodes=[...content.querySelectorAll(':scope > .panel,:scope > .card,:scope > section,.ops-panel')];
 return nodes.find(node=>!node.matches('.ux-plan-focus')&&pattern.test(text(node)))||null;
}
function findGrid(content){
 const known=content.querySelector('.tablewrap,.ops-scroll,.dp-table-scroll,.pci-table-wrap');
 if(known)return known;
 const tables=[...content.querySelectorAll('table')];
 const weekly=tables.find(table=>{
   const value=text(table).slice(0,5000);
   const days=['mon','tue','wed','thu','fri','sat','sun'].filter(day=>new RegExp(`\\b${day}`, 'i').test(value)).length;
   return days>=5&&/(person|employee|worker|published|draft)/i.test(value);
 });
 if(!weekly)return null;
 return weekly.closest('[data-grid],[data-table-scroll],.scroll,.table-scroll,.grid-scroll')||weekly.parentElement||weekly;
}
function findPublish(content){
 const candidates=[...content.querySelectorAll('button,[role="button"]')];
 return candidates.find(node=>{
   const label=text(node);
   if(!label||/\bexport\b|\bpublished\b|\bhistory\b|\breceipt\b|\bdetails\b/i.test(label))return false;
   return /^(publish\b|release\s+(schedule|rota)\b|post\s+schedule\b)/i.test(label);
 })||null;
}
function button(label,kind){
 const b=document.createElement('button');
 b.type='button';
 b.className='ux-plan-jump';
 b.dataset.target=kind;
 b.textContent=label;
 return b;
}
function revealGrid(content,grid,toggle){
 grid.hidden=false;
 toggle?.setAttribute('aria-expanded','true');
 if(toggle)toggle.textContent='Hide full planner';
 content.dataset.uxPlannerGrid='open';
}
function hideGrid(content,grid,toggle){
 grid.hidden=true;
 toggle?.setAttribute('aria-expanded','false');
 if(toggle)toggle.textContent='Open full planner';
 content.dataset.uxPlannerGrid='closed';
}
function focusTarget(node,block='center'){
 if(!node)return;
 try{node.focus({preventScroll:true});}catch{try{node.focus();}catch{}}
 node.scrollIntoView({block,behavior:'smooth'});
}
function enhancePlanner(){
 if(!manager()||route()!=='schedule-publication')return;
 const content=document.querySelector('.content');
 if(!content||content.dataset.uxPlannerFocus==='active'||content.dataset.uxPlannerFocus==='calm')return;
 const heading=content.querySelector(':scope > .heading')||content.querySelector('.heading');
 const issue=findIssuePanel(content),grid=findGrid(content),publish=findPublish(content);
 if(!heading||(!issue&&!grid&&!publish))return;
 if(grid){
   grid.classList.add('ux-plan-grid');
   if(!grid.hasAttribute('tabindex'))grid.setAttribute('tabindex','0');
   if(!grid.id)grid.id='ux-plan-grid-detail';
 }
 if(publish){publish.classList.add('ux-plan-publish');publish.setAttribute('data-ux-preserved-publish','true');}
 if(!issue){
   content.dataset.uxPlannerFocus='calm';
   return;
 }
 content.dataset.uxPlannerFocus='active';
 issue.classList.add('ux-plan-priority');
 issue.setAttribute('tabindex','-1');
 const shell=document.createElement('section');
 shell.className='ux-plan-focus';
 shell.setAttribute('aria-label','Schedule publication focus');
 shell.innerHTML='<div class="ux-plan-focus-copy"><span class="ux-plan-eyebrow">Schedule focus</span><h2>Resolve risk before you publish</h2><p>Start with coverage and skills gaps. Open the full planner only when you need to move people or inspect the grid.</p></div><div class="ux-plan-steps" aria-label="Recommended sequence"><span><b>1</b> Resolve gaps</span><span><b>2</b> Review impact</span><span><b>3</b> Publish</span></div><div class="ux-plan-jumps"></div>';
 const specialist=content.querySelector(':scope > .ux-specialist-context');
 (specialist||heading).insertAdjacentElement('afterend',shell);
 const jumps=shell.querySelector('.ux-plan-jumps');
 jumps.appendChild(button('Coverage & risks','issues'));
 let gridToggle=null;
 if(grid){
   gridToggle=button('Open full planner','grid');
   gridToggle.classList.add('ux-plan-grid-toggle');
   gridToggle.setAttribute('aria-expanded','false');
   gridToggle.setAttribute('aria-controls',grid.id);
   jumps.appendChild(gridToggle);
   hideGrid(content,grid,gridToggle);
 }
 if(publish)jumps.appendChild(button('Go to publish','publish'));
 jumps.addEventListener('click',event=>{
   const control=event.target.closest('.ux-plan-jump');if(!control)return;
   if(control.dataset.target==='issues')focusTarget(issue,'start');
   if(control.dataset.target==='grid'&&grid){
     if(grid.hidden){revealGrid(content,grid,gridToggle);focusTarget(grid,'start');}else hideGrid(content,grid,gridToggle);
   }
   if(control.dataset.target==='publish'&&publish)focusTarget(publish,'center');
 });
}
function apply(){try{enhancePlanner();}catch(e){console.warn('WFM UX cycle 10 skipped:',e);}}
const previousRender=window.render;
if(typeof previousRender==='function')window.render=async function(...args){const result=await previousRender.apply(this,args);apply();return result;};
const observer=new MutationObserver(()=>apply());
observer.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);setTimeout(apply,250);setTimeout(apply,700);
window.WFMUXCycle10={apply};
})();
