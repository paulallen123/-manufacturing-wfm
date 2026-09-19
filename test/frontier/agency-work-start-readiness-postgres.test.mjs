import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import {AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL} from '../../src/frontier/agency-right-to-work-assurance-ledger.mjs';
import {AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL} from '../../src/frontier/agency-portal-token-store.mjs';
import {AGENCY_IDENTITY_CONTINUITY_DDL,createPostgresAgencyIdentityContinuityStore} from '../../src/frontier/agency-identity-continuity.mjs';
import {AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL} from '../../src/frontier/agency-identity-observation-ingress.mjs';
import {createPostgresAgencyWorkStartAuthorityStore,evaluateAgencyWorkStartReadiness} from '../../src/frontier/agency-work-start-readiness.mjs';

const execFileAsync=promisify(execFile);
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const CONTAINER=`wfm-agency-work-start-${process.pid}-${Date.now()}`;
const DB_USER='postgres',DB_NAME='postgres',DB_PASSWORD='agency-work-start-proof-only-not-a-secret';
const NOW='2026-10-05T06:10:00Z',ASSURANCE='a'.repeat(32),NEW='b'.repeat(32),SUBJECT='c'.repeat(32);
const REQUEST={requestId:'R-START',roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00Z',endAt:'2026-10-05T14:00:00Z'};
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=(v,n=32)=>crypto.createHash('sha256').update(String(v??'')).digest('hex').slice(0,n);
const ASSIGNMENT=digest(JSON.stringify(stable({roleId:'PACK-OP',location:'Plant 1, Birmingham',startAt:'2026-10-05T06:00:00.000Z',endAt:'2026-10-05T14:00:00.000Z'})),24);
let started=false;

async function docker(args,options={}){return execFileAsync('docker',args,{maxBuffer:8*1024*1024,timeout:options.timeout??30000,encoding:'utf8'});}
function sqlLiteral(value){if(value===null||value===undefined)return 'NULL';if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('non-finite SQL test value');return String(value);}if(typeof value==='boolean')return value?'TRUE':'FALSE';return `'${String(value).replaceAll("'","''")}'`;}
function interpolate(sql,values=[]){return sql.replace(/\$(\d+)/g,(_,n)=>{const i=Number(n)-1;if(i<0||i>=values.length)throw new Error(`missing SQL test parameter $${n}`);return sqlLiteral(values[i]);});}
function normalizeCell(value){if(value==='__NULL__')return null;if(value==='t')return true;if(value==='f')return false;return value;}
function parseRows(stdout){const lines=stdout.split(/\r?\n/).map(line=>line.trimEnd()).filter(Boolean).filter(line=>!/^(INSERT|UPDATE|DELETE|SELECT|CREATE|ALTER|DROP|SET|BEGIN|COMMIT)\b/.test(line));if(lines.length<2)return [];const headers=lines[0].split('\t');return lines.slice(1).map(line=>{const cells=line.split('\t');return Object.fromEntries(headers.map((h,i)=>[h,normalizeCell(cells[i]??'')]));});}
async function psql(sql,options={}){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-A','-F','\t','-P','footer=off','-P','null=__NULL__','-c',sql],options);return stdout;}
async function query(sql,values=[]){const rows=parseRows(await psql(interpolate(sql,values)));return {rows,rowCount:rows.length};}
async function scalar(sql){const out=await psql(sql);return out.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).at(-1)??null;}
async function waitForPostgres(){let init=false,last='';for(let i=0;i<80;i+=1){try{const logs=await docker(['logs',CONTAINER],{timeout:5000});last=`${logs.stdout??''}\n${logs.stderr??''}`;init||=last.includes('PostgreSQL init process complete; ready for start up.');if(init){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-A','-t','-U',DB_USER,'-d',DB_NAME,'-c','SELECT 1;'],{timeout:5000});if(stdout.trim()==='1')return;}}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error(`postgres final server did not become ready\n${last.split(/\r?\n/).slice(-10).join('\n')}`);}
async function stop(){if(!started)return;try{await docker(['rm','-f',CONTAINER],{timeout:10000});}catch{}started=false;}
before(async()=>{if(!REQUIRED)return;try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for work-start PostgreSQL proof: ${error.message}`);}await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();await psql(AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL);await psql(AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL);await psql(AGENCY_IDENTITY_CONTINUITY_DDL);await psql(AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL);});
after(async()=>{await stop();});
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}
const policy=()=>({policyId:'S-START-PACK-v1',siteId:'S-START',roleId:'PACK-OP',minutesBeforeStart:60,minutesAfterStart:90,minIndependentSources:1,requireDirectIdentity:false,allowedSources:{turnstile:['access_pass']}});
async function reset(){await psql('TRUNCATE wfm_agency_identity_observation_ingress_receipts, wfm_agency_identity_continuity_observations, wfm_agency_portal_token_consumptions, wfm_agency_rtw_assurance_history, wfm_agency_rtw_assurance_current;');}
function bindingFp(){return digest(JSON.stringify(stable({tenantId:'T-START',siteId:'S-START',requestId:'R-START',sourceSystemId:'turnstile',agencyId:'A-START',workerId:'W-START',assignmentFingerprint:ASSIGNMENT,assuranceVersionId:ASSURANCE,subjectFingerprint:SUBJECT})));}
async function seedValid(){
  await psql(`INSERT INTO wfm_agency_rtw_assurance_current (tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,assignment_fingerprint,evidence_fingerprint,check_method,checked_at,coverage_until,promoted_at,conflicted) VALUES ('T-START','A-START','W-START','${ASSURANCE}','S-START','R-START','${ASSIGNMENT}','${'d'.repeat(24)}','manual_document','2026-10-04T10:00:00Z','2027-12-31T23:59:59Z','2026-10-04T11:00:00Z',false);`);
  await psql(`INSERT INTO wfm_agency_portal_token_consumptions (tenant_id,token_id,site_id,request_id,agency_id,token_fingerprint,action,expires_at,consumed_at,assurance_bindings) VALUES ('T-START','TOK-START','S-START','R-START','A-START','${'1'.repeat(16)}','confirm_preferred_worker','2026-10-05T05:00:00Z','2026-10-04T12:00:00Z','[{"workerId":"W-START","assuranceVersionId":"${ASSURANCE}"}]'::jsonb);`);
  const event='1'.repeat(32),binding=bindingFp(),auth=digest(`auth|${binding}`);
  await psql(`INSERT INTO wfm_agency_identity_continuity_observations (tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,assurance_version_id,source_system_id,source_event_fingerprint,subject_fingerprint,signal_type,observed_at) VALUES ('T-START','S-START','R-START','A-START','W-START','${ASSIGNMENT}','${ASSURANCE}','turnstile','${event}','${SUBJECT}','access_pass','2026-10-05T05:58:00Z');`);
  await psql(`INSERT INTO wfm_agency_identity_observation_ingress_receipts (tenant_id,source_system_id,source_event_fingerprint,source_auth_fingerprint,binding_fingerprint,ingress_version,received_at) VALUES ('T-START','turnstile','${event}','${auth}','${binding}','agency-identity-observation-ingress-v0.1.0','2026-10-05T05:58:10Z');`);
}
async function evaluate(){return evaluateAgencyWorkStartReadiness({tenantId:'T-START',siteId:'S-START',agencyId:'A-START',request:REQUEST,workerId:'W-START',now:NOW,policy:policy(),authorityStore:createPostgresAgencyWorkStartAuthorityStore({query}),continuityStore:createPostgresAgencyIdentityContinuityStore({query})});}

pgTest('real PostgreSQL work-start readiness composes exact accepted/current RTW authority with authenticated identity continuity and remains read only',async()=>{
  await reset();await seedValid();
  const countsBefore=[Number(await scalar('SELECT count(*) FROM wfm_agency_rtw_assurance_current;')),Number(await scalar('SELECT count(*) FROM wfm_agency_portal_token_consumptions;')),Number(await scalar('SELECT count(*) FROM wfm_agency_identity_continuity_observations;')),Number(await scalar('SELECT count(*) FROM wfm_agency_identity_observation_ingress_receipts;'))];
  const result=await evaluate();assert.equal(result.workStartReady,true);assert.equal(result.assuranceVersionId,ASSURANCE);assert.match(result.readinessFingerprint,/^[0-9a-f]{32}$/);assert.equal(result.rankingImpact,'none');assert.equal(result.scheduleWriteAuthorized,false);assert.equal(result.clockingWriteAuthorized,false);assert.equal(result.payrollWriteAuthorized,false);
  const countsAfter=[Number(await scalar('SELECT count(*) FROM wfm_agency_rtw_assurance_current;')),Number(await scalar('SELECT count(*) FROM wfm_agency_portal_token_consumptions;')),Number(await scalar('SELECT count(*) FROM wfm_agency_identity_continuity_observations;')),Number(await scalar('SELECT count(*) FROM wfm_agency_identity_observation_ingress_receipts;'))];assert.deepEqual(countsAfter,countsBefore);
});

pgTest('a newer current RTW assurance without an accepted matching agency binding fails closed before shift start',async()=>{
  await reset();await seedValid();
  await psql(`UPDATE wfm_agency_rtw_assurance_current SET assurance_version_id='${NEW}', checked_at='2026-10-05T05:00:00Z', promoted_at='2026-10-05T05:01:00Z' WHERE tenant_id='T-START' AND agency_id='A-START' AND worker_id='W-START';`);
  const result=await evaluate();assert.equal(result.workStartReady,false);assert.equal(result.reason,'work_start_accepted_response_missing');assert.equal(result.workStartWriteAuthorized,false);
});

pgTest('identity observation and provenance bound to an older RTW assurance cannot satisfy readiness after authoritative state changes',async()=>{
  await reset();await seedValid();
  await psql(`UPDATE wfm_agency_rtw_assurance_current SET assurance_version_id='${NEW}', checked_at='2026-10-05T05:00:00Z', promoted_at='2026-10-05T05:01:00Z' WHERE tenant_id='T-START' AND agency_id='A-START' AND worker_id='W-START';`);
  await psql(`INSERT INTO wfm_agency_portal_token_consumptions (tenant_id,token_id,site_id,request_id,agency_id,token_fingerprint,action,expires_at,consumed_at,assurance_bindings) VALUES ('T-START','TOK-NEW','S-START','R-START','A-START','${'2'.repeat(16)}','confirm_preferred_worker','2026-10-05T05:30:00Z','2026-10-05T05:02:00Z','[{"workerId":"W-START","assuranceVersionId":"${NEW}"}]'::jsonb);`);
  const result=await evaluate();assert.equal(result.workStartReady,false);assert.equal(result.reason,'identity_continuity_independent_sources_insufficient');assert.equal(result.continuityFingerprint,null);assert.equal(result.workStartWriteAuthorized,false);
});
