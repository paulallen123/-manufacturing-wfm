import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import {
  createPostgresAgencyWorkStartPermitStore,
  evaluateAgencyWorkStartPermit,
} from '../../src/frontier/agency-work-start-permit.mjs';
import {
  createPostgresAgencyWorkStartAuthorityStore,
  evaluateAgencyWorkStartReadiness,
} from '../../src/frontier/agency-work-start-readiness.mjs';
import {createPostgresAgencyIdentityContinuityStore,AGENCY_IDENTITY_CONTINUITY_DDL} from '../../src/frontier/agency-identity-continuity.mjs';
import {AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL} from '../../src/frontier/agency-portal-token-store.mjs';
import {AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL} from '../../src/frontier/agency-right-to-work-assurance-ledger.mjs';
import {
  AGENCY_IDENTITY_OBSERVATION_BOUNDARY_APPEND_SQL,
  AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL,
} from '../../src/frontier/agency-identity-observation-ingress.mjs';
import {AGENCY_IDENTITY_DB_BOUNDARY_DDL} from '../../src/frontier/agency-identity-db-boundary.mjs';
import {AGENCY_WORK_START_DB_BOUNDARY_DDL} from '../../src/frontier/agency-work-start-db-boundary.mjs';

const execFileAsync=promisify(execFile);
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const CONTAINER=`wfm-agency-work-start-runtime-${process.pid}-${Date.now()}`;
const DB_USER='postgres',DB_NAME='postgres',DB_PASSWORD='agency-work-start-runtime-proof-only-not-a-secret';
const NOW='2026-10-05T06:10:00.000Z';
const ASSURANCE='a'.repeat(32),SUBJECT='c'.repeat(32),ALT_SUBJECT='e'.repeat(32);
const REQUEST=Object.freeze({requestId:'R-START-RUNTIME',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'});
const SCOPE=Object.freeze({tenantId:'T-START-RUNTIME',siteId:'S-START-RUNTIME',requestId:REQUEST.requestId,agencyId:'A-START-RUNTIME',workerId:'W-START-RUNTIME'});
const POLICY=Object.freeze({policyId:'S-START-RUNTIME-PACK-v1',siteId:SCOPE.siteId,roleId:REQUEST.roleId,minutesBeforeStart:60,minutesAfterStart:90,minIndependentSources:1,requireDirectIdentity:false,allowedSources:Object.freeze({turnstile:Object.freeze(['access_pass'])})});
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=(v,n=32)=>crypto.createHash('sha256').update(String(v??'')).digest('hex').slice(0,n);
const ASSIGNMENT=digest(JSON.stringify(stable({roleId:REQUEST.roleId,location:REQUEST.location,startAt:REQUEST.startAt,endAt:REQUEST.endAt})),24);
let started=false;
let markerCounter=0;

async function docker(args,options={}){return execFileAsync('docker',args,{maxBuffer:8*1024*1024,timeout:options.timeout??30000,encoding:'utf8'});}
function lit(value){if(value==null)return 'NULL';if(typeof value==='number')return String(value);if(typeof value==='boolean')return value?'TRUE':'FALSE';return `'${String(value).replaceAll("'","''")}'`;}
function interpolate(sql,values=[]){return sql.replace(/\$(\d+)/g,(_,n)=>lit(values[Number(n)-1]));}
function jsonSql(sql,values=[]){const statement=interpolate(sql,values).trim().replace(/;\s*$/,'');return `SELECT COALESCE(json_agg(row_to_json(wfm_q)),'[]'::json)::text FROM (${statement}) AS wfm_q;`;}
function parseRows(stdout){const lines=String(stdout??'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);const raw=lines.at(-1)??'[]';const rows=JSON.parse(raw);if(!Array.isArray(rows))throw new Error('postgres_json_result_invalid');return {rows};}
async function psql(sql,options={}){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-A','-t','-c',sql],options);return stdout;}
async function queryOnce(sql,values=[]){return parseRows(await psql(jsonSql(sql,values)));}
async function scalar(sql){const out=await psql(sql);return out.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).at(-1)??null;}
async function waitForPostgres(){let init=false;for(let i=0;i<80;i+=1){try{const logs=await docker(['logs',CONTAINER],{timeout:5000});const all=`${logs.stdout??''}\n${logs.stderr??''}`;init||=all.includes('PostgreSQL init process complete; ready for start up.');if(init&&(await psql('SELECT 1;',{timeout:5000})).trim()==='1')return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('postgres final server did not become ready');}
async function waitForSleep(name){for(let i=0;i<80;i+=1){if(Number(await scalar(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${lit(name)} AND wait_event='PgSleep';`))===1)return;await new Promise(r=>setTimeout(r,50));}throw new Error(`${name} did not reach held sleep`);}
async function waitForLockWait(name){for(let i=0;i<80;i+=1){if(Number(await scalar(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${lit(name)} AND wait_event_type='Lock';`))===1)return;await new Promise(r=>setTimeout(r,50));}throw new Error(`${name} did not reach lock wait`);}
async function stop(){if(!started)return;try{await docker(['rm','-f',CONTAINER],{timeout:10000});}catch{}started=false;}
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}

class PersistentPsqlSession{
  constructor(applicationName){this.applicationName=applicationName;this.proc=null;this.stdout='';this.stderr='';this.pending=null;this.closed=false;}
  async start(){
    this.proc=spawn('docker',['exec','-i',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-A','-t'],{stdio:['pipe','pipe','pipe']});
    this.proc.stdout.setEncoding('utf8');this.proc.stderr.setEncoding('utf8');
    this.proc.stdout.on('data',chunk=>{this.stdout+=chunk;this.#drain();});
    this.proc.stderr.on('data',chunk=>{this.stderr+=chunk;});
    this.proc.on('exit',(code,signal)=>{this.closed=true;if(this.pending){const pending=this.pending;this.pending=null;pending.reject(new Error(`persistent_psql_exited code=${code} signal=${signal??''} stderr=${this.stderr.slice(-1000)}`));}});
    await this.exec(`SET application_name=${lit(this.applicationName)};`);
  }
  #drain(){if(!this.pending)return;const {marker,resolve}=this.pending;const index=this.stdout.indexOf(marker);if(index<0)return;const before=this.stdout.slice(0,index);let after=this.stdout.slice(index+marker.length);after=after.replace(/^\r?\n/,'');this.stdout=after;this.pending=null;resolve(before.trim());}
  async #command(sql){if(this.closed)throw new Error('persistent_psql_closed');if(this.pending)throw new Error('persistent_psql_concurrent_command');const marker=`__WFM_RUNTIME_${process.pid}_${++markerCounter}__`;return new Promise((resolve,reject)=>{this.pending={marker,resolve,reject};this.proc.stdin.write(`${sql}\n\\echo ${marker}\n`);});}
  async exec(sql){await this.#command(sql);}
  async query(sql,values=[]){if(/^\s*SET\s+LOCAL\s+ROLE\b/i.test(sql)){await this.exec(interpolate(sql,values));return {rows:[]};}return parseRows(await this.#command(jsonSql(sql,values)));}
  async close(){if(!this.proc||this.closed)return;const exited=new Promise(resolve=>this.proc.once('exit',()=>resolve()));this.proc.stdin.end();await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,2000))]);if(!this.closed)this.proc.kill('SIGTERM');}
}

function makePermitStore(applicationName){
  return createPostgresAgencyWorkStartPermitStore({withTransaction:async evaluate=>{
    const session=new PersistentPsqlSession(applicationName);await session.start();
    try{await session.exec('BEGIN;');const value=await evaluate({query:(sql,values)=>session.query(sql,values)});await session.exec('COMMIT;');return value;}
    catch(error){try{await session.exec('ROLLBACK;');}catch{}throw error;}
    finally{await session.close();}
  }});
}

function bindingFingerprint({scope=SCOPE,subjectFingerprint=SUBJECT,assignmentFingerprint=ASSIGNMENT}={}){return digest(JSON.stringify(stable({tenantId:scope.tenantId,siteId:scope.siteId,requestId:scope.requestId,sourceSystemId:'turnstile',agencyId:scope.agencyId,workerId:scope.workerId,assignmentFingerprint,assuranceVersionId:ASSURANCE,subjectFingerprint})));}
function ingressSql({scope=SCOPE,assignmentFingerprint=ASSIGNMENT,eventFingerprint,subjectFingerprint,bindingFingerprint:binding,observedAt,receivedAt}){return interpolate(AGENCY_IDENTITY_OBSERVATION_BOUNDARY_APPEND_SQL,[scope.tenantId,scope.siteId,scope.requestId,scope.agencyId,scope.workerId,assignmentFingerprint,ASSURANCE,'turnstile',eventFingerprint,subjectFingerprint,'access_pass',observedAt,digest(`auth|${binding}`),binding,'agency-identity-observation-ingress-v0.2.0',receivedAt]);}
function writerIngressSql(args){return `SET LOCAL ROLE wfm_agency_identity_ingress_writer; ${ingressSql(args)} RESET ROLE;`;}

async function reset(){
  await psql('TRUNCATE wfm_agency_identity_observation_ingress_receipts, wfm_agency_identity_continuity_observations, wfm_agency_portal_token_consumptions, wfm_agency_rtw_assurance_current, wfm_agency_rtw_assurance_history;');
  await psql(`INSERT INTO wfm_agency_rtw_assurance_current (tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,assignment_fingerprint,evidence_fingerprint,check_method,checked_at,coverage_until,promoted_at,conflicted) VALUES (${lit(SCOPE.tenantId)},${lit(SCOPE.agencyId)},${lit(SCOPE.workerId)},${lit(ASSURANCE)},${lit(SCOPE.siteId)},${lit(SCOPE.requestId)},${lit(ASSIGNMENT)},${lit('d'.repeat(24))},'home_office_online','2026-10-04T10:00:00Z','2027-12-31T23:59:59Z','2026-10-04T11:00:00Z',false);`);
  const bindings=JSON.stringify([{workerId:SCOPE.workerId,assuranceVersionId:ASSURANCE}]).replaceAll("'","''");
  await psql(`INSERT INTO wfm_agency_portal_token_consumptions (tenant_id,token_id,site_id,request_id,agency_id,token_fingerprint,action,expires_at,consumed_at,assurance_bindings) VALUES (${lit(SCOPE.tenantId)},'TOK-START-RUNTIME',${lit(SCOPE.siteId)},${lit(SCOPE.requestId)},${lit(SCOPE.agencyId)},${lit('1'.repeat(16))},'confirm_preferred_worker','2026-10-05T15:00:00Z','2026-10-04T12:00:00Z','${bindings}'::jsonb);`);
  const binding=bindingFingerprint();
  await psql(`BEGIN; ${writerIngressSql({eventFingerprint:'2'.repeat(32),subjectFingerprint:SUBJECT,bindingFingerprint:binding,observedAt:'2026-10-05T05:58:00Z',receivedAt:'2026-10-05T05:58:10Z'})} COMMIT;`);
}

async function currentReadiness(){
  const query=(sql,values)=>queryOnce(sql,values);
  return evaluateAgencyWorkStartReadiness({tenantId:SCOPE.tenantId,siteId:SCOPE.siteId,agencyId:SCOPE.agencyId,request:structuredClone(REQUEST),workerId:SCOPE.workerId,now:NOW,policy:structuredClone(POLICY),authorityStore:createPostgresAgencyWorkStartAuthorityStore({query}),continuityStore:createPostgresAgencyIdentityContinuityStore({query})});
}
function commandFrom(readiness){return {type:'shadow_work_start_admission',tenantId:SCOPE.tenantId,siteId:SCOPE.siteId,requestId:SCOPE.requestId,agencyId:SCOPE.agencyId,workerId:SCOPE.workerId,assuranceVersionId:readiness.assuranceVersionId,assignmentFingerprint:readiness.assignmentFingerprint,acceptedResponseFingerprint:readiness.acceptedResponseFingerprint,authorityFingerprint:readiness.authorityFingerprint,continuityFingerprint:readiness.continuityFingerprint,policyFingerprint:readiness.policyFingerprint,readinessFingerprint:readiness.readinessFingerprint};}
function evaluateWithStore({readiness,applicationName,shadowWorkStartCommand}){return evaluateAgencyWorkStartPermit({tenantId:SCOPE.tenantId,siteId:SCOPE.siteId,agencyId:SCOPE.agencyId,request:structuredClone(REQUEST),workerId:SCOPE.workerId,now:NOW,policy:structuredClone(POLICY),readiness,permitStore:makePermitStore(applicationName),shadowWorkStartCommand});}

before(async()=>{if(!REQUIRED)return;try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for runtime work-start race proof: ${error.message}`);}await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();await psql(`${AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL}\n${AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL}\n${AGENCY_IDENTITY_CONTINUITY_DDL}\n${AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL}\n${AGENCY_IDENTITY_DB_BOUNDARY_DDL}\n${AGENCY_WORK_START_DB_BOUNDARY_DDL}`);});
after(async()=>{await stop();});

pgTest('actual readiness + permit runtime is privacy-minimised, one-shot and database-backed',async()=>{
  await reset();const readiness=await currentReadiness();assert.equal(readiness.workStartReady,true);assert.equal(readiness.rankingImpact,'none');
  let secondConsumeCode=null;let envelope=null;
  const result=await evaluateWithStore({readiness,applicationName:`wfm_runtime_valid_${process.pid}`,shadowWorkStartCommand:async permit=>{envelope=permit.consume(commandFrom(readiness));try{permit.consume(commandFrom(readiness));}catch(error){secondConsumeCode=error.code;}}});
  assert.equal(result.permitPassed,true);assert.equal(secondConsumeCode,'work_start_permit_already_consumed');assert.equal(envelope.acceptedForShadow,true);assert.equal(result.rankingImpact,'none');assert.equal(result.scheduleWriteAuthorized,false);assert.equal(result.clockingWriteAuthorized,false);assert.equal(result.payrollWriteAuthorized,false);assert.equal(result.workStartWriteAuthorized,false);assert.doesNotMatch(JSON.stringify(result),/BADGE|photo|biometric|share[-_]?code|document[-_]?number|raw[-_]?payload|portal[-_]?token/i);
});

pgTest('identity-first contradictory authenticated evidence serializes before the actual runtime and zero stale permit is exposed',async()=>{
  await reset();const readiness=await currentReadiness();assert.equal(readiness.workStartReady,true);
  const binding=bindingFingerprint({subjectFingerprint:ALT_SUBJECT});const identityName=`wfm_runtime_identity_first_${process.pid}`;
  const identity=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${lit(identityName)}; BEGIN; ${writerIngressSql({eventFingerprint:'3'.repeat(32),subjectFingerprint:ALT_SUBJECT,bindingFingerprint:binding,observedAt:'2026-10-05T05:59:00Z',receivedAt:'2026-10-05T05:59:10Z'})} SELECT pg_sleep(1.2); COMMIT;`],{timeout:10000});
  await waitForSleep(identityName);let exposed=0;const permitName=`wfm_runtime_permit_wait_${process.pid}`;
  const permit=evaluateWithStore({readiness,applicationName:permitName,shadowWorkStartCommand:async()=>{exposed+=1;}});
  await waitForLockWait(permitName);const [,result]=await Promise.all([identity,permit]);
  assert.equal(result.permitPassed,false);assert.equal(result.reason,'identity_continuity_subject_mismatch');assert.equal(exposed,0);assert.equal(result.workStartWriteAuthorized,false);
});

pgTest('work-start-first keeps authority transaction-scoped, blocks same assignment ingress and leaves unrelated assignment ingress independent',async()=>{
  await reset();const readiness=await currentReadiness();assert.equal(readiness.workStartReady,true);
  let enteredResolve,releaseResolve;const entered=new Promise(resolve=>{enteredResolve=resolve;});const release=new Promise(resolve=>{releaseResolve=resolve;});let envelope=null;let secondConsumeCode=null;
  const permitName=`wfm_runtime_permit_first_${process.pid}`;
  const permit=evaluateWithStore({readiness,applicationName:permitName,shadowWorkStartCommand:async oneShot=>{envelope=oneShot.consume(commandFrom(readiness));try{oneShot.consume(commandFrom(readiness));}catch(error){secondConsumeCode=error.code;}enteredResolve();await release;}});
  await entered;
  const binding=bindingFingerprint({subjectFingerprint:ALT_SUBJECT});const blockedName=`wfm_runtime_identity_wait_${process.pid}`;
  const blocked=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${lit(blockedName)}; BEGIN; ${writerIngressSql({eventFingerprint:'3'.repeat(32),subjectFingerprint:ALT_SUBJECT,bindingFingerprint:binding,observedAt:'2026-10-05T05:59:00Z',receivedAt:'2026-10-05T05:59:10Z'})} COMMIT;`],{timeout:10000});
  await waitForLockWait(blockedName);
  const otherScope={tenantId:SCOPE.tenantId,siteId:SCOPE.siteId,requestId:'R-OTHER',agencyId:SCOPE.agencyId,workerId:'W-OTHER'};const otherAssignment='f'.repeat(24),otherSubject='9'.repeat(32);const otherBinding=bindingFingerprint({scope:otherScope,subjectFingerprint:otherSubject,assignmentFingerprint:otherAssignment});
  await psql(`BEGIN; ${writerIngressSql({scope:otherScope,assignmentFingerprint:otherAssignment,eventFingerprint:'8'.repeat(32),subjectFingerprint:otherSubject,bindingFingerprint:otherBinding,observedAt:'2026-10-05T06:00:00Z',receivedAt:'2026-10-05T06:00:01Z'})} COMMIT;`,{timeout:3000});
  assert.equal(await scalar(`SELECT count(*) FROM wfm_agency_identity_continuity_observations WHERE tenant_id=${lit(SCOPE.tenantId)} AND request_id='R-OTHER' AND worker_id='W-OTHER';`),'1');
  releaseResolve();const result=await permit;await blocked;
  assert.equal(result.permitPassed,true);assert.equal(envelope.acceptedForShadow,true);assert.equal(secondConsumeCode,'work_start_permit_already_consumed');assert.equal(result.workStartWriteAuthorized,false);
  const after=await currentReadiness();assert.equal(after.workStartReady,false);assert.equal(after.reason,'identity_continuity_subject_mismatch');
});
