/* VECTOR_REPORTING_UI_V1
 * Goal-first, source-bound reporting overlay for the approved VECTOR UI.
 * No mock data and no arbitrary endpoint access.
 */
(function(){
'use strict';

const MARKER='VECTOR_REPORTING_UI_V1';
const IMPROVE_ROUTES=new Set(['insights','costs','recommendations','benchmarks','compliance','overtime-watch']);
const state={catalog:null,selectedTemplate:null,selectedSource:null,rows:[],raw:null,columns:[],saved:[],loading:false};

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
      <div class="vector-reporting-body">
        <aside class="vector-reporting-sidebar">
          <label class="vector-reporting-search">
            <span>What do you need to know?</span>
            <input type="search" data-report-search placeholder="e.g. What blocks payroll?" autocomplete="off">
          </label>
          <div class="vector-reporting-template-list" data-report-templates></div>
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
  return m;
}
function close(){const m=modal();m.hidden=true;document.body.classList.remove('vector-reporting-open');}
async function open(){
  const m=modal();m.hidden=false;document.body.classList.add('vector-reporting-open');
  if(!state.catalog)await loadCatalog();
  else{renderTemplates('');renderSaved();}
  setTimeout(()=>m.querySelector('[data-report-search]')?.focus(),0);
}
async function json(url,options){
  const r=await fetch(url,{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json','content-type':'application/json'},...options});
  let body=null;try{body=await r.json();}catch{}
  if(!r.ok)throw new Error(body?.error||('Request failed: '+r.status));
  return body;
}
async function loadCatalog(){
  const main=modal().querySelector('[data-report-main]');
  main.innerHTML='<div class="vector-reporting-empty"><strong>Loading reporting controls…</strong></div>';
  try{
    state.catalog=await json('/api/reporting/catalog');
    const saved=await json('/api/reporting/reports').catch(()=>({reports:[]}));
    state.saved=Array.isArray(saved?.reports)?saved.reports:[];
    renderTemplates('');renderSaved();
    main.innerHTML='<div class="vector-reporting-empty"><strong>Choose a question</strong><span>Only report sources available to your current role are shown.</span></div>';
  }catch(e){
    main.innerHTML='<div class="vector-reporting-error"><strong>Reporting is unavailable</strong><span>'+esc(e.message)+'</span></div>';
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
  if(rows.length)return rows.map(flatten);
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
function flatten(obj,prefix='',depth=0,out={}){
  if(!obj||typeof obj!=='object'||depth>2)return out;
  for(const [k,v] of Object.entries(obj)){
    const key=prefix?prefix+'.'+k:k;
    if(v==null||['string','number','boolean'].includes(typeof v))out[key]=v;
    else if(Array.isArray(v))out[key]=v.length;
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
        <button type="button" class="secondary" data-report-save>Save</button>
        <button type="button" class="secondary" data-report-export ${state.rows.length?'':'disabled'}>CSV / Excel</button>
        <button type="button" class="secondary" data-report-print ${state.rows.length?'':'disabled'}>Print / PDF</button>
        <button type="button" class="primary" data-report-run>${state.loading?'Running…':'Run report'}</button>
      </div>
    </div>
    <div class="vector-reporting-boundary"><b>Evidence boundary</b><span>${esc(s.evidenceClass)} · ${esc(s.endpoint)} · role governed · no silent mock data</span></div>
    <details class="vector-reporting-advanced">
      <summary>Advanced controls</summary>
      <div class="vector-reporting-field-grid">${(s.fields||[]).map(f=>`<label><input type="checkbox" data-report-column="${esc(f)}" ${cols.includes(f)?'checked':''}><span>${esc(f)}</span></label>`).join('')}</div>
      <p>Field access is fixed by the governed semantic catalog. Arbitrary SQL and arbitrary endpoints are not available.</p>
    </details>
    ${state.raw?'<section class="vector-reporting-insight"><span>So what?</span><strong>'+esc(insight(s.id,state.rows,state.raw))+'</strong></section>':''}
    <section class="vector-reporting-table-card">
      ${state.loading?'<div class="vector-reporting-empty"><strong>Reading the governed source…</strong></div>':tableMarkup()}
    </section>
    <footer class="vector-reporting-foot">Source-bound report. Realised outcomes, estimates and opportunities remain separately classified.</footer>`;
}
function tableMarkup(){
  if(!state.raw)return '<div class="vector-reporting-empty"><strong>Ready to run</strong><span>The report reads the live source only when you press Run report.</span></div>';
  if(!state.rows.length)return '<div class="vector-reporting-empty"><strong>No rows</strong><span>No report rows were returned. VECTOR has not filled the report with demo values.</span></div>';
  const cols=availableColumns(state.rows,state.columns);
  return '<div class="vector-reporting-table-wrap"><table><thead><tr>'+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+
    state.rows.slice(0,250).map(r=>'<tr>'+cols.map(c=>'<td>'+esc(cell(r[c]))+'</td>').join('')+'</tr>').join('')+
    '</tbody></table></div><div class="vector-reporting-rowcount">'+state.rows.length+' row'+(state.rows.length===1?'':'s')+' · preview limited to 250 rows</div>';
}
async function chooseTemplate(id){
  const t=template(id);if(!t)return;
  state.selectedTemplate=t.id;state.selectedSource=source(t.sourceId);state.rows=[];state.raw=null;state.columns=[...(t.columns||[])];
  renderTemplates(modal().querySelector('[data-report-search]')?.value||'');
  renderReport();
}
async function chooseSaved(id){
  const body=await json('/api/reporting/reports/'+encodeURIComponent(id));
  const d=body?.report?.definition;if(!d)return;
  state.selectedTemplate=null;state.selectedSource=source(d.sourceId);state.rows=[];state.raw=null;state.columns=[...(d.columns||[])];
  renderReport();
}
async function run(){
  if(!state.selectedSource||state.loading)return;
  state.loading=true;renderReport();
  try{
    const body=await json(state.selectedSource.endpoint);
    state.raw=body;state.rows=rowsFor(state.selectedSource.id,body);
    if(!state.columns.length)state.columns=availableColumns(state.rows,[]);
  }catch(e){
    state.raw={error:e.message};state.rows=[];
    const main=modal().querySelector('[data-report-main]');
    main.innerHTML='<div class="vector-reporting-error"><strong>Source could not be read</strong><span>'+esc(e.message)+'</span><button type="button" data-report-run>Try again</button></div>';
    state.loading=false;return;
  }
  state.loading=false;renderReport();
}
async function save(){
  const s=state.selectedSource;if(!s)return;
  const t=template(state.selectedTemplate);
  try{
    const body=await json('/api/reporting/reports',{method:'POST',body:JSON.stringify({definition:{
      title:t?.label||s.label,
      sourceId:s.id,
      columns:state.columns.filter(c=>(s.fields||[]).includes(c)),
      visualisation:'table',
      comparison:t?.comparison||'none',
      narrative:t?.narrative!==false,
      includeEvidence:true
    }})});
    if(body?.report){state.saved.unshift(body.report);renderSaved();toast('Report saved as an immutable, audited definition.');}
  }catch(e){toast(e.message||'Could not save report.');}
}
function csv(){
  if(!state.rows.length)return;
  const cols=availableColumns(state.rows,state.columns),quote=v=>'"'+cell(v).replace(/"/g,'""')+'"';
  const data=[cols.map(quote).join(','),...state.rows.map(r=>cols.map(c=>quote(r[c])).join(','))].join('\r\n');
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
function toast(message){try{if(typeof window.toast==='function')return window.toast(message);}catch{}alert(message);}
async function handleClick(e){
  const t=e.target.closest('[data-report-template]');if(t){await chooseTemplate(t.dataset.reportTemplate);return;}
  const saved=e.target.closest('[data-report-saved-id]');if(saved){await chooseSaved(saved.dataset.reportSavedId);return;}
  if(e.target.closest('[data-report-run]')){await run();return;}
  if(e.target.closest('[data-report-save]')){await save();return;}
  if(e.target.closest('[data-report-export]')){csv();return;}
  if(e.target.closest('[data-report-print]')){printReport();return;}
  const col=e.target.closest('[data-report-column]');
  if(col){const f=col.dataset.reportColumn;if(col.checked&&!state.columns.includes(f))state.columns.push(f);if(!col.checked)state.columns=state.columns.filter(x=>x!==f);}
}

const observer=new MutationObserver(()=>installLaunch());
observer.observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('hashchange',()=>setTimeout(installLaunch,0));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal().hidden)close();});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installLaunch,{once:true});else installLaunch();
window.VectorReporting=Object.freeze({open,marker:MARKER});
})();
