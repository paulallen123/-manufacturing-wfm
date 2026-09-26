/* Vector display-context resolver.
 * Presentation only: authoritative identity, hierarchy, policy and cost services remain consequential.
 */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.VectorOperatingContext=api;
})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';

const VERSION='vector-operating-context-v1';
const clean=value=>typeof value==='string'?value.trim():'';
const first=(...values)=>values.map(clean).find(Boolean)||'';

function validLocale(value){
  const candidate=clean(value);
  if(!candidate)return null;
  try{return Intl.getCanonicalLocales(candidate)[0]||null;}catch{return null;}
}

function validTimeZone(value){
  const candidate=clean(value);
  if(!candidate)return null;
  try{new Intl.DateTimeFormat('en',{timeZone:candidate}).format(0);return candidate;}catch{return null;}
}

function validCurrency(value){
  const candidate=clean(value).toUpperCase();
  if(!/^[A-Z]{3}$/.test(candidate))return null;
  try{new Intl.NumberFormat('en',{style:'currency',currency:candidate}).format(0);return candidate;}catch{return null;}
}

function resolve({actor,person,scope,operatingContext,preference,costEvidence,browser}={}){
  const op=operatingContext&&typeof operatingContext==='object'?operatingContext:{};
  const pref=preference&&typeof preference==='object'?preference:{};
  const displayName=first(pref.preferredName,person?.preferredName,person?.name,actor?.name,actor?.email,'Current user');
  const roleLabel=first(actor?.title,actor?.role,person?.job,'Workforce user');
  const siteName=first(op.siteName,op.siteLabel,person?.site,scope?.label,scope?.name,'Current scope');
  const companyName=first(op.organisationName,op.organizationName,op.companyName,'Manufacturing workspace');

  const preferredLocale=validLocale(pref.locale);
  const operatingLocale=validLocale(op.locale);
  const browserLocale=validLocale(browser?.locale);
  const locale=preferredLocale||operatingLocale||browserLocale||'en';
  const localeSource=preferredLocale?'person_preference':operatingLocale?'operating_context':browserLocale?'browser_default':'neutral_default';

  const operatingTimeZone=validTimeZone(op.timeZone);
  const browserTimeZone=validTimeZone(browser?.timeZone);
  const timeZone=operatingTimeZone||browserTimeZone||'UTC';
  const timeZoneSource=operatingTimeZone?'operating_context':browserTimeZone?'browser_default':'neutral_default';

  const contextScope=first(op.scopeId,op.siteId,scope?.id);
  const costScope=first(costEvidence?.scopeId,costEvidence?.siteId);
  const hasCostEvidence=Boolean(costEvidence&&typeof costEvidence==='object');
  const currencyScopeMismatch=Boolean(contextScope&&costScope&&contextScope!==costScope);
  const evidenceCurrency=currencyScopeMismatch?null:validCurrency(costEvidence?.currency);
  const operatingCurrency=validCurrency(op.currency);
  const currency=currencyScopeMismatch?null:(hasCostEvidence?evidenceCurrency:(operatingCurrency||null));
  const currencySource=evidenceCurrency?'cost_evidence':(!hasCostEvidence&&operatingCurrency)?'operating_context':'unknown';

  const missing=[];
  if(displayName==='Current user')missing.push('identity');
  if(siteName==='Current scope')missing.push('site');
  if(timeZoneSource!=='operating_context')missing.push('authoritative_time_zone');
  if(!currency)missing.push('currency');
  if(currencyScopeMismatch)missing.push('cost_scope_match');

  return Object.freeze({
    version:VERSION,
    displayName,
    roleLabel,
    siteName,
    companyName,
    locale,
    localeSource,
    timeZone,
    timeZoneSource,
    currency,
    currencySource,
    currencyScopeMismatch,
    scopeId:contextScope||first(scope?.id),
    authoritative:op.authoritative===true,
    complete:missing.length===0,
    missing:Object.freeze(missing),
    claimBoundary:'Display context does not grant authority, certify local law, convert currency or change workforce records.'
  });
}

function formatMoney(value,context){
  if(!Number.isFinite(Number(value))||!context?.currency)return '\u2014';
  try{return new Intl.NumberFormat(context.locale||'en',{style:'currency',currency:context.currency,maximumFractionDigits:Number(value)>=10000?1:0,notation:Number(value)>=10000?'compact':'standard'}).format(Number(value));}
  catch{return '\u2014';}
}

function formatDate(value,context){
  const date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))return '\u2014';
  try{return new Intl.DateTimeFormat(context?.locale||'en',{weekday:'short',day:'2-digit',month:'short',year:'numeric',timeZone:context?.timeZone||'UTC'}).format(date);}
  catch{return '\u2014';}
}

function localHour(value,context){
  const date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))return null;
  try{
    const hour=new Intl.DateTimeFormat('en',{hour:'2-digit',hourCycle:'h23',timeZone:context?.timeZone||'UTC'}).formatToParts(date).find(part=>part.type==='hour')?.value;
    const parsed=Number(hour);
    return Number.isInteger(parsed)?parsed:null;
  }catch{return null;}
}
function localCalendarParts(value,context){
  const date=value instanceof Date?value:new Date(value);if(!Number.isFinite(date.getTime()))return null;
  try{const parts=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:context?.timeZone||'UTC'}).formatToParts(date);
    const read=type=>Number(parts.find(part=>part.type===type)?.value),year=read('year'),month=read('month'),day=read('day');
    return Number.isInteger(year)&&Number.isInteger(month)&&Number.isInteger(day)?Object.freeze({year,month,day}):null;}catch{return null;}
}
function isoWeek(value,context){
  const parts=localCalendarParts(value,context);if(!parts)return null;
  const localDate=new Date(Date.UTC(parts.year,parts.month-1,parts.day)),weekday=(localDate.getUTCDay()+6)%7;localDate.setUTCDate(localDate.getUTCDate()-weekday+3);
  const firstThursday=new Date(Date.UTC(localDate.getUTCFullYear(),0,4));firstThursday.setUTCDate(firstThursday.getUTCDate()-((firstThursday.getUTCDay()+6)%7)+3);
  return 1+Math.round((localDate-firstThursday)/604800000);
}
return Object.freeze({VERSION,resolve,formatMoney,formatDate,localHour,localCalendarParts,isoWeek,validLocale,validTimeZone,validCurrency});
});
