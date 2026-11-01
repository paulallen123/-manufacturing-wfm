/* VECTOR_REPORTING_UI_V1
 * Goal-first, source-bound reporting overlay for the approved VECTOR UI.
 * No mock data and no arbitrary endpoint access.
 */
(function(){
'use strict';

const MARKER='VECTOR_REPORTING_UI_V1';
const IMPROVE_ROUTES=new Set(['insights','costs','recommendations','benchmarks','compliance','overtime-watch']);
const state={catalog:null,selectedTemplate:null,selectedSource:null,selectedReportId:null,baseRows:[],rows:[],raw:null,columns:[],calculations:[],filters:[],sorts:[],visualisation:'table',saved:[],dashboards:[],schedules:[],deliveries:[],deliveriesAvailable:false,loading:false,scheduleOpen:false};
let authorityEpoch=0,editorRevision=0,savingToken=null,returnFocus=null;
function currentDefinitionSaved(){return Boolean(state.selectedReportId&&state.savedRevision===editorRevision);}
function advanceEditor(){editorRevision++;state.loading=false;}
function clearReporting(){
  advanceEditor();savingToken=null;state.savedRevision=null;state.hiddenDefinition={};
  state.catalog=null;state.selectedTemplate=null;state.selectedSource=null;state.selectedReportId=null;
  state.baseRows=[];state.rows=[];state.raw=null;state.columns=[];state.calculations=[];state.filters=[];state.sorts=[];
  state.saved=[];state.dashboards=[];state.schedules=[];state.deliveries=[];state.deliveriesAvailable=false;state.loading=false;state.scheduleOpen=false;
  for(const selector of ['[data-report-templates]','[data-report-saved]','[data-report-dashboard]','[data-report-schedules]','[data-report-deliveries]','[data-report-main]'])modal().querySelector(selector).innerHTML='';
}
function announce(message){const host=modal().querySelector('[data-report-status]');if(host)host.textContent=message;}

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=v=>String(v??'').replace(/\s+/g,' ').trim();
const currentPage=()=>{try{return String(window.ui?.page||(typeof ui!=='undefined'&&ui?.page)||'overview')}catch{return'overview'}};
const employee=()=>{try{return typeof window.isEmployee==='function'&&window.isEmployee()}catch{return false}};

function button(){
  const b=document.createElement('button');
  b.type='button';
  b.className='vector-reporting-launch';
  b.dataset.vectorReportingLaunch='1';
  b.innerHTML='<span aria-hidden="true">▦</span><span>Reports</span>';
  b.addEventListener('click',open);
  return b;
}
function installLaunch(){
  const existing=document.querySelector('[data-vector-reporting-launch]');
  if(employee()||!IMPROVE_ROUTES.has(currentPage())){
    existing?.closest('.vector-reporting-launch-wrap')?.remove();
    return;
  }
  if(existing)return;
  const heading=document.querySelector('.vector-page-content>.heading:first-child,.content>.heading:first-child');
  if(!heading)return;
  const holder=document.createElement('div');
  holder.className='vector-reporting-launch-wrap';
  holder.appendChild(button());
  heading.appendChild(holder);
}
function modal(){
  let m=document.getElementById('vector-reporting-modal');
  if(m)return m;
  m=document.createElement('div');
  m.id='vector-reporting-modal';
  m.className='vector-reporting-modal';
  m.dataset.vectorReporting=MARKER;
  m.hidden=true;
  m.innerHTML=`
    <div class="vector-reporting-backdrop" data-report-close></div>
    <section class="vector-reporting-shell" role="dialog" aria-modal="true" aria-labelledby="vector-reporting-title">
      <header class="vector-reporting-head">
        <div>
          <span class="vector-reporting-kicker">Evidence-backed reporting</span>
          <h2 id="vector-reporting-title">Ask VECTOR what you need to know</h2>
          <p>Start with the decision. Advanced controls stay out of the way until you need them.</p>
        </div>
        <button type="button" class="vector-reporting-close" data-report-close aria-label="Close reporting">×</button>
      </header>
      <div class="vector-reporting-status" data-report-status role="status" aria-live="polite" aria-atomic="true"></div>
      <div class="vector-reporting-body">
        <aside class="vector-reporting-sidebar">
          <label class="vector-reporting-search">
            <span>What do you need to know?</span>
            <input type="search" data-report-search placeholder="e.g. What blocks payroll?" autocomplete="off">
          </label>
          <div class="vector-reporting-template-list" data-report-templates></div>
          <div class="vector-reporting-saved" data-report-dashboard></div>
          <div class="vector-reporting-saved" data-report-deliveries></div>
          <div class="vector-reporting-saved" data-report-schedules></div>
          <div class="vector-reporting-saved" data-report-saved></div>
        </aside>
        <main class="vector-reporting-main" data-report-main>
          <div class="vector-reporting-empty">
            <strong>Choose a question</strong>
            <span>VECTOR will open the governed source, show the evidence boundary and keep realised outcomes separate from estimates.</span>
          </div>
        </main>
      </div>
    </section>`;
  document.body.appendChild(m);
  m.addEventListener('click',e=>{if(e.target.closest('[data-report-close]'))close();});
  m.querySelector('[data-report-search]')?.addEventListener('input',e=>renderTemplates(e.target.value));
  m.addEventListener('click',handleClick);
  m.addEventListener('change',handleChange);
  return m;
}
function close(){authorityEpoch++;clearReporting();const m=modal();m.hidden=true;document.body.classList.remove('vector-reporting-open');returnFocus?.focus();}
async function open(){
  if(modal().hidden)returnFocus=document.activeElement;
  const m=modal();m.hidden=false;document.body.classList.add('vector-reporting-open');
  await loadCatalog();
  if(!m.hidden)setTimeout(()=>m.querySelector('[data-report-search]')?.focus(),0);
}
async function json(url,options){
  const epoch=authorityEpoch;
  try{
  const r=await fetch(url,{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json','content-type':'application/json'},...options});
  let body=null;try{body=await r.json();}catch{}
  if(epoch!==authorityEpoch)throw Object.assign(new Error('Reporting controls changed.'),{stale:true});
  if(!r.ok)throw Object.assign(new Error(body?.error||('Request failed: '+r.status)),{status:r.status});
  return body;
  }catch(error){
    if(epoch!==authorityEpoch)throw Object.assign(new Error('Reporting controls changed.'),{stale:true});
    throw error;
  }
}
async function operationError(error,fallback){
  if(error.stale)return;
  if([401,403,404].includes(error.status)){await loadCatalog();return;}
  toast(error.message||fallback);
}
async function loadCatalog(){
  const epoch=++authorityEpoch;clearReporting();announce('Refreshing reporting controls.');
  const main=modal().querySelector('[data-report-main]');
  main.innerHTML='<div class="vector-reporting-empty"><strong>Loading reporting controls…</strong></div>';
  try{
    const catalog=await json('/api/reporting/catalog');
    const [saved,dashboards,schedules,deliveries]=await Promise.all([
      json('/api/reporting/reports').catch(()=>({reports:[]})),
      json('/api/reporting/dashboards').catch(()=>({dashboards:[]})),
      json('/api/reporting/schedules').catch(()=>({schedules:[]})),
      json('/api/reporting/deliveries').catch(error=>{if([401,403].includes(error.status))throw error;return null;})
    ]);
    if(epoch!==authorityEpoch)return;
    state.catalog=catalog;
    state.saved=Array.isArray(saved?.reports)?saved.reports:[];
    state.dashboards=Array.isArray(dashboards?.dashboards)?dashboards.dashboards:[];
    state.schedules=Array.isArray(schedules?.schedules)?schedules.schedules:[];
    state.deliveriesAvailable=Array.isArray(deliveries?.deliveries);
    state.deliveries=state.deliveriesAvailable?deliveries.deliveries:[];
    renderTemplates('');renderSaved();renderDashboard();renderDeliveries();renderSchedules();
    main.innerHTML='<div class="vector-reporting-empty"><strong>Choose a question</strong><span>Only report sources available to your current role are shown.</span></div>';
    announce(state.deliveriesAvailable?'Reporting controls updated. Only currently available reports are shown.':'Reporting controls updated. Delivery history is unavailable; delivery outcomes could not be checked.');
  }catch(e){
    if(epoch!==authorityEpoch)return;
    clearReporting();
    main.innerHTML='<div class="vector-reporting-empty"><strong>No reports available</strong><span>Reporting controls could not be refreshed. Reopen reporting to try again.</span></div>';
    announce('No reports available.');
  }
}
function renderTemplates(query){
  const host=modal().querySelector('[data-report-templates]');if(!host||!state.catalog)return;
  const q=text(query).toLowerCase();
  const templates=(state.catalog.templates||[]).filter(t=>!q||[t.label,t.sourceId].join(' ').toLowerCase().includes(q));
  host.innerHTML='<div class="vector-reporting-section-label">Suggested questions</div>'+
    (templates.length?templates.map(t=>`<button type="button" class="vector-reporting-template ${state.selectedTemplate===t.id?'active':''}" data-report-template="${esc(t.id)}"><b>${esc(t.label)}</b><span>${esc(source(t.sourceId)?.label||t.sourceId)}</span></button>`).join(''):'<div class="vector-reporting-none">No matching questions.</div>');
}
function renderSaved(){
  const host=modal().querySelector('[data-report-saved]');if(!host)return;
  const rows=state.saved.slice(0,8);
  host.innerHTML='<div class="vector-reporting-section-label">Saved reports</div>'+
    (rows.length?rows.map(r=>`<button type="button" class="vector-reporting-saved-row" data-report-saved-id="${esc(r.id)}"><b>${esc(r.title)}</b><span>${esc(source(r.sourceId)?.label||r.sourceId)}</span></button>`).join(''):'<div class="vector-reporting-none">None yet.</div>');
}
function renderDashboard(){
  const host=modal().querySelector('[data-report-dashboard]');if(!host)return;
  const latest=state.dashboards[0],ids=latest?.dashboard?.reportIds||[];
  const byId=new Map(state.saved.map(r=>[r.id,r])),rows=ids.map(id=>byId.get(id)).filter(Boolean);
  host.innerHTML='<div class="vector-reporting-section-label">My dashboard</div>'+
    (rows.length?rows.map(r=>`<button type="button" class="vector-reporting-saved-row dashboard" data-report-saved-id="${esc(r.id)}"><b>${esc(r.title)}</b><span>▦ Pinned · ${esc(source(r.sourceId)?.label||r.sourceId)}</span></button>`).join(''):'<div class="vector-reporting-none">Pin a saved report here for fast access.</div>');
}
function renderDeliveries(){
  const host=modal().querySelector('[data-report-deliveries]');if(!host)return;
  const byId=new Map(state.saved.map(r=>[r.id,r]));
  // Keep every outcome returned by the authorized endpoint visible, including
  // unknown and blocked writes. A receipt/dispatch response is not readback.
  if(!state.deliveriesAvailable){host.innerHTML='<div class="vector-reporting-section-label">Delivery outcomes</div><div class="vector-reporting-none">Delivery history is unavailable. Outcomes could not be checked. Reopen reporting to refresh.</div>';return;}
  const rows=state.deliveries;
  const labels={
    UNKNOWN:'Outcome unknown — reconciliation required. Do not repeat the delivery.',
    BLOCKED_RECONCILIATION_REQUIRED:'Blocked — an earlier delivery needs reconciliation.',
    BLOCKED_READBACK_REQUIRED:'Blocked — independent confirmation is unavailable.',
    BLOCKED_NO_ADAPTER:'Blocked — delivery connection is unavailable.',
    BLOCKED_AUTHORITY_DRIFT:'Blocked — current authorization is unavailable.',
    BLOCKED_SCHEDULE_PAUSED:'Blocked — schedule was paused.'
  };
  host.innerHTML='<div class="vector-reporting-section-label">Delivery outcomes</div>'+
    (rows.length?rows.map(d=>{
      const r=byId.get(d.reportId),date=new Date(d.createdAt);
      const label=d.status==='READY'&&d.mode==='in_app'?'In-product report ready.':Object.hasOwn(labels,d.status)?labels[d.status]:'Outcome unverified — reconciliation required.';
      const when=Number.isFinite(date.getTime())?date.toLocaleString():'Time unavailable';
      return `<button type="button" class="vector-reporting-saved-row delivery" data-report-saved-id="${esc(d.reportId)}"><b>${esc(r?.title||'Scheduled report')}</b><span>${esc(label)}</span><span>${esc(when)} · Open current report</span></button>`;
    }).join(''):'<div class="vector-reporting-none">No scheduled deliveries yet.</div>');
}
function renderSchedules(){
  const host=modal().querySelector('[data-report-schedules]');if(!host)return;
  const byId=new Map(state.saved.map(r=>[r.id,r])),rows=state.schedules.slice(0,6);
  host.innerHTML='<div class="vector-reporting-section-label">Schedules</div>'+
    (rows.length?rows.map(s=>{const r=byId.get(s.schedule?.reportId),time=String(s.schedule?.hour??0).padStart(2,'0')+':'+String(s.schedule?.minute??0).padStart(2,'0');return `<div class="vector-reporting-schedule-row"><button type="button" data-report-saved-id="${esc(s.schedule?.reportId)}"><b>${esc(r?.title||'Saved report')}</b><span>${esc(s.schedule?.cadence||'')} · ${esc(time)} · ${esc(s.schedule?.timeZone||'UTC')}</span></button><button type="button" class="state" data-report-schedule-state="${esc(s.id)}" data-next-enabled="${s.enabled?'false':'true'}">${s.enabled?'Pause':'Resume'}</button></div>`;}).join(''):'<div class="vector-reporting-none">No schedules yet.</div>');
}
function isPinnedReport(id){
  return Boolean(id&&(state.dashboards[0]?.dashboard?.reportIds||[]).includes(id));
}
function source(id){return (state.catalog?.sources||[]).find(s=>s.id===id)||null;}
function template(id){return (state.catalog?.templates||[]).find(t=>t.id===id)||null;}

function valueAt(obj,path){
  let v=obj;
  for(const p of String(path).split('.'))v=v?.[p];
  return v;
}
function first(obj,paths){
  for(const p of paths){const v=valueAt(obj,p);if(v!==undefined&&v!==null&&v!=='')return v;}
  return null;
}
function arr(body,candidates){
  for(const p of candidates){const v=valueAt(body,p);if(Array.isArray(v))return v;}
  return [];
}
function factoryRows(body){
  return arr(body,['departments','items']).map(x=>({
    site:first(x,['site','siteName'])||first(body,['site','siteName'])||'Current site',
    department:first(x,['name','department','departmentName']),
    status:first(x,['status']),
    requiredHours:first(x,['demand.requiredHours','requiredHours']),
    plannedHours:first(x,['demand.planAvailableHours','demand.scheduledPaidHours','plannedHours']),
    gapHours:first(x,['demand.planGapHours','gapHours']),
    headcount:first(x,['counts.headcount','counts.workers','headcount']),
    exceptions:first(x,['counts.exceptions','exceptions']),
    asOf:first(body,['asOf','generatedAt'])
  }));
}
function genericRows(body,candidates){
  const rows=arr(body,candidates);
  if(rows.length)return rows.map(row=>flatten(row));
  if(body&&typeof body==='object'&&!Array.isArray(body)){
    const out=[];
    for(const [k,v] of Object.entries(body)){
      if(v==null||typeof v==='object')continue;
      out.push({metric:k,value:v});
    }
    if(out.length)return out;
  }
  return [];
}
function flatten(obj,prefix='',depth=0,out=Object.create(null)){
  if(!obj||typeof obj!=='object'||depth>2)return out;
  for(const [k,v] of Object.entries(obj)){
    const key=prefix?prefix+'.'+k:k;
    if(v==null||['string','number','boolean'].includes(typeof v)||Array.isArray(v)){
      // A flat dotted field and a nested path must not silently select a value.
      if(Object.hasOwn(out,key))throw new TypeError('Ambiguous report source fields.');
      out[key]=Array.isArray(v)?v.length:v;
    }
    else if(depth<2)flatten(v,key,depth+1,out);
  }
  return out;
}
function rowsFor(id,body){
  if(id==='factory-readiness')return factoryRows(body);
  if(id==='weekly-review')return genericRows(body,['teams','reviews','items','rows']);
  if(id==='schedule-publication')return genericRows(body,['shifts','schedule','items','rows']);
  if(id==='time-review')return genericRows(body,['items','exceptions','teams','rows']);
  if(id==='payroll-control')return genericRows(body,['teams','items','runs','rows']);
  if(id==='value-realisation')return genericRows(body,['items','results','realizations','realisation','rows']);
  if(id==='decision-outcomes')return genericRows(body,['episodes','decisions','items','problems','rows']);
  if(id==='audit-evidence')return genericRows(body,['events','proofs','items','rows']);
  return [];
}
function availableColumns(rows,preferred=[]){
  const keys=[...new Set(rows.flatMap(r=>Object.keys(r||{})))];
  const out=[];
  for(const p of preferred||[]){if(keys.includes(p)&&!out.includes(p))out.push(p);}
  for(const k of keys){if(!out.includes(k))out.push(k);}
  return out.slice(0,24);
}
function cell(v){
  if(v==null||v==='')return '—';
  if(typeof v==='boolean')return v?'Yes':'No';
  if(typeof v==='object')return JSON.stringify(v);
  return String(v);
}
function insight(id,rows,raw){
  if(!rows.length)return 'No source rows were returned. VECTOR will not invent a result.';
  if(id==='factory-readiness'){
    const gaps=rows.map(r=>({name:r.department||'Area',gap:Number(r.gapHours)})).filter(x=>Number.isFinite(x.gap)&&x.gap>0).sort((a,b)=>b.gap-a.gap);
    if(gaps.length)return gaps[0].name+' has the largest source-reported capacity gap at '+gaps[0].gap+' hours. Review the underlying readiness evidence before acting.';
    return 'The source returned '+rows.length+' readiness rows and no positive capacity gap in the mapped readiness fields.';
  }
  if(id==='value-realisation')return 'Value reporting remains evidence-bound: opportunities and estimates must not be described as realised savings unless the source classification proves them.';
  if(id==='decision-outcomes')return 'This view links decisions to source-reported verification and outcomes. A recommendation is not treated as successful simply because it was generated.';
  return rows.length+' source row'+(rows.length===1?'':'s')+' returned. VECTOR is showing source evidence without adding an unsupported conclusion.';
}
function renderReport(){
  const main=modal().querySelector('[data-report-main]'),s=state.selectedSource,t=template(state.selectedTemplate);
  if(!main||!s)return;
  const cols=state.columns;
  main.innerHTML=`
    <div class="vector-reporting-report-head">
      <div><span class="vector-reporting-kicker">${esc(s.label)}</span><h3>${esc(t?.label||s.label)}</h3><p>${esc(s.description)}</p></div>
      <div class="vector-reporting-actions">
        <button type="button" class="secondary" data-report-save ${savingToken?'disabled':''}>${savingToken?'Saving…':currentDefinitionSaved()?'Saved':'Save'}</button>
        <button type="button" class="secondary" data-report-pin>${isPinnedReport(state.selectedReportId)?'Remove from dashboard':'Pin to dashboard'}</button>
        <button type="button" class="secondary" data-report-schedule>Schedule</button>
        <button type="button" class="secondary" data-report-export ${state.rows.length?'':'disabled'}>CSV review</button>
        <button type="button" class="secondary" data-report-print ${state.rows.length?'':'disabled'}>Print</button>
        <button type="button" class="primary" data-report-run>${state.loading?'Running…':'Run report'}</button>
      </div>
    </div>
    <div class="vector-reporting-boundary"><b>Evidence boundary</b><span>${esc(s.evidenceClass)} · ${esc(s.endpoint)} · role governed · no silent mock data</span></div>
    ${state.scheduleOpen?schedulePanelMarkup():''}
    <details class="vector-reporting-advanced">
      <summary>Advanced controls</summary>
      <div class="vector-reporting-advanced-grid">
        <label class="vector-reporting-control">View
          <select data-report-visualisation>
            <option value="table" ${state.visualisation==='table'?'selected':''}>Table</option>
            <option value="kpi" ${state.visualisation==='kpi'?'selected':''}>KPI cards</option>
            <option value="bar" ${state.visualisation==='bar'?'selected':''}>Bar chart</option>
            <option value="line" ${state.visualisation==='line'?'selected':''}>Line chart</option>
          </select>
        </label>
        <div class="vector-reporting-filter-builder">
          <select data-report-filter-field>${(s.fields||[]).map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select>
          <select data-report-filter-operator><option value="eq">equals</option><option value="neq">not equal</option><option value="contains">contains</option><option value="gte">≥</option><option value="lte">≤</option><option value="gt">&gt;</option><option value="lt">&lt;</option></select>
          <input data-report-filter-value placeholder="Filter value">
          <button type="button" data-report-filter-add>Add filter</button>
        </div>
        <div class="vector-reporting-filter-builder">
          <select data-report-sort-field>${(s.fields||[]).map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select>
          <select data-report-sort-direction><option value="asc">A → Z / low → high</option><option value="desc">Z → A / high → low</option></select>
          <button type="button" data-report-sort-add>Add sort</button>
        </div>
        <div class="vector-reporting-calculation-builder">
          <input data-report-calc-label placeholder="Calculated metric name">
          <select data-report-calc-left>${(s.fields||[]).map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select>
          <select data-report-calc-operator><option value="difference">minus</option><option value="sum">plus</option><option value="product">×</option><option value="ratio">÷</option><option value="percent_change">% change</option></select>
          <select data-report-calc-right>${(s.fields||[]).map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select>
          <button type="button" data-report-calc-add>Add metric</button>
        </div>
      </div>
      <div class="vector-reporting-chips">
        ${state.filters.map((f,i)=>`<button type="button" data-report-filter-remove="${i}">Filter · ${esc(f.field)} ${esc(f.operator)} ${esc(f.value)}</button>`).join('')}
        ${state.sorts.map((s,i)=>`<button type="button" data-report-sort-remove="${i}">Sort · ${esc(s.field)} ${esc(s.direction)}</button>`).join('')}
        ${state.calculations.map((x,i)=>`<button type="button" data-report-calc-remove="${i}">Metric · ${esc(x.label)}</button>`).join('')}
      </div>
      <div class="vector-reporting-field-grid">${(s.fields||[]).map(f=>`<label><input type="checkbox" data-report-column="${esc(f)}" ${cols.includes(f)?'checked':''}><span>${esc(f)}</span></label>`).join('')}</div>
      <p>Field access is fixed by the governed semantic catalog. Arbitrary SQL and arbitrary endpoints are not available.</p>
    </details>
    ${state.raw?'<section class="vector-reporting-insight"><span>So what?</span><strong>'+esc(insight(s.id,state.rows,state.raw))+'</strong></section>':''}
    <section class="vector-reporting-table-card">
      ${state.loading?'<div class="vector-reporting-empty"><strong>Reading the governed source…</strong></div>':tableMarkup()}
    </section>
    <footer class="vector-reporting-foot">Source-bound report. Realised outcomes, estimates and opportunities remain separately classified.</footer>`;
}
function numericColumns(rows){
  const keys=availableColumns(rows,state.columns);
  return keys.filter(k=>rows.some(r=>Number.isFinite(Number(r?.[k]))));
}
function chartMarkup(kind){
  const cols=availableColumns(state.rows,state.columns),nums=numericColumns(state.rows);
  if(!nums.length)return '<div class="vector-reporting-empty"><strong>No numeric measure</strong><span>Choose a numeric field or use the table view.</span></div>';
  const measure=nums[0],category=cols.find(c=>c!==measure)||measure,points=state.rows.slice(0,12).map((r,i)=>({label:cell(r[category]??('Row '+(i+1))),value:Number(r[measure])})).filter(p=>Number.isFinite(p.value));
  if(!points.length)return '<div class="vector-reporting-empty"><strong>No chartable rows</strong></div>';
  if(kind==='kpi')return '<div class="vector-reporting-kpi-view">'+points.slice(0,6).map(p=>'<div><small>'+esc(p.label)+'</small><strong>'+esc(cell(p.value))+'</strong><span>'+esc(measure)+'</span></div>').join('')+'</div>';
  const max=Math.max(...points.map(p=>Math.abs(p.value)),1);
  if(kind==='bar')return '<div class="vector-reporting-bar-view">'+points.map(p=>'<div class="vector-reporting-bar-row"><span>'+esc(p.label)+'</span><i><b style="width:'+Math.max(2,Math.round(Math.abs(p.value)/max*100))+'%"></b></i><strong>'+esc(cell(p.value))+'</strong></div>').join('')+'</div>';
  const w=700,h=220,pad=22,min=Math.min(...points.map(p=>p.value)),range=Math.max(1,max-min),xy=points.map((p,i)=>({x:pad+(points.length===1?0:(w-pad*2)*i/(points.length-1)),y:h-pad-(h-pad*2)*(p.value-min)/range,p}));
  return '<div class="vector-reporting-line-view"><svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(measure)+' line chart"><polyline points="'+xy.map(p=>p.x+','+p.y).join(' ')+'" fill="none" stroke="currentColor" stroke-width="3"/>'+xy.map(p=>'<circle cx="'+p.x+'" cy="'+p.y+'" r="4" fill="currentColor"/>').join('')+'</svg><div class="vector-reporting-line-labels">'+points.map(p=>'<span>'+esc(p.label)+'</span>').join('')+'</div></div>';
}
function tableMarkup(){
  if(!state.raw)return '<div class="vector-reporting-empty"><strong>Ready to run</strong><span>The report reads the live source only when you press Run report.</span></div>';
  if(!state.rows.length)return '<div class="vector-reporting-empty"><strong>No rows</strong><span>No report rows were returned. VECTOR has not filled the report with demo values.</span></div>';
  if(state.visualisation!=='table')return chartMarkup(state.visualisation);
  const cols=availableColumns(state.rows,state.columns);
  return '<div class="vector-reporting-table-wrap"><table><thead><tr>'+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+
    state.rows.slice(0,250).map(r=>'<tr>'+cols.map(c=>'<td>'+esc(cell(r[c]))+'</td>').join('')+'</tr>').join('')+
    '</tbody></table></div><div class="vector-reporting-rowcount">'+state.rows.length+' row'+(state.rows.length===1?'':'s')+' · preview limited to 250 rows</div>';
}
async function chooseTemplate(id){
  const t=template(id);if(!t)return;
  advanceEditor();state.savedRevision=null;state.hiddenDefinition={};
  state.selectedTemplate=t.id;state.selectedSource=source(t.sourceId);state.selectedReportId=null;state.baseRows=[];state.rows=[];state.raw=null;state.columns=[...(t.columns||[])];state.calculations=[];state.filters=[];state.sorts=[];state.visualisation=t.visualisation||'table';state.scheduleOpen=false;
  renderTemplates(modal().querySelector('[data-report-search]')?.value||'');
  renderReport();
}
async function chooseSaved(id){
  advanceEditor();const revision=editorRevision;
  let body;try{body=await json('/api/reporting/reports/'+encodeURIComponent(id));}catch(e){
    if(e.stale)return;
    const authorityDenied=[401,403,404].includes(e.status);
    if(revision!==editorRevision&&!authorityDenied)return;
    const refresh=loadCatalog(),epoch=authorityEpoch;await refresh;
    if(!authorityDenied&&epoch===authorityEpoch&&!modal().hidden)toast('Could not open saved report. Choose the saved report again to retry.');
    return;
  }
  const d=body?.report?.definition;if(!d||body.report.id!==id||revision!==editorRevision)return;
  state.hiddenDefinition=Object.fromEntries(['limit','claimBoundary'].filter(key=>Object.hasOwn(d,key)).map(key=>[key,d[key]]));
  state.savedRevision=revision;
  state.selectedTemplate=null;state.selectedSource=source(d.sourceId);state.selectedReportId=id;state.baseRows=[];state.rows=[];state.raw=null;state.columns=[...(d.columns||[])];state.calculations=[...(d.calculations||[])];state.filters=[...(d.filters||[])];state.sorts=[...(d.sorts||[])];state.visualisation=d.visualisation||'table';state.scheduleOpen=false;
  renderReport();
}
function compareValue(a,b){
  const na=Number(a),nb=Number(b);
  if(Number.isFinite(na)&&Number.isFinite(nb))return na-nb;
  return String(a??'').localeCompare(String(b??''),undefined,{numeric:true,sensitivity:'base'});
}
function matchesFilter(row,f){
  const a=row?.[f.field],b=f.value,op=f.operator;
  if(op==='eq')return String(a??'')===String(b??'');
  if(op==='neq')return String(a??'')!==String(b??'');
  if(op==='contains')return String(a??'').toLowerCase().includes(String(b??'').toLowerCase());
  const cmp=compareValue(a,b);
  return op==='gte'?cmp>=0:op==='lte'?cmp<=0:op==='gt'?cmp>0:op==='lt'?cmp<0:true;
}
function calculateRow(row){
  const out={...row};
  state.calculations.forEach((calc,index)=>{
    const a=Number(row?.[calc.left]),b=Number(row?.[calc.right]),key=calc.label||('Calculated '+(index+1));
    if(!Number.isFinite(a)||!Number.isFinite(b)){out[key]=null;return;}
    if(calc.operator==='sum')out[key]=a+b;
    else if(calc.operator==='difference')out[key]=a-b;
    else if(calc.operator==='product')out[key]=a*b;
    else if(calc.operator==='ratio')out[key]=b===0?null:a/b;
    else if(calc.operator==='percent_change')out[key]=b===0?null:((a-b)/Math.abs(b))*100;
  });
  return out;
}
function applyControls(rows){
  let out=rows.map(calculateRow);
  for(const f of state.filters)out=out.filter(r=>matchesFilter(r,f));
  if(state.sorts.length)out.sort((a,b)=>{for(const s of state.sorts){const n=compareValue(a?.[s.field],b?.[s.field]);if(n)return s.direction==='desc'?-n:n;}return 0;});
  return out;
}
function recalc(){state.rows=applyControls(state.baseRows);renderReport();}
async function run(){
  if(!state.selectedSource||state.loading)return;
  const revision=editorRevision,selectedSource=state.selectedSource;
  state.loading=true;renderReport();
  try{
    const body=await json(selectedSource.endpoint);
    if(revision!==editorRevision||selectedSource!==state.selectedSource)return;
    state.raw=body;state.baseRows=rowsFor(selectedSource.id,body);state.rows=applyControls(state.baseRows);
    if(!state.columns.length)state.columns=availableColumns(state.rows,[]);
  }catch(e){
    if(e.stale)return;
    if([401,403,404].includes(e.status)){await loadCatalog();return;}
    if(revision!==editorRevision||selectedSource!==state.selectedSource)return;
    state.raw={error:e.message};state.baseRows=[];state.rows=[];state.columns=[];
    const main=modal().querySelector('[data-report-main]');
    main.innerHTML='<div class="vector-reporting-error"><strong>Source could not be read</strong><span>'+esc(e.message)+'</span><button type="button" data-report-run>Try again</button></div>';
    state.loading=false;return;
  }
  state.loading=false;renderReport();
}
async function save(){
  const s=state.selectedSource;if(!s||savingToken)return null;
  const t=template(state.selectedTemplate),revision=editorRevision,token={};
  const request=JSON.parse(JSON.stringify({versionOf:state.selectedReportId||null,definition:{
    ...state.hiddenDefinition,
    title:t?.label||s.label,sourceId:s.id,
    columns:state.columns.filter(c=>(s.fields||[]).includes(c)),
    calculations:state.calculations,filters:state.filters,sorts:state.sorts,
    visualisation:state.visualisation,comparison:t?.comparison||'none',
    narrative:t?.narrative!==false,includeEvidence:true
  }}));
  const hiddenKeys=Object.keys(state.hiddenDefinition||{});
  const retainsHidden=definition=>definition&&hiddenKeys.every(key=>definition[key]===request.definition[key]);
  savingToken=token;renderReport();
  try{
    if(hiddenKeys.length){
      // The server owns normalization and evidence policy. Refuse a version
      // when it cannot retain settings this editor does not expose.
      const checked=await json('/api/reporting/validate',{method:'POST',body:JSON.stringify({definition:request.definition})});
      if(revision!==editorRevision)return null;
      if(checked?.valid!==true||!retainsHidden(checked.definition)){
        toast('Hidden settings cannot be retained under current report policy. No new version was saved.');return null;
      }
    }
    const body=await json('/api/reporting/reports',{method:'POST',body:JSON.stringify(request)});
    if(revision!==editorRevision){
      if(body?.report?.id)toast(currentDefinitionSaved()
        ?'An earlier report version was created. The current saved report was not replaced; reopen saved reports to review it.'
        :'An earlier report version was created. Current edits remain unsaved; reopen saved reports to review it.');
      return null;
    }
    if(!body?.report||typeof body.report.id!=='string'||!body.report.id)return null;
    if(!retainsHidden(body.report.definition)){
      toast('A version was created with changed hidden settings. Reopen it to review before continuing.');return null;
    }
    state.selectedReportId=body.report.id;state.savedRevision=revision;
    state.hiddenDefinition=Object.fromEntries(['limit','claimBoundary'].filter(key=>Object.hasOwn(body.report.definition,key)).map(key=>[key,body.report.definition[key]]));
    state.saved.unshift(body.report);renderSaved();renderDashboard();renderDeliveries();renderReport();
    toast('Report saved as an immutable, audited definition.');return body.report.id;
  }catch(e){
    if(revision===editorRevision||[401,403,404].includes(e.status))await operationError(e,'Could not save report.');
    return null;
  }finally{
    if(savingToken===token){savingToken=null;if(state.selectedSource&&!modal().hidden)renderReport();}
  }
}
async function ensureSaved(){
  if(state.selectedReportId){
    if(currentDefinitionSaved())return state.selectedReportId;
    toast('Save current edits before pinning or scheduling.');return null;
  }
  return save();
}
async function pin(){
  const revision=editorRevision,id=await ensureSaved();if(!id||revision!==editorRevision)return;
  const removing=isPinnedReport(id),url=removing?'/api/reporting/dashboards/unpin':'/api/reporting/dashboards/pin';
  try{
    const body=await json(url,{method:'POST',body:JSON.stringify({reportId:id})});
    if(revision!==editorRevision){
      if(body?.dashboard)toast(removing
        ?'The earlier saved version was removed from the dashboard. The current editor was not changed.'
        :'The earlier saved version was pinned to the dashboard. The current editor was not changed.');
      return;
    }
    if(body?.dashboard){state.dashboards.unshift(body.dashboard);renderDashboard();renderReport();toast(removing?'Removed from My dashboard.':'Pinned to My dashboard.');}
  }catch(e){await operationError(e,'Could not update dashboard.');}
}
function schedulePanelMarkup(){
  const now=new Date(),time=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  return `<section class="vector-reporting-schedule-panel">
    <div><b>Schedule this report</b><span>VECTOR will place a governed live report in your reporting inbox. External email/SFTP stays unavailable until a verified delivery connector is configured.</span></div>
    <label>Cadence<select data-report-cadence><option value="daily">Daily</option><option value="weekly" selected>Weekly</option><option value="monthly">Monthly</option></select></label>
    <label>Time<input type="time" data-report-time value="${esc(time)}"></label>
    <button type="button" class="primary" data-report-schedule-confirm>Create schedule</button>
  </section>`;
}
async function createSchedule(){
  const revision=editorRevision;
  const panel=modal().querySelector('.vector-reporting-schedule-panel'),cadence=panel?.querySelector('[data-report-cadence]')?.value||'weekly';
  const raw=panel?.querySelector('[data-report-time]')?.value||'08:00',[hh,mm]=raw.split(':').map(Number),now=new Date();
  const id=await ensureSaved();if(!id||revision!==editorRevision)return;
  const payload={reportId:id,cadence,hour:hh,minute:mm,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',delivery:'in_app'};
  if(cadence==='weekly')payload.weekday=now.getDay();
  if(cadence==='monthly')payload.dayOfMonth=Math.min(28,now.getDate());
  try{
    const body=await json('/api/reporting/schedules',{method:'POST',body:JSON.stringify(payload)});
    if(revision!==editorRevision){
      if(body?.schedule)toast('The earlier saved version was scheduled. The current editor was not changed.');
      return;
    }
    if(body?.schedule)state.schedules.unshift(body.schedule);
    state.scheduleOpen=false;renderSchedules();renderReport();toast(body?.schedule?'Schedule created. VECTOR will deliver it in-product at the selected cadence.':'Schedule created.');
  }catch(e){await operationError(e,'Could not schedule report.');}
}
function csv(){
  if(!state.rows.length)return;
  // A review-only representation: type tags and escaped JSON prevent raw
  // spreadsheet formulas, links and controls from leading any CSV cell.
  // This does not provide a typed import or an approved spreadsheet profile.
  const token=(type,value)=>type+':'+JSON.stringify(value).replace(/[\u007f-\uffff]/g,
    ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'));
  const reviewCell=value=>{
    if(value===null)return 'null:null';
    if(typeof value==='string')return token('text',value);
    if(typeof value==='boolean')return token('boolean',value);
    if(typeof value==='number'&&Number.isFinite(value))return token('number',value);
    if(value&&typeof value==='object'){
      const json=JSON.stringify(value);
      if(typeof json==='string')return token('json',json);
    }
    throw new TypeError('Unsupported CSV review value');
  };
  const quote=v=>'"'+v.replace(/"/g,'""')+'"';
  let data;
  try{
    const cols=availableColumns(state.rows,state.columns);
    if(!cols.length)throw new TypeError('No exportable columns');
    data=[cols.map(c=>quote(token('header',c))).join(','),
      ...state.rows.map(r=>cols.map(c=>{
        const descriptor=r&&typeof r==='object'&&Object.getOwnPropertyDescriptor(r,c);
        if(!descriptor||!Object.hasOwn(descriptor,'value'))throw new TypeError('Missing export value');
        return quote(reviewCell(descriptor.value));
      }).join(','))].join('\r\n')+'\r\n';
  }catch{toast('Could not prepare CSV review. Check the report data.');return;}
  const blob=new Blob([data],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='vector-report-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function printReport(){
  if(!state.rows.length)return;
  document.body.classList.add('vector-reporting-print');
  const cleanup=()=>document.body.classList.remove('vector-reporting-print');
  window.addEventListener('afterprint',cleanup,{once:true});
  window.print();
  setTimeout(cleanup,2000);
}
async function setScheduleState(id,enabled){
  try{
    const body=await json('/api/reporting/schedules/'+encodeURIComponent(id)+'/state',{method:'POST',body:JSON.stringify({enabled})});
    const i=state.schedules.findIndex(s=>s.id===id);if(i>=0&&body?.schedule)state.schedules[i]=body.schedule;
    renderSchedules();toast(enabled?'Schedule resumed.':'Schedule paused.');
  }catch(e){await operationError(e,'Could not change schedule.');}
}
function toast(message){try{if(typeof window.toast==='function')return window.toast(message);}catch{}alert(message);}
function handleChange(e){
  const vis=e.target.closest('[data-report-visualisation]');
  if(vis){advanceEditor();state.visualisation=vis.value;renderReport();}
}
async function handleClick(e){
  const t=e.target.closest('[data-report-template]');if(t){await chooseTemplate(t.dataset.reportTemplate);return;}
  const stateButton=e.target.closest('[data-report-schedule-state]');if(stateButton){await setScheduleState(stateButton.dataset.reportScheduleState,stateButton.dataset.nextEnabled==='true');return;}
  const saved=e.target.closest('[data-report-saved-id]');if(saved){await chooseSaved(saved.dataset.reportSavedId);return;}
  if(e.target.closest('[data-report-run]')){await run();return;}
  if(e.target.closest('[data-report-save]')){await save();return;}
  if(e.target.closest('[data-report-pin]')){await pin();return;}
  if(e.target.closest('[data-report-schedule]')){state.scheduleOpen=!state.scheduleOpen;renderReport();return;}
  if(e.target.closest('[data-report-schedule-confirm]')){await createSchedule();return;}
  if(e.target.closest('[data-report-export]')){csv();return;}
  if(e.target.closest('[data-report-print]')){printReport();return;}
  if(e.target.closest('[data-report-filter-add]')){
    const root=modal(),field=root.querySelector('[data-report-filter-field]')?.value,operator=root.querySelector('[data-report-filter-operator]')?.value,value=root.querySelector('[data-report-filter-value]')?.value;
    if(field&&operator&&value!==''){advanceEditor();state.filters.push({field,operator,value});if(state.raw)recalc();else renderReport();}return;
  }
  const fr=e.target.closest('[data-report-filter-remove]');if(fr){advanceEditor();state.filters.splice(Number(fr.dataset.reportFilterRemove),1);if(state.raw)recalc();else renderReport();return;}
  if(e.target.closest('[data-report-sort-add]')){
    const root=modal(),field=root.querySelector('[data-report-sort-field]')?.value,direction=root.querySelector('[data-report-sort-direction]')?.value;
    if(field&&direction){advanceEditor();state.sorts.push({field,direction});if(state.raw)recalc();else renderReport();}return;
  }
  const sr=e.target.closest('[data-report-sort-remove]');if(sr){advanceEditor();state.sorts.splice(Number(sr.dataset.reportSortRemove),1);if(state.raw)recalc();else renderReport();return;}
  if(e.target.closest('[data-report-calc-add]')){
    const root=modal(),label=root.querySelector('[data-report-calc-label]')?.value?.trim(),left=root.querySelector('[data-report-calc-left]')?.value,operator=root.querySelector('[data-report-calc-operator]')?.value,right=root.querySelector('[data-report-calc-right]')?.value;
    if(label&&left&&right&&operator&&state.calculations.length<8){advanceEditor();state.calculations.push({label,left,operator,right});if(state.raw)recalc();else renderReport();}return;
  }
  const cr=e.target.closest('[data-report-calc-remove]');if(cr){advanceEditor();state.calculations.splice(Number(cr.dataset.reportCalcRemove),1);if(state.raw)recalc();else renderReport();return;}
  const col=e.target.closest('[data-report-column]');
  if(col){advanceEditor();const f=col.dataset.reportColumn;if(col.checked&&!state.columns.includes(f))state.columns.push(f);if(!col.checked)state.columns=state.columns.filter(x=>x!==f);renderReport();}
}

const observer=new MutationObserver(()=>installLaunch());
observer.observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('hashchange',()=>setTimeout(installLaunch,0));
document.addEventListener('keydown',e=>{
  const m=modal();if(m.hidden)return;
  if(e.key==='Escape'){close();return;}
  if(e.key==='Tab'){
    const focusable=[...m.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary,[tabindex="0"]')].filter(node=>{
      if(!node.getClientRects().length)return false;
      for(let parent=node.parentElement;parent&&parent!==m;parent=parent.parentElement){
        if(parent.tagName==='DETAILS'&&!parent.open&&node!==parent.querySelector('summary'))return false;
      }
      return true;
    });
    const first=focusable[0],last=focusable[focusable.length-1];
    if(first&&((e.shiftKey&&document.activeElement===first)||(!e.shiftKey&&document.activeElement===last))){e.preventDefault();(e.shiftKey?last:first).focus();}
  }
});
window.addEventListener('focus',()=>{if(!modal().hidden)return loadCatalog();});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installLaunch,{once:true});else installLaunch();
window.VectorReporting=Object.freeze({open,marker:MARKER});
})();
