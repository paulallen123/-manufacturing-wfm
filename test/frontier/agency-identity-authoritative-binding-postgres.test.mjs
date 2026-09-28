import test, {after,before} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL} from '../../src/frontier/agency-portal-token-store.mjs';
import {AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL} from '../../src/frontier/agency-right-to-work-assurance-ledger.mjs';
import {
  AGENCY_IDENTITY_AUTHORITATIVE_BINDING_DDL,
  agencyIdentitySourceSubjectFingerprint,
  createPostgresAgencyIdentityAuthoritativeBindingResolver,
} from '../../src/frontier/agency-identity-authoritative-binding.mjs';

const execFileAsync=promisify(execFile);
const POSTGRES_IMAGE='postgres:16.10-bookworm@sha256:38471f330eb885e04de130b768d6db4e10469e2311879c7e5c699f6d2d8a1c74';
const REQUIRED=process.env.AGENCY_POSTGRES_PROOF_REQUIRED==='1';
const CONTAINER=`wfm-agency-identity-binding-${process.pid}-${Date.now()}`;
const DB_USER='postgres';const DB_NAME='postgres';const DB_PASSWORD='agency-identity-binding-proof-only-not-a-secret';
const KEY='authoritative-binding-fingerprint-key-0123456789abcdef';
const SUBJECT_REF='provider-badge-raw-88';
const ASSIGNMENT='a'.repeat(24);const ASSURANCE='b'.repeat(32);const BINDING_VERSION='c'.repeat(32);
let started=false;

async function docker(args,options={}){return execFileAsync('docker',args,{maxBuffer:8*1024*1024,timeout:options.timeout??30000,encoding:'utf8'});}
function sqlLiteral(value){if(value===null||value===undefined)return 'NULL';if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('non-finite SQL test value');return String(value);}if(typeof value==='boolean')return value?'TRUE':'FALSE';return `'${String(value).replaceAll("'","''")}'`;}
function interpolate(sql,values=[]){return sql.replace(/\$(\d+)/g,(_,n)=>{const i=Number(n)-1;if(i<0||i>=values.length)throw new Error(`missing SQL test parameter $${n}`);return sqlLiteral(values[i]);});}
function normalizeCell(value){if(value==='__NULL__')return null;if(value==='t')return true;if(value==='f')return false;return value;}
function parseRows(stdout){const lines=stdout.split(/\r?\n/).map(line=>line.trimEnd()).filter(Boolean).filter(line=>!/^(INSERT|UPDATE|DELETE|SELECT|CREATE|ALTER|DROP|SET|BEGIN|COMMIT|TRUNCATE)\b/.test(line));if(lines.length<2)return [];const headers=lines[0].split('\t');return lines.slice(1).map(line=>{const cells=line.split('\t');return Object.fromEntries(headers.map((h,i)=>[h,normalizeCell(cells[i]??'')]));});}
async function psql(sql,options={}){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U',DB_USER,'-d',DB_NAME,'-A','-F','\t','-P','footer=off','-P','null=__NULL__','-c',sql],options);return stdout;}
async function query(sql,values=[]){const rows=parseRows(await psql(interpolate(sql,values)));return {rows,rowCount:rows.length};}
async function scalar(sql){const out=await psql(sql);return out.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).at(-1)??null;}
async function waitForPostgres(){let init=false;let last='';for(let i=0;i<80;i+=1){try{const logs=await docker(['logs',CONTAINER],{timeout:5000});last=`${logs.stdout??''}\n${logs.stderr??''}`;init||=last.includes('PostgreSQL init process complete; ready for start up.');if(init){const {stdout}=await docker(['exec',CONTAINER,'psql','-X','-q','-A','-t','-U',DB_USER,'-d',DB_NAME,'-c','SELECT 1;'],{timeout:5000});if(stdout.trim()==='1')return;}}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error(`postgres final server did not become ready\n${last.split(/\r?\n/).slice(-10).join('\n')}`);}
async function stop(){if(!started)return;try{await docker(['rm','-f',CONTAINER],{timeout:10000});}catch{}started=false;}

before(async()=>{if(!REQUIRED)return;try{await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});}catch(error){throw new Error(`Docker is required for authoritative identity binding PostgreSQL proof: ${error.message}`);}await docker(['run','-d','--rm','--name',CONTAINER,'-e',`POSTGRES_PASSWORD=${DB_PASSWORD}`,POSTGRES_IMAGE],{timeout:120000});started=true;await waitForPostgres();await psql(AGENCY_PORTAL_TOKEN_CONSUMPTION_DDL);await psql(AGENCY_RIGHT_TO_WORK_ASSURANCE_DDL);await psql(AGENCY_IDENTITY_AUTHORITATIVE_BINDING_DDL);});
after(async()=>{await stop();});
function pgTest(name,fn){test(name,{skip:!REQUIRED},fn);}
async function reset(){await psql('TRUNCATE wfm_agency_identity_source_subject_bindings, wfm_agency_portal_token_consumptions, wfm_agency_rtw_assurance_current, wfm_agency_rtw_assurance_history;');}

async function seedValid({workerId='W1',agencyId='A1',assuranceVersionId=ASSURANCE,bindingVersionId=BINDING_VERSION,sourceSubjectRef=SUBJECT_REF}={}){
  const fp=agencyIdentitySourceSubjectFingerprint({tenantId:'T1',sourceSystemId:'turnstile',sourceSubjectRef},KEY);
  await psql(`INSERT INTO wfm_agency_identity_source_subject_bindings (tenant_id,source_system_id,source_subject_fingerprint,binding_version_id,agency_id,worker_id,valid_from,valid_until,created_at) VALUES ('T1','turnstile','${fp}','${bindingVersionId}','${agencyId}','${workerId}','2026-10-05T05:00:00Z','2026-10-05T07:00:00Z','2026-10-04T08:00:00Z');`);
  await psql(`INSERT INTO wfm_agency_rtw_assurance_current (tenant_id,agency_id,worker_id,assurance_version_id,site_id,request_id,assignment_fingerprint,evidence_fingerprint,check_method,checked_at,coverage_until,promoted_at,conflicted) VALUES ('T1','${agencyId}','${workerId}','${assuranceVersionId}','S1','R1','${ASSIGNMENT}','${'e'.repeat(24)}','digital_service','2026-10-04T09:00:00Z','2026-10-31T23:59:59Z','2026-10-04T09:05:00Z',false);`);
  const bindings=JSON.stringify([{workerId,assuranceVersionId}]).replaceAll("'","''");
  await psql(`INSERT INTO wfm_agency_portal_token_consumptions (tenant_id,token_id,site_id,request_id,agency_id,token_fingerprint,action,expires_at,consumed_at,assurance_bindings) VALUES ('T1','tok-${workerId}','S1','R1','${agencyId}','${'d'.repeat(16)}','confirm_preferred_worker','2026-10-05T08:00:00Z','2026-10-04T10:00:00Z','${bindings}'::jsonb);`);
}

function resolver(){return createPostgresAgencyIdentityAuthoritativeBindingResolver({query,fingerprintKey:KEY});}
function input(overrides={}){return {tenantId:'T1',siteId:'S1',requestId:'R1',sourceSystemId:'turnstile',sourceSubjectRef:SUBJECT_REF,observedAt:'2026-10-05T05:58:00Z',...overrides};}

pgTest('real PostgreSQL resolves only an active pseudonymous source mapping backed by an accepted agency response and current RTW assurance',async()=>{
  await reset();await seedValid();
  const result=await resolver().resolveBinding(input());
  assert.equal(result.workerId,'W1');assert.equal(result.agencyId,'A1');assert.equal(result.assuranceVersionId,ASSURANCE);assert.equal(result.assignmentFingerprint,ASSIGNMENT);
  assert.match(result.subjectFingerprint,/^[0-9a-f]{32}$/);assert.match(result.bindingEvidenceFingerprint,/^[0-9a-f]{32}$/);
  const dump=await psql("SELECT source_subject_fingerprint,binding_version_id,agency_id,worker_id FROM wfm_agency_identity_source_subject_bindings;");
  assert.doesNotMatch(dump,/provider-badge-raw-88/);
});

pgTest('a newer current RTW assurance invalidates the old accepted response binding before identity evidence can resolve',async()=>{
  await reset();await seedValid();
  const before=await resolver().resolveBinding(input());assert.equal(before.assuranceVersionId,ASSURANCE);
  await psql(`UPDATE wfm_agency_rtw_assurance_current SET assurance_version_id='${'f'.repeat(32)}', checked_at='2026-10-05T05:30:00Z', promoted_at='2026-10-05T05:31:00Z' WHERE tenant_id='T1' AND agency_id='A1' AND worker_id='W1';`);
  await assert.rejects(()=>resolver().resolveBinding(input()),/identity_binding_not_authoritative/);
});

pgTest('overlapping active provider-subject mappings fail closed even if one worker has otherwise valid accepted evidence',async()=>{
  await reset();await seedValid();
  const fp=agencyIdentitySourceSubjectFingerprint({tenantId:'T1',sourceSystemId:'turnstile',sourceSubjectRef:SUBJECT_REF},KEY);
  await psql(`INSERT INTO wfm_agency_identity_source_subject_bindings (tenant_id,source_system_id,source_subject_fingerprint,binding_version_id,agency_id,worker_id,valid_from,valid_until,created_at) VALUES ('T1','turnstile','${fp}','${'9'.repeat(32)}','A2','W2','2026-10-05T05:30:00Z','2026-10-05T06:30:00Z','2026-10-05T05:20:00Z');`);
  await assert.rejects(()=>resolver().resolveBinding(input()),/identity_binding_not_authoritative/);
});

pgTest('source-subject mappings are append-only and retain fingerprints rather than raw provider identity',async()=>{
  await reset();await seedValid();
  await assert.rejects(()=>psql("UPDATE wfm_agency_identity_source_subject_bindings SET worker_id='OTHER' WHERE tenant_id='T1';"));
  await assert.rejects(()=>psql("DELETE FROM wfm_agency_identity_source_subject_bindings WHERE tenant_id='T1';"));
  assert.equal(Number(await scalar('SELECT count(*) FROM wfm_agency_identity_source_subject_bindings;')),1);
  const dump=await psql('SELECT * FROM wfm_agency_identity_source_subject_bindings;');
  assert.doesNotMatch(dump,/provider-badge-raw-88/);
});
