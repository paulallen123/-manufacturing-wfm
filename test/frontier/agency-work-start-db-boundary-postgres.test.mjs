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
import {AGENCY_WORK_START_DB_BOUNDARY_DDL} from '../../src/frontier/agency-work-start-db-boundary.mjs';

const execFileAsync=promisify(execFile);
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const CONTAINER=`wfm-agency-work-start-boundary-${process.pid}-${Date.now()}`;
const DB_USER='postgres',DB_NAME='postgres',DB_PASSWORD='agency-work-start-boundary-proof-only-not-a-secret';
let started=false;

async function docker(args,options={}){return execFileAsync('docker',args,{maxBuffer:8*1024*1024,timeout:options.timeout??30000,encoding:'utf8'});}
async function psql(sql,options={}){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-A','-t','-c',sql],options);return stdout.trim();}
async function waitForPostgres(){for(let i=0;i<80;i+=1){try{if((await psql('SELECT 1;',{timeout:3000}))==='1')return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('postgres did not become ready');}
async function stop(){if(!started)return;try{await docker(['rm','-f',CONTAINER],{timeout:10000});}catch{}started=false;}
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=(v,n=32)=>crypto.createHash('sha256').update(String(v??'')).digest('hex').slice(0,n);
const request={roleId:'PACK-OP',location:'Plant 1',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'};
const assignment=digest(JSON.stringify(stable(request)),24);
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}

before(async()=>{
  if(!REQUIRED)return;
  try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for work-start DB boundary proof: ${error.message}`);}
  await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();
  await psql(`${AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL}\n${AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL}\n${AGENCY_IDENTITY_CONTINUITY_DDL}\n${AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL}\n${AGENCY_IDENTITY_DB_BOUNDARY_DDL}\n${AGENCY_WORK_START_DB_BOUNDARY_DDL}`);
});
after(async()=>{await stop();});

pgTest('work-start runtime role has no login, superuser or table mutation privilege and cannot see excluded evidence columns',async()=>{
  const flags=await psql("SELECT rolcanlogin||','||rolsuper||','||rolcreatedb||','||rolcreaterole FROM pg_roles WHERE rolname='wfm_agency_work_start_reader';");
  assert.equal(flags,'false,false,false,false');
  for(const table of ['wfm_agency_rtw_assurance_current','wfm_agency_portal_token_consumptions','wfm_agency_identity_continuity_observations','wfm_agency_identity_observation_ingress_receipts']){
    for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal(await psql(`SELECT has_table_privilege('wfm_agency_work_start_reader','public.${table}','${privilege}');`),'f',`${table} ${privilege}`);
  }
  assert.equal(await psql("SELECT has_column_privilege('wfm_agency_work_start_reader','public.wfm_agency_rtw_assurance_current','checked_at','SELECT');"),'t');
  assert.equal(await psql("SELECT has_column_privilege('wfm_agency_work_start_reader','public.wfm_agency_rtw_assurance_current','evidence_fingerprint','SELECT');"),'f');
  assert.equal(await psql("SELECT has_column_privilege('wfm_agency_work_start_reader','public.wfm_agency_rtw_assurance_current','check_method','SELECT');"),'f');
  assert.equal(await psql("SELECT has_column_privilege('wfm_agency_work_start_reader','public.wfm_agency_portal_token_consumptions','token_id','SELECT');"),'f');
  assert.equal(await psql("SELECT has_column_privilege('wfm_agency_work_start_reader','public.wfm_agency_portal_token_consumptions','expires_at','SELECT');"),'f');
  assert.equal(await psql("SELECT has_column_privilege('wfm_agency_work_start_reader','public.wfm_agency_identity_observation_ingress_receipts','source_auth_fingerprint','SELECT');"),'f');
});

pgTest('controlled snapshot executes under reader role, returns database scope evidence and does not expose a mutation surface',async()=>{
  await psql(`INSERT INTO wfm_agency_rtw_assurance_current (tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,assignment_fingerprint,evidence_fingerprint,check_method,checked_at,coverage_until,promoted_at,conflicted) VALUES ('T1','A1','W1','${'a'.repeat(32)}','S1','R1','${assignment}','${'b'.repeat(24)}','home_office_online','2026-10-04T10:00:00Z','2027-12-31T23:59:59Z','2026-10-04T11:00:00Z',false);`);
  await psql(`INSERT INTO wfm_agency_portal_token_consumptions (tenant_id,token_id,site_id,request_id,agency_id,token_fingerprint,action,expires_at,consumed_at,assurance_bindings) VALUES ('T1','TOK1','S1','R1','A1','${'1'.repeat(16)}','confirm_preferred_worker','2026-10-05T15:00:00Z','2026-10-04T12:00:00Z','[{"workerId":"W1","assuranceVersionId":"${'a'.repeat(32)}"}]'::jsonb);`);
  const row=await psql(`BEGIN; SET LOCAL ROLE wfm_agency_work_start_reader; SELECT assurance_version_id||','||assignment_fingerprint||','||token_fingerprint||','||scope_fingerprint FROM public.wfm_read_agency_work_start_locked_snapshot_v1('T1','S1','R1','A1','W1','${assignment}','2026-10-05T06:10:00Z'); COMMIT;`);
  const parts=row.split(',');assert.equal(parts[0],'a'.repeat(32));assert.equal(parts[1],assignment);assert.equal(parts[2],'1'.repeat(16));assert.match(parts[3],/^[0-9a-f]{24}$/);
  assert.equal(await psql("SELECT has_function_privilege('wfm_agency_work_start_reader','public.wfm_append_agency_identity_observation_v1(text,text,text,text,text,text,text,text,text,text,text,timestamptz,text,text,text,timestamptz)','EXECUTE');"),'f');
  assert.equal(await psql("SELECT has_function_privilege('wfm_agency_identity_ingress_writer','public.wfm_read_agency_work_start_locked_snapshot_v1(text,text,text,text,text,text,timestamptz)','EXECUTE');"),'f');
});

pgTest('direct mutation attempt under the runtime role is rejected by PostgreSQL',async()=>{
  await assert.rejects(()=>psql("BEGIN; SET LOCAL ROLE wfm_agency_work_start_reader; UPDATE public.wfm_agency_rtw_assurance_current SET conflicted=true WHERE tenant_id='T1'; COMMIT;"),/permission denied/i);
  assert.equal(await psql("SELECT conflicted FROM public.wfm_agency_rtw_assurance_current WHERE tenant_id='T1' AND worker_id='W1';"),'f');
});
