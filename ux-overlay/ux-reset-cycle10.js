/* WFM UX evolution cycle 10: exception-first schedule publication. */
(function(){
'use strict';
const route=()=>{try{return typeof ui!=='undefined'?ui.page:null;}catch{return null;}};
const employee=()=>{try{return typeof isEmployee==='function'&&isEmployee();}catch{return false;}};
const manager=()=>{try{const role=(typeof F!=='undefined'&&F.actor?.role)||(typeof ui!=='undefined'&&ui.role);return !employee()&&['manager','director','supervisor'].includes(role);}catch{return false;}};
const text=node=>(node?.textContent||'').replace(/\s+/g,' ').trim();
const emptyIssue=node=>/\b(no|none|zero)\b.{0,80}\b(draft|gap|risk|conflict|exception|shortage|issue|shift)s?\b|\b0\b.{0,24}\b(draft|gap|risk|conflict|exception|shortage|issue)s?\b/i.test(text(node));
function closestPanel(node,content){
 let current=node;
 while(current&&current!==content){
   if(current.matches?.('.panel,.card,.ops-panel,section,article')||current.parentElement===content)return current;
   current=current.parentElement;
 }
 return null;
}
function findIssuePanel(content){
 const headingPattern=/^(drafts? awaiting action|needs? action|coverage(?: & skills)? risks?|coverage gaps?|skills? gaps?|unfilled shifts?|schedule conflicts?|exceptions?|production risks?)\b/i;
 const headings=[...content.querySelectorAll('h2,h3,h4,[role="heading"]')];
 for(const heading of headings){
   if(!headingPattern.test(text(heading)))continue;
   const panel=closestPanel(heading,content);
   if(panel&&!panel.querySelector('table')&&!emptyIssue(panel))return panel;
 }
 return null;
}
function findGrid(content){
 const tables=[...content.querySelectorAll('table')];
 for(const table of tables){
   const tableText=text(table);
   if(!/(\bmon\b|\btue\b|\bwed\b|\bthu\b|\bfri\b|\bsat\b|\bsun\b)/i.test(tableText))continue;
   let current=table.parentElement;
   let fallback=current;
   while(current&&current!==content){
     fallback=current;
     if(/weekly view|published work|private drafts|mon\s+\d{1,2}|week/i.test(text(current))&&current.querySelector('table')===table)return current;
     current=current.parentElement;
   }
   if(fallback&&fallback!==content)return fallback;
 }
 return content.querySelector('.tablewrap,.ops-scroll,.dp-table-scroll,.pci-table-wrap');
}
function findPublish(content){
 const explicit=content.querySelector('[data-act="publish"],[data-action="publish"],[data-act="publish-schedule"],[data-action="publish-schedule"]');
 if(explicit)return explicit;
 const candidates=[...content.querySelectorAll('button,[role="button"]')];
 return candidates.find(node=>/^(publish(?: schedule)?|release(?: schedule)?|post schedule)\b/i.test(text(node)))||null;
}
function button(label,kind){
 const b=document.createElement('button');b.type='button';b.className='ux-plan-jump';b.dataset.target=kind;b.textContent=label;return b;
}
function revealGrid(content,grid,toggle){
 grid.hidden=false;toggle?.setAttribute('aria-expanded','true');if(toggle)toggle.textContent='Hide full planner';content.dataset.uxPlannerGrid='open';
}
function hideGrid(content,grid,toggle){
 grid.hidden=true;toggle?.setAttribute('aria-expanded','false');if(toggle)toggle.textContent='Open full planner';content.dataset.uxPlannerGrid='closed';
}
function focusTarget(node,block='center'){
 if(!node)return;try{node.focus({preventScroll:true});}catch{try{node.focus();}catch{}}node.scrollIntoView({block,behavior:'smooth'});
}
function enhancePlanner(){
 if(!manager()||route()!=='schedule-publication')return;
 const content=document.querySelector('.content');
 if(!content||content.dataset.uxPlannerFocus==='active')return;
 const heading=content.querySelector(':scope > .heading')||content.querySelector('.heading');
 const issue=findIssuePanel(content),grid=findGrid(content),publish=findPublish(content);
 if(!heading||(!issue&&!grid&&!publish))return;
 content.dataset.uxPlannerFocus='active';
 const shell=document.createElement('section');shell.className='ux-plan-focus';shell.setAttribute('aria-label','Schedule publication focus');
 const publishedState=!publish&&!issue;
 shell.innerHTML=publishedState
   ? '<div class="ux-plan-focus-copy"><span class="ux-plan-eyebrow">Schedule focus</span><h2>Week published — detail on demand</h2><p>No schedule action is currently surfaced. Keep the full week available when you need to inspect published work or evidence.</p></div><div class="ux-plan-steps" aria-label="Published week sequence"><span><b>1</b> Published</span><span><b>2</b> Inspect if needed</span><span><b>3</b> Evidence retained</span></div><div class="ux-plan-jumps"></div>'
   : '<div class="ux-plan-focus-copy"><span class="ux-plan-eyebrow">Schedule focus</span><h2>Resolve risk before you publish</h2><p>Start with drafts, coverage and skills risks. Open the full week only when you need planning detail.</p></div><div class="ux-plan-steps" aria-label="Recommended sequence"><span><b>1</b> Resolve gaps</span><span><b>2</b> Review impact</span><span><b>3</b> Publish</span></div><div class="ux-plan-jumps"></div>';
 const specialist=content.querySelector(':scope > .ux-specialist-context');(specialist||heading).insertAdjacentElement('afterend',shell);
 const jumps=shell.querySelector('.ux-plan-jumps');let gridToggle=null;
 if(issue){issue.classList.add('ux-plan-priority');issue.setAttribute('tabindex','-1');jumps.appendChild(button(/draft/i.test(text(issue))?'Drafts & risks':'Coverage & risks','issues'));}
 if(grid){
   grid.classList.add('ux-plan-grid');if(!grid.hasAttribute('tabindex'))grid.setAttribute('tabindex','0');if(!grid.id)grid.id='ux-plan-grid-detail';
   gridToggle=button('Open full planner','grid');gridToggle.classList.add('ux-plan-grid-toggle');gridToggle.setAttribute('aria-expanded','false');gridToggle.setAttribute('aria-controls',grid.id);jumps.appendChild(gridToggle);
   if(issue)hideGrid(content,grid,gridToggle);else revealGrid(content,grid,gridToggle);
 }
 if(publish){publish.classList.add('ux-plan-publish');publish.setAttribute('data-ux-preserved-publish','true');jumps.appendChild(button('Go to publish','publish'));}
 jumps.addEventListener('click',event=>{
   const control=event.target.closest('.ux-plan-jump');if(!control)return;
   if(control.dataset.target==='issues'&&issue)focusTarget(issue,'start');
   if(control.dataset.target==='grid'&&grid){if(grid.hidden){revealGrid(content,grid,gridToggle);grid.scrollIntoView({block:'start',behavior:'smooth'});}else hideGrid(content,grid,gridToggle);}
   if(control.dataset.target==='publish'&&publish)focusTarget(publish,'center');
 });
}
function apply(){try{enhancePlanner();}catch(e){console.warn('WFM UX cycle 10 skipped:',e);}}
const previousRender=window.render;
if(typeof previousRender==='function')window.render=async function(...args){const result=await previousRender.apply(this,args);apply();return result;};
const observer=new MutationObserver(()=>apply());observer.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);setTimeout(apply,250);setTimeout(apply,700);
window.WFMUXCycle10={apply};
})();
