/* WFM UX evolution cycle 8: make employee My time a simple correction journey. */
(function(){
'use strict';
const page=()=>{try{return typeof ui!=='undefined'?ui.page:null;}catch{return null;}};
const employee=()=>{try{return typeof isEmployee==='function'&&isEmployee();}catch{return false;}};
function makeFilterFold(){
 const details=document.createElement('details');
 details.className='ux-mytime-scope';
 details.innerHTML='<summary><span><b>Week &amp; filters</b><small>Change the period or narrow the list only when you need to.</small></span><span class="ux-mytime-open">Open</span></summary><div class="ux-mytime-scope-body"></div>';
 return details;
}
function enhanceMyTime(){
 if(!employee()||page()!=='time-review')return;
 const workspace=document.querySelector('.tr-workspace');
 const toolbar=document.querySelector('.tr-toolbar');
 const layout=document.querySelector('.tr-layout');
 if(!workspace||!toolbar||!layout)return;
 if(workspace.dataset.uxEmployeeTime==='calm')return;
 const host=toolbar.parentElement;
 if(!host)return;
 workspace.dataset.uxEmployeeTime='calm';
 host.dataset.uxEmployeeTime='calm';

 const feedSource=toolbar.nextElementSibling?.matches('.tr-source')?toolbar.nextElementSibling:null;
 const kpis=host.querySelector(':scope > .tr-kpis')||host.querySelector('.tr-kpis');
 const progress=host.querySelector(':scope > .tr-progress')||host.querySelector('.tr-progress');
 const weeklyStatus=progress?.nextElementSibling?.matches('p.tr-source')?progress.nextElementSibling:null;
 const settings=[...host.querySelectorAll(':scope > .tr-config')];

 const command=document.createElement('section');
 command.className='ux-mytime-command';
 command.setAttribute('aria-label','My time review');
 command.innerHTML='<div class="ux-mytime-command-head"><div><span class="eyebrow">MY TIME</span><h2>Is my time correct?</h2><p>Start with anything that needs your attention. Open the detail, check the evidence, then submit a correction only when something is wrong.</p></div><div class="ux-mytime-flow" aria-label="My time correction flow"><span><b>1</b>Check</span><i>›</i><span><b>2</b>Review</span><i>›</i><span><b>3</b>Correct if needed</span></div></div>';
 host.insertBefore(command,toolbar);
 if(kpis)command.appendChild(kpis);
 if(progress)command.appendChild(progress);
 if(weeklyStatus)command.appendChild(weeklyStatus);

 const scope=makeFilterFold();
 const scopeBody=scope.querySelector('.ux-mytime-scope-body');
 scopeBody.appendChild(toolbar);
 if(feedSource)scopeBody.appendChild(feedSource);
 settings.forEach(node=>scopeBody.appendChild(node));
 command.insertAdjacentElement('afterend',scope);
 scope.insertAdjacentElement('afterend',layout);

 const list=layout.querySelector('.tr-list');
 const panel=layout.querySelector('.tr-panel');
 if(list){list.dataset.uxEmployeeStep='What needs checking';list.setAttribute('aria-label','My time records that need checking');}
 if(panel){panel.dataset.uxEmployeeStep='Review and correct';panel.setAttribute('aria-label','Selected time record, evidence and correction');}
 const tablewrap=list?.querySelector('.tablewrap');
 if(tablewrap)tablewrap.setAttribute('tabindex','0');
 document.querySelector('.heading')?.classList.add('ux-mytime-heading');
}
function apply(){try{enhanceMyTime();}catch(e){console.warn('WFM UX cycle 8 skipped:',e);}}
const observer=new MutationObserver(()=>apply());
observer.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);setTimeout(apply,250);setTimeout(apply,700);
window.WFMUXCycle8={apply};
})();
