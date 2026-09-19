import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const forbiddenNames=[
  /^ux-overlay\/ux-reset(?:-|\.|$)/i,
  /^ux-overlay\/vector-priority-bridge\.(?:js|css)$/i,
  /^\.github\/scripts\/ux-cycle1[12]-/i,
  /^\.github\/workflows\/ux-cycle(?:2|3|4|6|7|8|9|10|11)-gate\.yml$/i,
  /^\.github\/workflows\/ux-role-first-gate\.yml$/i
];
const forbiddenTokens=[
  'Payroll review due today',
  'Automated value desk',
  'The system finds the saving.',
  'ux-signoff-desk',
  'ux11-queue'
];
const skipDirs=new Set(['.git','node_modules']);
const tokenScanSkip=new Set([
  'scripts/validate-vector-only-ui.mjs',
  '.github/workflows/vector-only-ui-guard.yml'
]);
const textExt=new Set(['.js','.cjs','.mjs','.css','.html','.htm','.yml','.yaml','.json','.md','.txt']);
const violations=[];

function walk(dir){
  for(const name of fs.readdirSync(dir)){
    if(skipDirs.has(name)) continue;
    const abs=path.join(dir,name);
    const rel=path.relative(root,abs).replaceAll(path.sep,'/');
    const st=fs.statSync(abs);
    if(st.isDirectory()){ walk(abs); continue; }
    if(forbiddenNames.some(rx=>rx.test(rel))) violations.push({type:'forbidden-file',path:rel});
    if(tokenScanSkip.has(rel) || !textExt.has(path.extname(name).toLowerCase())) continue;
    const text=fs.readFileSync(abs,'utf8');
    for(const token of forbiddenTokens) if(text.includes(token)) violations.push({type:'forbidden-token',path:rel,token});
  }
}
walk(root);

const vectorPath=path.join(root,'ux-overlay/vector-shell.js');
if(!fs.existsSync(vectorPath)) violations.push({type:'missing-vector-owner',path:'ux-overlay/vector-shell.js'});
else {
  const vector=fs.readFileSync(vectorPath,'utf8');
  if(!vector.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1')) violations.push({type:'missing-vector-marker',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('VECTOR_REVIEW_NEUTRAL_V1')) violations.push({type:'missing-review-governance',path:'ux-overlay/vector-shell.js'});
  if(vector.includes("tone:i===0?'red':i<3?'amber':'blue'")) violations.push({type:'presentation-inferred-urgency',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("tone:'blue',action:'Review',status:'Needs review'")) violations.push({type:'review-state-not-neutral',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('Review source evidence before acting.')||!vector.includes('aria-label="Review ${esc(r.title)}"')) violations.push({type:'review-accessibility-contract-missing',path:'ux-overlay/vector-shell.js'});
}

if(violations.length){
  console.error('VECTOR_ONLY_REPOSITORY_GUARD=FAIL');
  console.error(JSON.stringify(violations,null,2));
  process.exit(1);
}
console.log('VECTOR_ONLY_REPOSITORY_GUARD=PASS');
console.log('VECTOR_NEUTRAL_REVIEW_CONTRACT=PASS');
