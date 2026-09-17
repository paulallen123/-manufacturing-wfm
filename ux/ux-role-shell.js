/* WFM role-based simplification layer.
 * Loaded after the sealed application so it can simplify presentation without
 * removing the underlying workflows or rewriting domain logic.
 */
'use strict';

(() => {
  const state = { enhancing:false, observed:false };
  const activeRole = () => (typeof ui !== 'undefined' ? ui.role : 'manager');
  const employeeRole = () => ['employee','coveremployee'].includes(activeRole());
  const q = (s,root=document) => root.querySelector(s);
  const qa = (s,root=document) => Array.from(root.querySelectorAll(s));
  const safe = value => typeof esc === 'function' ? esc(String(value ?? '')) : String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hours = value => `${Number(value||0).toFixed(Number(value||0)%1?1:0)} h`;

  function allowanceFor(personRecord){
    const candidates=[personRecord?.leaveAllowanceHours,personRecord?.annualLeaveHours,personRecord?.entitlementHours,personRecord?.leaveAllowance];
    const found=candidates.find(Number.isFinite);
    return Number.isFinite(found)?Number(found):90;
  }

  function requestsFor(employeeId){
    if(typeof data==='undefined'||!Array.isArray(data.requests))return [];
    return data.requests.filter(r=>r.employee===employeeId);
  }

  function approvedHours(employeeId){
    return requestsFor(employeeId).filter(r=>r.status==='approved').reduce((n,r)=>n+Number(r.hours||0),0);
  }

  function pendingHours(employeeId){
    return requestsFor(employeeId).filter(r=>r.status==='pending').reduce((n,r)=>n+Number(r.hours||0),0);
  }

  function personFor(id){
    try{return typeof person==='function'?person(id):null;}catch{return null;}
  }

  function scopePeople(){
    try{return typeof people==='function'?people():[];}catch{return [];}
  }

  function leaveContext(request){
    const p=personFor(request.employee);
    const team=p?.team||'Team';
    const allowance=allowanceFor(p);
    const approved=approvedHours(request.employee);
    const alreadyApproved=request.status==='approved';
    const remainingBefore=Math.max(0,allowance-approved);
    const after=Math.max(0,alreadyApproved?remainingBefore:remainingBefore-Number(request.hours||0));
    const peers=scopePeople().filter(x=>x.id!==request.employee&&x.team===team);
    const sameDate=(typeof data!=='undefined'&&Array.isArray(data.requests)?data.requests:[]).filter(x=>x.id!==request.id&&x.date===request.date&&['approved','pending'].includes(x.status)).filter(x=>personFor(x.employee)?.team===team);
    const approvedOthers=sameDate.filter(x=>x.status==='approved');
    const pendingOthers=sameDate.filter(x=>x.status==='pending');
    const teamSize=peers.length+1;
    const approvedOffAfter=approvedOthers.length+(alreadyApproved?0:1);
    const availableAfter=Math.max(0,teamSize-approvedOffAfter);
    return {p,team,allowance,approved,remainingBefore,after,sameDate,approvedOthers,pendingOthers,teamSize,availableAfter};
  }

  function navButton(label,page,iconName){
    const iconHtml=typeof icon==='function'?icon(iconName||'dashboard'):'';
    const isActive=typeof ui!=='undefined'&&ui.page===page;
    return `<button type="button" class="navbtn wfm-primary-link ${isActive?'active':''}" data-act="nav" data-page="${safe(page)}" aria-label="${safe(label)}">${iconHtml}<span>${safe(label)}</span></button>`;
  }

  function availablePage(candidates){
    const buttons=qa('.sidebar .navbtn[data-page]');
    for(const c of candidates){if(buttons.some(b=>b.dataset.page===c))return c;}
    return candidates[0];
  }

  function simplifyNavigation(){
    const nav=q('.sidebar nav');
    if(!nav||nav.classList.contains('wfm-job-nav'))return;
    const originals=qa(':scope > .navbtn',nav);
    if(!originals.length)return;
    const toolList=document.createElement('div');
    toolList.className='wfm-tool-list';
    originals.forEach(b=>toolList.appendChild(b));
    const drawer=document.createElement('details');
    drawer.className='wfm-tool-drawer';
    const summary=document.createElement('summary');
    summary.textContent='All tools';
    drawer.append(summary,toolList);
    nav.classList.add('wfm-job-nav');

    if(employeeRole()){
      nav.insertAdjacentHTML('afterbegin',navButton('My day','overview','dashboard')+navButton('Time off','leave','health')+navButton('My shifts','shifts','calendar'));
    }else{
      const insight=availablePage(['costs','value-cockpit','insights','forecast']);
      nav.insertAdjacentHTML('afterbegin',navButton('Action centre','overview','dashboard')+navButton('Time off','leave','health')+navButton('Cost & efficiency',insight,'pound'));
    }
    nav.appendChild(drawer);
  }

  function baseButton(label,page,primary=false){
    return `<button type="button" class="btn ${primary?'primary':''}" data-act="nav" data-page="${safe(page)}">${safe(label)}</button>`;
  }

  function managerActionCentre(){
    if(employeeRole()||typeof ui==='undefined'||ui.page!=='overview')return;
    const content=q('.content');
    if(!content||q('.wfm-action-centre',content))return;
    const ps=scopePeople();
    if(!ps.length)return;
    const exceptions=ps.filter(p=>{
      try{const s=WFM.status(p);return ['missing','sync','sick'].includes(s)||WFM.lateness(p)>0;}catch{return false;}
    });
    const ids=new Set(ps.map(p=>p.id));
    const pending=(typeof data!=='undefined'&&Array.isArray(data.requests)?data.requests:[]).filter(r=>ids.has(r.employee)&&r.status==='pending');
    const reviewPage=availablePage(['weekly-review','time-review','review','payroll','attendance']);
    const detail=content.cloneNode(true);
    qa('.footer',detail).forEach(n=>n.remove());
    const filterHtml=typeof filters==='function'?filters():'';
    const title=(typeof me==='function'&&me()?.name)?safe(me().name.split(' ')[0]):'Manager';
    content.innerHTML=`
      <div class="wfm-simple-heading"><div><h1>${title}, start with the decisions.</h1><p>Absence, attendance and weekly review first. Everything else is still available when you need it.</p></div></div>
      ${filterHtml}
      <div class="wfm-action-centre" aria-label="Manager action centre">
        <section class="wfm-action-card" data-state="${exceptions.length?'attention':'clear'}">
          <span class="wfm-kicker">Attendance exceptions</span><strong>${exceptions.length}</strong><p>${exceptions.length?'Missing, late, sync or sickness records need checking before sign-off.':'No attendance exceptions in this scope.'}</p>${baseButton('Review attendance','attendance',exceptions.length>0)}
        </section>
        <section class="wfm-action-card" data-state="${pending.length?'attention':'clear'}">
          <span class="wfm-kicker">Time-off decisions</span><strong>${pending.length}</strong><p>${pending.length?'See balance after approval, team conflicts and staffing context before deciding.':'No time-off requests waiting for a decision.'}</p>${baseButton('Review time off','leave',pending.length>0)}
        </section>
        <section class="wfm-action-card">
          <span class="wfm-kicker">Weekly sign-off</span><strong>Review</strong><p>Open the existing time review workflow only when the exceptions above are understood.</p>${baseButton('Open weekly review',reviewPage,false)}
        </section>
      </div>
      <details class="wfm-progressive"><summary>Open live workforce detail</summary><div class="wfm-progressive-body">${detail.innerHTML}</div></details>
      ${q('.footer',content)?.outerHTML||''}`;
  }

  function conflictNames(items){
    if(!items.length)return 'Nobody else in this team has a recorded request for this date.';
    return items.slice(0,4).map(x=>`${safe(personFor(x.employee)?.name||x.employee)} (${safe(x.status)})`).join(' · ')+(items.length>4?` · +${items.length-4} more`:'');
  }

  function decisionCard(r){
    const c=leaveContext(r),p=c.p||{name:r.employee,team:c.team};
    const afterLabel=r.status==='approved'?'Current balance':'Balance if approved';
    const risk=c.approvedOthers.length>0||c.pendingOthers.length>0;
    const status=safe(r.status||'pending');
    const actions=r.status==='pending'?`<div class="wfm-decision-actions"><span class="wfm-spacer">Decision context shown above</span>${typeof button==='function'?button('Review details','request','small',`data-id="${safe(r.id)}"`):''}${typeof button==='function'?button('Approve','approve','small primary',`data-id="${safe(r.id)}"`):''}</div>`:'';
    return `<article class="wfm-decision-card" data-status="${status}">
      <div class="wfm-decision-head"><div class="person">${typeof avatar==='function'?avatar(p):''}<div><b>${safe(p.name)}</b><small>${safe(c.team)}</small></div></div><span class="wfm-decision-status">${status}</span></div>
      <div class="wfm-request-line"><b>${safe(r.kind||'Annual leave')}</b> · ${safe(r.date)} · ${hours(r.hours)} requested</div>
      <div class="wfm-decision-metrics">
        <div class="wfm-decision-metric"><small>Allowance</small><b>${hours(c.allowance)}</b></div>
        <div class="wfm-decision-metric"><small>Already approved</small><b>${hours(c.approved)}</b></div>
        <div class="wfm-decision-metric"><small>This request</small><b>${hours(r.hours)}</b></div>
        <div class="wfm-decision-metric" data-emphasis="true"><small>${afterLabel}</small><b>${hours(c.after)}</b></div>
      </div>
      <div class="wfm-context-grid">
        <div class="wfm-context" data-risk="${risk?'true':'false'}"><small>Who else is off / waiting</small><b>${c.sameDate.length?`${c.sameDate.length} other request${c.sameDate.length===1?'':'s'}`:'No team conflict recorded'}</b><p>${conflictNames(c.sameDate)}</p></div>
        <div class="wfm-context"><small>Staffing after approval</small><b>${c.availableAfter} of ${c.teamSize} people remain in this scoped team</b><p>Headcount context only. Skill coverage and overtime cost still require the existing cover workflow.</p></div>
      </div>
      ${actions}
    </article>`;
  }

  function managerLeave(){
    if(employeeRole()||typeof ui==='undefined'||ui.page!=='leave')return;
    const content=q('.content');
    if(!content||q('.wfm-leave-layout',content))return;
    const ps=scopePeople(),ids=new Set(ps.map(p=>p.id));
    const rs=(typeof data!=='undefined'&&Array.isArray(data.requests)?data.requests:[]).filter(r=>ids.has(r.employee));
    const headingNode=q('.heading',content),filtersNode=q('.filters',content),footerNode=q('.footer',content);
    const pending=rs.filter(r=>r.status==='pending');
    const ordered=[...pending,...rs.filter(r=>r.status!=='pending').slice().reverse()];
    const titleHtml=headingNode?headingNode.outerHTML:'<div class="wfm-simple-heading"><div><h1>Time off</h1></div></div>';
    const scopeHtml=filtersNode?filtersNode.outerHTML:(typeof filters==='function'?filters():'');
    content.innerHTML=`${titleHtml}${scopeHtml}
      <div class="wfm-leave-layout">
        <section class="wfm-request-list" aria-label="Time-off decisions">
          ${ordered.length?ordered.map(decisionCard).join(''):'<section class="panel"><div class="empty">No time-off requests in this scope.</div></section>'}
        </section>
        <aside class="wfm-leave-side">
          <h2>${pending.length} decision${pending.length===1?'':'s'} waiting</h2>
          <p>The approval screen now answers the manager’s decision questions before asking for a decision.</p>
          <div class="wfm-mini-rule"><span>1</span><div><b>Balance first.</b><br>Allowance, approved time and the post-approval balance stay together.</div></div>
          <div class="wfm-mini-rule"><span>2</span><div><b>Conflict in context.</b><br>Other approved or pending requests for the same team/date are visible here.</div></div>
          <div class="wfm-mini-rule"><span>3</span><div><b>Coverage stays honest.</b><br>Headcount is shown; skill cover and overtime cost are not invented.</div></div>
          ${baseButton('Find available cover',availablePage(['cover','availability-control','availability']),false)}
        </aside>
      </div>${footerNode?footerNode.outerHTML:''}`;
  }

  function employeeTimeOff(){
    if(!employeeRole()||typeof ui==='undefined'||ui.page!=='leave')return;
    const content=q('.content');
    if(!content||q('.wfm-self-balance',content))return;
    const p=typeof me==='function'?personFor(me().id):null;
    if(!p)return;
    const allowance=allowanceFor(p),approved=approvedHours(p.id),pending=pendingHours(p.id),remaining=Math.max(0,allowance-approved),available=Math.max(0,remaining-pending);
    const headingNode=q('.heading',content),footerNode=q('.footer',content);
    const list=typeof employeeRequests==='function'?employeeRequests():'<div class="empty">No requests recorded.</div>';
    content.innerHTML=`${headingNode?headingNode.outerHTML:''}
      <div class="wfm-self-balance" aria-label="My holiday balance">
        <div class="wfm-self-stat"><small>Allowance</small><strong>${hours(allowance)}</strong><p>Your current recorded allowance.</p></div>
        <div class="wfm-self-stat"><small>Approved</small><strong>${hours(approved)}</strong><p>Time already approved.</p></div>
        <div class="wfm-self-stat"><small>Pending</small><strong>${hours(pending)}</strong><p>Waiting for a manager decision.</p></div>
        <div class="wfm-self-stat" data-emphasis="true"><small>Available after pending</small><strong>${hours(available)}</strong><p>What remains if pending requests are approved.</p></div>
      </div>
      <section class="panel"><div class="panelhead"><div><h2>My requests</h2><p>Your request history and current status.</p></div></div>${list}</section>
      ${footerNode?footerNode.outerHTML:''}`;
  }

  function insightSwitcher(){
    if(employeeRole()||typeof ui==='undefined')return;
    const pages=['costs','forecast','insights','value-cockpit','payroll'];
    if(!pages.includes(ui.page))return;
    const content=q('.content');
    if(!content||q('.wfm-insight-switcher',content))return;
    const navPages=new Set(qa('.sidebar .navbtn[data-page]').map(b=>b.dataset.page));
    const labels={costs:'Labour cost',forecast:'Forecast',insights:'Efficiency', 'value-cockpit':'Value',payroll:'Payroll'};
    const buttons=pages.filter(p=>navPages.has(p)).map(p=>`<button type="button" class="btn ${ui.page===p?'primary':''}" data-act="nav" data-page="${safe(p)}">${safe(labels[p])}</button>`).join('');
    if(!buttons)return;
    const headingNode=q('.heading',content);
    const switcher=document.createElement('div');
    switcher.className='wfm-insight-switcher';
    switcher.setAttribute('aria-label','Cost and efficiency views');
    switcher.innerHTML=buttons;
    if(headingNode)headingNode.insertAdjacentElement('afterend',switcher);else content.prepend(switcher);
  }

  function enhance(){
    if(state.enhancing)return;
    state.enhancing=true;
    try{
      simplifyNavigation();
      managerActionCentre();
      managerLeave();
      employeeTimeOff();
      insightSwitcher();
    }catch(err){console.warn('WFM UX simplification layer could not enhance this view:',err);}
    finally{state.enhancing=false;}
  }

  if(typeof render==='function'){
    const previousRender=render;
    render=function(...args){
      const result=previousRender.apply(this,args);
      if(result&&typeof result.then==='function')return result.finally(()=>queueMicrotask(enhance));
      queueMicrotask(enhance);
      return result;
    };
  }

  const root=document.getElementById('root');
  if(root&&!state.observed){
    state.observed=true;
    let queued=false;
    new MutationObserver(()=>{
      if(queued||state.enhancing)return;
      queued=true;
      queueMicrotask(()=>{queued=false;enhance();});
    }).observe(root,{childList:true});
  }
  queueMicrotask(enhance);
})();
