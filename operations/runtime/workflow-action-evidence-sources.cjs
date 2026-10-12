'use strict';

// These callbacks are server-owned reads. They do not accept request-supplied
// source bodies, call actor(req), replay sessions, decorate missing operational
// state, infer observations, or create permission/confirmation authority.
function createWorkflowActionEvidenceSourceReaders({db,reviewDashboard,sanitise,tenantCalendar}={}){
 if(!db||typeof db.prepare!=='function'||typeof reviewDashboard!=='function'||typeof sanitise!=='function'||typeof tenantCalendar?.periodForState!=='function')throw new TypeError('Trusted workflow source dependencies are required.');
 const principal=db.prepare('SELECT email,tenant,role,person_id,costs,permissions FROM users WHERE email=? AND tenant=?');
 const stored=db.prepare('SELECT version,state FROM tenants WHERE id=?');
 const fail=message=>{throw new Error(message);};
 function readContext(ctx){
  const user=ctx&&principal.get(ctx.email,ctx.tenant);
  if(!user||user.tenant!==ctx.tenant||user.email!==ctx.email||user.role!==ctx.role||!['manager','director','supervisor'].includes(user.role)||typeof user.person_id!=='string'||!user.person_id)fail('Current workflow principal authority is unavailable.');
  let permissions;try{permissions=JSON.parse(user.permissions);}catch{fail('Current principal permissions are unavailable.');}
  if(!Array.isArray(permissions))fail('Current principal permissions are unavailable.');
  const snapshot=stored.get(user.tenant);let state;
  try{state=JSON.parse(snapshot.state);}catch{fail('Current workflow source state is unavailable.');}
  if(!state||!Number.isSafeInteger(snapshot.version)||state.version!==snapshot.version)fail('Current workflow source revision is unavailable.');
  if(!Array.isArray(state.org)||!state.org.some(row=>row?.id===user.person_id))fail('Current principal reporting access is unavailable.');
  const actor=Object.freeze({email:user.email,tenant:user.tenant,role:user.role,personId:user.person_id,costs:!!user.costs,permissions:Object.freeze(permissions.slice())});
  return {state,actor,version:snapshot.version};
 }
 function period(req,state,actor){
  const query=new URL(String(req?.url||'/'),'http://wfm.invalid').searchParams;
  const explicit=query.get('period');let id=explicit;
  if(!id){const person=state.staff?.find(row=>row?.id===actor.personId);id=tenantCalendar.periodForState(state,{tenant:actor.tenant,site:person?.site||null})?.period?.id;}
  if(typeof id!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(id)||!Number.isFinite(Date.parse(id+'T00:00:00Z'))||new Date(id+'T00:00:00Z').toISOString().slice(0,10)!==id||!Array.isArray(state.payrollControl?.periods)||!state.payrollControl.periods.some(p=>p?.id===id))fail('Current canonical workflow period is unavailable.');
  return id;
 }
 function weekly(req,ctx,workflow){const {state,actor,version}=readContext(ctx);const id=period(req,state,actor);const report=reviewDashboard(state,actor,id);return {status:200,body:{...report,workflow,tenant:actor.tenant,version}};}
 return Object.freeze({
  timeReviewSourceProvider:(req,ctx)=>weekly(req,ctx,'time-review'),
  weeklySignoffSourceProvider:(req,ctx)=>weekly(req,ctx,'weekly-signoff'),
  absenceSourceProvider:(_req,ctx)=>{const {state,actor,version}=readContext(ctx);return {status:200,body:{workflow:'absence',tenant:actor.tenant,version,actor,state:sanitise(state,actor)}};}
 });
}
module.exports=Object.freeze({createWorkflowActionEvidenceSourceReaders});
