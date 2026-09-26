'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto');
const origin=String(process.env.WFM_ORIGIN||'').replace(/\/$/,''),password=process.env.WFM_STAGING_PASSWORD||'';
const proof={schemaVersion:1,scope:'FORGE correction submission and manager rejection',target:origin,expectedCandidateSha:process.env.EXPECTED_CANDIDATE_SHA,startedAt:new Date().toISOString(),status:'UNPROVEN',assertions:[],network:[],errors:[],limitations:['Fixture accounts only; this proves one correction journey, not the complete Golden Journey.']};
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
let browser;const contexts=[];
function check(name,value,evidence){assert.ok(value,name);proof.assertions.push({name,status:'PASS',evidence});}
async function api(page,path){const r=await page.request.get(origin+path);assert.equal(r.status(),200,path);return r.json();}
async function user(email){const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);const page=await context.newPage();page.on('pageerror',e=>proof.errors.push(String(e.message).slice(0,300)));page.on('response',r=>{if(r.url().startsWith(origin+'/api/'))proof.network.push({path:new URL(r.url()).pathname,method:r.request().method(),status:r.status()});});
 await page.goto(origin+'/#vector/corrections',{waitUntil:'domcontentloaded'});
 const account=page.locator('[name="email"]');await account.waitFor({state:'visible'});const tag=await account.evaluate(e=>e.tagName);if(tag==='SELECT')await account.selectOption(email);else await account.fill(email);
 await page.locator('[name="password"]').fill(password);
 const loggedIn=page.waitForResponse(r=>r.url()===origin+'/api/login'&&r.request().method()==='POST');
 await page.locator('form').filter({has:account}).locator('button[type="submit"]').click();assert.equal((await loggedIn).status(),200);
 await page.waitForFunction(()=>!!window.VectorWorkforceOperations&&document.querySelector('.vector-sidebar'));
 await page.goto(origin+'/#vector/corrections',{waitUntil:'domcontentloaded'});
 await page.locator('.ac-panel').first().waitFor({state:'visible'});
 const bootstrap=await api(page,'/api/bootstrap');check('authenticated_'+email,bootstrap.actor.email===email,{tenant:bootstrap.actor.tenant,role:bootstrap.actor.role});
 check('approved_FORGE_shell_'+email,await page.locator('.vector-sidebar').isVisible());return page;
}
async function submit(page,label){const response=page.waitForResponse(r=>r.url()===origin+'/api/attendance-corrections/command'&&r.request().method()==='POST');await page.locator('#modal button[type="submit"]').click();const r=await response;const b=await r.json();assert.equal(r.status(),200,label+': '+JSON.stringify(b));return b;}
(async()=>{
 assert.equal(origin,'https://vector-customer-ready-candidate-production.up.railway.app','protected origin');assert.ok(password.length>=20,'credential required');assert.match(proof.expectedCandidateSha||'',/^[a-f0-9]{40}$/,'candidate identity');
 const {chromium}=require('playwright');browser=await chromium.launch({headless:true});
 const employee=await user('maya@northstar.example');
 const report=await api(employee,'/api/attendance-corrections');
 const record=report.records.find(r=>!r.payrollLocked&&!report.requests.some(q=>q.record===r.id&&q.period===r.period&&['submitted','information_required','awaiting_approval','payroll_review_required'].includes(q.status)));
 assert.ok(record,'an unlocked fixture record without an active request is required');
 proof.sourceRecord={id:record.id,beforeDigest:hash(record)};
 const note='FORGE proof '+crypto.randomUUID()+': verify retained original clock evidence';proof.fixtureNote=note;
 await employee.locator('[data-act="ac-submit"][data-id="'+record.id+'"]').click();
 await employee.locator('#modal [name="clockIn"]').fill(record.date+'T06:00');await employee.locator('#modal [name="clockOut"]').fill(record.date+'T14:00');await employee.locator('#modal [name="note"]').fill(note);
 const submitted=await submit(employee,'employee submission');const id=submitted.result.id;proof.correctionId=id;
 check('backend_submission_confirmed',submitted.result.status==='submitted',{id,status:submitted.result.status});
 await employee.locator('.ac-request').filter({hasText:note}).waitFor({state:'visible'});check('employee_UI_shows_saved_request',true);
 const manager=await user('manager@northstar.example');
 await manager.locator('[data-act="ac-open"][data-id="'+id+'"]').click();await manager.locator('[data-act="ac-reject"][data-id="'+id+'"]').click();await manager.locator('#modal [name="note"]').fill('Proof fixture declined after evidence review; recorded hours stay unchanged.');
 const rejected=await submit(manager,'manager rejection');check('authorised_business_decision',rejected.result.status==='rejected'&&rejected.result.outcome.applied===false,{id,status:rejected.result.status,revision:rejected.result.revision});
 const managerRow=manager.locator('.ac-request').filter({hasText:note});await managerRow.filter({hasText:'Declined'}).waitFor({state:'visible'});check('manager_UI_shows_backend_decision',true);
 await employee.reload({waitUntil:'domcontentloaded'});await employee.locator('.ac-request').filter({hasText:note}).filter({hasText:'Declined'}).waitFor({state:'visible'});check('employee_refresh_shows_same_decision',true);
 const final=await api(employee,'/api/attendance-corrections'),row=final.requests.find(q=>q.id===id),afterRecord=final.records.find(r=>r.id===record.id&&r.period===record.period);
 check('persistent_readback_rejected',row?.status==='rejected'&&row?.revision===2&&row.outcome.applied===false,{id,status:row.status,revision:row.revision,digest:hash(row)});
 check('submission_and_decision_history_persisted',row.history.some(h=>h.type==='attendance-correction-submitted')&&row.history.some(h=>h.type==='attendance-correction-reject'),{history:row.history.map(h=>({type:h.type,by:h.by,at:h.at}))});
 check('original_record_unchanged',hash(afterRecord)===hash(record),{before:hash(record),after:hash(afterRecord)});
 const fresh=await user('maya@northstar.example');await fresh.locator('.ac-request').filter({hasText:note}).filter({hasText:'Declined'}).waitFor({state:'visible'});const freshRow=(await api(fresh,'/api/attendance-corrections')).requests.find(q=>q.id===id);
 check('fresh_login_matches_persisted_backend',hash(freshRow)===hash(row),{digest:hash(freshRow)});
 check('no_browser_runtime_errors',proof.errors.length===0,{errors:proof.errors});proof.status='PASS';
})().catch(e=>{proof.status='FAIL';proof.error=String(e.stack||e).replaceAll(password||'\u0000','[redacted]').slice(0,1800);proof.assertions.push({name:'journey_completion',status:'FAIL',error:proof.error});}).finally(async()=>{
 for(const context of contexts){try{await context.request.post(origin+'/api/logout',{headers:{origin,'content-type':'application/json'},data:{}});}catch{}}await browser?.close();proof.finishedAt=new Date().toISOString();console.log('VECTOR_BROWSER_ASSERTIONS='+JSON.stringify(proof));
 http.createServer((req,res)=>{res.writeHead(req.url==='/health'?200:proof.status==='PASS'?200:503,{'content-type':'application/json'});res.end(JSON.stringify(proof));}).listen(process.env.PORT||3000,'0.0.0.0');
});
