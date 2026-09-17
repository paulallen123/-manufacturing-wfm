/* WFM UX evolution cycle 6: make the manager Today page a calm decision surface, not a dashboard wall. */
(function(){
'use strict';
const manager=()=>{try{return !isEmployee()&&['manager','director','supervisor'].includes((typeof F!=='undefined'&&F.actor?.role)||ui?.role);}catch{return false;}};
const safe=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function fold(title,caption,node,cls=''){
 if(!node||node.closest('.ux-today-detail')||node.closest('.ux-detail-fold'))return null;
 const d=document.createElement('details');d.className=`ux-today-detail ${cls}`.trim();
 const s=document.createElement('summary');s.innerHTML=`<span><b>${safe(title)}</b><small>${safe(caption)}</small></span><span class="ux-detail-state">Open</span>`;
 const body=document.createElement('div');body.className='ux-today-detail-body';
 node.parentNode.insertBefore(d,node);d.append(s,body);body.appendChild(node);return d;
}
function retitleExistingFold(selector,title,caption,cls){
 const node=document.querySelector(selector);const d=node?.closest('.ux-detail-fold');if(!d)return null;
 d.classList.add('ux-today-detail',cls||'');const s=d.querySelector(':scope > summary');
 if(s&&!s.dataset.uxTodayLabel){s.dataset.uxTodayLabel='1';s.innerHTML=`<span><b>${safe(title)}</b><small>${safe(caption)}</small></span><span class="ux-detail-state">Open</span>`;}
 return d;
}
function simplifyToday(){
 if(!manager()||ui?.page!=='overview')return;
 const content=document.querySelector('.content');if(!content||content.dataset.uxToday==='calm')return;
 const hero=content.querySelector('.fcc-hero');
 const main=content.querySelector('.fcc-main');
 const pulse=content.querySelector('.fcc-pulse-grid');
 const departments=content.querySelector('.fcc-dept-grid');
 const map=content.querySelector('.fcc-map');
 const week=content.querySelector('.fcc-week');
 if(!hero&&!main)return;
 document.body.dataset.uxRole='manager';document.body.dataset.uxJob='today';
 hero?.classList.add('ux-today-hero');
 main?.classList.add('ux-today-actions');
 pulse?.classList.add('ux-today-pulse');
 // Put the manager's actionable queue directly after the compact day summary.
 if(hero&&main&&hero.nextElementSibling!==main)hero.insertAdjacentElement('afterend',main);
 // Keep the headline pulse visible, but after the action queue and in a much denser format.
 if(main&&pulse&&main.nextElementSibling!==pulse)main.insertAdjacentElement('afterend',pulse);
 // Area-by-area detail is useful depth, not the default decision surface.
 if(departments)fold('Capacity by area','Open only when you need the department/work-centre breakdown.',departments,'capacity');
 retitleExistingFold('.fcc-map','Readiness map','Explore work-centre readiness and operational detail when a decision needs it.','readiness');
 retitleExistingFold('.fcc-week','Decision flow','Reference the end-to-end control flow without keeping it permanently on screen.','flow');
 // If the base overlay has not folded these yet, do it here rather than leaving long sections exposed.
 if(map&&!map.closest('.ux-today-detail'))fold('Readiness map','Explore work-centre readiness and operational detail when a decision needs it.',map,'readiness');
 if(week&&!week.closest('.ux-today-detail'))fold('Decision flow','Reference the end-to-end control flow without keeping it permanently on screen.',week,'flow');
 // Empty layout shells create unnecessary vertical space after their decision lane is promoted.
 content.querySelectorAll('.fcc-layout').forEach(layout=>{layout.classList.add('ux-today-layout');if(!layout.textContent.trim()&&!layout.children.length)layout.hidden=true;});
 content.dataset.uxToday='calm';
}
function clearIntent(){
 if(ui?.page==='overview'&&manager())return;
 const content=document.querySelector('.content');if(content?.dataset.uxToday)delete content.dataset.uxToday;
}
function apply(){try{clearIntent();simplifyToday();}catch(e){console.warn('WFM UX cycle 6 skipped:',e);}}
const previousRender=window.render;if(typeof previousRender==='function')window.render=async function(...args){const result=await previousRender.apply(this,args);apply();return result;};
const observer=new MutationObserver(()=>{try{if(manager()&&ui?.page==='overview'&&!document.querySelector('.content[data-ux-today="calm"]'))apply();}catch{}});observer.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);setTimeout(apply,450);
window.WFMUXCycle6={apply};
})();
