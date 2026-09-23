import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {nextWeeklyAction,verifyPayrollReady,verifyReleasedPayroll} from './vector-weekly-payroll-journey.mjs';

export const MAX_WEEKLY_ACTIONS=256;

async function readWeekly(page,period){
  return page.evaluate(async p=>{const r=await fetch('/api/weekly-review?period='+encodeURIComponent(p),{cache:'no-store'});return {status:r.status,json:await r.json()};},period);
}
async function readPayroll(page,period){
  return page.evaluate(async p=>{const r=await fetch('/api/payroll-run?period='+encodeURIComponent(p),{cache:'no-store'});return {status:r.status,json:await r.json()};},period);
}
async function openWeekly(page,teamId){
  const time=page.getByText('Time & Attendance',{exact:true}).first();await time.waitFor({state:'visible',timeout:10000});await time.click();
  const weekly=page.locator('button[data-vector-workflow="weekly"]').first();await weekly.waitFor({state:'visible',timeout:10000});await weekly.click();
  const team=page.locator('#vw-team');await team.waitFor({state:'visible',timeout:10000});await team.selectOption(teamId);
}
async function commandResponse(page,command,click){
  const pending=page.waitForResponse(response=>{if(!response.url().endsWith('/api/command')||response.request().method()!=='POST')return false;try{return response.request().postDataJSON()?.command===command;}catch{return false;}},{timeout:15000});
  await click();const response=await pending;assert.equal(response.status(),200,`${command} rejected.`);const body=await response.json();assert.equal(body?.ok,true,`${command} did not return saved success.`);return body;
}
async function submitModal(page,command,fill){
  await fill();return commandResponse(page,command,()=>page.locator('#modalform button[type="submit"]').click({timeout:5000}));
}
async function executeWeeklyAction(page,action){
  await openWeekly(page,action.team);
  if(action.type==='resolve-issue'){
    const button=page.locator(`button[data-vector-workflow="issue"][data-id="${action.issue}"]`);await button.waitFor({state:'visible',timeout:10000});await button.click();
    return submitModal(page,'review-resolve',async()=>{
      if(action.issueType==='adjustment') await page.locator('#modalform select[name="decision"]').selectOption(action.decision);
      if(['missing','sync'].includes(action.issueType)){
        await page.locator('#modalform select[name="outcome"]').selectOption(action.outcome);
        for(const [name,value] of [['clockIn',action.clockIn],['clockOut',action.clockOut],['breakStart',action.breakStart],['breakEnd',action.breakEnd]]) await page.locator(`#modalform input[name="${name}"]`).fill(value);
        await page.locator('#modalform input[name="breaksConfirmed"]').check();
      }
      await page.locator('#modalform textarea[name="reason"]').fill(action.reason);
      await page.locator('#modalform input[name="checked"]').check();
    });
  }
  if(action.type==='check-category'||action.type==='check-employee'){
    const id=action.category||action.employee,kind=action.type==='check-category'?'category':'employee';
    const button=page.locator(`button[data-vector-workflow="${kind}"][data-id="${id}"]`);await button.waitFor({state:'visible',timeout:10000});await button.click();
    return submitModal(page,'review-check',()=>page.locator('#modalform input[name="checked"]').check());
  }
  if(action.type==='sign-team'){
    const button=page.locator('button[data-vector-workflow="sign"]');await button.waitFor({state:'visible',timeout:10000});assert.equal(await button.isDisabled(),false,'Sign button is disabled despite signable source state.');await button.click();
    return submitModal(page,'review-sign',()=>page.locator('#modalform input[name="checked"]').check());
  }
  throw Error('UNSUPPORTED_WEEKLY_UI_ACTION');
}

export async function runWeeklyPayrollBrowserJourney({browser,origin,loginRole,period='2026-09-07'}={}){
  assert.ok(browser&&typeof browser.newContext==='function','Browser unavailable.');assert.equal(typeof loginRole,'function','loginRole unavailable.');
  const evidence={weeklyActions:[],signedTeams:[],payrollReleased:false,freshLoginReadBack:false,tenantIsolation:false,csvSha256:null,batchId:null};
  const directorContext=await browser.newContext({viewport:{width:1280,height:900}});const directorPage=await directorContext.newPage();
  try{
    await loginRole(directorPage,'superuser@northstar.example');
    for(let count=0;count<MAX_WEEKLY_ACTIONS;count++){
      const before=await readWeekly(directorPage,period);assert.equal(before.status,200,'Weekly review unavailable.');
      const action=nextWeeklyAction(before.json);if(action.type==='ready-for-payroll'){evidence.signedTeams=before.json.teams.map(team=>team.id);break;}
      const beforeVersion=before.json.teams.find(team=>team.id===action.team)?.revision;
      const result=await executeWeeklyAction(directorPage,action);assert.ok(Number.isInteger(result.version),'Saved weekly action has no version.');
      const after=await readWeekly(directorPage,period);assert.equal(after.status,200,'Weekly review unavailable after action.');
      const afterTeam=after.json.teams.find(team=>team.id===action.team);assert.ok(afterTeam,'Weekly team disappeared after action.');
      assert.notEqual(afterTeam.revision,beforeVersion,'Weekly action produced no source revision change.');
      evidence.weeklyActions.push({type:action.type,team:action.team,source:action.issue||action.category||action.employee||action.team,version:result.version});
      if(count===MAX_WEEKLY_ACTIONS-1) throw Error('WEEKLY_ACTION_BUDGET_EXHAUSTED');
    }
    assert.ok(evidence.signedTeams.length>0,'Weekly journey never reached the signed terminal.');
  } finally {await directorContext.close();}

  const payrollContext=await browser.newContext({viewport:{width:1280,height:900}});const payrollPage=await payrollContext.newPage();
  let savedBatch;
  try{
    await loginRole(payrollPage,'payroll@northstar.example');
    const before=await readPayroll(payrollPage,period);assert.equal(before.status,200);verifyPayrollReady(before.json);
    await payrollPage.waitForFunction(()=>document.querySelector('button[data-vector-workflow="release"]'),{timeout:30000});
    const release=payrollPage.locator('button[data-vector-workflow="release"]');assert.equal(await release.isDisabled(),false,'Payroll release remained disabled after verified sign-off.');await release.click();
    const released=await submitModal(payrollPage,'payroll-release',async()=>{
      await payrollPage.locator('#modalform input[name="checked"]').check();await payrollPage.locator('#modalform input[name="schemaReviewed"]').check();
      const extra=payrollPage.locator('#modalform input[name="timeReviewMappingReviewed"]');if(await extra.count())await extra.check();
    });
    const after=await readPayroll(payrollPage,period);assert.equal(after.status,200);savedBatch=verifyReleasedPayroll(before.json,after.json,released.result);evidence.payrollReleased=true;evidence.batchId=savedBatch.id;
    const exported=await payrollPage.evaluate(async id=>{const r=await fetch('/api/payroll-export/'+encodeURIComponent(id),{cache:'no-store'});return {status:r.status,text:await r.text(),sha:r.headers.get('x-export-sha256')};},savedBatch.id);
    assert.equal(exported.status,200);const digest=crypto.createHash('sha256').update(exported.text).digest('hex');assert.equal(exported.sha,digest);assert.equal(savedBatch.checksum,digest);evidence.csvSha256=digest;
  } finally {await payrollContext.close();}

  const freshContext=await browser.newContext({viewport:{width:1280,height:900}});const fresh=await freshContext.newPage();
  try{await loginRole(fresh,'payroll@northstar.example');const after=await readPayroll(fresh,period);assert.equal(after.status,200);assert.equal(after.json.batches.find(batch=>batch.id===savedBatch.id)?.checksum,savedBatch.checksum);evidence.freshLoginReadBack=true;}finally{await freshContext.close();}

  const otherContext=await browser.newContext({viewport:{width:1280,height:900}});const other=await otherContext.newPage();
  try{await loginRole(other,'otherpayroll@isolation.example');const status=await other.evaluate(async id=>(await fetch('/api/payroll-export/'+encodeURIComponent(id),{cache:'no-store'})).status,savedBatch.id);assert.equal(status,404);evidence.tenantIsolation=true;}finally{await otherContext.close();}

  return Object.freeze({...evidence,status:'PASS',providerSubmission:false,productionMutation:false,customerMutation:false});
}
