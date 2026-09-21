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
  // These immutable copies contain the checker's own banned-token dictionary.
  // Only the checker files are exempt; all other snapshot files remain scanned.
  '__security_hold_7b6f9d22e1__/scripts/validate-vector-only-ui.mjs',
  '__security_hold_one_day_enterprise__/scripts/validate-vector-only-ui.mjs',
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

const contractPath=path.join(root,'operations/runtime/workflow-action-evidence-contract.cjs');
if(!fs.existsSync(contractPath)) violations.push({type:'missing-workflow-action-evidence-contract',path:'operations/runtime/workflow-action-evidence-contract.cjs'});
else {
  const contract=fs.readFileSync(contractPath,'utf8');
  if(!contract.includes("WFM_WORKFLOW_ACTION_EVIDENCE_V1")) violations.push({type:'workflow-action-contract-version-missing',path:'operations/runtime/workflow-action-evidence-contract.cjs'});
  for(const workflow of ["'time-review'","'absence'","'weekly-signoff'"]){
    if(!contract.includes(workflow)) violations.push({type:'workflow-action-source-missing',path:'operations/runtime/workflow-action-evidence-contract.cjs',workflow});
  }
  for(const lifecycle of ["'action_required'","'decision_sent'","'confirming_source'","'needs_verification'","'resolved'"]){
    if(!contract.includes(lifecycle)) violations.push({type:'workflow-action-lifecycle-missing',path:'operations/runtime/workflow-action-evidence-contract.cjs',lifecycle});
  }
  if(!contract.includes("'current','stale','unknown'")) violations.push({type:'workflow-action-freshness-states-missing',path:'operations/runtime/workflow-action-evidence-contract.cjs'});
  if(contract.includes('Date.now(')) violations.push({type:'workflow-action-contract-derives-state-from-wall-clock',path:'operations/runtime/workflow-action-evidence-contract.cjs'});
  if(!contract.includes("confirmationState==='needs_verification'&&!slaExpired")) violations.push({type:'needs-verification-not-source-owned',path:'operations/runtime/workflow-action-evidence-contract.cjs'});
  if(!contract.includes("confirmationState==='resolved'&&(!confirmedAt||!auditRef)")) violations.push({type:'resolved-state-evidence-not-required',path:'operations/runtime/workflow-action-evidence-contract.cjs'});
  if(!contract.includes("input.consequence.verified!==true")) violations.push({type:'verified-consequence-boundary-missing',path:'operations/runtime/workflow-action-evidence-contract.cjs'});
}

const vectorPath=path.join(root,'ux-overlay/vector-shell.js');
if(!fs.existsSync(vectorPath)) violations.push({type:'missing-vector-owner',path:'ux-overlay/vector-shell.js'});
else {
  const vector=fs.readFileSync(vectorPath,'utf8');
  if(!vector.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1')) violations.push({type:'missing-vector-marker',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('VECTOR_REVIEW_NEUTRAL_V1')) violations.push({type:'missing-review-governance',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('VECTOR_PLANNING_NEUTRAL_V1')) violations.push({type:'missing-planning-governance',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('VECTOR_KPI_EVIDENCE_V1')) violations.push({type:'missing-kpi-evidence-governance',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('VECTOR_IDENTITY_SOURCE_BOUND_V1')) violations.push({type:'missing-identity-source-governance',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('VECTOR_LEAVE_SOURCE_BOUND_V1')) violations.push({type:'missing-leave-source-governance',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('VECTOR_ACTION_SOURCE_BOUND_V1')) violations.push({type:'missing-action-source-governance',path:'ux-overlay/vector-shell.js'});
  if(vector.includes("tone:i===0?'red':i<3?'amber':'blue'")) violations.push({type:'presentation-inferred-urgency',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("tone:'blue',action:'Review',status:'Needs review'")) violations.push({type:'review-state-not-neutral',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('Review source evidence before acting.')||!vector.includes('aria-label="${esc(action)} ${esc(r.title)}"')||!vector.includes('const action=actionAffordance(r)')) violations.push({type:'review-accessibility-contract-missing',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('data-vector-action-status="${esc(r.status)}"')||!vector.includes('· ${esc(r.status)}</small>')) violations.push({type:'action-lifecycle-not-visibly-rendered',path:'ux-overlay/vector-shell.js'});
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
  if(vector.includes("const displayName=()=> 'Paul Allen'")||vector.includes("const siteName=()=> 'Rugby Plant'")) violations.push({type:'hard-coded-user-or-site-context',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("function sourceIdentity(){try{if(typeof me!=='function')return {}")) violations.push({type:'identity-not-source-bound',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("displayName=()=>sourceIdentity().name||'Signed-in user'")||!vector.includes("siteName=()=>sourceIdentity().site||'Current workspace'")) violations.push({type:'identity-neutral-fallback-missing',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('data-vector-identity="${IDENTITY_MARKER}"')) violations.push({type:'identity-evidence-marker-missing',path:'ux-overlay/vector-shell.js'});
  if(vector.includes("filter(x=>x.status==='pending')")) violations.push({type:'pending-request-presented-as-upcoming-leave',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("String(r.status||'').toLowerCase()==='approved'")) violations.push({type:'leave-approval-boundary-missing',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('x.date>=start&&x.date<end')) violations.push({type:'leave-seven-day-window-missing',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('Only approved source requests dated within the next seven days are shown.')) violations.push({type:'leave-evidence-boundary-missing',path:'ux-overlay/vector-shell.js'});
  if(vector.includes('function actionRows(')||vector.includes('.vector-home-source .fcc-action')||vector.includes('.vector-home-source .ux-approved-decision-card')) violations.push({type:'action-state-derived-from-hidden-presentation',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('function structuredReviewRows(){')||!vector.includes("String(issue?.status||'').toLowerCase()==='open'")||!vector.includes("String(request?.status||'').toLowerCase()!=='pending'")) violations.push({type:'structured-action-source-contract-missing',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('if(employee())return [];')||!vector.includes('if(!tokens.size)return [];')) violations.push({type:'action-scope-fail-closed-missing',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('actionQueueGroups(structuredReviewRows()).needs.length')) violations.push({type:'notification-count-not-source-bound',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes('data-vector-action-evidence="${ACTION_MARKER}"')||!vector.includes('No source-confirmed items need your action.')) violations.push({type:'action-evidence-boundary-missing',path:'ux-overlay/vector-shell.js'});

  // Time Review must consume the authoritative read-only bridge once, validate the
  // shared contract, and preserve every uncovered local open item as neutral work.
  if(!vector.includes("const ACTION_EVIDENCE_CONTRACT='WFM_WORKFLOW_ACTION_EVIDENCE_V1'" )||!vector.includes("const TIME_REVIEW_EVIDENCE_PATH='/api/workforce/lifecycle/action-evidence/time-review'")) violations.push({type:'time-review-evidence-endpoint-not-bound',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("fetch(TIME_REVIEW_EVIDENCE_PATH,{method:'GET',credentials:'same-origin',cache:'no-store'")) violations.push({type:'time-review-evidence-read-not-session-bound',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("body.contractVersion!==ACTION_EVIDENCE_CONTRACT||body.workflow!=='time-review'||!Array.isArray(body.items)")) violations.push({type:'time-review-response-contract-not-validated',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("item.contractVersion!==ACTION_EVIDENCE_CONTRACT||item.workflow!=='time-review'")) violations.push({type:'time-review-item-contract-not-validated',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("['decision_sent','confirming_source','needs_verification','resolved'].includes(confirmationState)&&!decisionId")||!vector.includes("['decision_sent','confirming_source','needs_verification'].includes(confirmationState)&&!Number.isFinite(slaExpiresAt)")) violations.push({type:'time-review-confirmation-evidence-not-validated',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("confirmationState==='needs_verification'&&confirmation.slaExpired!==true")) violations.push({type:'time-review-needs-verification-not-source-owned',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("String(item?.confirmation?.state||'').toLowerCase()!=='resolved'")) violations.push({type:'resolved-time-review-item-not-suppressed-from-action-list',path:'ux-overlay/vector-shell.js'});
  if(!vector.includes("state.timeReviewEvidence={status:'unavailable',items:[]}" )||!vector.includes('const uncovered=open.filter')||!vector.includes('!id||!coveredSourceIds.has(id)')) violations.push({type:'time-review-neutral-fallback-missing',path:'ux-overlay/vector-shell.js'});
  if(vector.includes('setInterval(loadTimeReviewEvidence')||vector.includes('setTimeout(loadTimeReviewEvidence')) violations.push({type:'time-review-evidence-retry-loop-present',path:'ux-overlay/vector-shell.js'});

  // Source observation times are provenance, not a freshness verdict. Vector may display
  // source-owned lifecycle/freshness fields in future, but it must never calculate them.
  const reviewStart=vector.indexOf('function structuredReviewRows(){');
  const reviewEnd=vector.indexOf('function leaveDate(',reviewStart);
  const reviewSource=reviewStart>=0&&reviewEnd>reviewStart?vector.slice(reviewStart,reviewEnd):'';
  if(!reviewSource) violations.push({type:'review-source-slice-missing',path:'ux-overlay/vector-shell.js'});
  if(/evidenceState\s*:\s*['"]current['"]/.test(reviewSource)||/status\s*:\s*['"](?:Current|Fresh|Verified current)['"]/.test(reviewSource)) violations.push({type:'review-freshness-invented-without-source-sla',path:'ux-overlay/vector-shell.js'});
  if(/Date\.now\(\).*?(?:generatedAt|updatedAt|observedAt|validUntil|slaExpiresAt)|(?:generatedAt|updatedAt|observedAt|validUntil|slaExpiresAt).*?Date\.now\(\)/s.test(reviewSource)) violations.push({type:'review-state-derived-from-wall-clock',path:'ux-overlay/vector-shell.js'});
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
console.log('VECTOR_IDENTITY_SOURCE_CONTRACT=PASS');
console.log('VECTOR_LEAVE_SOURCE_CONTRACT=PASS');
console.log('VECTOR_ACTION_SOURCE_CONTRACT=PASS');
console.log('VECTOR_ACTION_LIFECYCLE_VISIBLE_CONTRACT=PASS');
console.log('VECTOR_ACTION_FRESHNESS_NEUTRAL_CONTRACT=PASS');
console.log('VECTOR_ACTION_CONFIRMATION_SOURCE_CONTRACT=PASS');
console.log('VECTOR_TIME_REVIEW_EVIDENCE_CONSUMER=PASS');
