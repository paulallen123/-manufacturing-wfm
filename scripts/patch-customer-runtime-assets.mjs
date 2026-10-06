import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.argv[2]||'');
if(!root)throw new Error('PUBLIC_ROOT_REQUIRED');
function replaceOnce(source,from,to,label){
 const count=source.split(from).length-1;
 if(count!==1)throw new Error(label+':'+count);
 return source.replace(from,to);
}
function patchOperations(){
 const file=path.join(root,'operations-ui.js');if(!fs.existsSync(file))return;
 let source=fs.readFileSync(file,'utf8');if(source.includes('VECTOR_CUSTOMER_OPERATIONS_CURRENT_DATE_V1'))return;
 source=replaceOnce(source,
  "const OP={epoch:0,actor:null,prefs:null,leave:null,breaks:null,sites:null,swaps:null,settings:null,shifts:null,period:'weekly',breakFilter:'attention'};",
  "const OP={epoch:0,actor:null,prefs:null,leave:null,breaks:null,sites:null,swaps:null,settings:null,shifts:null,calendar:null,personal:null,period:'weekly',breakFilter:'attention'};",
  'OPERATIONS_STATE_ANCHOR');
 source=replaceOnce(source,
  "const opWhen=x=>x?new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(x)):'—';",
  "const opZone=()=>OP.calendar?.timeZone||null;const opLocalDay=x=>{const z=opZone();if(!z||!x)return null;try{return new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x));}catch{return null;}};const opWhen=x=>{const z=opZone();if(!z||!x)return '—';try{return new Intl.DateTimeFormat('en-GB',{timeZone:z,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(x));}catch{return '—';}};const opWeekBounds=()=>{const day=OP.calendar?.localDate;if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(day||'')))return null;const d=new Date(day+'T12:00:00Z'),offset=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-offset);const start=d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+7);return{start,end:d.toISOString().slice(0,10)};};const opCurrentWeek=x=>{const b=opWeekBounds(),d=opLocalDay(x);return Boolean(b&&d&&d>=b.start&&d<b.end);};",
  'OPERATIONS_TIME_ANCHOR');
 source=replaceOnce(source,
  "function opEmployeeHome(){const p=person(me().id),today=OP.shifts.shifts.find(s=>s.start.slice(0,10)==='2026-09-14'),lead=data.org.find(n=>n.id===p.manager);return",
  "function opEmployeeHome(){const p=person(me().id),self=OP.personal?.identity||{},today=OP.calendar?.localDate?OP.shifts.shifts.find(s=>opLocalDay(s.start)===OP.calendar.localDate):null,lead=data.org.find(n=>n.id===p.manager);if(!OP.calendar?.localDate)return heading('Your work today.','Current tenant calendar/source evidence is unavailable. No shift status is calculated until it is restored.',button('Request time off','newleave','primary'));return",
  'OPERATIONS_EMPLOYEE_HOME_ANCHOR');
 source=replaceOnce(source,"${esc(today?.site||p.site)} · ${esc(today?.job||p.job)}","${esc(today?.site||self.site||p.site)} · ${esc(today?.job||self.job||p.job)}",'OPERATIONS_PERSONAL_IDENTITY_SITE');
 source=replaceOnce(source,"Reporting manager: ${esc(lead?.name||'Needs configuration')}","Reporting manager: ${esc(self.manager||lead?.name||'Needs configuration')}",'OPERATIONS_PERSONAL_IDENTITY_MANAGER');
 source=replaceOnce(source,
  "function opShiftsPage(){const r=OP.shifts,ss=r.shifts.filter(s=>s.start>='2026-09-14'&&s.start<'2026-09-21');return",
  "function opShiftsPage(){const r=OP.shifts,ss=OP.calendar?.localDate?r.shifts.filter(s=>opCurrentWeek(s.start)):[];if(!OP.calendar?.localDate)return heading(isEmployee()?'Your published assignments.':'Published site assignments.','Current tenant calendar/source evidence is unavailable. Historical assignments are not substituted for current shifts.');return",
  'OPERATIONS_SHIFTS_ANCHOR');
 source=source.replace('Actual published duty intervals, including approved cross-site swaps.','Actual published duty intervals for the current tenant-calendar week, including approved cross-site swaps.');
 source=source.replace('The legacy sample has remaining balances but no verified earlier usage. A super user must enter reviewed openings; the system will not invent annual usage from a rough estimate.','Earlier leave usage is not verified. An authorised administrator must provide reviewed opening evidence; the system will not infer annual usage.');
 source=source.replace('Clocking remains on the site tablet. The development sample uses fictional clock evidence, not a live device feed.','Attendance shown here comes from the connected source. Unverified events are labelled and stay outside approved payroll.');
 source=source.replace('The development sample uses fictional clock evidence, not a live device feed.','Unverified clock events are clearly labelled and excluded from approved payroll.');
 source=source.replace('General draft-shift editing remains a separate unfinished core workflow.','Only published assignments are shown here; draft planning remains outside this employee view.');
 source=replaceOnce(source,
  "if(ui.page==='overview'&&isEmployee()){[OP.leave,OP.shifts]=await Promise.all([opGet('leave'),opGet('shifts')]);if(epoch!==OP.epoch)return;document.getElementById('root').innerHTML=shell(opEmployeeHome());saveOffline();return;}",
  "if(ui.page==='overview'&&isEmployee()){[OP.leave,OP.shifts,OP.calendar,OP.personal]=await Promise.all([opGet('leave'),opGet('shifts'),OFFLINE?Promise.resolve(null):request('/api/tenant-calendar'),OFFLINE?Promise.resolve(null):request('/api/personal')]);if(epoch!==OP.epoch)return;document.getElementById('root').innerHTML=shell(opEmployeeHome());saveOffline();return;}",
  'OPERATIONS_EMPLOYEE_LOAD_ANCHOR');
 source=replaceOnce(source,
  "const mode={leave:'leave','op-breaks':'breaks','op-sites':'sites','op-swaps':'swaps','op-settings':'settings',shifts:'shifts'}[ui.page];if(!mode)return opPreviousRender();OP[mode]=await opGet(mode);",
  "const mode={leave:'leave','op-breaks':'breaks','op-sites':'sites','op-swaps':'swaps','op-settings':'settings',shifts:'shifts'}[ui.page];if(!mode)return opPreviousRender();if(mode==='shifts'&&!OFFLINE){[OP[mode],OP.calendar]=await Promise.all([opGet(mode),request('/api/tenant-calendar')]);}else OP[mode]=await opGet(mode);",
  'OPERATIONS_SHIFTS_LOAD_ANCHOR');
 if(source.includes("==='2026-09-14'")||source.includes("s.start>='2026-09-14'"))throw new Error('OPERATIONS_HARDCODED_CURRENT_SHIFT_DATE_REMAINS');
 if(/development sample|legacy sample|unfinished core workflow/i.test(source))throw new Error('OPERATIONS_CUSTOMER_SAMPLE_COPY_REMAINS');
 source+='\n/* VECTOR_CUSTOMER_OPERATIONS_CURRENT_DATE_V1 */\n';fs.writeFileSync(file,source);
}
function removeEncodedCsvRow(source,matcher){
 const findBoundary=(from,backward)=>{
  const escaped=backward?source.lastIndexOf('\\n',from):source.indexOf('\\n',from);
  const actual=backward?source.lastIndexOf('\n',from):source.indexOf('\n',from);
  const options=[escaped,actual].filter(v=>v>=0);
  if(!options.length)return backward?0:source.length;
  return backward?Math.max(...options):Math.min(...options);
 };
 let guard=0;
 while(matcher.test(source)){
  matcher.lastIndex=0;
  const match=matcher.exec(source);if(!match)break;
  if(++guard>20)throw new Error('ONBOARDING_SAMPLE_ROW_SCRUB_LOOP');
  const tokenAt=match.index,startBoundary=findBoundary(tokenAt,true);
  const start=source.slice(startBoundary,startBoundary+2)==='\\n'?startBoundary+2:(startBoundary===0?0:startBoundary+1);
  const endBoundary=findBoundary(tokenAt,false);
  const end=source.slice(endBoundary,endBoundary+2)==='\\n'?endBoundary+2:(endBoundary<source.length?endBoundary+1:endBoundary);
  source=source.slice(0,start)+source.slice(end);
  matcher.lastIndex=0;
 }
 return source;
}
function patchOnboarding(){
 const file=path.join(root,'onboarding-ui.js');if(!fs.existsSync(file))return;
 let source=fs.readFileSync(file,'utf8');if(source.includes('VECTOR_CUSTOMER_ONBOARDING_COPY_V2'))return;
 source=removeEncodedCsvRow(source,/Jordan New|jordan\.new@example\.test/gi);
 source=source.replaceAll('Secure invitations require the authenticated development application.','Secure invitations require the authenticated online application.');
 source=source.replaceAll('Invitation created — development only','Invitation created');
 source=source.replaceAll('This development build does not contact real employees.','Delivery is not treated as confirmed until the configured invitation channel records an acknowledgement.');
 source=source.replaceAll('Use fictional data in this development build.','Preview validates the file without creating employee records.');
 const forbidden=[['development only',/development only/i],['development build',/development build/i],['Jordan New',/Jordan New/i],['jordan.new@example.test',/jordan\.new@example\.test/i]];
 const survivor=forbidden.find(([,pattern])=>pattern.test(source));
 if(survivor){const match=survivor[1].exec(source),at=match?.index??-1,snippet=at>=0?source.slice(Math.max(0,at-120),Math.min(source.length,at+240)).replace(/[\r\n]+/g,' '):'';throw new Error('ONBOARDING_CUSTOMER_SAMPLE_COPY_REMAINS:'+survivor[0]+':'+snippet);}
 source+='\n/* VECTOR_CUSTOMER_ONBOARDING_COPY_V2 */\n';fs.writeFileSync(file,source);
}
function patchFeatures(){
 const file=path.join(root,'features.js');if(!fs.existsSync(file))return;
 let source=fs.readFileSync(file,'utf8');if(source.includes('VECTOR_CUSTOMER_FEATURES_COPY_V1'))return;
 source=source.replace(/For the sample journey, send Leah an offer,[\s\S]*?return to the manager to confirm\./gi,'');
 source=source.replaceAll(' All data is synthetic.','');
 source=source.replaceAll('All data is synthetic.','');
 source=source.replace(
  "document.title='Manufacturing Workforce · '+(OFFLINE?'Interactive sample':'Local development build');",
  "document.title='Vector · Workforce';"
 );
 if(/For the sample journey, send Leah|All data is synthetic\./i.test(source))throw new Error('FEATURES_CUSTOMER_SAMPLE_COPY_REMAINS');
 if(/document\.title\s*=.*Local development build/i.test(source))throw new Error('FEATURES_CUSTOMER_DEVELOPMENT_TITLE_REMAINS');
 source+='\n/* VECTOR_CUSTOMER_FEATURES_COPY_V1 */\n';fs.writeFileSync(file,source);
}
patchOperations();patchOnboarding();patchFeatures();
console.log('VECTOR_CUSTOMER_RUNTIME_ASSET_PATCH=PASS');