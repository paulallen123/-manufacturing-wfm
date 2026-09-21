'use strict';
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value || '').digest('hex');
let diagnostic = process.env.WFM_BROWSER_DIAGNOSTIC_SOURCE;
let journey = process.env.WFM_BROWSER_JOURNEY_SOURCE;
if (hash(diagnostic) !== '6803b05fe634f78122a61703df5f6835b71a430857c213f7cfb4b82628aedbd1' || hash(journey) !== '36d996c04079c1d6dd5ef33356972f2dc5bc56fabdbcae0c4531f067f9d0fdbc') throw Error('BROWSER_PROOF_SOURCE_DIGEST_MISMATCH');
function replaceExactly(source, oldText, newText) {
  if (source.split(oldText).length !== 2) throw Error('AMBIGUOUS_PROOF_PATCH');
  return source.replace(oldText, newText);
}
const oldAssertion = String.raw`   await employee.page.locator('#modalform button[type="submit"]').click();await employee.page.locator('#formerror').waitFor();assert.match(await employee.page.locator('#formerror').innerText(),/overlap|already|request/i);`;
const newAssertion = String.raw`   const overlapStarted = Date.now();
   const overlapResponsePending = employee.page.waitForResponse(response => new URL(response.url()).pathname === '/api/personal/work' && response.request().method() === 'POST', {timeout:15000});
   await employee.page.locator('#modalform button[type="submit"]').click();
   await employee.page.locator('#formerror').waitFor();
   const immediateFeedback = await employee.page.locator('#formerror').innerText();
   const overlapResponse = await overlapResponsePending;
   const overlapBody = await overlapResponse.json();
   assert.ok([400,409,422].includes(overlapResponse.status()), 'OVERLAP_NOT_REFUSED_BY_SOURCE');
   assert.match(String(overlapBody.error || overlapBody.message || ''), /overlap|already|request/i, 'SOURCE_OVERLAP_REASON_MISSING');
   try {
    await employee.page.waitForFunction(() => {
      const node = document.getElementById('formerror');
      return !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden' && /overlap|already|request/i.test(node.innerText);
    }, null, {timeout:15000});
   } catch (error) {
    await capture(employee.page,'leave-'+run+'-feedback-failure');
    console.log(JSON.stringify({event:'VECTOR_OVERLAP_FEEDBACK_FAILURE',run,httpStatus:overlapResponse.status(),sourceError:overlapBody.error || overlapBody.message,immediateFeedback,finalFeedback:await employee.page.locator('#formerror').innerText(),elapsedMs:Date.now()-overlapStarted}));
    throw error;
   }
   const settledFeedback = await employee.page.locator('#formerror').innerText();
   assert.match(settledFeedback,/overlap|already|request/i);
   const feedbackEvidence = {run,httpStatus:overlapResponse.status(),sourceError:overlapBody.error || overlapBody.message,immediateFeedback,settledFeedback,elapsedMs:Date.now()-overlapStarted};
   (state.overlapFeedback ??= []).push(feedbackEvidence);
   console.log(JSON.stringify({event:'VECTOR_OVERLAP_FEEDBACK_VERIFIED',...feedbackEvidence}));
   await capture(employee.page,'leave-'+run+'-overlap-warning');`;
journey = replaceExactly(journey, oldAssertion, newAssertion);
journey = replaceExactly(journey, String.raw`await employee.page.locator('#modalform [data-act="close"]').click();`, String.raw`await employee.page.locator('#modalform').getByRole('button',{name:'Cancel',exact:true}).click();`);
const originalCapture = String.raw`async function capture(page,name){const bytes=await page.screenshot({path:out+'/'+name+'.png',fullPage:true});state.artifacts.push({file:name+'.png',sha256:digest(bytes),bytes:bytes.length});}`;
const observedCapture = originalCapture.slice(0,-1) + String.raw`
 if(name==='manager-today'){
  const visual=await page.evaluate(()=>({title:document.title,sectionLabels:[...document.querySelectorAll('.vector-nav button')].map(n=>n.innerText.trim()),brand:[...document.querySelectorAll('.vector-brand,.vector-logo,.vector-mark')].map(n=>({text:n.innerText,background:getComputedStyle(n).backgroundColor,color:getComputedStyle(n).color})),bodyBackground:getComputedStyle(document.body).backgroundColor}));
  console.log(JSON.stringify({event:'VECTOR_RENDERED_DESIGN_REFERENCE',designId:'VECTOR_FIVE_SECTION_2026_09_19',...visual}));
  try {
  const jpeg=await page.evaluate(async encoded=>{const raw=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([raw],{type:'image/png'}));const canvas=document.createElement('canvas');canvas.width=360;canvas.height=Math.round(bitmap.height*360/bitmap.width);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',0.2).split(',')[1];},bytes.toString('base64'));
  const image=Buffer.from(jpeg,'base64'),file='manager-today-private-preview.jpeg';fs.writeFileSync(out+'/'+file,image,{mode:0o600});state.artifacts.push({file,sha256:digest(image),bytes:image.length});console.log(JSON.stringify({event:'VECTOR_PRIVATE_VISUAL_EVIDENCE',format:'jpeg',width:360,file,sha256:digest(image),bytes:image.length}));
  }catch(error){console.log(JSON.stringify({event:'VECTOR_PRIVATE_VISUAL_UNAVAILABLE',error:String(error.message)}));}
 }
}`;
diagnostic = replaceExactly(diagnostic, originalCapture, observedCapture);
const insertion = String.raw` state.scope='Exact deployed fixture UI with two leave-request, duplicate-refusal, manager-decline and fresh-login journeys; production readiness, restart durability, full approval/payroll and provider proof remain unproven.';
 await (await import('data:text/javascript;base64,'+Buffer.from(process.env.WFM_BROWSER_PATCHED_JOURNEY).toString('base64'))).runLeaveJourney({browser,origin,out,checks,capture,contexts,state});
 state.testResult='PASS';`;
diagnostic = replaceExactly(diagnostic, " state.testResult='PASS';", insertion);
process.env.WFM_BROWSER_PATCHED_JOURNEY = journey;
console.log(JSON.stringify({event:'VECTOR_FEEDBACK_PROOF_V4_PRIVATE',originalJourneySha256:'36d996c04079c1d6dd5ef33356972f2dc5bc56fabdbcae0c4531f067f9d0fdbc',patchedJourneySha256:hash(journey),patchedDiagnosticSha256:hash(diagnostic),applicationChanged:false}));
import('data:text/javascript;base64,'+Buffer.from(diagnostic).toString('base64')).catch(()=>{console.error('BROWSER_DIAGNOSTIC_BOOT_FAILED');process.exitCode=1;});
