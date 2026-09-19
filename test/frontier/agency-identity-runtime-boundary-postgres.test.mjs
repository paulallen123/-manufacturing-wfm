import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  createPostgresAgencyIdentityObservationIngressStore,
} from '../../src/frontier/agency-identity-observation-ingress.mjs';
import {AGENCY_IDENTITY_CONTINUITY_DDL} from '../../src/frontier/agency-identity-continuity.mjs';
import {AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL} from '../../src/frontier/agency-identity-observation-ingress.mjs';
import {AGENCY_IDENTITY_DB_BOUNDARY_DDL} from '../../src/frontier/agency-identity-db-boundary.mjs';

const execFileAsync=promisify(execFile);
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const CONTAINER=`wfm-agency-identity-runtime-boundary-${process.pid}-${Date.now()}`;
const DB_USER='postgres',DB_NAME='postgres',DB_PASSWORD='agency-identity-runtime-boundary-proof-only-not-a-secret';
const ASSIGNMENT='a'.repeat(24),ASSURANCE='b'.repeat(32),SUBJECT='c'.repeat(32);
let started=false;

async function docker(args,options={}){return execFileAsync('docker',args,{maxBuffer:8*1024*1024,timeout:options.timeout??30000,encoding:'utf8'});}
function lit(value){return `'${String(value).replaceAll("'","''")}'`;}
function interpolate(sql,values=[]){return sql.replace(/\$(\d+)/g,(_,n)=>lit(values[Number(n)-1]));}
async function psql(sql,options={}){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-A','-t','-c',sql],options);return stdout;}
async function scalar(sql){const out=await psql(sql);return out.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).at(-1)??null;}
async function waitForPostgres(){let init=false;for(let i=0;i<80;i+=1){try{const logs=await docker(['logs',CONTAINER],{timeout:5000});const all=`${logs.stdout??''}\n${logs.stderr??''}`;init||=all.includes('PostgreSQL init process complete; ready for start up.');if(init&&(await psql('SELECT 1;',{timeout:5000})).trim()==='1')return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('postgres did not become ready');}
async function stop(){if(!started)return;try{await docker(['rm','-f',CONTAINER],{timeout:10000});}catch{}started=false;}
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}

before(async()=>{if(!REQUIRED)return;try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for identity runtime boundary PostgreSQL proof: ${error.message}`);}await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();await psql(`${AGENCY_IDENTITY_CONTINUITY_DDL}\n${AGENCY_IDENTITY_OBSERVATION_INGRESS_DDL}\n${AGENCY_IDENTITY_DB_BOUNDARY_DDL}`);});
after(async()=>{await stop();});
async function reset(){await psql('TRUNCATE public.wfm_agency_identity_observation_ingress_receipts, public.wfm_agency_identity_continuity_observations;');}

function observation(overrides={}){
 return {
  tenantId:'T1',siteId:'S1',requestId:'R1',agencyId:'A1',workerId:'W1',
  assignmentFingerprint:ASSIGNMENT,assuranceVersionId:ASSURANCE,sourceSystemId:'turnstile',
  sourceEventFingerprint:'d'.repeat(32),subjectFingerprint:SUBJECT,signalType:'access_pass',
  observedAt:'2026-10-05T05:58:00Z',sourceAuthFingerprint:'e'.repeat(32),bindingFingerprint:'f'.repeat(32),
  ingressVersion:'agency-identity-observation-ingress-v0.2.0',receivedAt:'2026-10-05T05:58:10Z',
  ...overrides,
 };
}

async function executeBoundary(sql,values){
 const out=await psql(`SET ROLE wfm_agency_identity_ingress_writer; ${interpolate(sql,values)}`,{timeout:10000});
 const line=out.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).at(-1);
 if(!line)throw new Error('missing boundary result');
 const [observationDuplicate,receiptDuplicate]=line.split('|');
 return {rows:[{observation_duplicate:observationDuplicate==='t',receipt_duplicate:receiptDuplicate==='t'}]};
}
const store=()=>createPostgresAgencyIdentityObservationIngressStore({executeBoundary});

pgTest('runtime store writes through the function-only ingress credential and exact replay is idempotent',async()=>{
 await reset();
 const first=await store().appendObservation(observation());
 assert.equal(first.duplicate,false);assert.equal(first.receiptDuplicate,false);
 const replay=await store().appendObservation(observation());
 assert.equal(replay.duplicate,true);assert.equal(replay.receiptDuplicate,true);
 assert.equal(await scalar('SELECT count(*) FROM public.wfm_agency_identity_continuity_observations;'),'1');
 assert.equal(await scalar('SELECT count(*) FROM public.wfm_agency_identity_observation_ingress_receipts;'),'1');
 await assert.rejects(()=>psql(`SET ROLE wfm_agency_identity_ingress_writer; INSERT INTO public.wfm_agency_identity_continuity_observations (tenant_id,site_id,request_id,agency_id,worker_id,assignment_fingerprint,assurance_version_id,source_system_id,source_event_fingerprint,subject_fingerprint,signal_type,observed_at) VALUES ('T1','S1','R1','A1','W9','${ASSIGNMENT}','${ASSURANCE}','turnstile','${'9'.repeat(32)}','${SUBJECT}','access_pass',now());`),/permission denied/i);
});

pgTest('32 concurrent runtime-store replays converge to one durable identity without direct table DML',async()=>{
 await reset();
 const results=await Promise.all(Array.from({length:32},()=>store().appendObservation(observation())));
 assert.equal(results.filter(x=>x.duplicate===false).length,1);
 assert.equal(results.filter(x=>x.duplicate===true).length,31);
 assert.equal(await scalar('SELECT count(*) FROM public.wfm_agency_identity_continuity_observations;'),'1');
 assert.equal(await scalar('SELECT count(*) FROM public.wfm_agency_identity_observation_ingress_receipts;'),'1');
});

pgTest('same provider event cannot be rebound to another worker through the runtime boundary',async()=>{
 await reset();await store().appendObservation(observation());
 await assert.rejects(()=>store().appendObservation(observation({workerId:'W2'})),/identity_observation_replay_conflict/i);
 assert.equal(await scalar("SELECT worker_id FROM public.wfm_agency_identity_continuity_observations WHERE tenant_id='T1' AND source_system_id='turnstile';"),'W1');
 assert.equal(await scalar('SELECT count(*) FROM public.wfm_agency_identity_continuity_observations;'),'1');
});
