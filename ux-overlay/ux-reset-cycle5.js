/* WFM UX evolution cycle 5: employee self-service that is calm by default and complete on demand. */
(function(){
'use strict';
const employee=()=>{try{return isEmployee();}catch{return false;}};
const text=el=>String(el?.textContent||'').trim();
const safe=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function detail(title,caption,nodes,cls=''){
 const d=document.createElement('details');d.className=`ux-employee-detail ${cls}`.trim();
 const s=document.createElement('summary');s.innerHTML=`<span><b>${safe(title)}</b><small>${safe(caption)}</small></span><span class="ux-detail-state">Open</span>`;
 const body=document.createElement('div');body.className='ux-employee-detail-body';nodes.filter(Boolean).forEach(n=>body.appendChild(n));d.append(s,body);return d;
}
function promotePersonal(){
 if(!employee())return;
 const nav=document.querySelector('.sidebar nav');if(!nav)return;
 const b=[...nav.querySelectorAll('.navbtn[data-page="personal"]')].find(x=>!x.closest('#ux-tool-backdrop'));if(!b)return;
 b.classList.remove('ux-secondary-route');b.classList.add('ux-primary-route','ux-personal-primary');
 const label=b.querySelector('span');if(label)label.textContent='My details';b.setAttribute('aria-label','My details');b.title='My details';
 const more=nav.querySelector('[data-ux="more"]');nav.insertBefore(b,more||null);
 document.querySelectorAll('#ux-tool-backdrop .navbtn[data-page="personal"]').forEach(x=>x.remove());
}
function requestAction(balance){
 if(!balance||balance.querySelector('[data-act="newleave"]'))return;
 const head=balance.querySelector('.ux-employee-balance-head');if(!head)return;
 const b=document.createElement('button');b.type='button';b.className='btn small primary';b.dataset.act='newleave';b.textContent='Request time off';head.appendChild(b);
}
function simplifyHome(){
 const content=document.querySelector('.content');if(!content||content.dataset.uxEmployeeHome==='calm')return;
 const heading=content.querySelector('.heading'),balance=content.querySelector('.ux-employee-balance');
 if(heading&&balance)heading.after(balance);requestAction(balance);
 const direct=[...content.children];
 const holidayGrid=direct.find(x=>x.classList?.contains('ops-grid'));
 const panels=direct.filter(x=>x.classList?.contains('ops-panel'));
 const attendance=panels.find(x=>/^Attendance and corrections$/i.test(text(x.querySelector('h2'))));
 const updates=panels.find(x=>/^Your saved updates$/i.test(text(x.querySelector('h2'))));
 let anchor=panels.find(x=>x!==attendance&&x!==updates)||balance||heading;
 if(holidayGrid){const d=detail('Holiday breakdown','Used, booked and pending hours',[holidayGrid],'holiday');anchor?.after(d);anchor=d;}
 if(attendance){const d=detail('Attendance & corrections','Clock status, absence reporting and corrections',[attendance],'attendance');anchor?.after(d);anchor=d;}
 if(updates){const d=detail('Requests & updates','Saved requests and assignment notices',[updates],'updates');anchor?.after(d);anchor=d;}
 // Legacy home fallback: keep the shift hero, fold the week and lower panels instead of stacking them.
 const week=[...content.querySelectorAll(':scope > .panel.all-spacer')].find(x=>/week at a glance/i.test(text(x)));
 if(week&&!week.closest('.ux-employee-detail')){const d=detail('This week','Your published week at a glance',[week],'week');(balance||heading)?.after(d);}
 const oldGrid=content.querySelector(':scope > .grid2.grid-equal.all-spacer');
 if(oldGrid&&!oldGrid.closest('.ux-employee-detail')){const d=detail('Attendance & requests','Today’s attendance and your saved requests',[oldGrid],'legacy');(content.querySelector('.ux-employee-detail.week')||balance||heading)?.after(d);}
 content.dataset.uxEmployeeHome='calm';
}
function simplifyLeave(){
 const content=document.querySelector('.content');if(!content||content.dataset.uxEmployeeLeave==='calm')return;
 const heading=content.querySelector('.heading'),balance=content.querySelector('.ux-employee-balance');requestAction(balance);
 if(heading&&balance&&heading.nextElementSibling!==balance)heading.after(balance);
 const direct=[...content.children],metrics=direct.find(x=>x.classList?.contains('ops-grid'));
 const callout=direct.find(x=>x.classList?.contains('ops-callout'));
 const panels=direct.filter(x=>x.classList?.contains('ops-panel'));
 const ledger=panels.find(x=>/^Your balance$/i.test(text(x.querySelector('h2'))));
 const requests=panels.find(x=>x!==ledger);
 const foot=direct.find(x=>x.classList?.contains('ops-footnote'));
 if(requests){requests.classList.add('ux-employee-requests');requests.querySelectorAll(':scope > [data-act="newleave"]').forEach(x=>x.classList.add('ux-duplicate-request-action'));}
 const nodes=[metrics,callout,ledger,foot].filter(Boolean);
 if(nodes.length){const d=detail('Balance breakdown','Used, booked and pending hours with source detail',nodes,'leave-breakdown');(requests||balance||heading)?.after(d);}
 content.dataset.uxEmployeeLeave='calm';
}
function simplifyPersonal(){
 const content=document.querySelector('.content');if(!content||content.dataset.uxEmployeePersonal==='calm')return;
 const hero=content.querySelector('.personal-hero'),columns=content.querySelector('.personal-columns');if(!hero||!columns)return;
 const panels=[...columns.querySelectorAll('.personal-panel')],profile=panels.find(x=>/^My details$/i.test(text(x.querySelector('h2'))));
 if(profile){profile.classList.add('ux-personal-profile-primary');hero.after(profile);}
 const grids=[...content.querySelectorAll(':scope > .personal-grid')];
 let anchor=profile||hero;
 if(grids.length){const d=detail('Hours & holiday summary','Reviewed hours and holiday totals',grids,'personal-summary');anchor.after(d);anchor=d;}
 const left=columns.children[0],right=columns.children[1];
 const leftNodes=left?[...left.children].filter(x=>x!==profile):[];
 const rightNodes=right?[...right.children].filter(x=>x!==profile):[];
 if(leftNodes.length){const d=detail('Clock, time & offers','Clock controls, recent records and optional shift offers',leftNodes,'personal-work');anchor.after(d);anchor=d;}
 if(rightNodes.length){const d=detail('Holiday & upcoming shifts','Holiday requests and future published assignments',rightNodes,'personal-plans');anchor.after(d);anchor=d;}
 columns.remove();
 content.dataset.uxEmployeePersonal='calm';
}
function simplifyShifts(){
 const content=document.querySelector('.content');if(!content||content.dataset.uxEmployeeShifts==='calm')return;
 const table=content.querySelector('.ops-table');if(!table)return;
 const rows=[...table.querySelectorAll('tbody tr')];if(!rows.length)return;
 const list=document.createElement('div');list.className='ux-employee-shift-list';
 rows.forEach(row=>{const c=[...row.children].map(x=>text(x));const card=document.createElement('article');card.className='ux-employee-shift-card';card.innerHTML=`<div><small>SHIFT</small><strong>${safe(c[2]||'Start')} → ${safe(c[3]||'Finish')}</strong><span>${safe(c[1]||'')}</span></div><div class="ux-shift-meta"><span><small>Breaks</small>${safe(c[4]||'—')}</span><span><small>Revision</small>${safe(c[5]||'—')}</span></div>`;list.appendChild(card);});
 const scroll=table.closest('.ops-scroll')||table;const panel=scroll.closest('.ops-panel');panel?.insertBefore(list,scroll);
 const d=detail('Full shift detail','Original assignment table and source fields',[scroll],'shift-evidence');list.after(d);
 content.dataset.uxEmployeeShifts='calm';
}
function apply(){
 if(!employee())return;
 promotePersonal();
 try{if(ui?.page==='overview')simplifyHome();else if(ui?.page==='leave')simplifyLeave();else if(ui?.page==='personal')simplifyPersonal();else if(ui?.page==='shifts')simplifyShifts();}catch(e){console.warn('WFM UX cycle 5 skipped:',e);}
}
const previousRender=window.render;if(typeof previousRender==='function')window.render=async function(...args){const result=await previousRender.apply(this,args);apply();return result;};
const observer=new MutationObserver(()=>{try{if(employee())apply();}catch{}});observer.observe(document.documentElement,{subtree:true,childList:true});
setTimeout(apply,0);setTimeout(apply,450);
window.WFMUXCycle5={apply};
})();
