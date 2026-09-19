import fs from 'node:fs';
import path from 'node:path';

const publicDir=process.argv[2]||'/app/public';
const retired=Object.freeze({
  'review-ui.js': "'use strict';\n/* Retired presentation: weekly review is surfaced through Vector. Server-side review APIs remain authoritative. */\n",
  'review-ui.css': "/* Retired presentation: Vector owns review presentation. */\n",
  'value-cockpit-ui.js': "'use strict';\n/* Retired presentation: cost/productivity decisions are surfaced through Vector. Server-side evidence APIs remain authoritative. */\n"
});

for(const [name,body] of Object.entries(retired)){
  const file=path.join(publicDir,name);
  if(fs.existsSync(file)) fs.writeFileSync(file,body,'utf8');
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
  }
}
walk(publicDir);
if(violations.length){
  console.error('RETIRED_PRESENTATION_PURGE=FAIL');
  console.error(JSON.stringify(violations,null,2));
  process.exit(1);
}
console.log('RETIRED_PRESENTATION_PURGE=PASS');
