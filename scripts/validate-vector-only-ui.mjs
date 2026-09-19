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
  if(!vector.includes('VECTOR_PLANNING_NEUTRAL_V1')) violations.push({type:'missing-planning-governance',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('VECTOR_KPI_EVIDENCE_V1')) violations.push({type:'missing-kpi-evidence-governance',path:'ux-overlay/vector-shell.js'});
  if(vector.includes("tone:i===0?'red':i<3?'amber':'blue'")) violations.push({type:'presentation-inferred-urgency',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("tone:'blue',action:'Review',status:'Needs review'")) violations.push({type:'review-state-not-neutral',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('Review source evidence before acting.')||!vector.includes('aria-label="Review ${esc(r.title)}"')) violations.push({type:'review-accessibility-contract-missing',path:'ux-overlay/vector-shell.js'});
  if(vector.includes('const risk=/gap|critical|short|risk|review|under/i')) violations.push({type:'planning-risk-inferred-from-copy',path:'ux-overlay/vector-shell.js'});
  if(vector.includes('width:risk?58')||vector.includes("width:[82,71,69,55][i]")) violations.push({type:'planning-width-invented',path:'ux-overlay/vector-shell.js'});
  if(vector.includes("const times=['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00','22:00']")) violations.push({type:'planning-timeline-invented',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("status:'Open source planning',tone:'grey',width:null")) violations.push({type:'planning-state-not-neutral',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('Status and coverage shown only when verified by the source workflow')) violations.push({type:'planning-evidence-boundary-missing',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('background:none;border-left:0')||!vector.includes('background:#eef1f5;box-shadow:none;color:#43546d')) violations.push({type:'planning-neutral-visual-contract-missing',path:'ux-overlay/vector-shell.js'});

  if(vector.includes('progress:cost==null?null:68')) violations.push({type:'labour-cost-progress-invented',path:'ux-overlay/vector-shell.js'});
  if(vector.includes('function sparkline(')||/points:\[[0-9]/.test(vector)) violations.push({type:'synthetic-kpi-trend-present',path:'ux-overlay/vector-shell.js'});
  if(vector.includes("tone:'red',icon:'clock'")||vector.includes("tone:'green',icon:'cost'")) violations.push({type:'kpi-severity-without-structured-status',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("tone:'blue',icon:'clock'")||!vector.includes("tone:'blue',icon:'cost'")) violations.push({type:'kpi-neutral-tone-contract-missing',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("label:'Labour cost (today)',detail:cost==null?'Connect verified cost data':'Verified cost total',progress:null")) violations.push({type:'labour-cost-progress-not-neutral',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('data-vector-kpi-evidence="${KPI_MARKER}"')||!vector.includes('Trend graphics are shown only when verified source history is available.')) violations.push({type:'kpi-evidence-boundary-missing',path:'ux-overlay/vector-shell.js'});
}

if(violations.length){
  console.error('VECTOR_ONLY_REPOSITORY_GUARD=FAIL');
  console.error(JSON.stringify(violations,null,2));
  process.exit(1);
}
console.log('VECTOR_ONLY_REPOSITORY_GUARD=PASS');
console.log('VECTOR_NEUTRAL_REVIEW_CONTRACT=PASS');
console.log('VECTOR_NEUTRAL_PLANNING_CONTRACT=PASS');
console.log('VECTOR_KPI_EVIDENCE_CONTRACT=PASS');
