import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import {createPostgresAgencyWorkStartRuntime} from '../../src/frontier/agency-work-start-runtime.mjs';
import {AGENCY_IDENTITY_CONTINUITY_DDL} from '../../src/frontier/agency-identity-continuity.mjs';
import {AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL} from '../../src/frontier/agency-portal-token-store.mjs';
import {AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL} from '../../src/frontier/agency-right-to-work-assurance-ledger.mjs';
import {
  AGENCY_IDENTITY_OBSERVATION_BOUNDARY_APPEND_SQL,
  AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL,
} from '../../src/frontier/agency-identity-observation-ingress.mjs';
import {AGENCY_IDENTITY_DB_BOUNDARY_DDL} from '../../src/frontier/agency-identity-db-boundary.mjs';
import {AGENCY_WORK_START_CANONICAL_MIGRATION_DDL} from '../../src/frontier/agency-work-start-principal-lifecycle.mjs';

const execFileAsync=promisify(execFile);
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const CONTAINER=`wfm-agency-work-start-rotation-${process.pid}-${Date.now()}`;
const DB_USER='postgres',DB_NAME='postgres',DB_PASSWORD='agency-work-start-rotation-proof-only-not-a-secret';
const RUNTIME_PASSWORD='agency-runtime-rotation-proof-only-not-a-secret';
const OLD_RUNTIME_USER='wfm_work_start_runtime_rotation_old';
const NEW_RUNTIME_USER='wfm_work_start_runtime_rotation_new';
const NOW='2026-10-05T06:10:00.000Z';
const ASSURANCE='a'.repeat(32),SUBJECT='c'.repeat(32);
const REQUEST=Object.freeze({requestId:'R-START-ROTATE',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'});
const SCOPE=Object.freeze({tenantId:'T-START-ROTATE',siteId:'S-START-ROTATE',requestId:REQUEST.requestId,agencyId:'A-START-ROTATE',workerId:'W-START-ROTATE'});
const POLICY=Object.freeze({policyId:'S-START-ROTATE-PACK-v1',siteId:SCOPE.siteId,roleId:REQUEST.roleId,minutesBeforeStart:60,minutesAfterStart:90,minIndependentSources:1,requireDirectIdentity:false,allowedSources:Object.freeze({turnstile:Object.freeze(['access_pass'])})});
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=(v,n=32)=>crypto.createHash('sha256').update(String(v??'')).digest('hex').slice(0,n);
const ASSIGNMENT=digest(JSON.stringify(stable({roleId:REQUEST.roleId,location:REQUEST.location,startAt:REQUEST.startAt,endAt:REQUEST.endAt})),24);
let started=false;
let markerCounter=0;

async function docker(args,options={}){return execFileAsync('docker',args,{maxBuffer:8*1024*1024,timeout:options.timeout??30000,encoding:'utf8'});}
function lit(value){if(value==null)return 'NULL';if(typeof value==='number')return String(value);if(typeof value==='boolean')return value?'TRUE':'FALSE';return `'${String(value).replaceAll("'","''")}'`;}
function interpolate(sql,values=[]){return sql.replace(/\$(\d+)/g,(_,n)=>lit(values[Number(n)-1]));}
function jsonSql(sql,values=[]){const statement=interpolate(sql,values).trim().replace(/;\s*$/,'');return `SELECT COALESCE(json_agg(row_to_json(wfm_q)),'[]'::json)::text FROM (${statement}) AS wfm_q;`;}
function parseRows(stdout){const lines=String(stdout??'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);const rows=JSON.parse(lines.at(-1)??'[]');if(!Array.isArray(rows))throw new Error('postgres_json_result_invalid');return {rows};}
async function psql(sql,options={}){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-A','-t','-c',sql],options);return stdout;}
async function scalar(sql){const out=await psql(sql);return out.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).at(-1)??null;}
async function waitForPostgres(){let init=false;for(let i=0;i<80;i+=1){try{const logs=await docker(['logs',CONTAINER],{timeout:5000});const all=`${logs.stdout??''}\n${logs.stderr??''}`;init||=all.includes('PostgreSQL init process complete; ready for start up.');if(init&&(await psql('SELECT 1;',{timeout:5000})).trim()==='1')return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('postgres final server did not become ready');}
async function stop(){if(!started)return;try{await docker(['rm','-f',CONTAINER],{timeout:10000});}catch{}started=false;}
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}

class PersistentPsqlSession{
  constructor(applicationName,{user,password}={}){this.applicationName=applicationName;this.user=user;this.password=password;this.proc=null;this.stdout='';this.stderr='';this.pending=null;this.closed=false;}
  async start(){
    this.proc=spawn('docker',['exec','-i','-e',`PGPASSWORD=${this.password}`,CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U',this.user,'-d',DB_NAME,'-A','-t'],{stdio:['pipe','pipe','pipe']});
    this.proc.stdout.setEncoding('utf8');this.proc.stderr.setEncoding('utf8');
    this.proc.stdout.on('data',chunk=>{this.stdout+=chunk;this.#drain();});
    this.proc.stderr.on('data',chunk=>{this.stderr+=chunk;});
    this.proc.on('exit',(code,signal)=>{this.closed=true;if(this.pending){const pending=this.pending;this.pending=null;pending.reject(new Error(`persistent_psql_exited code=${code} signal=${signal??''} stderr=${this.stderr.slice(-1000)}`));}});
    await this.exec(`SET application_name=${lit(this.applicationName)};`);
  }
  #drain(){if(!this.pending)return;const {marker,resolve}=this.pending;const index=this.stdout.indexOf(marker);if(index<0)return;const before=this.stdout.slice(0,index);let after=this.stdout.slice(index+marker.length);after=after.replace(/^\r?\n/,'');this.stdout=after;this.pending=null;resolve(before.trim());}
  async #command(sql){if(this.closed)throw new Error('persistent_psql_closed');if(this.pending)throw new Error('persistent_psql_concurrent_command');const marker=`__WFM_ROTATION_${process.pid}_${++markerCounter}__`;return new Promise((resolve,reject)=>{this.pending={marker,resolve,reject};this.proc.stdin.write(`${sql}\n\\echo ${marker}\n`);});}
  async exec(sql){await this.#command(sql);}
  async query(sql,values=[]){if(/^\s*SET\s+LOCAL\s+ROLE\b/i.test(sql)){await this.exec(interpolate(sql,values));return {rows:[]};}return parseRows(await this.#command(jsonSql(sql,values)));}
  async close(){if(!this.proc||this.closed)return;const exited=new Promise(resolve=>this.proc.once('exit',()=>resolve()));this.proc.stdin.end();await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,2000))]);if(!this.closed)this.proc.kill('SIGTERM');}
}

async function makePooledRuntime(applicationName,user){
  const session=new PersistentPsqlSession(applicationName,{user,password:RUNTIME_PASSWORD});
  await session.start();
  const withTransaction=async evaluate=>{
    try{
      await session.exec('BEGIN;');
      const value=await evaluate({query:(sql,values)=>session.query(sql,values)});
      await session.exec('COMMIT;');
      return value;
    }catch(error){
      try{if(!session.closed)await session.exec('ROLLBACK;');}catch{}
      throw error;
    }
  };
  return {runtime:createPostgresAgencyWorkStartRuntime({withTransaction}),session};
}

function makeOneShotRuntime(applicationName,user){
  return createPostgresAgencyWorkStartRuntime({withTransaction:async evaluate=>{
    const session=new PersistentPsqlSession(applicationName,{user,password:RUNTIME_PASSWORD});
    await session.start();
    try{await session.exec('BEGIN;');const value=await evaluate({query:(sql,values)=>session.query(sql,values)});await session.exec('COMMIT;');return value;}
    catch(error){try{if(!session.closed)await session.exec('ROLLBACK;');}catch{}throw error;}
    finally{await session.close();}
  }});
}

function bindingFingerprint(){return digest(JSON.stringify(stable({tenantId:SCOPE.tenantId,siteId:SCOPE.siteId,requestId:SCOPE.requestId,sourceSystemId:'turnstile',agencyId:SCOPE.agencyId,workerId:SCOPE.workerId,assignmentFingerprint:ASSIGNMENT,assuranceVersionId:ASSURANCE,subjectFingerprint:SUBJECT})));}
function ingressSql(){const binding=bindingFingerprint();return interpolate(AGENCY_IDENTITY_OBSERVATION_BOUNDARY_APPEND_SQL,[SCOPE.tenantId,SCOPE.siteId,SCOPE.requestId,SCOPE.agencyId,SCOPE.workerId,ASSIGNMENT,ASSURANCE,'turnstile','2'.repeat(32),SUBJECT,'access_pass','2026-10-05T05:58:00Z',digest(`auth|${binding}`),binding,'agency-identity-observation-ingress-v0.2.0','2026-10-05T05:58:10Z']);}
function adminSql(sql){return `BEGIN; SET LOCAL ROLE wfm_agency_work_start_tenant_binding_admin; ${sql} COMMIT;`;}
function runtimeInput(overrides={}){return {tenantId:SCOPE.tenantId,siteId:SCOPE.siteId,agencyId:SCOPE.agencyId,request:structuredClone(REQUEST),workerId:SCOPE.workerId,now:NOW,policy:structuredClone(POLICY),...overrides};}
function commandFrom(readiness){return {type:'shadow_work_start_admission',tenantId:SCOPE.tenantId,siteId:SCOPE.siteId,requestId:SCOPE.requestId,agencyId:SCOPE.agencyId,workerId:SCOPE.workerId,assuranceVersionId:readiness.assuranceVersionId,assignmentFingerprint:readiness.assignmentFingerprint,acceptedResponseFingerprint:readiness.acceptedResponseFingerprint,authorityFingerprint:readiness.authorityFingerprint,continuityFingerprint:readiness.continuityFingerprint,policyFingerprint:readiness.policyFingerprint,readinessFingerprint:readiness.readinessFingerprint};}

async function seed(){
  await psql('TRUNCATE wfm_agency_identity_observation_ingress_receipts, wfm_agency_identity_continuity_observations, wfm_agency_portal_token_consumptions, wfm_agency_rtw_assurance_current, wfm_agency_rtw_assurance_history;');
  await psql(`INSERT INTO wfm_agency_rtw_assurance_current (tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,assignment_fingerprint,evidence_fingerprint,check_method,checked_at,coverage_until,promoted_at,conflicted) VALUES (${lit(SCOPE.tenantId)},${lit(SCOPE.agencyId)},${lit(SCOPE.workerId)},${lit(ASSURANCE)},${lit(SCOPE.siteId)},${lit(SCOPE.requestId)},${lit(ASSIGNMENT)},${lit('d'.repeat(24))},'home_office_online','2026-10-04T10:00:00Z','2027-12-31T23:59:59Z','2026-10-04T11:00:00Z',false);`);
  const bindings=JSON.stringify([{workerId:SCOPE.workerId,assuranceVersionId:ASSURANCE}]).replaceAll("'","''");
  await psql(`INSERT INTO wfm_agency_portal_token_consumptions (tenant_id,token_id,site_id,request_id,agency_id,token_fingerprint,action,expires_at,consumed_at,assurance_bindings) VALUES (${lit(SCOPE.tenantId)},'TOK-START-ROTATE',${lit(SCOPE.siteId)},${lit(SCOPE.requestId)},${lit(SCOPE.agencyId)},${lit('1'.repeat(16))},'confirm_preferred_worker','2026-10-05T15:00:00Z','2026-10-04T12:00:00Z','${bindings}'::jsonb);`);
  await psql(`BEGIN; SET LOCAL ROLE wfm_agency_identity_ingress_writer; ${ingressSql()} RESET ROLE; COMMIT;`);
}

before(async()=>{
  if(!REQUIRED)return;
  try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for credential-rotation proof: ${error.message}`);}
  await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();
  await psql(`${AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL}\n${AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL}\n${AGENCY_IDENTITY_CONTINUITY_DDL}\n${AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL}\n${AGENCY_IDENTITY_DB_BOUNDARY_DDL}\n${AGENCY_WORK_START_CANONICAL_MIGRATION_DDL}`);
  await psql(`
CREATE ROLE ${OLD_RUNTIME_USER} LOGIN PASSWORD ${lit(RUNTIME_PASSWORD)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE ${NEW_RUNTIME_USER} LOGIN PASSWORD ${lit(RUNTIME_PASSWORD)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT wfm_agency_work_start_reader TO ${OLD_RUNTIME_USER},${NEW_RUNTIME_USER};
`);
  await psql(adminSql(`SELECT public.wfm_bind_agency_work_start_principal_v1('${OLD_RUNTIME_USER}',${lit(SCOPE.tenantId)},'${'4'.repeat(24)}');`));
});
after(async()=>{await stop();});

pgTest('mid-flight principal revocation invalidates an already-open pooled session and rotation requires fresh readiness under the new principal',async()=>{
  await seed();
  const oldPool=await makePooledRuntime(`wfm_rotation_old_pool_${process.pid}`,OLD_RUNTIME_USER);
  try{
    const oldReadiness=await oldPool.runtime.evaluateReadiness(runtimeInput());
    assert.equal(oldReadiness.workStartReady,true);
    assert.equal(oldReadiness.rankingImpact,'none');

    await psql(adminSql(`SELECT public.wfm_revoke_agency_work_start_principal_v1('${OLD_RUNTIME_USER}',${lit(SCOPE.tenantId)},'${'7'.repeat(24)}');`));
    assert.equal(await scalar(`SELECT (revoked_at IS NOT NULL)::text FROM public.wfm_agency_work_start_principal_tenants WHERE database_principal='${OLD_RUNTIME_USER}';`),'true');

    let exposed=0;
    const revokedPermit=await oldPool.runtime.evaluatePermit(runtimeInput({readiness:oldReadiness,shadowWorkStartCommand:async()=>{exposed+=1;}}));
    assert.equal(revokedPermit.permitPassed,false);
    assert.equal(revokedPermit.reason,'work_start_permit_store_unavailable');
    assert.equal(exposed,0);
    assert.equal(oldPool.session.closed,true);

    const replay=await oldPool.runtime.evaluatePermit(runtimeInput({readiness:oldReadiness,shadowWorkStartCommand:async()=>{exposed+=1;}}));
    assert.equal(replay.permitPassed,false);
    assert.equal(replay.reason,'work_start_runtime_precheck_already_used');
    assert.equal(exposed,0);

    const oldCredentialRuntime=makeOneShotRuntime(`wfm_rotation_old_new_connection_${process.pid}`,OLD_RUNTIME_USER);
    await assert.rejects(()=>oldCredentialRuntime.evaluateReadiness(runtimeInput()),/work_start_tenant_principal_revoked/i);

    await psql(adminSql(`SELECT public.wfm_bind_agency_work_start_principal_v1('${NEW_RUNTIME_USER}',${lit(SCOPE.tenantId)},'${'8'.repeat(24)}');`));
    assert.equal(await scalar(`SELECT (revoked_at IS NULL)::text FROM public.wfm_agency_work_start_principal_tenants WHERE database_principal='${NEW_RUNTIME_USER}';`),'true');

    const freshPool=await makePooledRuntime(`wfm_rotation_new_pool_${process.pid}`,NEW_RUNTIME_USER);
    try{
      const crossRuntimeReplay=await freshPool.runtime.evaluatePermit(runtimeInput({readiness:oldReadiness,shadowWorkStartCommand:async()=>{exposed+=1;}}));
      assert.equal(crossRuntimeReplay.permitPassed,false);
      assert.equal(crossRuntimeReplay.reason,'work_start_runtime_precheck_untrusted');
      assert.equal(exposed,0);

      const freshReadiness=await freshPool.runtime.evaluateReadiness(runtimeInput());
      assert.equal(freshReadiness.workStartReady,true);
      let envelope=null;
      const result=await freshPool.runtime.evaluatePermit(runtimeInput({readiness:freshReadiness,shadowWorkStartCommand:async permit=>{envelope=permit.consume(commandFrom(freshReadiness));}}));
      assert.equal(result.permitPassed,true);
      assert.equal(result.rankingImpact,'none');
      assert.equal(result.scheduleWriteAuthorized,false);
      assert.equal(result.clockingWriteAuthorized,false);
      assert.equal(result.payrollWriteAuthorized,false);
      assert.equal(freshPool.runtime.invoiceWriteAuthorized,false);
      assert.equal(result.workStartWriteAuthorized,false);
      assert.equal(envelope.acceptedForShadow,true);
      assert.doesNotMatch(JSON.stringify(result),/photo|biometric|share[-_]?code|document[-_]?number|raw[-_]?payload|portal[-_]?token/i);
    }finally{
      await freshPool.session.close();
    }
  }finally{
    await oldPool.session.close();
  }
});
