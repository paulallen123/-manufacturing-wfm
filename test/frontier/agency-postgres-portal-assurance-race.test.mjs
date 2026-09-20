import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL,
  createPostgresAgencyPortalTokenStore,
} from '../../src/frontier/agency-portal-token-store.mjs';
import { AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL } from '../../src/frontier/agency-right-to-work-assurance-ledger.mjs';

const execFileAsync=promisify(execFile);
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const CONTAINER=`wfm-agency-portal-rtw-race-${process.pid}-${Date.now()}`;
const DB_USER='postgres';
const DB_NAME='postgres';
const DB_PASSWORD='agency-portal-proof-only-not-a-secret';
const OLD_VERSION='a'.repeat(32);
const NEW_VERSION='b'.repeat(32);
let started=false;

async function docker(args,options={}){
  return execFileAsync('docker',args,{maxBuffer:8*1024*1024,timeout:options.timeout??30000,encoding:'utf8',input:options.input});
}
function sqlLiteral(value){
  if(value===null||value===undefined)return 'NULL';
  if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('non-finite SQL test value');return String(value);}
  if(typeof value==='boolean')return value?'TRUE':'FALSE';
  const string=String(value);if(string.includes('\0'))throw new TypeError('NUL is not permitted in SQL test values');
  return `'${string.replaceAll("'","''")}'`;
}
function interpolate(sql,values=[]){return sql.replace(/\$(\d+)/g,(_,indexText)=>{const index=Number(indexText)-1;if(index<0||index>=values.length)throw new Error(`missing SQL test parameter $${indexText}`);return sqlLiteral(values[index]);});}
function normalizeCell(value){if(value==='__NULL__')return null;if(value==='t')return true;if(value==='f')return false;return value;}
function parseRows(stdout){
  const lines=stdout.split(/\r?\n/).map(line=>line.trimEnd()).filter(Boolean).filter(line=>!/^(INSERT|UPDATE|DELETE|SELECT|CREATE|ALTER|DROP|SET|BEGIN|COMMIT)\b/.test(line));
  if(lines.length<2)return [];
  const headers=lines[0].split('\t');
  return lines.slice(1).map(line=>{const cells=line.split('\t');return Object.fromEntries(headers.map((header,index)=>[header,normalizeCell(cells[index]??'')]));});
}
async function psql(sql,options={}){
  const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-A','-F','\t','-P','footer=off','-P','null=__NULL__','-c',sql],options);
  return stdout;
}
async function query(sql,values=[]){const stdout=await psql(interpolate(sql,values));const rows=parseRows(stdout);return {rows,rowCount:rows.length};}
async function scalar(sql){const stdout=await psql(sql);const lines=stdout.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);return lines.at(-1)??null;}
async function waitForPostgres(){
  let initComplete=false;let lastError=null;let lastLogs='';
  for(let attempt=0;attempt<80;attempt+=1){
    try{
      const logs=await docker(['logs',CONTAINER],{timeout:5000});lastLogs=`${logs.stdout??''}\n${logs.stderr??''}`;initComplete||=lastLogs.includes('PostgreSQL init process complete; ready for start up.');
      if(initComplete){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-A','-t','-U',DB_USER,'-d',DB_NAME,'-c','SELECT 1;'],{timeout:5000});if(stdout.trim()==='1')return;}
    }catch(error){lastError=error;}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error(`postgres final server did not become ready: ${lastError?.message??'no psql success'}\n${lastLogs.split(/\r?\n/).filter(Boolean).slice(-10).join('\n')}`);
}
async function waitForUpdaterSleep(applicationName){
  for(let attempt=0;attempt<50;attempt+=1){
    const count=Number(await scalar(`SELECT count(*) FROM pg_stat_activity WHERE application_name=${sqlLiteral(applicationName)} AND wait_event='PgSleep';`));
    if(count===1)return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('concurrent assurance updater did not reach held-lock sleep');
}
async function stopContainer(){if(!started)return;try{await docker(['rm','-f',CONTAINER],{timeout:10000});}catch{}started=false;}

before(async()=>{
  if(!REQUIRED)return;
  try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for portal assurance race proof: ${error.message}`);}
  await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});
  started=true;await waitForPostgres();
  await psql(`${AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL}\n${AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL}`);
});
after(async()=>{await stopContainer();});
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}

async function seedCurrent(version=OLD_VERSION){
  await psql(`
INSERT INTO wfm_agency_rtw_assurance_current
  (tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,assignment_fingerprint,evidence_fingerprint,check_method,checked_at,coverage_until,promoted_at,conflicted)
VALUES
  ('T-PORTAL','A-PORTAL','W-1','${version}','S-PORTAL','R-PORTAL','${'c'.repeat(24)}','${'d'.repeat(24)}','home_office_online','2026-10-04T10:00:00Z','2027-12-31T23:59:59Z','2026-10-04T12:00:00Z',false)
ON CONFLICT (tenant_id,agency_id,worker_id) DO UPDATE SET
  assurance_version_id=EXCLUDED.assurance_version_id,
  site_id=EXCLUDED.site_id,
  request_id=EXCLUDED.request_id,
  conflicted=false;
`);
}
function record(tokenId){return {tenantId:'T-PORTAL',tokenId,siteId:'S-PORTAL',requestId:'R-PORTAL',agencyId:'A-PORTAL',tokenFingerprint:'0123456789abcdef',action:'confirm_preferred_worker',expiresAt:'2026-10-05T05:00:00Z',consumedAt:'2026-10-04T12:30:00Z'};}

pgTest('real PostgreSQL binds one-time portal acceptance to the exact authoritative assurance version under 32 concurrent submissions',async()=>{
  await seedCurrent(OLD_VERSION);
  const store=createPostgresAgencyPortalTokenStore({query});
  const binding=[{workerId:'W-1',assuranceVersionId:OLD_VERSION}];
  const results=await Promise.all(Array.from({length:32},()=>store.consumeOnceWithAssuranceBindings(record('token-bound-32'),binding)));
  assert.equal(results.filter(result=>result.consumed===true&&result.assuranceMatched===true).length,1);
  assert.equal(results.filter(result=>result.reason==='already_consumed').length,31);
  assert.equal(Number(await scalar(`SELECT count(*) FROM wfm_agency_portal_token_consumptions WHERE tenant_id='T-PORTAL' AND token_id='token-bound-32';`)),1);
  const stored=await scalar(`SELECT assurance_bindings->0->>'assuranceVersionId' FROM wfm_agency_portal_token_consumptions WHERE tenant_id='T-PORTAL' AND token_id='token-bound-32';`);
  assert.equal(stored,OLD_VERSION);
});

pgTest('stale assurance binding fails closed and does not burn the portal token',async()=>{
  await seedCurrent(NEW_VERSION);
  const store=createPostgresAgencyPortalTokenStore({query});
  const stale=await store.consumeOnceWithAssuranceBindings(record('token-stale-no-burn'),[{workerId:'W-1',assuranceVersionId:OLD_VERSION}]);
  assert.equal(stale.consumed,false);
  assert.equal(stale.reason,'assurance_version_changed');
  assert.equal(stale.assuranceMatched,false);
  assert.equal(Number(await scalar(`SELECT count(*) FROM wfm_agency_portal_token_consumptions WHERE tenant_id='T-PORTAL' AND token_id='token-stale-no-burn';`)),0);
});

pgTest('pending concurrent assurance promotion wins before portal acceptance and stale planned version cannot slip through the lock',async()=>{
  await seedCurrent(OLD_VERSION);
  const applicationName=`wfm_portal_assurance_updater_${process.pid}`;
  const updaterSql=`SET application_name=${sqlLiteral(applicationName)}; BEGIN; UPDATE wfm_agency_rtw_assurance_current SET assurance_version_id='${NEW_VERSION}', promoted_at='2026-10-04T12:31:00Z' WHERE tenant_id='T-PORTAL' AND agency_id='A-PORTAL' AND worker_id='W-1'; SELECT pg_sleep(1.2); COMMIT;`;
  const updater=docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-c',updaterSql],{timeout:10000});
  await waitForUpdaterSleep(applicationName);

  const store=createPostgresAgencyPortalTokenStore({query});
  const startedAt=Date.now();
  const result=await store.consumeOnceWithAssuranceBindings(record('token-held-update'),[{workerId:'W-1',assuranceVersionId:OLD_VERSION}]);
  const elapsed=Date.now()-startedAt;
  await updater;

  assert.equal(result.consumed,false);
  assert.equal(result.reason,'assurance_version_changed');
  assert.equal(result.assuranceMatched,false);
  assert.ok(elapsed>=500,`assurance-aware consume should have waited on the authoritative row lock; elapsed=${elapsed}ms`);
  assert.equal(await scalar(`SELECT assurance_version_id FROM wfm_agency_rtw_assurance_current WHERE tenant_id='T-PORTAL' AND agency_id='A-PORTAL' AND worker_id='W-1';`),NEW_VERSION);
  assert.equal(Number(await scalar(`SELECT count(*) FROM wfm_agency_portal_token_consumptions WHERE tenant_id='T-PORTAL' AND token_id='token-held-update';`)),0);
});
