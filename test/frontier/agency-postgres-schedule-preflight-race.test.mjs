import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createPostgresAgencySchedulePreflightStore,
  preflightAgencyScheduleHandoff,
  agencyScheduleAssignmentFingerprint,
} from '../../src/frontier/agency-schedule-preflight.mjs';
import { AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL } from '../../src/frontier/agency-portal-token-store.mjs';
import { AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL } from '../../src/frontier/agency-right-to-work-assurance-ledger.mjs';

const execFileAsync=promisify(execFile);
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const CONTAINER=`wfm-agency-schedule-preflight-${process.pid}-${Date.now()}`;
const DB_USER='postgres';
const DB_NAME='postgres';
const DB_PASSWORD='agency-schedule-preflight-proof-only-not-a-secret';
const OLD='a'.repeat(32);
const NEW='b'.repeat(32);
const REQUEST={requestId:'R-SCHED',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00Z',endAt:'2026-10-05T14:00:00Z'};
const ASSIGNMENT_FP=agencyScheduleAssignmentFingerprint(REQUEST);
let started=false;

async function docker(args,options={}){return execFileAsync('docker',args,{maxBuffer:8*1024*1024,timeout:options.timeout??30000,encoding:'utf8'});}
function sqlLiteral(value){if(value===null||value===undefined)return 'NULL';if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('non-finite SQL test value');return String(value);}if(typeof value==='boolean')return value?'TRUE':'FALSE';return `'${String(value).replaceAll("'","''")}'`;}
function interpolate(sql,values=[]){return sql.replace(/\$(\d+)/g,(_,n)=>{const i=Number(n)-1;if(i<0||i>=values.length)throw new Error(`missing SQL test parameter $${n}`);return sqlLiteral(values[i]);});}
function normalizeCell(value){if(value==='__NULL__')return null;if(value==='t')return true;if(value==='f')return false;return value;}
function parseRows(stdout){const lines=stdout.split(/\r?\n/).map(line=>line.trimEnd()).filter(Boolean).filter(line=>!/^(INSERT|UPDATE|DELETE|SELECT|CREATE|ALTER|DROP|SET|BEGIN|COMMIT)\b/.test(line));if(lines.length<2)return [];const headers=lines[0].split('\t');return lines.slice(1).map(line=>{const cells=line.split('\t');return Object.fromEntries(headers.map((h,i)=>[h,normalizeCell(cells[i]??'')]));});}
async function psql(sql,options={}){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-A','-F','\t','-P','footer=off','-P','null=__NULL__','-c',sql],options);return stdout;}
async function query(sql,values=[]){const rows=parseRows(await psql(interpolate(sql,values)));return {rows,rowCount:rows.length};}
async function scalar(sql){const out=await psql(sql);return out.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).at(-1)??null;}
async function waitForPostgres(){let init=false;let last='';for(let i=0;i<80;i+=1){try{const logs=await docker(['logs',CONTAINER],{timeout:5000});last=`${logs.stdout??''}\n${logs.stderr??''}`;init||=last.includes('PostgreSQL init process complete; ready for start up.');if(init){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-A','-t','-U',DB_USER,'-d',DB_NAME,'-c','SELECT 1;'],{timeout:5000});if(stdout.trim()==='1')return;}}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error(`postgres final server did not become ready\n${last.split(/\r?\n/).slice(-10).join('\n')}`);}
async function waitForUpdaterSleep(name){for(let i=0;i<50;i+=1){const count=Number(await scalar(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${sqlLiteral(name)} AND wait_event='PgSleep';`));if(count===1)return;await new Promise(r=>setTimeout(r,50));}throw new Error('concurrent assurance updater did not reach held sleep');}
async function stop(){if(!started)return;try{await docker(['rm','-f',CONTAINER],{timeout:10000});}catch{}started=false;}

before(async()=>{if(!REQUIRED)return;try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for schedule preflight race proof: ${error.message}`);}await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();await psql(`${AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL}\n${AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL}`);});
after(async()=>{await stop();});
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}

async function reset(version=OLD,{conflicted=false,coverageUntil='2027-12-31T23:59:59Z'}={}){
  await psql('TRUNCATE wfm_agency_portal_token_consumptions, wfm_agency_rtw_assurance_current, wfm_agency_rtw_assurance_history;');
  await psql(`INSERT INTO wfm_agency_rtw_assurance_current (tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,assignment_fingerprint,evidence_fingerprint,check_method,checked_at,coverage_until,promoted_at,conflicted) VALUES ('T-SCHED','A-SCHED','W-1','${version}','S-SCHED','R-SCHED','${ASSIGNMENT_FP}','${'d'.repeat(24)}','home_office_online','2026-10-04T10:00:00Z','${coverageUntil}','2026-10-04T11:00:00Z',${conflicted?'true':'false'});`);
  const bindings=JSON.stringify([{workerId:'W-1',assuranceVersionId:OLD}]).replaceAll("'","''");
  await psql(`INSERT INTO wfm_agency_portal_token_consumptions (tenant_id,token_id,site_id,request_id,agency_id,token_fingerprint,action,expires_at,consumed_at,assurance_bindings) VALUES ('T-SCHED','TOK-SCHED','S-SCHED','R-SCHED','A-SCHED','0123456789abcdef','confirm_preferred_worker','2026-10-05T05:00:00Z','2026-10-04T12:00:00Z','${bindings}'::jsonb);`);
}
function preflight(){return preflightAgencyScheduleHandoff({tenantId:'T-SCHED',siteId:'S-SCHED',agencyId:'A-SCHED',tokenId:'TOK-SCHED',request:REQUEST,now:'2026-10-04T12:30:00Z',preflightStore:createPostgresAgencySchedulePreflightStore({query})});}

pgTest('real PostgreSQL schedule preflight permits an exact durably accepted current assurance and stays read only',async()=>{
  await reset(OLD);
  const beforeCount=Number(await scalar('SELECT count(*) FROM wfm_agency_portal_token_consumptions;'));
  const result=await preflight();
  assert.equal(result.readyForScheduleHandoff,true);
  assert.equal(result.workerAssuranceBindings[0].assuranceVersionId,OLD);
  assert.equal(Number(await scalar('SELECT count(*) FROM wfm_agency_portal_token_consumptions;')),beforeCount);
});

pgTest('real PostgreSQL schedule preflight rejects an accepted worker after authoritative assurance changes',async()=>{
  await reset(NEW);
  const result=await preflight();
  assert.equal(result.readyForScheduleHandoff,false);
  assert.ok(result.failures.includes('accepted_worker_assurance_changed'));
});

pgTest('pending concurrent assurance update wins before schedule preflight and stale accepted version cannot slip through FOR SHARE',async()=>{
  await reset(OLD);
  const app=`wfm_schedule_preflight_updater_${process.pid}`;
  const updaterSql=`SET application_name=${sqlLiteral(app)}; BEGIN; UPDATE wfm_agency_rtw_assurance_current SET assurance_version_id='${NEW}', promoted_at='2026-10-04T12:31:00Z' WHERE tenant_id='T-SCHED' AND agency_id='A-SCHED' AND worker_id='W-1'; SELECT pg_sleep(1.2); COMMIT;`;
  const updater=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',updaterSql],{timeout:10000});
  await waitForUpdaterSleep(app);
  const startedAt=Date.now();
  const result=await preflight();
  const elapsed=Date.now()-startedAt;
  await updater;
  assert.equal(result.readyForScheduleHandoff,false);
  assert.ok(result.failures.includes('accepted_worker_assurance_changed'));
  assert.ok(elapsed>=500,`preflight should wait behind in-flight assurance update; elapsed=${elapsed}ms`);
  assert.equal(await scalar(`SELECT assurance_version_id FROM wfm_agency_rtw_assurance_current WHERE tenant_id='T-SCHED' AND agency_id='A-SCHED' AND worker_id='W-1';`),NEW);
});
