import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import {AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL} from '../../src/frontier/agency-right-to-work-assurance-ledger.mjs';
import {AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL} from '../../src/frontier/agency-portal-token-store.mjs';
import {AGENCY_IDENTITY_CONTINUITY_DDL} from '../../src/frontier/agency-identity-continuity.mjs';
import {AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL} from '../../src/frontier/agency-identity-observation-ingress.mjs';
import {AGENCY_IDENTITY_DB_BOUNDARY_DDL} from '../../src/frontier/agency-identity-db-boundary.mjs';
import {AGENCY_WORK_START_CANONICAL_MIGRATION_DDL} from '../../src/frontier/agency-work-start-principal-lifecycle.mjs';
import {AGENCY_WORK_START_SCOPED_AUTHORITY_SQL} from '../../src/frontier/agency-work-start-db-boundary.mjs';
import {createPostgresAgencyWorkStartPrecheck} from '../../src/frontier/agency-work-start-precheck.mjs';

const execFileAsync=promisify(execFile);
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const CONTAINER=`wfm-agency-precheck-${process.pid}-${Date.now()}`;
const DB_USER='postgres',DB_NAME='postgres',DB_PASSWORD='agency-precheck-proof-only-not-a-secret';
const RUNTIME_PASSWORD='agency-precheck-runtime-proof-only-not-a-secret';
const BOUND_USER='wfm_precheck_bound';
const OTHER_USER='wfm_precheck_other';
const UNBOUND_USER='wfm_precheck_unbound';
const REVOKED_USER='wfm_precheck_revoked';
const NOW='2026-10-05T06:10:00.000Z';
const ASSURANCE='a'.repeat(32),SUBJECT='c'.repeat(32);
const REQUEST=Object.freeze({requestId:'R-PRECHECK-PG',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'});
const SCOPE=Object.freeze({tenantId:'T-PRECHECK-PG',siteId:'S-PRECHECK-PG',requestId:REQUEST.requestId,agencyId:'A-PRECHECK-PG',workerId:'W-PRECHECK-PG'});
const POLICY=Object.freeze({policyId:'S-PRECHECK-PG-PACK-v1',siteId:SCOPE.siteId,roleId:REQUEST.roleId,minutesBeforeStart:60,minutesAfterStart:90,minIndependentSources:1,requireDirectIdentity:false,allowedSources:Object.freeze({turnstile:Object.freeze(['access_pass'])})});
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=(value,length=32)=>crypto.createHash('sha256').update(String(value??'')).digest('hex').slice(0,length);
const ASSIGNMENT=digest(JSON.stringify(stable({roleId:REQUEST.roleId,location:REQUEST.location,startAt:REQUEST.startAt,endAt:REQUEST.endAt})),24);
let started=false,markerCounter=0;

async function docker(args,options={}){return execFileAsync('docker',args,{maxBuffer:8*1024*1024,timeout:options.timeout??30000,encoding:'utf8'});}
function lit(value){if(value==null)return 'NULL';if(typeof value==='number')return String(value);if(typeof value==='boolean')return value?'TRUE':'FALSE';return `'${String(value).replaceAll("'","''")}'`;}
function interpolate(sql,values=[]){return sql.replace(/\$(\d+)/g,(_,n)=>lit(values[Number(n)-1]));}
function jsonSql(sql,values=[]){const statement=interpolate(sql,values).trim().replace(/;\s*$/,'');return `SELECT COALESCE(json_agg(row_to_json(wfm_q)),'[]'::json)::text FROM (${statement}) AS wfm_q;`;}
function parseRows(stdout){const lines=String(stdout??'').split(/\r?\n/).map(value=>value.trim()).filter(Boolean);const rows=JSON.parse(lines.at(-1)??'[]');if(!Array.isArray(rows))throw new Error('postgres_json_result_invalid');return {rows};}
async function psql(sql,options={}){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-A','-t','-c',sql],options);return stdout;}
async function runtimePsql(user,sql){return docker(['exec','-e',`PGPASSWORD=${RUNTIME_PASSWORD}`,CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U',user,'-d',DB_NAME,'-A','-t','-c',sql]);}
async function scalar(sql){const out=await psql(sql);return out.split(/\r?\n/).map(value=>value.trim()).filter(Boolean).at(-1)??null;}
async function waitForPostgres(){let initialized=false;for(let i=0;i<80;i+=1){try{const logs=await docker(['logs',CONTAINER],{timeout:5000});const all=`${logs.stdout??''}\n${logs.stderr??''}`;initialized||=all.includes('PostgreSQL init process complete; ready for start up.');if(initialized&&(await psql('SELECT 1;',{timeout:5000})).trim()==='1')return;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}throw new Error('postgres final server did not become ready');}
async function stop(){if(!started)return;try{await docker(['rm','-f',CONTAINER],{timeout:10000});}catch{}started=false;}
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}

class PersistentPsqlSession{
  constructor(user){this.user=user;this.proc=null;this.stdout='';this.stderr='';this.pending=null;this.closed=false;}
  async start(){
    this.proc=spawn('docker',['exec','-i','-e',`PGPASSWORD=${RUNTIME_PASSWORD}`,CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U',this.user,'-d',DB_NAME,'-A','-t'],{stdio:['pipe','pipe','pipe']});
    this.proc.stdout.setEncoding('utf8');this.proc.stderr.setEncoding('utf8');
    this.proc.stdout.on('data',chunk=>{this.stdout+=chunk;this.#drain();});this.proc.stderr.on('data',chunk=>{this.stderr+=chunk;});
    this.proc.on('exit',(code,signal)=>{this.closed=true;if(this.pending){const pending=this.pending;this.pending=null;pending.reject(new Error(`persistent_psql_exited code=${code} signal=${signal??''} stderr=${this.stderr.slice(-1200)}`));}});
    await this.exec("SET application_name='wfm_precheck_proof';");
  }
  #drain(){if(!this.pending)return;const index=this.stdout.indexOf(this.pending.marker);if(index<0)return;const pending=this.pending;const before=this.stdout.slice(0,index);this.stdout=this.stdout.slice(index+pending.marker.length).replace(/^\r?\n/,'');this.pending=null;pending.resolve(before.trim());}
  async #command(sql){if(this.closed)throw new Error('persistent_psql_closed');if(this.pending)throw new Error('persistent_psql_concurrent_command');const marker=`__WFM_PRECHECK_${process.pid}_${++markerCounter}__`;return new Promise((resolve,reject)=>{this.pending={marker,resolve,reject};this.proc.stdin.write(`${sql}\n\\echo ${marker}\n`);});}
  async exec(sql){await this.#command(sql);}
  async query(sql,values=[]){if(/^\s*SET\s+LOCAL\s+ROLE\b/i.test(sql)){await this.exec(interpolate(sql,values));return {rows:[]};}return parseRows(await this.#command(jsonSql(sql,values)));}
  async close(){if(!this.proc||this.closed)return;const exited=new Promise(resolve=>this.proc.once('exit',resolve));this.proc.stdin.end();await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,1500))]);if(!this.closed)this.proc.kill('SIGTERM');}
}

function makePrecheck(user){return createPostgresAgencyWorkStartPrecheck({withTransaction:async evaluate=>{const session=new PersistentPsqlSession(user);await session.start();try{await session.exec('BEGIN;');const value=await evaluate({query:(sql,values)=>session.query(sql,values)});await session.exec('COMMIT;');return value;}catch(error){try{await session.exec('ROLLBACK;');}catch{}throw error;}finally{await session.close();}}});}
function input(tenantId=SCOPE.tenantId){return {tenantId,siteId:SCOPE.siteId,agencyId:SCOPE.agencyId,request:structuredClone(REQUEST),workerId:SCOPE.workerId,now:NOW,policy:structuredClone(POLICY)};}
function adminSql(sql){return `BEGIN; SET LOCAL ROLE wfm_agency_work_start_tenant_binding_admin; ${sql} COMMIT;`;}
function bindingFingerprint(){return digest(JSON.stringify(stable({tenantId:SCOPE.tenantId,siteId:SCOPE.siteId,requestId:SCOPE.requestId,sourceSystemId:'turnstile',agencyId:SCOPE.agencyId,workerId:SCOPE.workerId,assignmentFingerprint:ASSIGNMENT,assuranceVersionId:ASSURANCE,subjectFingerprint:SUBJECT})));}
function authoritySql(tenantId){return `BEGIN; SET LOCAL ROLE wfm_agency_work_start_reader; ${interpolate(AGENCY_WORK_START_SCOPED_AUTHORITY_SQL,[tenantId,SCOPE.siteId,SCOPE.requestId,SCOPE.agencyId,SCOPE.workerId,ASSIGNMENT,NOW])} COMMIT;`;}

async function reset(){
  await psql('TRUNCATE wfm_agency_identity_observation_ingress_receipts, wfm_agency_identity_continuity_observations, wfm_agency_portal_token_consumptions, wfm_agency_rtw_assurance_current, wfm_agency_rtw_assurance_history;');
  await psql(`INSERT INTO wfm_agency_rtw_assurance_current (tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,assignment_fingerprint,evidence_fingerprint,check_method,checked_at,coverage_until,promoted_at,conflicted) VALUES (${lit(SCOPE.tenantId)},${lit(SCOPE.agencyId)},${lit(SCOPE.workerId)},${lit(ASSURANCE)},${lit(SCOPE.siteId)},${lit(SCOPE.requestId)},${lit(ASSIGNMENT)},${lit('d'.repeat(24))},'home_office_online','2026-10-04T10:00:00Z','2027-12-31T23:59:59Z','2026-10-04T11:00:00Z',false);`);
  const bindings=JSON.stringify([{workerId:SCOPE.workerId,assuranceVersionId:ASSURANCE}]).replaceAll("'","''");
  await psql(`INSERT INTO wfm_agency_portal_token_consumptions (tenant_id,token_id,site_id,request_id,agency_id,token_fingerprint,action,expires_at,consumed_at,assurance_bindings) VALUES (${lit(SCOPE.tenantId)},'TOK-PRECHECK-PG',${lit(SCOPE.siteId)},${lit(SCOPE.requestId)},${lit(SCOPE.agencyId)},${lit('1'.repeat(16))},'confirm_preferred_worker','2026-10-05T15:00:00Z','2026-10-04T12:00:00Z','${bindings}'::jsonb);`);
  const event='2'.repeat(32),binding=bindingFingerprint();
  await psql(`INSERT INTO wfm_agency_identity_continuity_observations (tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,assurance_version_id,source_system_id,source_event_fingerprint,subject_fingerprint,signal_type,observed_at) VALUES (${lit(SCOPE.tenantId)},${lit(SCOPE.siteId)},${lit(SCOPE.requestId)},${lit(SCOPE.agencyId)},${lit(SCOPE.workerId)},${lit(ASSIGNMENT)},${lit(ASSURANCE)},'turnstile',${lit(event)},${lit(SUBJECT)},'access_pass','2026-10-05T05:58:00Z');`);
  await psql(`INSERT INTO wfm_agency_identity_observation_ingress_receipts (tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint,binding_fingerprint,ingress_version,received_at) VALUES (${lit(SCOPE.tenantId)},'turnstile',${lit(event)},${lit(digest(`auth|${binding}`))},${lit(binding)},'agency-identity-observation-ingress-v0.2.0','2026-10-05T05:58:10Z');`);
}

before(async()=>{
  if(!REQUIRED)return;
  try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for work-start precheck PostgreSQL proof: ${error.message}`);}
  await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();
  await psql(`${AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL}\n${AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL}\n${AGENCY_IDENTITY_CONTINUITY_DDL}\n${AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL}\n${AGENCY_IDENTITY_DB_BOUNDARY_DDL}\n${AGENCY_WORK_START_CANONICAL_MIGRATION_DDL}`);
  await psql(`CREATE ROLE ${BOUND_USER} LOGIN PASSWORD ${lit(RUNTIME_PASSWORD)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; CREATE ROLE ${OTHER_USER} LOGIN PASSWORD ${lit(RUNTIME_PASSWORD)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; CREATE ROLE ${UNBOUND_USER} LOGIN PASSWORD ${lit(RUNTIME_PASSWORD)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; CREATE ROLE ${REVOKED_USER} LOGIN PASSWORD ${lit(RUNTIME_PASSWORD)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; GRANT wfm_agency_work_start_reader TO ${BOUND_USER},${OTHER_USER},${UNBOUND_USER},${REVOKED_USER};`);
  await psql(adminSql(`SELECT public.wfm_bind_agency_work_start_principal_v1('${BOUND_USER}',${lit(SCOPE.tenantId)},'${'4'.repeat(24)}'); SELECT public.wfm_bind_agency_work_start_principal_v1('${OTHER_USER}','T-OTHER','${'5'.repeat(24)}'); SELECT public.wfm_bind_agency_work_start_principal_v1('${REVOKED_USER}',${lit(SCOPE.tenantId)},'${'6'.repeat(24)}'); SELECT public.wfm_revoke_agency_work_start_principal_v1('${REVOKED_USER}',${lit(SCOPE.tenantId)},'${'7'.repeat(24)}');`));
});
after(async()=>{await stop();});

pgTest('bound non-superuser precheck proves readiness through function-only tenant-scoped evidence and leaves evidence tables unchanged',async()=>{
  await reset();
  const beforeCounts=await scalar("SELECT concat((SELECT count(*) FROM wfm_agency_rtw_assurance_current),',',(SELECT count(*) FROM wfm_agency_portal_token_consumptions),',',(SELECT count(*) FROM wfm_agency_identity_continuity_observations),',',(SELECT count(*) FROM wfm_agency_identity_observation_ingress_receipts));");
  const result=await makePrecheck(BOUND_USER).evaluate(input());
  assert.equal(result.workStartReady,true);assert.equal(result.rankingImpact,'none');assert.equal(result.scheduleWriteAuthorized,false);assert.equal(result.clockingWriteAuthorized,false);assert.equal(result.payrollWriteAuthorized,false);assert.equal(result.workStartWriteAuthorized,false);
  const afterCounts=await scalar("SELECT concat((SELECT count(*) FROM wfm_agency_rtw_assurance_current),',',(SELECT count(*) FROM wfm_agency_portal_token_consumptions),',',(SELECT count(*) FROM wfm_agency_identity_continuity_observations),',',(SELECT count(*) FROM wfm_agency_identity_observation_ingress_receipts));");
  assert.equal(afterCounts,beforeCounts);
});

pgTest('database guard rejects tenant substitution, other-tenant, unbound and revoked principals before scoped authority evidence can be read',async()=>{
  await reset();
  await assert.rejects(()=>runtimePsql(BOUND_USER,authoritySql('T-OTHER')),/work_start_tenant_principal_unauthorized/i);
  await assert.rejects(()=>runtimePsql(OTHER_USER,authoritySql(SCOPE.tenantId)),/work_start_tenant_principal_unauthorized/i);
  await assert.rejects(()=>runtimePsql(UNBOUND_USER,authoritySql(SCOPE.tenantId)),/work_start_tenant_principal_unauthorized/i);
  await assert.rejects(()=>runtimePsql(REVOKED_USER,authoritySql(SCOPE.tenantId)),/work_start_tenant_principal_revoked/i);
});

pgTest('runtime reader membership cannot fall back to raw evidence-table enumeration',async()=>{
  await reset();
  await assert.rejects(()=>runtimePsql(BOUND_USER,'BEGIN; SET LOCAL ROLE wfm_agency_work_start_reader; SELECT count(*) FROM public.wfm_agency_rtw_assurance_current; COMMIT;'),/permission denied/i);
  await assert.rejects(()=>runtimePsql(BOUND_USER,'BEGIN; SET LOCAL ROLE wfm_agency_work_start_reader; SELECT count(*) FROM public.wfm_agency_portal_token_consumptions; COMMIT;'),/permission denied/i);
  await assert.rejects(()=>runtimePsql(BOUND_USER,'BEGIN; SET LOCAL ROLE wfm_agency_work_start_reader; SELECT count(*) FROM public.wfm_agency_identity_continuity_observations; COMMIT;'),/permission denied/i);
});
