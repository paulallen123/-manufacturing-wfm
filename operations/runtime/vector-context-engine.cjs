'use strict';

function compact(v,max=300){return String(v??'').trim().replace(/\s+/g,' ').slice(0,max);}
function parseState(raw){
  if(raw&&typeof raw==='object')return raw;
  try{return raw?JSON.parse(String(raw)):{};}catch{return {};}
}
function peopleArray(state){
  for(const key of ['staff','people','employees']){
    if(Array.isArray(state?.[key]))return {key,rows:state[key]};
  }
  return {key:null,rows:[]};
}
function siteValue(row){
  const values=[row?.siteId,row?.site_id,row?.site,row?.plantId,row?.plant_id,row?.plant,row?.locationId,row?.location_id,row?.location,row?.root];
  const value=values.find(v=>typeof v==='string'||typeof v==='number');
  return value==null?null:compact(value,120);
}
function statusValue(row){
  const value=row?.attendanceStatus??row?.attendance_status??row?.status??row?.state??row?.presence;
  return compact(value,80).toLowerCase();
}
function scopeRows(rows,siteIds=[]){
  const wanted=(Array.isArray(siteIds)?siteIds:[]).map(v=>compact(v,120)).filter(Boolean);
  if(!wanted.length)return {rows,scopeResolved:true,siteDimensionPresent:rows.some(x=>siteValue(x)!=null)};
  const dimension=rows.some(x=>siteValue(x)!=null);
  if(!dimension)return {rows:[],scopeResolved:false,siteDimensionPresent:false};
  const wantedSet=new Set(wanted);
  return {rows:rows.filter(x=>wantedSet.has(siteValue(x))),scopeResolved:true,siteDimensionPresent:true};
}
function stateTimezone(state){
  const candidates=[state?.timezone,state?.timeZone,state?.settings?.timezone,state?.settings?.timeZone,state?.organisation?.timezone,state?.organization?.timezone];
  for(const v of candidates){
    const tz=compact(v,100);if(!tz)continue;
    try{new Intl.DateTimeFormat('en-GB',{timeZone:tz}).format(new Date());return tz;}catch{}
  }
  return null;
}
function createTenantSnapshot(rawState,context={}){
  const state=parseState(rawState);
  const people=peopleArray(state);
  const scoped=scopeRows(people.rows,context.siteIds);
  const metrics=[],facts=[];
  if(!scoped.scopeResolved)return {ok:false,reason:'SCOPE_UNRESOLVED',snapshot:null};
  if(people.key){
    metrics.push({label:'People in scope',value:scoped.rows.length,detail:'Fresh tenant state'});
    let present=0,absent=0,late=0,missing=0;
    for(const row of scoped.rows){
      const status=statusValue(row);
      if(['onsite','on site','present','working','in','clocked in'].includes(status))present++;
      else if(['sick','absent','off sick'].includes(status))absent++;
      else if(['late'].includes(status))late++;
      else if(['missing','unknown','unconfirmed'].includes(status))missing++;
    }
    if(present)metrics.push({label:'Present',value:present,detail:'Fresh attendance status'});
    if(absent)metrics.push({label:'Absent',value:absent,detail:'Fresh attendance status'});
    if(late)facts.push({label:'Late',value:late,detail:'Fresh attendance status'});
    if(missing)facts.push({label:'Unconfirmed attendance',value:missing,detail:'Requires reconciliation'});
  }
  if(Array.isArray(state?.requests)){
    const approved=state.requests.filter(r=>String(r?.status||'').toLowerCase()==='approved').length;
    facts.push({label:'Approved workforce requests',value:approved,detail:'Current tenant state'});
  }
  const timezone=stateTimezone(state);
  const snapshot={
    generatedAt:new Date().toISOString(),
    role:compact(context.role,60)||null,
    scope:compact(context.scope,80)||null,
    currentScreen:compact(context.currentScreen,80)||'automation',
    site:Array.isArray(context.siteIds)&&context.siteIds.length?context.siteIds.map(v=>compact(v,80)).join(', '):'All authorised sites',
    metrics,
    facts,
    decisionLens:{
      soWhat:compact(context.soWhat,500)||'This scheduled report uses the latest tenant state available at execution time.',
      nextAction:compact(context.nextAction,500)||'Review the current evidence and highest-impact exceptions before taking action.'
    }
  };
  if(!metrics.length&&!facts.length)return {ok:false,reason:'NO_FRESH_EVIDENCE',snapshot:null,timezone};
  return {ok:true,reason:'FRESH_EVIDENCE',snapshot,timezone};
}
module.exports={parseState,peopleArray,siteValue,scopeRows,stateTimezone,createTenantSnapshot};
