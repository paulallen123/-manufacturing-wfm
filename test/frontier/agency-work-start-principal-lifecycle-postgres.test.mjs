import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import {AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL} from '../../src/frontier/agency-right-to-work-assurance-ledger.mjs';
import {AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL} from '../../src/frontier/agency-portal-token-store.mjs';
import {AGENCY_IDENTITY_CONTINUITY_DDL} from '../../src/frontier/agency-identity-continuity.mjs';
import {AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL} from '../../src/frontier/agency-identity-observation-ingress.mjs';
import {AGENCY_IDENTITY_DB_BOUNDARY_DDL} from '../../src/frontier/agency-identity-db-boundary.mjs';
import {AGENCY_WORK_START_CANONICAL_MIGRATION_DDL} from '../../src/frontier/agency-work-start-principal-lifecycle.mjs';

const execFileAsync=promisify(execFile);
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const CONTAINER=`wfm-agency-work-start-principal-lifecycle-${process.pid}-${Date.now()}`;
const DB_USER='postgres',DB_NAME='postgres',DB_PASSWORD='agency-work-start-principal-lifecycle-proof-only-not-a-secret';
let started=false;

async function docker(args,options={}){return execFileAsync('docker',args,{maxBuffer:8*1024*1024,timeout:options.timeout??30000,encoding:'utf8'});}
async function psql(sql,options={}){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-A','-t','-c',sql],options);return stdout.trim();}
async function waitForPostgres(){for(let i=0;i<80;i+=1){try{if((await psql('SELECT 1;',{timeout:3000}))==='1')return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('postgres did not become ready');}
async function stop(){if(!started)return;try{await docker(['rm','-f',CONTAINER],{timeout:10000});}catch{}started=false;}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assignment=crypto.createHash('sha256').update('principal-lifecycle-assignment').digest('hex').slice(0,24);
const adminSql=sql=>`BEGIN; SET LOCAL ROLE wfm_agency_work_start_tenant_binding_admin; ${sql} COMMIT;`;
const runtimeAuthoritySql=(principal,tenant)=>`SET SESSION AUTHORIZATION ${principal}; BEGIN; SET LOCAL ROLE wfm_agency_work_start_reader; SELECT count(*) FROM public.wfm_read_agency_work_start_authority_v1('${tenant}','S_ROT','R_ROT','A_ROT','W_ROT','${assignment}','2026-10-05T06:10:00Z'); COMMIT;`;
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}

before(async()=>{
  if(!REQUIRED)return;
  try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for work-start principal lifecycle proof: ${error.message}`);}
  await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();
  await psql(`${AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL}\n${AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL}\n${AGENCY_IDENTITY_CONTINUITY_DDL}\n${AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL}\n${AGENCY_IDENTITY_DB_BOUNDARY_DDL}\n${AGENCY_WORK_START_CANONICAL_MIGRATION_DDL}`);
  await psql(`
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='wfm_work_start_runtime_rotate_old') THEN
    CREATE ROLE wfm_work_start_runtime_rotate_old LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='wfm_work_start_runtime_rotate_new') THEN
    CREATE ROLE wfm_work_start_runtime_rotate_new LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='wfm_work_start_runtime_race_old') THEN
    CREATE ROLE wfm_work_start_runtime_race_old LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$roles$;
GRANT wfm_agency_work_start_reader TO wfm_work_start_runtime_rotate_old,wfm_work_start_runtime_rotate_new,wfm_work_start_runtime_race_old;
`);
  await psql(adminSql(`SELECT public.wfm_bind_agency_work_start_principal_v1('wfm_work_start_runtime_rotate_old','T_ROT','${'1'.repeat(24)}');`));
  await psql(adminSql(`SELECT public.wfm_bind_agency_work_start_principal_v1('wfm_work_start_runtime_race_old','T_RACE','${'2'.repeat(24)}');`));
});
after(async()=>{await stop();});

pgTest('binding admin is function-only and runtime principals cannot call lifecycle administration functions',async()=>{
  for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']){
    assert.equal(await psql(`SELECT has_table_privilege('wfm_agency_work_start_tenant_binding_admin','public.wfm_agency_work_start_principal_tenants','${privilege}');`),'f');
  }
  assert.equal(await psql("SELECT has_function_privilege('wfm_agency_work_start_tenant_binding_admin','public.wfm_bind_agency_work_start_principal_v1(name,text,text)','EXECUTE');"),'t');
  assert.equal(await psql("SELECT has_function_privilege('wfm_agency_work_start_tenant_binding_admin','public.wfm_revoke_agency_work_start_principal_v1(name,text,text)','EXECUTE');"),'t');
  assert.equal(await psql("SELECT has_function_privilege('wfm_agency_work_start_reader','public.wfm_bind_agency_work_start_principal_v1(name,text,text)','EXECUTE');"),'f');
  assert.equal(await psql("SELECT has_function_privilege('wfm_agency_work_start_reader','public.wfm_revoke_agency_work_start_principal_v1(name,text,text)','EXECUTE');"),'f');
  await assert.rejects(()=>psql(adminSql("UPDATE public.wfm_agency_work_start_principal_tenants SET tenant_id='T_OTHER' WHERE database_principal='wfm_work_start_runtime_rotate_old';")),/permission denied/i);
});

pgTest('revoked credential cannot be rebound to another tenant and rotation uses a fresh principal',async()=>{
  assert.equal(await psql(runtimeAuthoritySql('wfm_work_start_runtime_rotate_old','T_ROT')),'0');
  await psql(adminSql(`SELECT public.wfm_revoke_agency_work_start_principal_v1('wfm_work_start_runtime_rotate_old','T_ROT','${'3'.repeat(24)}');`));
  await assert.rejects(()=>psql(runtimeAuthoritySql('wfm_work_start_runtime_rotate_old','T_ROT')),/work_start_tenant_principal_revoked/i);
  await assert.rejects(()=>psql(adminSql(`SELECT public.wfm_bind_agency_work_start_principal_v1('wfm_work_start_runtime_rotate_old','T_OTHER','${'4'.repeat(24)}');`)),/work_start_principal_already_bound/i);

  await psql(adminSql(`SELECT public.wfm_bind_agency_work_start_principal_v1('wfm_work_start_runtime_rotate_new','T_ROT','${'5'.repeat(24)}');`));
  assert.equal(await psql(runtimeAuthoritySql('wfm_work_start_runtime_rotate_new','T_ROT')),'0');
  await assert.rejects(()=>psql(runtimeAuthoritySql('wfm_work_start_runtime_rotate_new','T_OTHER')),/work_start_tenant_principal_unauthorized/i);
});

pgTest('revoke-first race blocks the work-start read then fails the old pooled principal closed',async()=>{
  const revokePromise=psql(adminSql(`SELECT public.wfm_revoke_agency_work_start_principal_v1('wfm_work_start_runtime_race_old','T_RACE','${'6'.repeat(24)}'); SELECT pg_sleep(1);`),{timeout:5000});
  await delay(150);
  const startedAt=Date.now();
  await assert.rejects(()=>psql(runtimeAuthoritySql('wfm_work_start_runtime_race_old','T_RACE'),{timeout:5000}),/work_start_tenant_principal_revoked/i);
  const elapsed=Date.now()-startedAt;
  await revokePromise;
  assert.ok(elapsed>=650,`expected guarded read to serialize behind revocation, elapsed=${elapsed}ms`);
});

pgTest('work-start-first race grants authority only for that transaction and revocation takes effect afterwards',async()=>{
  await psql(`DO $roles$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wfm_work_start_runtime_inflight') THEN CREATE ROLE wfm_work_start_runtime_inflight LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF; END $roles$; GRANT wfm_agency_work_start_reader TO wfm_work_start_runtime_inflight;`);
  await psql(adminSql(`SELECT public.wfm_bind_agency_work_start_principal_v1('wfm_work_start_runtime_inflight','T_INFLIGHT','${'7'.repeat(24)}');`));

  const inFlight=psql(`SET SESSION AUTHORIZATION wfm_work_start_runtime_inflight; BEGIN; SET LOCAL ROLE wfm_agency_work_start_reader; SELECT count(*) FROM public.wfm_read_agency_work_start_authority_v1('T_INFLIGHT','S_ROT','R_ROT','A_ROT','W_ROT','${assignment}','2026-10-05T06:10:00Z'); SELECT pg_sleep(1); COMMIT;`,{timeout:5000});
  await delay(150);
  const startedAt=Date.now();
  await psql(adminSql(`SELECT public.wfm_revoke_agency_work_start_principal_v1('wfm_work_start_runtime_inflight','T_INFLIGHT','${'8'.repeat(24)}');`),{timeout:5000});
  const elapsed=Date.now()-startedAt;
  const inFlightResult=await inFlight;
  assert.match(inFlightResult,/0/);
  assert.ok(elapsed>=650,`expected revocation to wait for in-flight guarded transaction, elapsed=${elapsed}ms`);
  await assert.rejects(()=>psql(runtimeAuthoritySql('wfm_work_start_runtime_inflight','T_INFLIGHT')),/work_start_tenant_principal_revoked/i);
});

pgTest('canonical migration replay preserves revocation tombstones and function-only admin authority',async()=>{
  await psql(`DO $roles$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wfm_work_start_runtime_reapply') THEN CREATE ROLE wfm_work_start_runtime_reapply LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF; END $roles$; GRANT wfm_agency_work_start_reader TO wfm_work_start_runtime_reapply;`);
  await psql(adminSql(`SELECT public.wfm_bind_agency_work_start_principal_v1('wfm_work_start_runtime_reapply','T_REAPPLY','${'9'.repeat(24)}');`));
  assert.equal(await psql(runtimeAuthoritySql('wfm_work_start_runtime_reapply','T_REAPPLY')),'0');
  await psql(adminSql(`SELECT public.wfm_revoke_agency_work_start_principal_v1('wfm_work_start_runtime_reapply','T_REAPPLY','${'a'.repeat(24)}');`));
  await assert.rejects(()=>psql(runtimeAuthoritySql('wfm_work_start_runtime_reapply','T_REAPPLY')),/work_start_tenant_principal_revoked/i);
  const beforeReplay=await psql("SELECT tenant_id||','||(revoked_at IS NOT NULL)::text||','||revocation_fingerprint FROM public.wfm_agency_work_start_principal_tenants WHERE database_principal='wfm_work_start_runtime_reapply';");
  assert.equal(beforeReplay,`T_REAPPLY,true,${'a'.repeat(24)}`);

  await psql(AGENCY_WORK_START_CANONICAL_MIGRATION_DDL,{timeout:30000});

  for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']){
    assert.equal(await psql(`SELECT has_table_privilege('wfm_agency_work_start_tenant_binding_admin','public.wfm_agency_work_start_principal_tenants','${privilege}');`),'f');
  }
  await assert.rejects(()=>psql(adminSql("UPDATE public.wfm_agency_work_start_principal_tenants SET tenant_id='T_ESCAPED' WHERE database_principal='wfm_work_start_runtime_reapply';")),/permission denied/i);
  const afterReplay=await psql("SELECT tenant_id||','||(revoked_at IS NOT NULL)::text||','||revocation_fingerprint FROM public.wfm_agency_work_start_principal_tenants WHERE database_principal='wfm_work_start_runtime_reapply';");
  assert.equal(afterReplay,beforeReplay);
  await assert.rejects(()=>psql(runtimeAuthoritySql('wfm_work_start_runtime_reapply','T_REAPPLY')),/work_start_tenant_principal_revoked/i);
});
