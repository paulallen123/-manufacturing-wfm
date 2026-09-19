import fs from 'node:fs';
import path from 'node:path';

const publicDir=process.argv[2]||'/app/public';
const retired=Object.freeze({
  'review-ui.js': "'use strict';\n/* Retired presentation: weekly review is surfaced through Vector. Server-side review APIs remain authoritative. */\n",
  'review-ui.css': "/* Retired presentation: Vector owns review presentation. */\n",
  'value-cockpit-ui.js': "'use strict';\n/* Retired presentation: cost/productivity decisions are surfaced through Vector. Server-side evidence APIs remain authoritative. */\n",
  'value-cockpit-ui.css': "/* Retired presentation: Vector owns cost/productivity presentation. */\n"
});

for(const [name,body] of Object.entries(retired)){
  const file=path.join(publicDir,name);
  if(fs.existsSync(file)) fs.writeFileSync(file,body,'utf8');
}

function replaceRequired(name,before,after){
  const file=path.join(publicDir,name);
  if(!fs.existsSync(file)) throw new Error('Required runtime presentation asset missing: '+name);
  const text=fs.readFileSync(file,'utf8');
  const occurrences=text.split(before).length-1;
  if(occurrences!==1) throw new Error('Expected exactly one runtime repair signature in '+name+'; found '+occurrences);
  fs.writeFileSync(file,text.replace(before,after),'utf8');
}

// The sealed 0.6.76 presentation still contained two strict-mode globals that were
// previously supplied by retired presentation ownership. Repair the ownership boundary
// without inventing payroll data or changing server-side payroll authority.
replaceRequired(
  'company-ui.js',
  'payrollShell=content=>shell(content);',
  'globalThis.payrollShell=content=>shell(content);'
);
replaceRequired(
  'payroll-intelligence-ui.js',
  'const pciOldPayrollReport=payrollReport;',
  "const pciOldPayrollReport=typeof globalThis.payrollReport==='function'?globalThis.payrollReport:async()=>{};"
);
replaceRequired(
  'payroll-intelligence-ui.js',
  'payrollReport=async function(){await pciOldPayrollReport();',
  'globalThis.payrollReport=async function(){await pciOldPayrollReport();'
);
replaceRequired(
  'payroll-intelligence-ui.js',
  'const pciOldPayrollPage=payrollPageV4;',
  "const pciOldPayrollPage=typeof globalThis.payrollPageV4==='function'?globalThis.payrollPageV4:()=>'';"
);
replaceRequired(
  'payroll-intelligence-ui.js',
  'payrollPageV4=function(){return pciSummary()+pciOldPayrollPage();};',
  'globalThis.payrollPageV4=function(){return pciSummary()+pciOldPayrollPage();};'
);

const timeReviewCss=path.join(publicDir,'time-review-ui.css');
if(fs.existsSync(timeReviewCss)){
  let css=fs.readFileSync(timeReviewCss,'utf8');
  css=css.replace(/[^{}]*\.review-callout[^{}]*\{[^{}]*\}/g,'');
  fs.writeFileSync(timeReviewCss,css,'utf8');
}

const forbidden=[
  ['Payroll review',' due today'].join(''),
  ['AUTOMATED VALUE',' DESK'].join(''),
  ['The system finds',' the saving.'].join(''),
  ['ux-signoff','-desk'].join(''),
  ['ux11','-queue'].join(''),
  ['review','-callout'].join(''),
  ['review','-layout'].join(''),
  ['vc','-hero'].join(''),
  ['vc','-card'].join('')
];
const violations=[];
function walk(dir){
  for(const name of fs.readdirSync(dir)){
    const file=path.join(dir,name),st=fs.statSync(file);
    if(st.isDirectory()){walk(file);continue;}
    if(!/\.(?:js|css|html)$/i.test(name)) continue;
    const text=fs.readFileSync(file,'utf8');
    for(const token of forbidden) if(text.includes(token)) violations.push({file:path.relative(publicDir,file),token});
    if(name==='company-ui.js'&&text.includes('payrollShell=content=>shell(content);')&&!text.includes('globalThis.payrollShell=content=>shell(content);')) violations.push({file:path.relative(publicDir,file),token:'unguarded-payrollShell'});
    if(name==='payroll-intelligence-ui.js'&&text.includes('const pciOldPayrollReport=payrollReport;')) violations.push({file:path.relative(publicDir,file),token:'unguarded-payrollReport-read'});
    if(name==='payroll-intelligence-ui.js'&&text.includes('const pciOldPayrollPage=payrollPageV4;')) violations.push({file:path.relative(publicDir,file),token:'unguarded-payrollPageV4-read'});
  }
}
walk(publicDir);
if(violations.length){
  console.error('RETIRED_PRESENTATION_PURGE=FAIL');
  console.error(JSON.stringify(violations,null,2));
  process.exit(1);
}
console.log('SEALED_RUNTIME_PRESENTATION_REPAIR=PASS');
console.log('RETIRED_PRESENTATION_PURGE=PASS');
