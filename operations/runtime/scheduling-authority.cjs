'use strict';

const {createHash}=require('node:crypto');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function deny(message='Current scheduling authority is unavailable.'){const error=new Error(message);error.statusCode=403;throw error;}
function identifier(value){return typeof value==='string'&&value.length>0&&value===value.trim();}
function validateState(state,version){
 if(!state||Array.isArray(state)||!Number.isSafeInteger(version)||state.version!==version||!Array.isArray(state.org)||!Array.isArray(state.staff))deny();
 const nodes=new Map();for(const node of state.org){if(!node||!identifier(node.id)||nodes.has(node.id)||!(node.parent===null||identifier(node.parent)))deny('Current reporting hierarchy is invalid.');nodes.set(node.id,node);}
 for(const node of nodes.values()){const seen=new Set();let current=node;while(current){if(seen.has(current.id))deny('Current reporting hierarchy contains a cycle.');seen.add(current.id);if(current.parent===null)break;current=nodes.get(current.parent);if(!current)deny('Current reporting hierarchy has an unknown parent.');}}
 const staff=new Map();for(const person of state.staff){if(!person||!identifier(person.id)||staff.has(person.id)||!nodes.has(person.manager)||!identifier(person.site))deny('Current personnel hierarchy is invalid.');staff.set(person.id,person);}
 return {nodes,staff};
}
function branchFor(req,body){
 const query=new URL(String(req?.url||'/'),'http://wfm.invalid').searchParams,values=[];
 for(const key of ['scope','branch']){if(query.getAll(key).length>1)deny('Reporting branch must be a single string.');if(query.has(key))values.push(query.get(key));for(const source of [body,body?.input])if(source&&Object.hasOwn(source,key))values.push(source[key]);}
 if(values.some(x=>!identifier(x))||values.some(x=>x!==values[0]))deny('Reporting branch must be a single string.');return values[0]||null;
}
function workerReferences(value){const ids=new Set();function visit(x){if(!x||typeof x!=='object')return;for(const [key,v] of Object.entries(x)){if(['workerId','employee'].includes(key)){if(v!==null){if(!identifier(v))deny('Personnel reference is invalid.');ids.add(v);}}else if(['workerIds','lockedWorkerIds','unavailableWorkerIds'].includes(key)){if(!Array.isArray(v)||v.some(id=>!identifier(id)))deny('Personnel references are invalid.');v.forEach(id=>ids.add(id));}else visit(v);}}visit(value);return ids;}
function redactFinancial(value){
 const financialKey=/(?:cost|premium|penalty|margin|price|salary|wage|payrate|hourlyrate|hourlycost|overtimemultiplier|financial|objective|score|revenue|profit|budget)/i;
 const opaque=new Set(['provenance','attendanceProvenance','sourceEvidence','evidenceRefs']);
 function clean(x){if(Array.isArray(x))return x.map(clean).filter(v=>v!==undefined);if(x&&typeof x==='object'){const out={};for(const [key,v] of Object.entries(x))if(!financialKey.test(key)&&!opaque.has(key)){const result=clean(v);if(result!==undefined)out[key]=result;}return out;}if(typeof x==='string'&&/(?:[$£€]|(?:^|[^a-z])(?:cost|salary|wage|premium|penalty|margin|financial|profit|revenue|savings?|expense|remuneration)(?:$|[^a-z]))/i.test(x))return undefined;return x;}
 return clean(value);
}
function createSchedulingAuthority({db,nativeHelpers}={}){
 let principal,stored;
 function helpers(){if(nativeHelpers)return nativeHelpers;try{return {allowedPeople:require('../public/engine.js').allowedPeople,descendants:require('../public/engine.js').descendants,approvedSite:require('../public/operations-engine.js').approvedSite};}catch{deny('Native scheduling authority is unavailable.');}}
 function readContext(context,branch=null){
  try{principal??=db.prepare('SELECT email,tenant,role,person_id,costs,permissions FROM users WHERE email=? AND tenant=?');stored??=db.prepare('SELECT version,state FROM tenants WHERE id=?');}catch{deny();}
  const user=context&&principal.get(context.email,context.tenant);if(!user||user.email!==context.email||user.tenant!==context.tenant||user.role!==context.role||!['manager','director','supervisor'].includes(String(user.role).toLowerCase())||!identifier(user.person_id)||![0,1].includes(user.costs))deny();
  let permissions,state;const row=stored.get(user.tenant);try{permissions=JSON.parse(user.permissions);state=JSON.parse(row.state);}catch{deny();}if(!Array.isArray(permissions))deny();const {nodes,staff}=validateState(state,row.version);if(!nodes.has(user.person_id)||branch!==null&&!identifier(branch))deny();
  const native=helpers();if(typeof native.allowedPeople!=='function'||typeof native.descendants!=='function'||typeof native.approvedSite!=='function')deny();
  const actor=Object.freeze({email:user.email,tenant:user.tenant,role:user.role,personId:user.person_id,costs:user.costs===1,permissions:Object.freeze(permissions.slice())});
  let people,departments;try{people=native.allowedPeople(state,actor,branch||undefined);departments=native.descendants(state.org,branch||actor.personId);}catch{deny('Reporting branch is outside current authority.');}
  const allowed=new Set(people.map(p=>p.id));return {actor,state,version:row.version,nodes,staff,allowed,departments,native,branch,fence:digest([user,row.version,row.state,branch])};
 }
 function worker(context,id){if(!identifier(id)||!context.allowed.has(id)||!context.staff.has(id))deny('Personnel is outside current reporting authority.');return context.staff.get(id);}
 function destination(context,requirement,people){
  if(!requirement||!identifier(requirement.site))deny('Destination site is unavailable.');
  let department=requirement.department;if(department===undefined){const managers=new Set(people.map(id=>worker(context,id).manager));if(managers.size===1)department=[...managers][0];}
  const node=context.nodes.get(department);if(!identifier(department)||!node||node.role!=='Team leader'||!context.departments.has(department))deny('Destination department is outside current reporting authority.');
  if(![...context.staff.values()].some(p=>p.site===requirement.site))deny('Destination site is unavailable.');return department;
 }
 function assertDepartmentSite(context,department,site){
  destination(context,{department,site},[]);
  if(![...context.staff.values()].some(person=>person.manager===department&&person.site===site&&context.allowed.has(person.id)))deny('Department and site are outside current reporting authority.');
 }
 function approvedFor(context,id,requirement){
  const person=worker(context,id);if(person.site===requirement.site)return true;
  const start=Date.parse(requirement.start),end=Date.parse(requirement.end);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return false;
  const grants=context.state.operations?.siteAccess?.[id],validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
  const grant=Array.isArray(grants)&&grants.some(g=>g?.site===requirement.site&&g.approved===true&&validDate(g.validFrom)&&validDate(g.validUntil)&&g.validFrom<=new Date(start).toISOString().slice(0,10)&&g.validUntil>=new Date(end).toISOString().slice(0,10));
  let approved=false;try{approved=context.native.approvedSite(context.state,id,requirement.site,requirement.end,requirement.start);}catch{}return !!grant&&approved===true;
 }
 function assertInput(context,input,mode){
  if(!input||typeof input!=='object'||Array.isArray(input))deny('Scheduling scenario is invalid.');
  const workers=mode==='swap'?[input.workerA,input.workerB]:input.workers||[];if(!Array.isArray(workers))deny();const ids=new Set();for(const row of workers){const person=worker(context,row?.id);if(ids.has(person.id))deny('Duplicate scenario personnel.');ids.add(person.id);if(row.homeSite!==undefined&&row.homeSite!==person.site||row.site!==undefined&&row.site!==person.site)deny('Worker home site does not match current personnel.');}
  for(const id of workerReferences(input))worker(context,id);for(const id of Object.values(input.preferredAssignments||{}))worker(context,id);
  for(const assignment of input.currentAssignments||[])if(assignment.workerId&&(assignment.site!==undefined||assignment.department!==undefined)){const person=worker(context,assignment.workerId),target={...assignment,site:assignment.site??person.site};destination(context,target,[person.id]);if(!approvedFor(context,person.id,target))deny('Current approved cross-site access is required.');}
  const requirements=mode==='swap'?[input.requirementA,input.requirementB]:mode==='open'?[input.requirement]:input.requirements||[];if(!Array.isArray(requirements))deny();
  const scope=requirements.map(r=>({requirementId:r?.id,department:destination(context,r,[...ids]),site:r.site,start:r.start,end:r.end}));
  const canonical=workers.map(row=>({...row,homeSite:worker(context,row.id).site,eligibleSites:[...new Set([worker(context,row.id).site,...requirements.filter(r=>approvedFor(context,row.id,r)).map(r=>r.site)])]}));
  for(const r of requirements)if(workers.length&&!canonical.some(w=>w.eligibleSites.includes(r.site)))deny('Current approved cross-site access is required.');
  if(mode==='swap'&&(!approvedFor(context,workers[0].id,requirements[1])||!approvedFor(context,workers[1].id,requirements[0])))deny('Current approved cross-site access is required.');
  const canonicalInput={...input,requirements:input.requirements?.map(r=>({...r,department:scope.find(x=>x.requirementId===r.id)?.department}))};if(mode==='swap'){canonicalInput.workerA=canonical[0];canonicalInput.workerB=canonical[1];}else canonicalInput.workers=canonical;
  return {workerIds:[...new Set([...ids,...workerReferences(input)])].sort(),requirements:scope,input:canonicalInput};
 }
 function bindPlan(plan,input,previousScope){
  const raw=input?.requirements||[],requirements=plan.requirements.map(r=>{const source=raw.find(x=>x.id===r.id),prior=previousScope?.requirements?.find(x=>x.requirementId===r.id);return {requirementId:r.id,department:source?.department??prior?.department??null,site:r.site,start:r.start,end:r.end};});
  const workers=new Map((previousScope?.workers||[]).map(w=>[w.id,w]));for(const w of input?.workers||[]){const homeSite=w.homeSite||w.site;workers.set(w.id,{id:w.id,homeSite,eligibleSites:Array.isArray(w.eligibleSites)&&w.eligibleSites.length?w.eligibleSites.slice():[homeSite]});}
  const workerIds=[...new Set([...workers.keys(),...workerReferences(input||{}),...(previousScope?.workerIds||[])])].sort();const authorityScope={schema:'CURRENT_NATIVE_HIERARCHY_V1',workerIds,workers:[...workers.values()].sort((a,b)=>String(a.id).localeCompare(String(b.id))),requirements};return {...plan,authorityScope,planId:digest([plan.planId,authorityScope])};
 }
 function assertPlan(context,plan){
  const scope=plan?.authorityScope;if(plan?.tenant!==context.actor.tenant||scope?.schema!=='CURRENT_NATIVE_HIERARCHY_V1'||!Array.isArray(scope.workerIds)||!Array.isArray(scope.workers)||!Array.isArray(scope.requirements)||!Array.isArray(plan.requirements)||!scope.workerIds.length||scope.requirements.length!==plan.requirements.length)deny('Stored plan destination authority is unavailable.');
  if(plan.requirements.some(r=>!identifier(r?.id))||scope.requirements.some(r=>!identifier(r?.requirementId))||(plan.assignments||[]).some(a=>!identifier(a?.requirementId)))deny('Stored plan destination authority is unavailable.');
  for(const id of new Set([...scope.workerIds,...workerReferences(plan)]))worker(context,id);
  const candidates=new Map();for(const w of scope.workers){if(candidates.has(w.id)||!scope.workerIds.includes(w.id)||w.homeSite!==worker(context,w.id).site||!Array.isArray(w.eligibleSites)||w.eligibleSites.some(site=>!identifier(site)))deny();candidates.set(w.id,w);}
  const seen=new Set();for(const r of plan.requirements){const items=scope.requirements.filter(x=>x.requirementId===r.id);if(seen.has(r.id)||items.length!==1)deny();seen.add(r.id);const item=items[0];if(item.site!==r.site||item.start!==r.start||item.end!==r.end)deny();destination(context,{...r,department:item.department},scope.workerIds);const eligible=[...candidates.values()].filter(w=>w.eligibleSites.includes(r.site));if(r.headcount>0&&!eligible.length)deny();for(const w of eligible)if(!approvedFor(context,w.id,r))deny('Current approved cross-site access is required.');for(const assignment of plan.assignments||[])if(assignment.requirementId===r.id){if(assignment.site!==r.site||assignment.start!==r.start||assignment.end!==r.end)deny('Stored assignment authority is unavailable.');if(assignment.workerId&&(!candidates.get(assignment.workerId)?.eligibleSites.includes(r.site)||!approvedFor(context,assignment.workerId,r)))deny();}}
  for(const assignment of plan.assignments||[])if(!seen.has(assignment?.requirementId))deny('Stored assignment authority is unavailable.');
  return true;
 }
 function publicProjection(value){
  if(Array.isArray(value))return value.map(publicProjection);
  if(value&&typeof value==='object'){const result={};for(const [key,child] of Object.entries(value))if(key!=='authorityScope')result[key]=publicProjection(child);return result;}
  return value;
 }
 function output(context,value){const projected=publicProjection(value);return context.actor.costs?projected:redactFinancial(projected);}
 return {readContext,assertInput,assertDepartmentSite,bindPlan,assertPlan,worker,output};
}
module.exports={createSchedulingAuthority,branchFor,redactFinancial,workerReferences};
