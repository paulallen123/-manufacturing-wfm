import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AGENCY_IDENTITY_DB_BOUNDARY_DDL} from '../../src/frontier/agency-identity-db-boundary.mjs';

const execFileAsync=promisify(execFile);
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const CONTAINER=`wfm-agency-identity-db-boundary-${process.pid}-${Date.now()}`;
const DB_USER='postgres',DB_NAME='postgres',DB_PASSWORD='agency-identity-db-boundary-proof-only-not-a-secret';
let started=false;

const BASE_DDL=`
CREATE TABLE public.wfm_agency_identity_observation_ingress_receipts (
 tenant_id text NOT NULL, source_system_id text NOT NULL,
 source_event_fingerprint text NOT NULL CHECK (source_event_fingerprint ~ '^[0-9a-f]{32}$'),
 source_auth_fingerprint text NOT NULL CHECK (source_auth_fingerprint ~ '^[0-9a-f]{32}$'),
 binding_fingerprint text NOT NULL CHECK (binding_fingerprint ~ '^[0-9a-f]{32}$'),
 ingress_version text NOT NULL, received_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint));
CREATE TABLE public.wfm_agency_identity_continuity_observations (
 tenant_id text NOT NULL, site_id text NOT NULL, request_id text NOT NULL, agency_id text NOT NULL, worker_id text NOT NULL,
 assignment_fingerprint text NOT NULL CHECK (assignment_fingerprint ~ '^[0-9a-f]{24}$'),
 assurance_version_id text NOT NULL CHECK (assurance_version_id ~ '^[0-9a-f]{32}$'),
 source_system_id text NOT NULL, source_event_fingerprint text NOT NULL CHECK (source_event_fingerprint ~ '^[0-9a-f]{32}$'),
 subject_fingerprint text NOT NULL CHECK (subject_fingerprint ~ '^[0-9a-f]{32}$'),
 signal_type text NOT NULL CHECK (signal_type IN ('access_pass','attendance_clock_in','supervised_identity_check','rtw_dvsp_holder_check')),
 observed_at timestamptz NOT NULL, captured_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,source_system_id,source_event_fingerprint));`;

async function docker(args,options={}){return execFileAsync('docker',args,{maxBuffer:8*1024*1024,timeout:options.timeout??30000,encoding:'utf8'});}
async function psql(sql,options={}){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-A','-t','-c',sql],options);return stdout;}
async function scalar(sql){const out=await psql(sql);return out.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).at(-1)??null;}
async function waitForPostgres(){let init=false;for(let i=0;i<80;i+=1){try{const logs=await docker(['logs',CONTAINER],{timeout:5000});const all=`${logs.stdout??''}\n${logs.stderr??''}`;init||=all.includes('PostgreSQL init process complete; ready for start up.');if(init&&(await psql('SELECT 1;',{timeout:5000})).trim()==='1')return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('postgres did not become ready');}
async function stop(){if(!started)return;try{await docker(['rm','-f',CONTAINER],{timeout:10000});}catch{}started=false;}
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}

const ASSIGNMENT='a'.repeat(24),ASSURANCE='b'.repeat(32),EVENT='c'.repeat(32),SUBJECT='d'.repeat(32),AUTH='e'.repeat(32),BINDING='f'.repeat(32);
function appendCall(overrides={}){
 const x={tenant:'T1',site:'S1',request:'R1',agency:'A1',worker:'W1',assignment:ASSIGNMENT,assurance:ASSURANCE,source:'turnstile',event:EVENT,subject:SUBJECT,signal:'access_pass',observed:'2026-10-05T05:58:00Z',auth:AUTH,binding:BINDING,version:'agency-identity-observation-ingress-v0.2.0',received:'2026-10-05T05:58:10Z',lock:'123456789',...overrides};
 return `SELECT observation_duplicate,receipt_duplicate FROM public.wfm_append_agency_identity_observation_v1('${x.tenant}','${x.site}','${x.request}','${x.agency}','${x.worker}','${x.assignment}','${x.assurance}','${x.source}','${x.event}','${x.subject}','${x.signal}','${x.observed}'::timestamptz,'${x.auth}','${x.binding}','${x.version}','${x.received}'::timestamptz,${x.lock}::bigint);`;
}

before(async()=>{if(!REQUIRED)return;try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for identity DB boundary PostgreSQL proof: ${error.message}`);}await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();await psql(`${BASE_DDL}\n${AGENCY_IDENTITY_DB_BOUNDARY_DDL}`);});
after(async()=>{await stop();});

pgTest('ingress writer can execute the controlled append function but cannot read or directly mutate evidence tables',async()=>{
 const first=await psql(`BEGIN; SET ROLE wfm_agency_identity_ingress_writer; ${appendCall()} COMMIT;`);
 assert.match(first,/f\|f|false\|false/i);
 assert.equal(await scalar('SELECT count(*) FROM public.wfm_agency_identity_continuity_observations;'),'1');
 await assert.rejects(()=>psql('SET ROLE wfm_agency_identity_ingress_writer; SELECT count(*) FROM public.wfm_agency_identity_continuity_observations;'),/permission denied/i);
 await assert.rejects(()=>psql(`SET ROLE wfm_agency_identity_ingress_writer; INSERT INTO public.wfm_agency_identity_continuity_observations (tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,assurance_version_id,source_system_id,source_event_fingerprint,subject_fingerprint,signal_type,observed_at) VALUES ('T1','S1','R1','A1','W9','${ASSIGNMENT}','${ASSURANCE}','turnstile','${'9'.repeat(32)}','${SUBJECT}','access_pass',now());`),/permission denied/i);
});

pgTest('reader can evaluate persisted evidence but cannot execute the ingress writer function or mutate evidence',async()=>{
 assert.equal(await scalar('SET ROLE wfm_agency_identity_reader; SELECT count(*) FROM public.wfm_agency_identity_continuity_observations;'),'1');
 await assert.rejects(()=>psql(`SET ROLE wfm_agency_identity_reader; ${appendCall({event:'1'.repeat(32)})}`),/permission denied/i);
 await assert.rejects(()=>psql('SET ROLE wfm_agency_identity_reader; DELETE FROM public.wfm_agency_identity_continuity_observations;'),/permission denied/i);
});

pgTest('controlled function is idempotent for exact replay and fails closed for conflicting identity replay',async()=>{
 const exact=await psql(`BEGIN; SET ROLE wfm_agency_identity_ingress_writer; ${appendCall()} COMMIT;`);
 assert.match(exact,/t\|t|true\|true/i);
 await assert.rejects(()=>psql(`BEGIN; SET ROLE wfm_agency_identity_ingress_writer; ${appendCall({worker:'W2'})} COMMIT;`),/identity_observation_replay_conflict/i);
 assert.equal(await scalar('SELECT count(*) FROM public.wfm_agency_identity_continuity_observations;'),'1');
 assert.equal(await scalar('SELECT count(*) FROM public.wfm_agency_identity_observation_ingress_receipts;'),'1');
});

pgTest('least-privilege roles are NOLOGIN/NOSUPERUSER and only the reader has table SELECT',async()=>{
 const attrs=await psql("SELECT rolname||':'||rolcanlogin||':'||rolsuper FROM pg_catalog.pg_roles WHERE rolname IN ('wfm_agency_identity_ingress_owner','wfm_agency_identity_ingress_writer','wfm_agency_identity_reader') ORDER BY rolname;");
 assert.doesNotMatch(attrs,/:t:|:.*:t/);
 const grants=await psql("SELECT grantee||':'||privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN ('wfm_agency_identity_observation_ingress_receipts','wfm_agency_identity_continuity_observations') AND grantee IN ('wfm_agency_identity_ingress_writer','wfm_agency_identity_reader') ORDER BY grantee,privilege_type;");
 assert.doesNotMatch(grants,/wfm_agency_identity_ingress_writer:(INSERT|UPDATE|DELETE|SELECT)/);
 assert.doesNotMatch(grants,/wfm_agency_identity_reader:(INSERT|UPDATE|DELETE)/);
 assert.match(grants,/wfm_agency_identity_reader:SELECT/);
});
