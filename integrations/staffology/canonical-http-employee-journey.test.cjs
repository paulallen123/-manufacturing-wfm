'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {existsSync,mkdirSync,mkdtempSync,rmSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');

const sourceDirectory=process.env.CANONICAL_SOURCE_DIR;
if(!sourceDirectory)throw Error('CANONICAL_SOURCE_DIR_REQUIRED: point this test at the verified canonical source snapshot.');
const source=resolve(sourceDirectory),explicitRuntime=process.env.WFM_RUNTIME&&resolve(process.env.WFM_RUNTIME);
const token='0123456789abcdef0123456789abcdef';
const configuration=JSON.stringify([{id:'staffology-people',provider:'staffology',tenant:'northstar-demo',scope:'d1',token,objectTypes:['people']}]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function start(runtime,database,port){
 const localPaths=join(runtime,'local-paths.cjs'),bootstrap=join(runtime,'security-runtime/bootstrap.cjs'),args=existsSync(localPaths)&&existsSync(bootstrap)?['--require',localPaths,bootstrap]:[join(runtime,'server.cjs')];
 const child=spawn(process.execPath,args,{env:{PATH:process.env.PATH,HOME:process.env.HOME,PORT:String(port),NODE_ENV:'staging',NODE_OPTIONS:'--experimental-sqlite',WFM_DB:database,WFM_INTEGRATIONS_JSON:configuration},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 for(let i=0;i<400;i++){if(child.exitCode!==null)assert.fail(`canonical server exited ${child.exitCode}: ${output}`);try{const response=await fetch(`http://127.0.0.1:${port}/api/health`);if(response.ok)return {child,output:()=>output};}catch{}await sleep(25);}
 child.kill('SIGKILL');assert.fail(`canonical server did not become healthy: ${output}`);
}
async function stop(child){if(child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(2000)]);if(child.exitCode===null)child.kill('SIGKILL');}
function client(port,userAgent){let cookie='';const origin=`http://127.0.0.1:${port}`;return async(path,{method='GET',body,headers={}}={})=>{const response=await fetch(origin+path,{method,headers:{origin,'user-agent':userAgent,...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];const text=await response.text(),value=text?JSON.parse(text):null;assert.equal(response.ok,true,`${method} ${path} returned ${response.status}: ${text}`);return value;};}
async function login(request){await request('/api/login',{method:'POST',body:{email:'superuser@northstar.example',password:'Factory-local-demo-2026!'}});}

function staffologyEmployee(id,payrollId,firstName,email){return {id,status:'Current',personalDetails:{firstName,lastName:'Synthetic',email},employmentDetails:{payrollCode:payrollId,starterDetails:{startDate:'2026-09-01'},leaverDetails:{hasLeft:false}}};}
async function reviewedEnvelope(Adapter,Bridge){
 const provider=[staffologyEmployee('employee-001','PAY901','Alpha','staffology-http-1@example.invalid'),staffologyEmployee('employee-002','PAY902','Beta','staffology-http-2@example.invalid')],response=(status,body)=>new Response(JSON.stringify(body),{status}),config={apiKey:'OFFLINE-SYNTHETIC-CREDENTIAL-0001',baseUrl:'https://api.staffology.co.uk',timeoutMs:1000};
 const acquisition=await Adapter.acquireEmployees({config,employerId:'employer-001',pageSize:2,now:()=>Date.parse('2026-10-01T00:00:00Z'),client:async url=>{const path=new URL(url).pathname;if(path.endsWith('/employees'))return response(200,new URL(url).searchParams.get('pageNum')==='0'?provider.map(({id})=>({id})):[]);const id=path.split('/').pop();return response(200,provider.find(row=>row.id===id));}});
 const mappings=[{externalId:'employee-001',payrollId:'PAY901',managerId:'m1',site:'Leeds',job:'Machine operator',contractType:'full_time',weeklyHours:40,language:'en-GB'},{externalId:'employee-002',payrollId:'PAY902',managerId:'m1',site:'Leeds',job:'Machine operator',contractType:'full_time',weeklyHours:40,language:'en-GB'}];
 assert.deepEqual(acquisition.records.map(row=>[row.externalId,row.data.identity.payrollCode]),[['employee-001','PAY901'],['employee-002','PAY902']]);
 assert.throws(()=>Bridge.peopleEnvelope(acquisition,{approved:true,mappings:[mappings[0],{...mappings[1],externalId:'employee-003'}]}),{code:'STAFFOLOGY_EMPLOYEE_MAPPING_REQUIRED'});
 return Bridge.peopleEnvelope(acquisition,{approved:true,mappings});
}

test('reviewed Staffology cohort becomes canonical staff and survives bootstrap restart',async t=>{
 const temporary=mkdtempSync(join(tmpdir(),'staffology-http-journey-')),database=join(temporary,'wfm.sqlite'),port=4600+Math.floor(Math.random()*200);t.after(()=>rmSync(temporary,{recursive:true,force:true}));
 let runtime=explicitRuntime;
 if(!runtime){runtime=join(temporary,'runtime');mkdirSync(runtime);const extracted=spawnSync('tar',['--no-same-owner','-xzf',join(source,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz'),'-C',runtime],{encoding:'utf8'});assert.equal(extracted.status,0,extracted.stderr);const composed=spawnSync(process.execPath,[join(source,'scripts/compose-vector-local-runtime.mjs'),runtime],{cwd:source,encoding:'utf8',timeout:120000});assert.equal(composed.status,0,composed.stderr);}
 const Adapter=require(join(source,'integrations/staffology/staffology-adapter.cjs')),Bridge=require(join(source,'integrations/staffology/canonical-runtime-bridge.cjs')),envelope=await reviewedEnvelope(Adapter,Bridge);
 let running=await start(runtime,database,port);t.after(()=>stop(running.child));const request=client(port,'staffology-http-application');await login(request);let version=(await request('/api/bootstrap')).state.version;
 const staged=await request('/api/integrations/ingest',{method:'POST',headers:{authorization:`Bearer ${token}`,'x-connector-id':'staffology-people','idempotency-key':'staffology-http-journey-001'},body:envelope});assert.equal(staged.status,'staged');assert.equal(staged.valid,2);
 const applied=await request('/api/integrations/apply',{method:'POST',body:{version,id:staged.id,reviewed:true}});assert.equal(applied.status,'applied');assert.equal(applied.outcome.status,'staged');
 let onboarding=await request('/api/onboarding'),batch=onboarding.batches.find(row=>row.id===applied.outcome.id);assert.equal(batch.status,'staged');assert.ok(onboarding.people.every(row=>row.staffId===null));
 let command=await request('/api/command',{method:'POST',body:{version:applied.version,command:'onboarding-review',payload:{id:batch.id,revision:batch.revision,reviewed:true}}});assert.equal(command.result.status,'reviewed');version=command.version;
 for(const sourceId of ['employee-001','employee-002']){const invite=await request('/api/onboarding/invite',{method:'POST',body:{version,sourceId,hours:24}});assert.equal(invite.delivery,'not_sent');const acceptance=client(port,`staffology-identity-${sourceId}`);await acceptance('/api/onboarding/accept',{method:'POST',body:{token:invite.token,password:`Synthetic-${sourceId}-Pass!`}});version=(await request('/api/bootstrap')).state.version;command=await request('/api/command',{method:'POST',body:{version,command:'onboarding-configure',payload:{sourceId,reviewed:true,age:30,standardAdult:true,nightWorker:false,noticeMinutes:30,restHistoryComplete:true,approvedSkills:[{name:'CNC',level:1,validUntil:'2027-12-31',evidence:'synthetic-reviewed-training-record'}],reference:{complete:true}}}});assert.match(command.result.staffId,/^ob-employee-00[12]$/);version=command.version;}
 const csv='employee_id,hourly_rate,effective_from,currency\nPAY901,10.00,2026-09-01,GBP\nPAY902,10.00,2026-09-01,GBP\n';command=await request('/api/command',{method:'POST',body:{version,command:'cost-import-stage',payload:{csv,options:{mode:'explicit'}}}});assert.equal(command.result.status,'staged');version=command.version;command=await request('/api/command',{method:'POST',body:{version,command:'cost-import-apply',payload:{id:command.result.id,reviewed:true}}});assert.equal(command.result.status,'applied');version=command.version;
 for(const sourceId of ['employee-001','employee-002']){command=await request('/api/command',{method:'POST',body:{version,command:'onboarding-ready',payload:{sourceId,reviewed:true}}});assert.equal(command.result.applied,true);version=command.version;}
 await stop(running.child);running=await start(runtime,database,port);const independent=client(port,'staffology-independent-bootstrap-restart-readback');await login(independent);const bootstrap=await independent('/api/bootstrap');onboarding=await independent('/api/onboarding');const detail=await independent(`/api/integrations/${encodeURIComponent(staged.id)}`),people=onboarding.people.filter(row=>row.sourceId.startsWith('employee-00')),staff=bootstrap.state.staff.filter(row=>row.sourceId?.startsWith('employee-00'));
 assert.deepEqual(people.map(row=>[row.sourceId,row.payrollId,row.status,row.staffId]),[['employee-001','PAY901','ready_for_scheduling','ob-employee-001'],['employee-002','PAY902','ready_for_scheduling','ob-employee-002']]);assert.deepEqual(staff.map(row=>[row.id,row.sourceId,row.payrollId,row.onboardingReady]),[['ob-employee-001','employee-001','PAY901',true],['ob-employee-002','employee-002','PAY902',true]]);assert.deepEqual(detail.records.map(row=>[row.externalId,row.status,row.appliedRef]),[['employee-001','applied',batch.id],['employee-002','applied',batch.id]]);
 const db=new DatabaseSync(database,{readOnly:true}),audit=db.prepare("SELECT action,COUNT(*) count FROM audit_events WHERE action IN ('integration-stage','integration-apply','onboarding-review','onboarding-invite','onboarding-identity-verified','onboarding-configure','cost-import-stage','cost-import-apply','onboarding-ready') GROUP BY action ORDER BY action").all();db.close();assert.deepEqual(Object.fromEntries(audit.map(row=>[row.action,row.count])),{'cost-import-apply':1,'cost-import-stage':1,'integration-apply':1,'integration-stage':1,'onboarding-configure':2,'onboarding-identity-verified':2,'onboarding-invite':2,'onboarding-ready':2,'onboarding-review':1});
});
