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
if(violations.length){
  console.error('VECTOR_ONLY_REPOSITORY_GUARD=FAIL');
  console.error(JSON.stringify(violations,null,2));
  process.exit(1);
}
console.log('VECTOR_ONLY_REPOSITORY_GUARD=PASS');
