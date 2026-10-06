import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
const patcher=path.join(path.dirname(fileURLToPath(import.meta.url)),'patch-customer-runtime-assets.mjs');
const exactSealedOnboardingExcerpt="(function(){'use strict';\nconst ON=rootThis(),STATE={report:null,preview:null,csv:'source_id,payroll_id,name,email,manager_id,site,job,start_date,contract_type,weekly_hours,language,skills,role\\nHR-9101,PAY-9101,Jordan New,jordan.new@example.test,s1,Tamworth,Machine operator,2026-10-01,full_time,40,en-GB,CNC,director\\n'};\nfunction rootThis(){return window.WFMOnboarding;}\nasync function invite(source){if(OFFLINE)return toast('Secure invitations require the authenticated development application.');modal('Invitation created — development only','This development build does not contact real employees.');}\n})();";
test('customer runtime patch removes fixed September shifts and development onboarding copy',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vector-customer-runtime-patch-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const ops=[
  "const OP={epoch:0,actor:null,prefs:null,leave:null,breaks:null,sites:null,swaps:null,settings:null,shifts:null,period:'weekly',breakFilter:'attention'};",
  "const opWhen=x=>x?new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(x)):'—';",
  "function opEmployeeHome(){const p=person(me().id),today=OP.shifts.shifts.find(s=>s.start.slice(0,10)==='2026-09-14'),lead=data.org.find(n=>n.id===p.manager);return `x ${esc(today?.site||p.site)} · ${esc(today?.job||p.job)} Reporting manager: ${esc(lead?.name||'Needs configuration')} The development sample uses fictional clock evidence, not a live device feed.`;}",
  "function opShiftsPage(){const r=OP.shifts,ss=r.shifts.filter(s=>s.start>='2026-09-14'&&s.start<'2026-09-21');return `Actual published duty intervals, including approved cross-site swaps. General draft-shift editing remains a separate unfinished core workflow.`;}",
  "const opPreviousRender=render;render=async function(){if(ui.page==='overview'&&isEmployee()){[OP.leave,OP.shifts]=await Promise.all([opGet('leave'),opGet('shifts')]);if(epoch!==OP.epoch)return;document.getElementById('root').innerHTML=shell(opEmployeeHome());saveOffline();return;}const mode={leave:'leave','op-breaks':'breaks','op-sites':'sites','op-swaps':'swaps','op-settings':'settings',shifts:'shifts'}[ui.page];if(!mode)return opPreviousRender();OP[mode]=await opGet(mode);};",
  "The legacy sample has remaining balances but no verified earlier usage. A super user must enter reviewed openings; the system will not invent annual usage from a rough estimate."
 ].join('\\n');
 fs.writeFileSync(path.join(root,'operations-ui.js'),ops);
 fs.writeFileSync(path.join(root,'onboarding-ui.js'),exactSealedOnboardingExcerpt);
 fs.writeFileSync(path.join(root,'features.js'),"const copy='Order is safe. All data is synthetic.'; const tip='For the sample journey, send Leah an offer, sign out and sign in as leah@northstar.example, accept it, then return to the manager to confirm.\\\\n\\\\n'; document.title='Manufacturing Workforce · '+(OFFLINE?'Interactive sample':'Local development build');");
 const run=spawnSync(process.execPath,[patcher,root],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
 const patched=fs.readFileSync(path.join(root,'operations-ui.js'),'utf8');
 assert.doesNotMatch(patched,/2026-09-14|2026-09-21|development sample|legacy sample|unfinished core workflow/i);
 assert.match(patched,/api\/tenant-calendar/);assert.match(patched,/api\/personal/);assert.match(patched,/opCurrentWeek/);
 const onboarding=fs.readFileSync(path.join(root,'onboarding-ui.js'),'utf8');
 assert.doesNotMatch(onboarding,/Jordan New|jordan\.new@example\.test|development only|development build/i);
 assert.match(onboarding,/Delivery is not treated as confirmed/);
 assert.match(onboarding,/VECTOR_CUSTOMER_ONBOARDING_COPY_V2/);
 assert.ok(onboarding.includes("csv:'source_id,payroll_id,name,email,manager_id,site,job,start_date,contract_type,weekly_hours,language,skills,role\\n'};"),'sealed CSV header must remain after sample-row removal');
 assert.doesNotMatch(onboarding,/HR-9101,PAY-9101/,'exact packaged Jordan row must be removed without leaving row fragments');
 const features=fs.readFileSync(path.join(root,'features.js'),'utf8');
 assert.doesNotMatch(features,/For the sample journey, send Leah|All data is synthetic\.|document\.title\s*=.*Local development build/i);
 assert.match(features,/document\.title='Vector · Workforce'/);
 assert.match(features,/VECTOR_CUSTOMER_FEATURES_COPY_V1/);
 assert.equal(spawnSync(process.execPath,[patcher,root],{encoding:'utf8'}).status,0,'patch is idempotent');
});