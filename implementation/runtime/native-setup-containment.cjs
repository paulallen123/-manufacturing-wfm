'use strict';
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const {assertCustomerWorkspaceSchema}=require('./customer-workspace.cjs');
const {assertImplementationRunSchema}=require('./implementation-run-schema.cjs');
const {assertSetupOnlySchema}=require('./setup-only-policy.cjs');
let factory=null,bound=false;
// Exact post-migration native foundation shapes from the pinned sealed server.
const foundationalObjects=[
  {
    "type": "index",
    "name": "kiosk_events_employee_time",
    "tbl_name": "kiosk_events",
    "sql": "CREATE INDEX kiosk_events_employee_time ON kiosk_events(employee,client_at)"
  },
  {
    "type": "table",
    "name": "audit_events",
    "tbl_name": "audit_events",
    "sql": "CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL)"
  },
  {
    "type": "table",
    "name": "kiosk_devices",
    "tbl_name": "kiosk_devices",
    "sql": "CREATE TABLE kiosk_devices(id TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),site TEXT NOT NULL,name TEXT NOT NULL,secret_hash TEXT NOT NULL UNIQUE,status TEXT NOT NULL,last_sequence INTEGER NOT NULL DEFAULT 0,last_seen INTEGER,created_by TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at INTEGER)"
  },
  {
    "type": "table",
    "name": "kiosk_events",
    "tbl_name": "kiosk_events",
    "sql": "CREATE TABLE kiosk_events(device_id TEXT NOT NULL REFERENCES kiosk_devices(id),event_id TEXT NOT NULL,sequence INTEGER NOT NULL,digest TEXT NOT NULL,employee TEXT NOT NULL,kind TEXT NOT NULL,client_at INTEGER NOT NULL,server_at INTEGER NOT NULL,result TEXT NOT NULL,PRIMARY KEY(device_id,event_id),UNIQUE(device_id,sequence))"
  },
  {
    "type": "table",
    "name": "onboarding_invites",
    "tbl_name": "onboarding_invites",
    "sql": "CREATE TABLE onboarding_invites(id TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),source_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires INTEGER NOT NULL,revoked_at INTEGER,used_at INTEGER,issued_by TEXT NOT NULL,created_at TEXT NOT NULL)"
  },
  {
    "type": "table",
    "name": "personnel_links",
    "tbl_name": "personnel_links",
    "sql": "CREATE TABLE personnel_links(email TEXT PRIMARY KEY REFERENCES users(email),tenant TEXT NOT NULL REFERENCES tenants(id),staff_id TEXT NOT NULL,status TEXT NOT NULL,linked_by TEXT NOT NULL,linked_at TEXT NOT NULL)"
  },
  {
    "type": "table",
    "name": "sessions",
    "tbl_name": "sessions",
    "sql": "CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL, issued_at INTEGER, last_seen INTEGER, source_hash TEXT, source_basis TEXT, source_authoritative INTEGER NOT NULL DEFAULT 0, client_hash TEXT)"
  },
  {
    "type": "table",
    "name": "tenants",
    "tbl_name": "tenants",
    "sql": "CREATE TABLE tenants(id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL)"
  },
  {
    "type": "table",
    "name": "users",
    "tbl_name": "users",
    "sql": "CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL, permissions TEXT NOT NULL DEFAULT '[]')"
  },
  {
    "type": "trigger",
    "name": "no_audit_delete",
    "tbl_name": "audit_events",
    "sql": "CREATE TRIGGER no_audit_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit events are append only.'); END"
  },
  {
    "type": "trigger",
    "name": "no_audit_update",
    "tbl_name": "audit_events",
    "sql": "CREATE TRIGGER no_audit_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit events are append only.'); END"
  }
];
const foundationalUnique={
  "audit_events": [],
  "kiosk_devices": [
    "id",
    "secret_hash"
  ],
  "kiosk_events": [
    "device_id,event_id",
    "device_id,sequence"
  ],
  "onboarding_invites": [
    "id",
    "token_hash"
  ],
  "personnel_links": [
    "email"
  ],
  "sessions": [
    "token_hash"
  ],
  "tenants": [
    "id"
  ],
  "users": [
    "email"
  ]
};
const foundation=['tenants','users','sessions','personnel_links','onboarding_invites','kiosk_devices','kiosk_events','audit_events'];
const register=['customer_workspaces','customer_workspace_contracts','customer_workspace_events','customer_workspace_adoptions','customer_workspace_orders','customer_workspace_order_revocations','customer_workspace_invitation_bindings','implementation_runs'];
const mode=['customer_workspace_runtime_state','customer_workspace_runtime_state_events'];
function denied(message,status,code){throw Object.assign(Error(message),{code,status,statusCode:status});}
function unavailable(){denied('Setup mode binding unavailable.',503,'SETUP_MODE_BINDING_UNAVAILABLE');}
const sessionDenied=()=>denied('Original session is no longer current. Sign in again.',401,'WFM_NATIVE_SESSION_REQUIRED');
const authorityChanged=()=>denied('Current request authority changed. Start a new request.',403,'WFM_NATIVE_AUTHORITY_CHANGED');
const anchorDenied=()=>denied('A current canonical principal anchor is required.',403,'WFM_NATIVE_PRINCIPAL_ANCHOR_REQUIRED');
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
function ownFields(input,keys){
  if(!input||typeof input!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(input)))unavailable();
  for(const key of Reflect.ownKeys(input)){const d=Object.getOwnPropertyDescriptor(input,key);if(typeof key!=='string'||!keys.includes(key)||!Object.hasOwn(d,'value')||!d.enumerable)unavailable();}
}
function synchronous(fn){return typeof fn==='function'&&fn.constructor?.name!=='AsyncFunction';}
function installNativeSetupFactory(input){
  ownFields(input,['initializeSchema','createReader']);
  if(factory||bound||!synchronous(input.initializeSchema)||!synchronous(input.createReader))unavailable();
  factory=Object.freeze({initializeSchema:input.initializeSchema,createReader:input.createReader});
}
function assertFoundations(db){
  if(Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys)!==1)unavailable();
  const normal=sql=>String(sql||'').replace(/IF NOT EXISTS /g,'').replace(/"([A-Za-z_][A-Za-z_0-9]*)"/g,'$1').replace(/\s+/g,'').replace(/;$/,'');
  for(const expected of foundationalObjects){
    const actual=db.prepare('SELECT sql,tbl_name FROM sqlite_master WHERE type=? AND name=?').get(expected.type,expected.name);
    if(!actual||actual.tbl_name!==expected.tbl_name||normal(actual.sql)!==normal(expected.sql))unavailable();
    if(expected.type==='table'){
      const unique=db.prepare('PRAGMA index_list('+expected.name+')').all().filter(i=>i.unique&&i.origin!=='c').map(i=>db.prepare('PRAGMA index_info('+JSON.stringify(i.name)+')').all().map(c=>c.name).join(',')).sort();
      if(JSON.stringify(unique)!==JSON.stringify(foundationalUnique[expected.name]))unavailable();
    }
  }
}
function assertFreshObjectInventory(db){
  for(const actual of db.prepare("SELECT type,name,tbl_name FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'").all())
    if(!foundationalObjects.some(expected=>actual.type===expected.type&&actual.name===expected.name&&actual.tbl_name===expected.tbl_name))unavailable();
}
function assertCanonical(db){assertFoundations(db);assertImplementationRunSchema({db});assertCustomerWorkspaceSchema({db});}
function bindNativeDatabase(input){
  ownFields(input,['db','requestSource','clientFingerprint']);
  if(bound)unavailable();bound=true;
  const {db,requestSource,clientFingerprint}=input;
  let reader=null,held=false;
  const requests=new WeakMap(),actors=new WeakMap();
  function latch(){held=true;reader=null;}
  function readOnly(){
    const result=factory.createReader({db});
    if(!result||result.then||Object.keys(result).sort().join(',')!=='assertAllowed,forTenant'||typeof result.forTenant!=='function'||typeof result.assertAllowed!=='function')unavailable();
    return result;
  }
  try{
    if(!(db instanceof DatabaseSync)||!factory||db.isTransaction||!synchronous(requestSource)||!synchronous(clientFingerprint))unavailable();
    // The native callbacks close over later native definitions. Do not invoke
    // requestSource/clientFingerprint while binding schema before startup.
    assertFoundations(db);
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'").all().map(x=>x.name)),present=register.filter(x=>tables.has(x)),modes=mode.filter(x=>tables.has(x));
    const fresh=present.length===0&&modes.length===0;
    if(fresh){
      assertFreshObjectInventory(db);
      if([...tables].some(x=>!foundation.includes(x))||foundation.some(table=>db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n!==0))unavailable();
    }else{
      if(present.length!==register.length||modes.length===1)unavailable();
      assertCanonical(db);
      // An intact existing mode schema is read, never repaired. Missing trigger,
      // FK or constraints fail here before a DDL helper could restore them.
      if(modes.length===2)reader=readOnly();
    }
    if(!reader){
      db.exec('BEGIN IMMEDIATE');try{
        const result=factory.initializeSchema(db);if(result?.then)unavailable();
        assertCanonical(db);reader=readOnly();db.exec('COMMIT');
      }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
    }
  }catch{latch();console.error('WFM_NATIVE_SETUP_CONTAINMENT_HELD=SETUP_MODE_BINDING_UNAVAILABLE');}
  function currentSchema(){
    if(held||!reader)unavailable();
    try{assertCanonical(db);assertSetupOnlySchema({db});}catch{latch();unavailable();}
  }
  function assertOperationalTenant(tenant){
    currentSchema();try{return reader.assertAllowed({tenant,purpose:'NATIVE_OPERATIONAL'});}
    catch(error){if(Number.isInteger(error.statusCode))error.status=error.statusCode;throw error;}
  }
  function canSeedUnmanagedDemo(tenant){
    if(!['northstar-demo','isolation-test'].includes(tenant))return false;
    try{currentSchema();return reader.forTenant(tenant).classification==='UNMANAGED_LEGACY';}catch{return false;}
  }
  function permissions(value){
    if(!Array.isArray(value)||value.some(p=>typeof p!=='string'))authorityChanged();
    return [...new Set(value)].sort();
  }
  function authorityKey(actor){
    if(!actor||typeof actor!=='object'||typeof actor.email!=='string'||typeof actor.tenant!=='string'||typeof actor.personId!=='string'||typeof actor.role!=='string'||typeof actor.costs!=='boolean'||!(actor.personnelId===null||typeof actor.personnelId==='string'))authorityChanged();
    return JSON.stringify([actor.email,actor.tenant,actor.personId,actor.personnelId,actor.role,actor.costs,permissions(actor.permissions)]);
  }
  function cookieHash(req){
    const token=String(req?.headers?.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('wfm_session='))?.split('=')[1];
    if(!token)sessionDenied();return hash(token);
  }
  function context(req){
    let source,client;try{source=requestSource(req);client=clientFingerprint(req);}catch{sessionDenied();}
    if(!source||source.then||typeof source.identity!=='string'||!source.identity||typeof source.basis!=='string'||typeof source.containmentEligible!=='boolean'||typeof client!=='string'||!client)sessionDenied();
    return Object.freeze({cookieHash:cookieHash(req),sourceHash:hash(source.identity).slice(0,24),basis:source.basis,authoritative:source.containmentEligible,client,method:String(req.method||''),url:String(req.url||'')});
  }
  function subject(token){
    let row;try{row=db.prepare(`SELECT u.email,u.tenant,u.person_id,u.role,u.costs,u.permissions,
      pl.staff_id AS personnel_id,pl.tenant AS personnel_tenant,
      s.expires AS session_expires,s.issued_at AS session_issued_at,s.source_hash AS session_source_hash,
      s.source_basis AS session_source_basis,s.source_authoritative AS session_source_authoritative,s.client_hash AS session_client_hash
      FROM sessions s JOIN users u ON u.email=s.email LEFT JOIN personnel_links pl ON pl.email=u.email AND pl.status='active'
      WHERE s.token_hash=?`).get(token);}catch{unavailable();}
    if(!row||!Number.isSafeInteger(row.session_expires)||row.session_expires<=Date.now())sessionDenied();
    if(![0,1].includes(row.costs)||!['string'].includes(typeof row.role)||(row.personnel_id!==null&&row.personnel_tenant!==row.tenant))authorityChanged();
    let list;try{list=JSON.parse(row.permissions);}catch{authorityChanged();}
    const actor={email:row.email,tenant:row.tenant,personId:row.person_id,personnelId:row.personnel_id||null,role:row.role,costs:row.costs===1,permissions:list};
    return {row,authorityKey:authorityKey(actor),sessionKey:JSON.stringify([row.session_expires,row.session_issued_at,row.session_source_hash,row.session_source_basis,row.session_source_authoritative,row.session_client_hash])};
  }
  function captureRequestActor(req,actor){
    if(!req||typeof req!=='object'||requests.has(req)||actors.has(actor))authorityChanged();
    const originalContext=context(req),current=subject(originalContext.cookieHash),key=authorityKey(actor);
    if(key!==current.authorityKey)authorityChanged();
    if(current.row.session_client_hash!==originalContext.client||
      (originalContext.authoritative&&(current.row.session_source_hash!==originalContext.sourceHash||current.row.session_source_basis!==originalContext.basis||current.row.session_source_authoritative!==1)))sessionDenied();
    const binding=Object.freeze({req,actor,originalContext,contextKey:JSON.stringify(originalContext),authorityKey:key,sessionKey:current.sessionKey});
    requests.set(req,binding);actors.set(actor,binding);return actor;
  }
  function checkBinding(binding){
    if(!binding)sessionDenied();
    // Always resolve the captured bearer, never a replacement cookie/session.
    const current=subject(binding.originalContext.cookieHash);
    if(current.authorityKey!==binding.authorityKey||authorityKey(binding.actor)!==binding.authorityKey)authorityChanged();
    if(current.sessionKey!==binding.sessionKey||JSON.stringify(context(binding.req))!==binding.contextKey)sessionDenied();
    return binding.actor;
  }
  function assertRequestCurrent(req){return checkBinding(requests.get(req));}
  function assertCapturedRequestCurrent(req){const binding=requests.get(req);if(binding)return checkBinding(binding);}
  function assertActorCurrent(actor){return checkBinding(actors.get(actor));}
  function graph(state){
    if(!state||!Array.isArray(state.org)||!Array.isArray(state.staff))anchorDenied();
    const identifier=x=>typeof x==='string'&&x.length>0&&x===x.trim(),nodes=new Map(),staff=new Map();
    for(const node of state.org){if(!node||!identifier(node.id)||nodes.has(node.id)||!(node.parent===null||identifier(node.parent)))anchorDenied();nodes.set(node.id,node);}
    for(const node of nodes.values()){
      const seen=new Set();let current=node;while(current){if(seen.has(current.id))anchorDenied();seen.add(current.id);if(current.parent===null)break;current=nodes.get(current.parent);if(!current)anchorDenied();}
    }
    for(const person of state.staff){if(!person||!identifier(person.id)||staff.has(person.id)||!identifier(person.manager)||!nodes.has(person.manager))anchorDenied();staff.set(person.id,person);}
    return {nodes,staff,key:JSON.stringify([[...nodes.values()].map(n=>[n.id,n.parent]).sort((a,b)=>a[0].localeCompare(b[0])),[...staff.values()].map(p=>[p.id,p.manager]).sort((a,b)=>a[0].localeCompare(b[0]))])};
  }
  function assertPrincipalAnchor(actor,state){
    // This checks the graph only; it never grants a session, role or permission.
    // Non-native consumers retain their own current source identity contract.
    if(!actor||typeof actor.email!=='string'||typeof actor.tenant!=='string'||typeof actor.personId!=='string'||!actor.personId||actor.personId!==actor.personId.trim())anchorDenied();
    let user,row,current;try{
      user=db.prepare('SELECT email,tenant,person_id,role FROM users WHERE email=? AND tenant=?').get(actor.email,actor.tenant);
      row=db.prepare('SELECT version,state FROM tenants WHERE id=?').get(actor.tenant);current=JSON.parse(row?.state);
    }catch{anchorDenied();}
    if(!user||user.person_id!==actor.personId||user.role!==actor.role||!Number.isSafeInteger(row.version)||state?.version!==row.version||current?.version!==row.version)anchorDenied();
    const canonical=graph(current),candidate=graph(state);if(candidate.key!==canonical.key)anchorDenied();
    if(actor.role==='employee'){if(!canonical.staff.has(actor.personId))anchorDenied();}
    else if(!canonical.nodes.has(actor.personId))anchorDenied();
  }
  return Object.freeze({assertOperationalTenant,canSeedUnmanagedDemo,captureRequestActor,assertRequestCurrent,assertCapturedRequestCurrent,assertActorCurrent,assertPrincipalAnchor});
}
module.exports={installNativeSetupFactory,bindNativeDatabase};
