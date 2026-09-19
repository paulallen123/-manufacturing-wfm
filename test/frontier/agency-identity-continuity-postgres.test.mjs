import test, {after,before} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import {AGENCY_IDENTITY_CONTINUITY_DDL,createPostgresAgencyIdentityContinuityStore,evaluateAgencyIdentityContinuity} from '../../src/frontier/agency-identity-continuity.mjs';

const execFileAsync=promisify(execFile);
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const CONTAINER=`wfm-agency-identity-continuity-${process.pid}-${Date.now()}`;
const DB_USER='postgres';const DB_NAME='postgres';const DB_PASSWORD='agency-identity-continuity-proof-only-not-a-secret';
const ASSURANCE='a'.repeat(32);const SUBJECT='b'.repeat(32);
const REQUEST={requestId:'R-ID',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00Z',endAt:'2026-10-05T14:00:00Z'};
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=(v,n=32)=>crypto.createHash('sha256').update(String(v??'')).digest('hex').slice(0,n);
const ASSIGNMENT_FP=digest(JSON.stringify(stable({roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'})),24);
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
async function stop(){if(!started)return;try{await docker(['rm','-f',CONTAINER],{timeout:10000});}catch{}started=false;}

before(async()=>{if(!REQUIRED)return;try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for identity continuity PostgreSQL proof: ${error.message}`);}await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();await psql(AGENCY_IDENTITY_CONTINUITY_DDL);});
after(async()=>{await stop();});
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}

const policy=()=>({policyId:'S-ID-PACK-v1',siteId:'S-ID',roleId:'PACK-OP',minutesBeforeStart:60,minutesAfterStart:90,minIndependentSources:2,requireDirectIdentity:true,allowedSources:{turnstile:['access_pass'],supervisor:['supervised_identity_check']}});
async function evaluate(){return evaluateAgencyIdentityContinuity({tenantId:'T-ID',siteId:'S-ID',agencyId:'A-ID',request:REQUEST,workerBinding:{workerId:'W-ID',assuranceVersionId:ASSURANCE},now:'2026-10-05T06:10:00Z',policy:policy(),continuityStore:createPostgresAgencyIdentityContinuityStore({query})});}
async function reset(){await psql('TRUNCATE wfm_agency_identity_continuity_observations;');}
function insertSql({tenant='T-ID',site='S-ID',request='R-ID',agency='A-ID',worker='W-ID',assignment=ASSIGNMENT_FP,assurance=ASSURANCE,source='turnstile',event='1'.repeat(32),subject=SUBJECT,signal='access_pass',observed='2026-10-05T05:58:00Z'}={}){return `INSERT INTO wfm_agency_identity_continuity_observations (tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,assurance_version_id,source_system_id,source_event_fingerprint,subject_fingerprint,signal_type,observed_at) VALUES (${[tenant,site,request,agency,worker,assignment,assurance,source,event,subject,signal,observed].map(sqlLiteral).join(',')});`;}

pgTest('real PostgreSQL continuity reader accepts exact two-source evidence and remains read only',async()=>{
  await reset();await psql(insertSql());await psql(insertSql({source:'supervisor',event:'2'.repeat(32),signal:'supervised_identity_check',observed:'2026-10-05T06:02:00Z'}));
  const beforeCount=Number(await scalar('SELECT count(*) FROM wfm_agency_identity_continuity_observations;'));
  const result=await evaluate();
  assert.equal(result.continuityPassed,true);assert.equal(result.independentSourceCount,2);assert.equal(result.directIdentityObserved,true);assert.equal(result.scheduleWriteAuthorized,false);assert.equal(result.rankingImpact,'none');
  assert.equal(Number(await scalar('SELECT count(*) FROM wfm_agency_identity_continuity_observations;')),beforeCount);
});

pgTest('identity-continuity ledger is append-only and duplicate source events converge to one durable observation',async()=>{
  await reset();
  const attempts=await Promise.allSettled(Array.from({length:32},()=>psql(insertSql({event:'3'.repeat(32)}))));
  assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1);assert.equal(Number(await scalar('SELECT count(*) FROM wfm_agency_identity_continuity_observations;')),1);
  await assert.rejects(()=>psql("UPDATE wfm_agency_identity_continuity_observations SET signal_type='attendance_clock_in' WHERE tenant_id='T-ID';"));
  await assert.rejects(()=>psql("DELETE FROM wfm_agency_identity_continuity_observations WHERE tenant_id='T-ID';"));
  assert.equal(Number(await scalar('SELECT count(*) FROM wfm_agency_identity_continuity_observations;')),1);
});

pgTest('cross-tenant direct-identity noise cannot satisfy the scoped worker continuity decision',async()=>{
  await reset();await psql(insertSql({source:'turnstile',event:'4'.repeat(32)}));await psql(insertSql({tenant:'OTHER',source:'supervisor',event:'5'.repeat(32),signal:'supervised_identity_check',observed:'2026-10-05T06:02:00Z'}));
  const result=await evaluate();
  assert.equal(result.continuityPassed,false);assert.ok(result.failures.includes('identity_continuity_independent_sources_insufficient'));assert.ok(result.failures.includes('identity_continuity_direct_identity_required'));assert.equal(result.observations.length,1);
});
