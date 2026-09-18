/* WFM UX evolution cycle 7: make manager Time Review an exception-first decision flow. */
(function(){
'use strict';
const page=()=>{try{return typeof ui!=='undefined'?ui.page:null;}catch{return null;}};
const manager=()=>{try{if(typeof isEmployee==='function'&&isEmployee())return false;const role=(typeof F!=='undefined'&&F.actor?.role)||(typeof ui!=='undefined'&&ui.role);return ['manager','director','supervisor'].includes(role);}catch{return false;}};
function makeScopeFold(){
 const details=document.createElement('details');
 details.className='ux-tr-scope';
 details.innerHTML='<summary><span><b>Scope, filters &amp; review settings</b><small>Change week, day, team, queue, search or tolerances only when you need to.</small></span><span class="ux-tr-open">Open</span></summary><div class="ux-tr-scope-body"></div>';
 return details;
}
function focusDecisionPanel(){
 if(!manager()||page()!=='time-review')return false;
 const panel=document.querySelector('.tr-panel');
 if(!panel)return false;
 const target=panel.querySelector('h2,h3,[data-ux-decision-heading]')||panel;
 if(!target.matches?.('button,a[href],input,select,textarea,[tabindex]'))target.setAttribute('tabindex','-1');
 try{target.scrollIntoView({block:'start',behavior:'smooth'});}catch{try{target.scrollIntoView();}catch{}}
 try{target.focus({preventScroll:true});}catch{try{target.focus();}catch{}}
 return document.activeElement===target;
}
function continueFromEmployeeSelection(){
 setTimeout(()=>{try{focusDecisionPanel();}catch{}},80);
}
function enhanceTimeReview(){
 if(!manager()||page()!=='time-review')return;
 const workspace=document.querySelector('.tr-workspace');
 const toolbar=document.querySelector('.tr-toolbar');
 const layout=document.querySelector('.tr-layout');
 if(!workspace||!toolbar||!layout)return;
 if(workspace.dataset.uxTimeReview==='calm')return;
 const host=toolbar.parentElement;
 if(!host)return;
 workspace.dataset.uxTimeReview='calm';
 host.dataset.uxTimeReview='calm';

 const feedSource=toolbar.nextElementSibling?.matches('.tr-source')?toolbar.nextElementSibling:null;
 const kpis=host.querySelector(':scope > .tr-kpis')||host.querySelector('.tr-kpis');
 const progress=host.querySelector(':scope > .tr-progress')||host.querySelector('.tr-progress');
 const weeklyStatus=progress?.nextElementSibling?.matches('p.tr-source')?progress.nextElementSibling:null;
 const settings=[...host.querySelectorAll(':scope > .tr-config')];

 const command=document.createElement('section');
 command.className='ux-tr-command';
 command.setAttribute('aria-label','Time review decision flow');
 command.innerHTML='<div class="ux-tr-command-head"><div><span class="eyebrow">MANAGER ACTION</span><h2>Work the exceptions, not the timesheet.</h2><p>The default queue already starts with records that need you. Select an employee, understand the exception, then make the controlled decision.</p></div><div class="ux-tr-steps" aria-label="Review flow"><span><b>1</b>Employee</span><i>›</i><span><b>2</b>Exception</span><i>›</i><span><b>3</b>Evidence</span><i>›</i><span><b>4</b>Decision</span></div></div>';
 host.insertBefore(command,toolbar);
 if(kpis)command.appendChild(kpis);
 if(progress)command.appendChild(progress);
 if(weeklyStatus)command.appendChild(weeklyStatus);

 const scope=makeScopeFold();
 const scopeBody=scope.querySelector('.ux-tr-scope-body');
 scopeBody.appendChild(toolbar);
 if(feedSource)scopeBody.appendChild(feedSource);
 settings.forEach(node=>scopeBody.appendChild(node));
 command.insertAdjacentElement('afterend',scope);
 scope.insertAdjacentElement('afterend',layout);

 const list=layout.querySelector('.tr-list');
 const panel=layout.querySelector('.tr-panel');
 if(list){list.dataset.uxStep='Needs my action';list.setAttribute('aria-label','Needs my action · team clocking issues');}
 if(panel){panel.dataset.uxStep='Decision';panel.setAttribute('aria-label','Selected employee exception and decision');}
 const tablewrap=list?.querySelector('.tablewrap');
 if(tablewrap)tablewrap.setAttribute('tabindex','0');
 document.querySelector('.heading')?.classList.add('ux-tr-heading');
}
function apply(){try{enhanceTimeReview();}catch(e){console.warn('WFM UX cycle 7 skipped:',e);}}
document.addEventListener('click',e=>{if(e.target.closest('.tr-person'))continueFromEmployeeSelection();},true);
const observer=new MutationObserver(()=>apply());
observer.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);setTimeout(apply,250);setTimeout(apply,700);
window.WFMUXCycle7={apply,focusDecisionPanel};
})();
