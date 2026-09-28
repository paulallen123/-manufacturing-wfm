import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AGENCY_SCHEDULE_AUTHORITY_LOCK_SQL } from '../../src/frontier/agency-schedule-authority-guard.mjs';
import { AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL } from '../../src/frontier/agency-portal-token-store.mjs';
import { AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL } from '../../src/frontier/agency-right-to-work-assurance-ledger.mjs';

const execFileAsync=promisify(execFile);
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const CONTAINER=`wfm-agency-schedule-authority-${process.pid}-${Date.now()}`;
const DB_USER='postgres';
const DB_NAME='postgres';
const DB_PASSWORD='agency-schedule-authority-proof-only-not-a-secret';
const OLD='a'.repeat(32);
const NEW='b'.repeat(32);
const ASSIGNMENT_FP='c'.repeat(24);
let started=false;

async function docker(args,options={}){return execFileAsync('docker',args,{maxBuffer:8*1024*1024,timeout:options.timeout??30000,encoding:'utf8'});}
function sqlLiteral(value){if(value===null||value===undefined)return 'NULL';if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('non-finite SQL test value');return String(value);}if(typeof value==='boolean')return value?'TRUE':'FALSE';return `'${String(value).replaceAll("'","''")}'`;}
function interpolate(sql,values=[]){return sql.replace(/\$(\d+)/g,(_,n)=>{const i=Number(n)-1;if(i<0||i>=values.length)throw new Error(`missing SQL test parameter $${n}`);return sqlLiteral(values[i]);});}
function normalizeCell(value){if(value==='__NULL__')return null;if(value==='t')return true;if(value==='f')return false;return value;}
function parseRows(stdout){const lines=stdout.split(/\r?\n/).map(line=>line.trimEnd()).filter(Boolean).filter(line=>!/^(INSERT|UPDATE|DELETE|SELECT|CREATE|ALTER|DROP|SET|BEGIN|COMMIT)\b/.test(line));if(lines.length<2)return [];const headers=lines[0].split('\t');return lines.slice(1).map(line=>{const cells=line.split('\t');return Object.fromEntries(headers.map((h,i)=>[h,normalizeCell(cells[i]??'')]));});}
async function psql(sql,options={}){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-A','-F','\t','-P','footer=off','-P','null=__NULL__','-c',sql],options);return stdout;}
async function query(sql,values=[]){return {rows:parseRows(await psql(interpolate(sql,values)))};}
async function scalar(sql){const out=await psql(sql);return out.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).at(-1)??null;}
async function waitForPostgres(){let init=false;let last='';for(let i=0;i<80;i+=1){try{const logs=await docker(['logs',CONTAINER],{timeout:5000});last=`${logs.stdout??''}\n${logs.stderr??''}`;init||=last.includes('PostgreSQL init process complete; ready for start up.');if(init){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-A','-t','-U',DB_USER,'-d',DB_NAME,'-c','SELECT 1;'],{timeout:5000});if(stdout.trim()==='1')return;}}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error(`postgres final server did not become ready\n${last.split(/\r?\n/).slice(-10).join('\n')}`);}
async function waitForSleep(name){for(let i=0;i<60;i+=1){const count=Number(await scalar(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${sqlLiteral(name)} AND wait_event='PgSleep';`));if(count===1)return;await new Promise(r=>setTimeout(r,50));}throw new Error(`${name} did not reach held sleep`);}
async function waitForLockWait(name){for(let i=0;i<60;i+=1){const count=Number(await scalar(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${sqlLiteral(name)} AND wait_event_type='Lock';`));if(count===1)return;await new Promise(r=>setTimeout(r,50));}throw new Error(`${name} did not reach lock wait`);}
async function stop(){if(!started)return;try{await docker(['rm','-f',CONTAINER],{timeout:10000});}catch{}started=false;}

before(async()=>{if(!REQUIRED)return;try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for schedule authority race proof: ${error.message}`);}await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();await psql(`${AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL}\n${AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL}`);});
after(async()=>{await stop();});
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}

async function reset(version=OLD){
  await psql('TRUNCATE wfm_agency_portal_token_consumptions, wfm_agency_rtw_assurance_current, wfm_agency_rtw_assurance_history;');
  await psql(`INSERT INTO wfm_agency_rtw_assurance_current (tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,assignment_fingerprint,evidence_fingerprint,check_method,checked_at,coverage_until,promoted_at,conflicted) VALUES ('T-GUARD','A-GUARD','W-1','${version}','S-GUARD','R-GUARD','${ASSIGNMENT_FP}','${'d'.repeat(24)}','home_office_online','2026-10-04T10:00:00Z','2027-12-31T23:59:59Z','2026-10-04T11:00:00Z',false);`);
  const bindings=JSON.stringify([{workerId:'W-1',assuranceVersionId:OLD}]).replaceAll("'","''");
  await psql(`INSERT INTO wfm_agency_portal_token_consumptions (tenant_id,token_id,site_id,request_id,agency_id,token_fingerprint,action,expires_at,consumed_at,assurance_bindings) VALUES ('T-GUARD','TOK-GUARD','S-GUARD','R-GUARD','A-GUARD','0123456789abcdef','confirm_preferred_worker','2026-10-05T05:00:00Z','2026-10-04T12:00:00Z','${bindings}'::jsonb);`);
}
const VALUES=['T-GUARD','TOK-GUARD','S-GUARD','R-GUARD','A-GUARD'];

pgTest('shared authority locks prevent assurance mutation during the shadow critical section',async()=>{
  await reset(OLD);
  const lockerName=`wfm_guard_locker_${process.pid}`;
  const updaterName=`wfm_guard_updater_${process.pid}`;
  const lockedSql=interpolate(AGENCY_SCHEDULE_AUTHORITY_LOCK_SQL,VALUES);
  const locker=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${sqlLiteral(lockerName)}; BEGIN; ${lockedSql} SELECT pg_sleep(1.2); COMMIT;`],{timeout:10000});
  await waitForSleep(lockerName);
  const startedAt=Date.now();
  const updater=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${sqlLiteral(updaterName)}; UPDATE wfm_agency_rtw_assurance_current SET assurance_version_id='${NEW}', promoted_at='2026-10-04T12:31:00Z' WHERE tenant_id='T-GUARD' AND agency_id='A-GUARD' AND worker_id='W-1';`],{timeout:10000});
  await waitForLockWait(updaterName);
  assert.equal(await scalar(`SELECT assurance_version_id FROM wfm_agency_rtw_assurance_current WHERE tenant_id='T-GUARD' AND agency_id='A-GUARD' AND worker_id='W-1';`),OLD);
  await locker;
  await updater;
  const elapsed=Date.now()-startedAt;
  assert.ok(elapsed>=500,`assurance update should wait behind guard lock; elapsed=${elapsed}ms`);
  assert.equal(await scalar(`SELECT assurance_version_id FROM wfm_agency_rtw_assurance_current WHERE tenant_id='T-GUARD' AND agency_id='A-GUARD' AND worker_id='W-1';`),NEW);
});

pgTest('an assurance update already in flight completes before guard read and the locked read observes the new version',async()=>{
  await reset(OLD);
  const updaterName=`wfm_guard_first_updater_${process.pid}`;
  const updater=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${sqlLiteral(updaterName)}; BEGIN; UPDATE wfm_agency_rtw_assurance_current SET assurance_version_id='${NEW}', promoted_at='2026-10-04T12:31:00Z' WHERE tenant_id='T-GUARD' AND agency_id='A-GUARD' AND worker_id='W-1'; SELECT pg_sleep(1.2); COMMIT;`],{timeout:10000});
  await waitForSleep(updaterName);
  const startedAt=Date.now();
  const read=await query(AGENCY_SCHEDULE_AUTHORITY_LOCK_SQL,VALUES);
  const elapsed=Date.now()-startedAt;
  await updater;
  assert.equal(read.rows.length,1);
  assert.equal(read.rows[0].accepted_assurance_version_id,OLD);
  assert.equal(read.rows[0].current_assurance_version_id,NEW);
  assert.ok(elapsed>=500,`guard read should wait behind in-flight update; elapsed=${elapsed}ms`);
});

pgTest('accepted-response row is also locked so handoff evidence cannot be rewritten during the critical section',async()=>{
  await reset(OLD);
  const lockerName=`wfm_guard_token_locker_${process.pid}`;
  const updaterName=`wfm_guard_token_updater_${process.pid}`;
  const lockedSql=interpolate(AGENCY_SCHEDULE_AUTHORITY_LOCK_SQL,VALUES);
  const locker=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${sqlLiteral(lockerName)}; BEGIN; ${lockedSql} SELECT pg_sleep(1.2); COMMIT;`],{timeout:10000});
  await waitForSleep(lockerName);
  const updater=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',`SET application_name=${sqlLiteral(updaterName)}; UPDATE wfm_agency_portal_token_consumptions SET action='decline_request' WHERE tenant_id='T-GUARD' AND token_id='TOK-GUARD';`],{timeout:10000});
  await waitForLockWait(updaterName);
  assert.equal(await scalar(`SELECT action FROM wfm_agency_portal_token_consumptions WHERE tenant_id='T-GUARD' AND token_id='TOK-GUARD';`),'confirm_preferred_worker');
  await locker;
  await updater;
  assert.equal(await scalar(`SELECT action FROM wfm_agency_portal_token_consumptions WHERE tenant_id='T-GUARD' AND token_id='TOK-GUARD';`),'decline_request');
});
