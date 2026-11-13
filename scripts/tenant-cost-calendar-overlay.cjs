'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const periodOld="const live=asOf||runtimeNow(),end=asOf?localDay(live):runtimeDate(),d=new Date(end+'T12:00:00Z');let start=end,previousStart;";
const periodNew="const live=asOf||runtimeNow(),parts=asOf?Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:requireCalendar().timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(live)).filter(part=>part.type!=='literal').map(part=>[part.type,part.value])):null,end=parts?parts.year+'-'+parts.month+'-'+parts.day:runtimeDate(),d=new Date(end+'T12:00:00Z');let start=end,previousStart;";
const costHeader="const HOUR=3600000, MIN=60000, NOW=E.AS_OF, SNAP='2026-09-14';";
const dateOld="const dayFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'});\nconst timeFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',hour12:false});\nconst localDay=t=>dayFmt.format(new Date(t));";
const dateNew="const timeFmt={format:value=>new Intl.DateTimeFormat('en-GB',{timeZone:requireCalendar().timeZone,hour:'2-digit',hourCycle:'h23'}).format(value)};\nconst localDay=t=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:requireCalendar().timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(t)).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));return parts.year+'-'+parts.month+'-'+parts.day;};";
const resolverOld="function london(value){if(localCache.size>10000)localCache.clear();if(!localCache.has(value))localCache.set(value,E.resolveLondon(value));return localCache.get(value);}";
const resolverNew="function london(value){const zone=requireCalendar().timeZone,key=zone+'|'+value;if(localCache.size>10000)localCache.clear();if(!localCache.has(key)){if(typeof module!=='undefined'&&module.exports)localCache.set(key,localResolve(value));else{const rules=root.WFMWorkRules;assert(rules&&typeof rules.localResolve==='function','Tenant local-time resolver unavailable.');localCache.set(key,rules.localResolve(value));}}return localCache.get(key);}";

const reviewedBrowserCalendarSha256='1aa6152f12d9ee0744414e69c0cbcd24511a0d48b289cb988ac26640a8c155c3';
const reviewedResolverSha256='686e16fd524506871ece40b817d3ca75f6d4822d54f22896688f6ecf31ff97f9';
const timeOK="const timeOK=t=>typeof t==='string'&&/^([01]\\d|2[0-3]):[0-5]\\d$/.test(t);";
const validDate="const validDate=d=>typeof d==='string'&&/^\\d{4}-\\d{2}-\\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T12:00Z'))&&new Date(d+'T12:00Z').toISOString().slice(0,10)===d;";
function exactCostResolver(rules,cost){
 const start='const localOffsetCache=new Map();',end='const infoFmt=zone=>';
 if(rules.split(start).length!==2||rules.split(end).length!==2)throw Error('V026_RESOLVER_SOURCE_BOUNDARY_CHANGED');
 const body=rules.slice(rules.indexOf(start),rules.indexOf(end));
 if(crypto.createHash('sha256').update(body).digest('hex')!==reviewedResolverSha256)throw Error('V026_RESOLVER_SOURCE_DIGEST_CHANGED');
 if(rules.split(timeOK).length!==2||rules.split(validDate).length!==2||cost.split(validDate).length!==2)throw Error('V026_RESOLVER_VALIDATORS_CHANGED');
 if(rules.split("const DAY=86400000,HOUR=3600000,MIN=60000,CHECKED='2026-09-14';").length!==2||cost.split(costHeader).length!==2||rules.split("const clone=x=>JSON.parse(JSON.stringify(x)),assert=E.assert,stamp=E.stamp,round=").length!==2||cost.split("const assert=E.assert, r=E.round, copy=x=>JSON.parse(JSON.stringify(x));").length!==2)throw Error('V026_RESOLVER_HELPERS_CHANGED');
 return timeOK+'\n'+body;
}

function replaceOnce(s,old,next,label){if(s.split(old).length!==2)throw Error('V026_TIMEZONE_ANCHOR_CHANGED:'+label);return s.replace(old,next);}
function patchProposal(runtime,browserCalendar){
 if(crypto.createHash('sha256').update(browserCalendar).digest('hex')!==reviewedBrowserCalendarSha256)throw Error('V026_CALENDAR_HELPER_DIGEST_CHANGED');
 const engine=path.join(runtime,'public/engine.js');fs.writeFileSync(engine,replaceOnce(fs.readFileSync(engine,'utf8'),periodOld,periodNew,'period-end'));
 const cost=path.join(runtime,'public/cost-engine.js');let text=fs.readFileSync(cost,'utf8');
 text=replaceOnce(text,costHeader,costHeader+'\n'+browserCalendar,'cost-calendar');
 text=replaceOnce(text,dateOld,dateNew,'cost-projection');const resolver=exactCostResolver(fs.readFileSync(path.join(runtime,'public/work-rules.js'),'utf8'),text);text=replaceOnce(text,resolverOld,resolver+resolverNew,'cost-resolver');fs.writeFileSync(cost,text);
}
module.exports={patchProposal,periodOld,periodNew,costHeader,dateOld,dateNew,resolverOld,resolverNew,exactCostResolver,reviewedResolverSha256,reviewedBrowserCalendarSha256,timeOK,validDate};
