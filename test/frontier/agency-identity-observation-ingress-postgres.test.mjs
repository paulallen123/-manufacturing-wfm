import test, {after,before} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AGENCY_IDENTITY_CONTINUITY_DDL} from '../../src/frontier/agency-identity-continuity.mjs';
import {AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL,createHmacJsonAgencyIdentityObservationAdapter,createPostgresAgencyIdentityObservationIngressStore,ingestAgencyIdentityObservation} from '../../src/frontier/agency-identity-observation-ingress.mjs';

const execFileAsync=promisify(execFile);
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const CONTAINER=`wfm-agency-identity-ingress-${process.pid}-${Date.now()}`;
const DB_USER='postgres';const DB_NAME='postgres';const DB_PASSWORD='agency-identity-ingress-proof-only-not-a-secret';
const SECRET='0123456789abcdef0123456789abcdef0123456789abcdef';
const RECEIVED='2026-10-05T05:58:10.000Z';const TS=String(Math.floor(Date.parse(RECEIVED)/1000));
const ASSIGNMENT='a'.repeat(24);const ASSURANCE='b'.repeat(32);const SUBJECT='c'.repeat(32);
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

before(async()=>{if(!REQUIRED)return;try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for identity observation ingress PostgreSQL proof: ${error.message}`);}await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();await psql(AGENCY_IDENTITY_CONTINUITY_DDL);await psql(AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL);});
after(async()=>{await stop();});
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}
async function reset(){await psql('TRUNCATE wfm_agency_identity_observation_ingress_receipts, wfm_agency_identity_continuity_observations;');}
const adapter=createHmacJsonAgencyIdentityObservationAdapter({secret:SECRET});
const registry={async resolveSource(){return {sourceSystemId:'turnstile',adapter,allowedSignalTypes:['access_pass','attendance_clock_in'],maxEventAgeMinutes:60,maxFutureSkewSeconds:30};}};
const resolver={async resolveBinding(){return {tenantId:'T1',siteId:'S1',requestId:'R1',sourceSystemId:'turnstile',agencyId:'A1',workerId:'W1',assignmentFingerprint:ASSIGNMENT,assuranceVersionId:ASSURANCE,subjectFingerprint:SUBJECT};}};
function signedInput(overrides={}){const body=JSON.stringify({eventId:'evt-pg-1',sourceSubjectRef:'raw-badge-7',signalType:'access_pass',observedAt:'2026-10-05T05:58:00.000Z',...overrides});const signature=crypto.createHmac('sha256',SECRET).update(TS).update('.').update(body).digest('hex');return {tenantId:'T1',siteId:'S1',requestId:'R1',sourceSystemId:'turnstile',rawBody:body,headers:{'x-wfm-timestamp':TS,'x-wfm-signature':signature},receivedAt:RECEIVED,sourceRegistry:registry,bindingResolver:resolver,continuityStore:createPostgresAgencyIdentityObservationIngressStore({query})};}

pgTest('32 concurrent authenticated replays converge to one durable observation and one provenance receipt',async()=>{
  await reset();const results=await Promise.all(Array.from({length:32},()=>ingestAgencyIdentityObservation(signedInput())));
  assert.equal(results.filter(r=>r.accepted).length,32);assert.equal(results.filter(r=>r.duplicate===false).length,1);assert.equal(results.filter(r=>r.duplicate===true).length,31);
  assert.equal(Number(await scalar('SELECT count(*) FROM wfm_agency_identity_continuity_observations;')),1);assert.equal(Number(await scalar('SELECT count(*) FROM wfm_agency_identity_observation_ingress_receipts;')),1);
});

pgTest('concurrent conflicting payloads reusing one authenticated event id produce one durable truth and one fail-closed conflict',async()=>{
  await reset();const a=signedInput({signalType:'access_pass'});const b=signedInput({signalType:'attendance_clock_in'});
  const [ra,rb]=await Promise.all([ingestAgencyIdentityObservation(a),ingestAgencyIdentityObservation(b)]);const results=[ra,rb];
  assert.equal(results.filter(r=>r.accepted).length,1);assert.equal(results.filter(r=>r.reason==='identity_observation_replay_conflict').length,1);
  assert.equal(Number(await scalar('SELECT count(*) FROM wfm_agency_identity_continuity_observations;')),1);assert.equal(Number(await scalar('SELECT count(*) FROM wfm_agency_identity_observation_ingress_receipts;')),2);
});

pgTest('provenance receipts are append-only and persist fingerprints only, not raw source identifiers or payloads',async()=>{
  await reset();const input=signedInput();const result=await ingestAgencyIdentityObservation(input);assert.equal(result.accepted,true);
  await assert.rejects(()=>psql("UPDATE wfm_agency_identity_observation_ingress_receipts SET ingress_version='tampered' WHERE tenant_id='T1';"));
  await assert.rejects(()=>psql("DELETE FROM wfm_agency_identity_observation_ingress_receipts WHERE tenant_id='T1';"));
  const dump=await psql("SELECT source_event_fingerprint,source_auth_fingerprint,binding_fingerprint,ingress_version FROM wfm_agency_identity_observation_ingress_receipts WHERE tenant_id='T1';");
  assert.doesNotMatch(dump,/raw-badge-7|BADGE|photo|biometric/i);assert.equal(dump.includes(input.rawBody),false);assert.equal(dump.includes(input.headers['x-wfm-signature']),false);assert.equal(Number(await scalar('SELECT count(*) FROM wfm_agency_identity_observation_ingress_receipts;')),1);
});
