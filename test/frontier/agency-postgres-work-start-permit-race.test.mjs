import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import {
  AGENCY_WORK_START_PERMIT_LOCK_SQL,
  AGENCY_WORK_START_IDENTITY_RECEIPT_BARRIER_SQL,
  AGENCY_WORK_START_IDENTITY_OBSERVATION_BARRIER_SQL,
} from '../../src/frontier/agency-work-start-permit.mjs';
import {AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL} from '../../src/frontier/agency-portal-token-store.mjs';
import {AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL} from '../../src/frontier/agency-right-to-work-assurance-ledger.mjs';
import {AGENCY_IDENTITY_CONTINUITY_DDL} from '../../src/frontier/agency-identity-continuity.mjs';
import {AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL} from '../../src/frontier/agency-identity-observation-ingress.mjs';

const execFileAsync=promisify(execFile);
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const CONTAINER=`wfm-agency-work-start-permit-${process.pid}-${Date.now()}`;
const DB_USER='postgres',DB_NAME='postgres',DB_PASSWORD='agency-work-start-permit-proof-only-not-a-secret';
const OLD='a'.repeat(32),NEW='b'.repeat(32),SUBJECT='c'.repeat(32),ALT_SUBJECT='e'.repeat(32);let started=false;
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=(v,n=32)=>crypto.createHash('sha256').update(String(v??'')).digest('hex').slice(0,n);
const ASSIGNMENT=digest(JSON.stringify(stable({roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'})),24);
const bindingFor=subjectFingerprint=>digest(JSON.stringify(stable({tenantId:'T-START-PERMIT',siteId:'S-START-PERMIT',requestId:'R-START-PERMIT',sourceSystemId:'turnstile',agencyId:'A-START-PERMIT',workerId:'W-START-PERMIT',assignmentFingerprint:ASSIGNMENT,assuranceVersionId:OLD,subjectFingerprint})));
const BINDING=bindingFor(SUBJECT),ALT_BINDING=bindingFor(ALT_SUBJECT);
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

before(async()=>{if(!REQUIRED)return;try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for work-start permit race proof: ${error.message}`);}await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();await psql(`${AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL}\n${AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL}\n${AGENCY_IDENTITY_CONTINUITY_DDL}\n${AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL}\nCREATE TABLE wfm_agency_work_start_shadow_proof (command_id text PRIMARY KEY, assurance_version_id text NOT NULL, continuity_event_fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());`);});
after(async()=>{await stop();});

async function reset(){
  await psql('TRUNCATE wfm_agency_work_start_shadow_proof, wfm_agency_identity_observation_ingress_receipts, wfm_agency_identity_continuity_observations, wfm_agency_portal_token_consumptions, wfm_agency_rtw_assurance_current, wfm_agency_rtw_assurance_history;');
  await psql(`INSERT INTO wfm_agency_rtw_assurance_current (tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,assignment_fingerprint,evidence_fingerprint,check_method,checked_at,coverage_until,promoted_at,conflicted) VALUES ('T-START-PERMIT','A-START-PERMIT','W-START-PERMIT','${OLD}','S-START-PERMIT','R-START-PERMIT','${ASSIGNMENT}','${'d'.repeat(24)}','home_office_online','2026-10-04T10:00:00Z','2027-12-31T23:59:59Z','2026-10-04T11:00:00Z',false);`);
  const bindings=JSON.stringify([{workerId:'W-START-PERMIT',assuranceVersionId:OLD}]).replaceAll("'","''");
  await psql(`INSERT INTO wfm_agency_portal_token_consumptions (tenant_id,token_id,site_id,request_id,agency_id,token_fingerprint,action,expires_at,consumed_at,assurance_bindings) VALUES ('T-START-PERMIT','TOK-START-PERMIT','S-START-PERMIT','R-START-PERMIT','A-START-PERMIT','${'1'.repeat(16)}','confirm_preferred_worker','2026-10-05T05:00:00Z','2026-10-04T12:00:00Z','${bindings}'::jsonb);`);
  const event='2'.repeat(32),auth=digest(`auth|${BINDING}`);
  await psql(`INSERT INTO wfm_agency_identity_continuity_observations (tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,assurance_version_id,source_system_id,source_event_fingerprint,subject_fingerprint,signal_type,observed_at) VALUES ('T-START-PERMIT','S-START-PERMIT','R-START-PERMIT','A-START-PERMIT','W-START-PERMIT','${ASSIGNMENT}','${OLD}','turnstile','${event}','${SUBJECT}','access_pass','2026-10-05T05:58:00Z');`);
  await psql(`INSERT INTO wfm_agency_identity_observation_ingress_receipts (tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint,binding_fingerprint,ingress_version,received_at) VALUES ('T-START-PERMIT','turnstile','${event}','${auth}','${BINDING}','agency-identity-observation-ingress-v0.1.0','2026-10-05T05:58:10Z');`);
}
const VALUES=['T-START-PERMIT','S-START-PERMIT','R-START-PERMIT','A-START-PERMIT','W-START-PERMIT','2026-10-05T06:10:00Z'];
const lockedSql=()=>interpolate(AGENCY_WORK_START_PERMIT_LOCK_SQL,VALUES);
const barrierSql=()=>`${AGENCY_WORK_START_IDENTITY_RECEIPT_BARRIER_SQL}\n${AGENCY_WORK_START_IDENTITY_OBSERVATION_BARRIER_SQL}`;
const proofInsert=commandId=>`INSERT INTO wfm_agency_work_start_shadow_proof(command_id,assurance_version_id,continuity_event_fingerprint)
SELECT ${lit(commandId)},current.assurance_version_id,o.source_event_fingerprint
FROM wfm_agency_rtw_assurance_current current
JOIN wfm_agency_identity_continuity_observations o ON o.tenant_id=current.tenant_id AND o.agency_id=current.agency_id AND o.worker_id=current.worker_id AND o.assurance_version_id=current.assurance_version_id AND o.assignment_fingerprint=current.assignment_fingerprint
WHERE current.tenant_id='T-START-PERMIT' AND current.agency_id='A-START-PERMIT' AND current.worker_id='W-START-PERMIT' AND current.assurance_version_id='${OLD}' AND current.conflicted=false
  AND o.site_id='S-START-PERMIT' AND o.request_id='R-START-PERMIT' AND o.source_system_id='turnstile' AND o.source_event_fingerprint='${'2'.repeat(32)}'
  AND EXISTS (SELECT 1 FROM wfm_agency_identity_observation_ingress_receipts r WHERE r.tenant_id=o.tenant_id AND r.source_system_id=o.source_system_id AND r.source_event_fingerprint=o.source_event_fingerprint AND r.binding_fingerprint='${BINDING}')
  AND EXISTS (SELECT 1 FROM wfm_agency_portal_token_consumptions p CROSS JOIN LATERAL jsonb_array_elements(p.assurance_bindings) b WHERE p.tenant_id='T-START-PERMIT' AND p.site_id='S-START-PERMIT' AND p.request_id='R-START-PERMIT' AND p.agency_id='A-START-PERMIT' AND p.action='confirm_preferred_worker' AND b->>'workerId'='W-START-PERMIT' AND lower(b->>'assuranceVersionId')='${OLD}');`;
const strictProofInsert=commandId=>`${proofInsert(commandId).replace(/;\s*$/,'')}
  AND NOT EXISTS (
    SELECT 1 FROM wfm_agency_identity_continuity_observations x
    WHERE x.tenant_id='T-START-PERMIT' AND x.site_id='S-START-PERMIT' AND x.request_id='R-START-PERMIT'
      AND x.agency_id='A-START-PERMIT' AND x.worker_id='W-START-PERMIT' AND x.assignment_fingerprint='${ASSIGNMENT}'
      AND x.assurance_version_id='${OLD}' AND x.subject_fingerprint <> '${SUBJECT}'
  );`;
const contradictoryIngressSql=()=>{
  const event='3'.repeat(32),auth=digest(`auth|${ALT_BINDING}`);
  return `INSERT INTO wfm_agency_identity_observation_ingress_receipts (tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint,binding_fingerprint,ingress_version,received_at) VALUES ('T-START-PERMIT','turnstile','${event}','${auth}','${ALT_BINDING}','agency-identity-observation-ingress-v0.1.0','2026-10-05T05:59:10Z');
INSERT INTO wfm_agency_identity_continuity_observations (tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,assurance_version_id,source_system_id,source_event_fingerprint,subject_fingerprint,signal_type,observed_at) VALUES ('T-START-PERMIT','S-START-PERMIT','R-START-PERMIT','A-START-PERMIT','W-START-PERMIT','${ASSIGNMENT}','${OLD}','turnstile','${event}','${ALT_SUBJECT}','access_pass','2026-10-05T05:59:00Z');`;
};

pgTest('an RTW update already in flight wins before work-start permit lock acquisition and zero stale shadow admissions escape',async()=>{
  await reset();const updaterName=`wfm_work_start_permit_first_update_${process.pid}`;
  const updater=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${lit(updaterName)}; BEGIN; UPDATE wfm_agency_rtw_assurance_current SET assurance_version_id='${NEW}',promoted_at='2026-10-05T06:00:00Z' WHERE tenant_id='T-START-PERMIT' AND agency_id='A-START-PERMIT' AND worker_id='W-START-PERMIT'; SELECT pg_sleep(1.2); COMMIT;`],{timeout:10000});
  await waitForSleep(updaterName);const permit=psql(`BEGIN; ${barrierSql()} ${lockedSql()} ${proofInsert('START-STALE')} COMMIT;`,{timeout:10000});await Promise.all([updater,permit]);
  assert.equal(await scalar("SELECT count(*) FROM wfm_agency_work_start_shadow_proof WHERE command_id='START-STALE';"),'0');assert.equal(await scalar("SELECT assurance_version_id FROM wfm_agency_rtw_assurance_current WHERE tenant_id='T-START-PERMIT' AND agency_id='A-START-PERMIT' AND worker_id='W-START-PERMIT';"),NEW);
});

pgTest('a valid shadow work-start admission is created only while current RTW and accepted-response rows remain locked in the same transaction',async()=>{
  await reset();const permitName=`wfm_work_start_permit_holder_${process.pid}`;const updaterName=`wfm_work_start_permit_waiting_update_${process.pid}`;
  const permit=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${lit(permitName)}; BEGIN; ${barrierSql()} ${lockedSql()} ${proofInsert('START-VALID')} SELECT pg_sleep(1.2); COMMIT;`],{timeout:10000});
  await waitForSleep(permitName);const updater=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${lit(updaterName)}; UPDATE wfm_agency_rtw_assurance_current SET assurance_version_id='${NEW}',promoted_at='2026-10-05T06:11:00Z' WHERE tenant_id='T-START-PERMIT' AND agency_id='A-START-PERMIT' AND worker_id='W-START-PERMIT';`],{timeout:10000});
  await waitForLockWait(updaterName);assert.equal(await scalar("SELECT count(*) FROM wfm_agency_work_start_shadow_proof WHERE command_id='START-VALID';"),'0');await permit;await updater;
  assert.equal(await scalar("SELECT assurance_version_id FROM wfm_agency_work_start_shadow_proof WHERE command_id='START-VALID';"),OLD);assert.equal(await scalar("SELECT assurance_version_id FROM wfm_agency_rtw_assurance_current WHERE tenant_id='T-START-PERMIT' AND agency_id='A-START-PERMIT' AND worker_id='W-START-PERMIT';"),NEW);
});

pgTest('authenticated contradictory identity evidence already in flight commits before the work-start barrier and produces zero stale admissions',async()=>{
  await reset();const ingressName=`wfm_identity_ingress_first_${process.pid}`;const permitName=`wfm_work_start_barrier_wait_${process.pid}`;
  const ingress=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${lit(ingressName)}; BEGIN; ${contradictoryIngressSql()} SELECT pg_sleep(1.2); COMMIT;`],{timeout:10000});
  await waitForSleep(ingressName);
  const permit=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${lit(permitName)}; BEGIN; ${barrierSql()} ${lockedSql()} ${strictProofInsert('START-IDENTITY-CONFLICT')} COMMIT;`],{timeout:10000});
  await waitForLockWait(permitName);await Promise.all([ingress,permit]);
  assert.equal(await scalar("SELECT count(*) FROM wfm_agency_work_start_shadow_proof WHERE command_id='START-IDENTITY-CONFLICT';"),'0');
  assert.equal(await scalar(`SELECT count(*) FROM wfm_agency_identity_continuity_observations WHERE tenant_id='T-START-PERMIT' AND source_event_fingerprint='${'3'.repeat(32)}';`),'1');
});

pgTest('work-start identity write barrier serializes a later contradictory ingress until the shadow admission transaction completes',async()=>{
  await reset();const permitName=`wfm_work_start_barrier_first_${process.pid}`;const ingressName=`wfm_identity_ingress_wait_${process.pid}`;
  const permit=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${lit(permitName)}; BEGIN; ${barrierSql()} ${lockedSql()} ${strictProofInsert('START-IDENTITY-SERIALIZED')} SELECT pg_sleep(1.2); COMMIT;`],{timeout:10000});
  await waitForSleep(permitName);
  const ingress=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${lit(ingressName)}; BEGIN; ${contradictoryIngressSql()} COMMIT;`],{timeout:10000});
  await waitForLockWait(ingressName);
  assert.equal(await scalar(`SELECT count(*) FROM wfm_agency_identity_continuity_observations WHERE tenant_id='T-START-PERMIT' AND source_event_fingerprint='${'3'.repeat(32)}';`),'0');
  await permit;await ingress;
  assert.equal(await scalar("SELECT count(*) FROM wfm_agency_work_start_shadow_proof WHERE command_id='START-IDENTITY-SERIALIZED';"),'1');
  assert.equal(await scalar(`SELECT count(*) FROM wfm_agency_identity_continuity_observations WHERE tenant_id='T-START-PERMIT' AND source_event_fingerprint='${'3'.repeat(32)}';`),'1');
});
