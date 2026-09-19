import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import {AGENCY_IDENTITY_CONTINUITY_DDL} from '../../src/frontier/agency-identity-continuity.mjs';
import {AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL} from '../../src/frontier/agency-identity-observation-ingress.mjs';
import {AGENCY_IDENTITY_SCOPE_LOCK_SQL,deriveAgencyIdentityScopeLock} from '../../src/frontier/agency-identity-scope-lock.mjs';

const execFileAsync=promisify(execFile);
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const CONTAINER=`wfm-agency-identity-ingress-${process.pid}-${Date.now()}`;
const DB_USER='postgres',DB_NAME='postgres',DB_PASSWORD='agency-identity-ingress-proof-only-not-a-secret';
const ASSIGNMENT='a'.repeat(24),ASSURANCE='b'.repeat(32),SUBJECT='c'.repeat(32),ALT_SUBJECT='d'.repeat(32);
const SCOPE={tenantId:'T1',siteId:'S1',requestId:'R1',agencyId:'A1',workerId:'W1',assignmentFingerprint:ASSIGNMENT};
const LOCK=deriveAgencyIdentityScopeLock(SCOPE);
let started=false;

async function docker(args,options={}){return execFileAsync('docker',args,{maxBuffer:8*1024*1024,timeout:options.timeout??30000,encoding:'utf8'});}
function lit(value){return `'${String(value).replaceAll("'","''")}'`;}
function interpolate(sql,values=[]){return sql.replace(/\$(\d+)/g,(_,n)=>lit(values[Number(n)-1]));}
async function psql(sql,options={}){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-A','-t','-c',sql],options);return stdout;}
async function scalar(sql){const out=await psql(sql);return out.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).at(-1)??null;}
async function waitForPostgres(){let init=false;for(let i=0;i<80;i+=1){try{const logs=await docker(['logs',CONTAINER],{timeout:5000});const all=`${logs.stdout??''}\n${logs.stderr??''}`;init||=all.includes('PostgreSQL init process complete; ready for start up.');if(init&&(await psql('SELECT 1;',{timeout:5000})).trim()==='1')return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('postgres final server did not become ready');}
async function waitForSleep(name){for(let i=0;i<60;i+=1){if(Number(await scalar(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${lit(name)} AND wait_event='PgSleep';`))===1)return;await new Promise(r=>setTimeout(r,50));}throw new Error(`${name} did not reach held sleep`);}
async function waitForLockWait(name){for(let i=0;i<60;i+=1){if(Number(await scalar(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${lit(name)} AND wait_event_type='Lock';`))===1)return;await new Promise(r=>setTimeout(r,50));}throw new Error(`${name} did not reach lock wait`);}
async function stop(){if(!started)return;try{await docker(['rm','-f',CONTAINER],{timeout:10000});}catch{}started=false;}
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}

before(async()=>{if(!REQUIRED)return;try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for identity observation ingress PostgreSQL proof: ${error.message}`);}await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();await psql(`${AGENCY_IDENTITY_CONTINUITY_DDL}\n${AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL}`);});
after(async()=>{await stop();});
async function reset(){await psql('TRUNCATE wfm_agency_identity_observation_ingress_receipts, wfm_agency_identity_continuity_observations;');}
const scopeLockSql=(lock=LOCK)=>interpolate(AGENCY_IDENTITY_SCOPE_LOCK_SQL,[lock.advisoryKey]);
const fp=value=>crypto.createHash('sha256').update(value).digest('hex').slice(0,32);
function ingressSql({event='1'.repeat(32),subject=SUBJECT,signal='access_pass',auth=fp(`auth|${subject}|${signal}`),binding=fp(`binding|${subject}`)}={}){
 return `INSERT INTO wfm_agency_identity_observation_ingress_receipts (tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint,binding_fingerprint,ingress_version,received_at) VALUES ('T1','turnstile','${event}','${auth}','${binding}','agency-identity-observation-ingress-v0.2.0','2026-10-05T05:58:10Z') ON CONFLICT (tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint) DO NOTHING;\nINSERT INTO wfm_agency_identity_continuity_observations (tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,assurance_version_id,source_system_id,source_event_fingerprint,subject_fingerprint,signal_type,observed_at) VALUES ('T1','S1','R1','A1','W1','${ASSIGNMENT}','${ASSURANCE}','turnstile','${event}','${subject}','${signal}','2026-10-05T05:58:00Z') ON CONFLICT (tenant_id,source_system_id,source_event_fingerprint) DO NOTHING;`;
}

pgTest('32 concurrent authenticated replay transactions converge to one durable observation and one provenance receipt under one assignment-scoped lock',async()=>{
 await reset();
 const tx=`BEGIN; ${scopeLockSql()} ${ingressSql()} COMMIT;`;
 await Promise.all(Array.from({length:32},()=>psql(tx,{timeout:10000})));
 assert.equal(await scalar('SELECT count(*) FROM wfm_agency_identity_continuity_observations;'),'1');
 assert.equal(await scalar('SELECT count(*) FROM wfm_agency_identity_observation_ingress_receipts;'),'1');
});

pgTest('conflicting authenticated payload with the same provider event waits for the same assignment lock and cannot replace the first durable identity truth',async()=>{
 await reset();const firstName=`wfm_identity_first_${process.pid}`,secondName=`wfm_identity_second_${process.pid}`;
 const first=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${lit(firstName)}; BEGIN; ${scopeLockSql()} ${ingressSql()} SELECT pg_sleep(1.2); COMMIT;`],{timeout:10000});
 await waitForSleep(firstName);
 const second=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${lit(secondName)}; BEGIN; ${scopeLockSql()} ${ingressSql({subject:ALT_SUBJECT,signal:'attendance_clock_in'})} COMMIT;`],{timeout:10000});
 await waitForLockWait(secondName);await Promise.all([first,second]);
 assert.equal(await scalar('SELECT count(*) FROM wfm_agency_identity_continuity_observations;'),'1');
 assert.equal(await scalar(`SELECT subject_fingerprint FROM wfm_agency_identity_continuity_observations WHERE tenant_id='T1' AND source_system_id='turnstile' AND source_event_fingerprint='${'1'.repeat(32)}';`),SUBJECT);
 assert.equal(await scalar('SELECT count(*) FROM wfm_agency_identity_observation_ingress_receipts;'),'2');
});

pgTest('an unrelated worker assignment gets a different advisory lock and is not stalled by this assignment',async()=>{
 await reset();const holderName=`wfm_identity_scope_holder_${process.pid}`;
 const holder=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${lit(holderName)}; BEGIN; ${scopeLockSql()} SELECT pg_sleep(1.2); COMMIT;`],{timeout:10000});
 await waitForSleep(holderName);
 const unrelated=deriveAgencyIdentityScopeLock({...SCOPE,workerId:'W2'});assert.notEqual(unrelated.advisoryKey,LOCK.advisoryKey);
 const out=await psql(`BEGIN; ${scopeLockSql(unrelated)} SELECT 'unrelated-ok'; COMMIT;`,{timeout:3000});assert.match(out,/unrelated-ok/);
 await holder;
});

pgTest('provenance receipts remain append-only and contain fingerprints only',async()=>{
 await reset();await psql(`BEGIN; ${scopeLockSql()} ${ingressSql()} COMMIT;`);
 await assert.rejects(()=>psql("UPDATE wfm_agency_identity_observation_ingress_receipts SET ingress_version='tampered' WHERE tenant_id='T1';"));
 await assert.rejects(()=>psql("DELETE FROM wfm_agency_identity_observation_ingress_receipts WHERE tenant_id='T1';"));
 const dump=await psql("SELECT source_event_fingerprint,source_auth_fingerprint,binding_fingerprint,ingress_version FROM wfm_agency_identity_observation_ingress_receipts WHERE tenant_id='T1';");
 assert.doesNotMatch(dump,/raw-badge|BADGE|photo|biometric|signature|payload/i);assert.equal(await scalar('SELECT count(*) FROM wfm_agency_identity_observation_ingress_receipts;'),'1');
});
