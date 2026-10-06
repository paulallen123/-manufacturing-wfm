'use strict';

function fail(message,code='WFM_TENANT_CALENDAR_INVALID'){const error=new Error(message);error.code=code;throw error;}
function clean(value,max=160){const text=String(value??'').trim();if(!text||text.length>max||/[\u0000-\u001f\u007f]/.test(text))fail('Tenant calendar value is invalid.');return text;}
function validZone(value){const zone=clean(value,120);try{new Intl.DateTimeFormat('en-GB',{timeZone:zone}).format(new Date(0));}catch{fail('Tenant calendar timezone is invalid.');}return zone;}
function localParts(ms,zone){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new Date(ms)).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
 return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}:${parts.second}`};
}
function parseSiteZones(raw){
 if(!raw)return Object.freeze({});
 let value;try{value=JSON.parse(raw);}catch{fail('Site timezone configuration is invalid JSON.');}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Site timezone configuration must be an object.');
 const out={};for(const [site,zone] of Object.entries(value)){const key=clean(site,120);out[key]=validZone(zone);}return Object.freeze(out);
}
function currentPeriod(periods,localDate){
 const rows=Array.isArray(periods)?periods.filter(row=>row&&typeof row.start==='string'&&typeof row.end==='string'):[];
 const exact=rows.filter(row=>row.start<=localDate&&row.end>=localDate).sort((a,b)=>String(b.start).localeCompare(String(a.start)));
 if(exact.length>1)fail('Multiple payroll periods overlap the authoritative tenant date.','WFM_CURRENT_PERIOD_AMBIGUOUS');
 return exact.length===1?exact[0]:null;
}
function freshness({asOf,timeZone,maxAgeMs,nowMs}){
 const zone=validZone(timeZone),observed=Date.parse(asOf),current=Number(nowMs);
 if(!Number.isFinite(observed)||!Number.isFinite(current)||!Number.isFinite(maxAgeMs)||maxAgeMs<=0)return {fresh:false,reason:'INVALID_FRESHNESS_CONTRACT'};
 if(observed>current+30000)return {fresh:false,reason:'EVIDENCE_FROM_FUTURE'};
 if(current-observed>maxAgeMs)return {fresh:false,reason:'EVIDENCE_STALE'};
 return {fresh:true,reason:null,timeZone:zone,ageMs:Math.max(0,current-observed),maxAgeMs};
}
function createTenantCalendar({env=process.env,now=null}={}){
 const tenantTimeZone=validZone(env.WFM_TENANT_TIMEZONE||'Europe/London'),siteZones=parseSiteZones(env.WFM_SITE_TIMEZONES_JSON||'');
 const defaultMaxAgeMs=Math.max(60000,Number(env.WFM_TODAY_MAX_AGE_MS||15*60*1000));
 const injectedIso=String(env.WFM_TENANT_CLOCK_ISO||'').trim(),allowInjectedClock=env.NODE_ENV==='test'||env.WFM_STAFFOLOGY_LOCAL_PROOF==='true'||env.STAFFOLOGY_RUNTIME_MODE==='full';
 const clock=typeof now==='function'?now:()=>{if(injectedIso&&allowInjectedClock){const ms=Date.parse(injectedIso);if(Number.isFinite(ms))return ms;}return Date.now();};
 function zoneFor(site){return site&&siteZones[site]?siteZones[site]:tenantTimeZone;}
 function snapshot({tenant,site,maxAgeMs=defaultMaxAgeMs}={}){
  const at=Number(clock());if(!Number.isFinite(at))fail('Server calendar clock is invalid.');
  const timeZone=zoneFor(site),parts=localParts(at,timeZone);
  return Object.freeze({schemaVersion:'tenant-calendar-1',tenant:tenant?clean(tenant,160):null,site:site?clean(site,120):null,timeZone,asOf:new Date(at).toISOString(),localDate:parts.date,localTime:parts.time,maxAgeMs:Number(maxAgeMs),source:'server-authoritative-tenant-calendar'});
 }
 function periodForState(state,context={}){
  const snap=snapshot(context),period=currentPeriod(state?.payrollControl?.periods,snap.localDate);
  return Object.freeze({...snap,period:period?Object.freeze({id:period.id||period.start,start:period.start,end:period.end,deadline:period.deadline||null,source:period.source||null}):null});
 }
 return Object.freeze({snapshot,periodForState,zoneFor,freshness:input=>freshness({...input,nowMs:Number(clock())})});
}
module.exports={createTenantCalendar,currentPeriod,freshness,validZone};
