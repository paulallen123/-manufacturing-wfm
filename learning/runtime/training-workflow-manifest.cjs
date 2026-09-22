'use strict';

const { createHash } = require('node:crypto');

const CONTRACT_VERSION = 'VECTOR_TRAINING_WORKFLOW_MANIFEST_V1';
const GENERATOR_VERSION = 'training-factory-v1';
const UI_VERSION = 'VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1';
const DELIVERY_MODES = Object.freeze(['SHOW_ME','GUIDE_ME','PRACTISE','TEST_ME']);

const WORKFLOWS = Object.freeze({
  'time.clock': {
    revision: '1',
    title: 'Clock accurately',
    roles: ['employee','manager','payroll','admin'],
    dependencies: ['attendance','clocking','payroll-readiness'],
    surface: 'Time',
    scenario: null,
    steps: [
      ['open-time','Open your Time workspace','Use your own attendance view. Never edit another employee from an employee role.'],
      ['review-shift','Review the shift evidence','Check the recorded start, finish and break evidence before taking action.'],
      ['correct-safely','Correct only the real exception','Use the correction workflow for a missed or incorrect event; do not fabricate a replacement clock.'],
      ['confirm','Confirm the result','Verify the corrected time is reflected in the authoritative attendance state.']
    ]
  },
  'absence.request': {
    revision: '1',
    title: 'Manage absence and leave',
    roles: ['employee','manager','admin'],
    dependencies: ['absence','entitlement','coverage'],
    surface: 'Absence',
    scenario: null,
    steps: [
      ['open-absence','Open your leave view','Review your entitlement, remaining balance and existing requests.'],
      ['choose-dates','Choose the real dates','Enter the requested period and reason required by policy.'],
      ['review-impact','Review what VECTOR shows','Check overlaps, status and any policy warnings before submitting.'],
      ['submit','Submit the request','Confirm the request and use the status shown by VECTOR as the source of truth.']
    ]
  },
  'time.signoff': {
    revision: '1',
    title: 'Complete weekly sign-off',
    roles: ['manager','payroll','admin'],
    dependencies: ['attendance','exceptions','payroll-readiness'],
    surface: 'Today / Time review',
    scenario: 'weekly-signoff',
    steps: [
      ['open-review','Open weekly review','Start from unresolved exceptions rather than manually checking every record.'],
      ['resolve-evidence','Resolve each material exception','Use source evidence and never clear an exception just to reach green status.'],
      ['check-payroll','Review payroll impact','Confirm payable time and any remaining blockers before sign-off.'],
      ['signoff','Sign off only when ready','The week is ready only when unresolved consequential exceptions are cleared or explicitly evidenced.']
    ]
  },
  'schedule.recover': {
    revision: '1',
    title: 'Recover the schedule',
    roles: ['manager','admin'],
    dependencies: ['digital-twin','skills','absence','agency','energy','cash-to-capacity','autopilot'],
    surface: 'Factory / Autopilot',
    scenario: 'absence-recovery',
    steps: [
      ['understand-gap','Understand the operational gap','Review the affected line, required competence, production consequence and source evidence.'],
      ['compare-options','Compare all eligible options','Compare redeployment, overtime, agency and do-nothing. Unsafe or policy-blocked choices must remain visible as rejected evidence.'],
      ['review-value','Review operational and financial impact','Check production, labour, energy and cash consequences together; predicted value is not realised value.'],
      ['decide','Make the authorised decision','Approve only within your authority. If the evidence is stale or context has changed, re-simulate.'],
      ['verify','Verify the outcome','After execution, verify authoritative state and review actual outcome versus prediction.']
    ]
  },
  'labour.cost': {
    revision: '1',
    title: 'Control labour cost',
    roles: ['manager','admin'],
    dependencies: ['labour-cost','agency','overtime','production','verified-value'],
    surface: 'Improve',
    scenario: 'absence-recovery',
    steps: [
      ['identify-driver','Identify the controllable cost driver','Separate unavoidable cost from an actionable labour decision.'],
      ['compare','Compare safe alternatives','Review cost, output, skills, compliance and downstream consequences together.'],
      ['choose','Choose the best authorised option','Do not optimise cost by violating coverage, fatigue, safety or customer constraints.'],
      ['measure','Measure actual value','Use realised outcomes, not forecast savings, to evidence value.']
    ]
  },
  'payroll.reconcile': {
    revision: '1',
    title: 'Reconcile payroll',
    roles: ['payroll','admin'],
    dependencies: ['attendance','payroll','reconciliation','audit'],
    surface: 'Payroll',
    scenario: 'payroll-reconciliation',
    steps: [
      ['review-readiness','Review payroll readiness','Resolve consequential time and attendance exceptions before release.'],
      ['compare','Compare expected and generated outcomes','Trace material variances to source evidence rather than overwriting them.'],
      ['resolve','Resolve or evidence every material variance','Keep raw events immutable and use append-only corrections.'],
      ['release','Release only when reconciliation is proven','Payroll output must remain blocked while critical reconciliation evidence is unresolved.']
    ]
  },
  'configuration.policy': {
    revision: '1',
    title: 'Configure workforce policy',
    roles: ['admin'],
    dependencies: ['configuration','simulation','policy'],
    surface: 'Configuration',
    scenario: null,
    steps: [
      ['change','Prepare the policy change','Record the reason, scope and intended outcome.'],
      ['simulate','Simulate impact','Check affected roles, pay, schedules and downstream rules before activation.'],
      ['approve','Use the required authority','High-impact changes must follow the customer authority model.'],
      ['verify','Verify after activation','Confirm expected behaviour and preserve rollback evidence.']
    ]
  },
  'integration.health': {
    revision: '1',
    title: 'Manage integration health',
    roles: ['admin'],
    dependencies: ['integration-fabric','schema','reconciliation','recovery'],
    surface: 'Integrations',
    scenario: 'integration-recovery',
    steps: [
      ['detect','Identify the source-health issue','Confirm the affected source, freshness and authority boundary.'],
      ['contain','Contain unsafe data use','Pause unsafe mappings or actions rather than guessing changed fields.'],
      ['repair','Reconcile and repair','Use source revisions, mapping evidence and recovery checkpoints.'],
      ['verify','Verify recovery','Resume only after authoritative source health and reconciliation are proven.']
    ]
  },
  'trainer.teachback': {
    revision: '1',
    title: 'Teach the system',
    roles: ['admin'],
    dependencies: ['learning','audit'],
    surface: 'Guide',
    scenario: null,
    steps: [
      ['explain','Explain why the workflow exists','Teach the purpose and safety boundary, not just the clicks.'],
      ['demonstrate','Demonstrate the real workflow','Use the current verified VECTOR experience.'],
      ['practice','Let the learner practise','Move from guided practice to independent performance.'],
      ['teachback','Require teach-back where appropriate','The learner explains and demonstrates the workflow in their own words.']
    ]
  }
});


const CAPTURE_PLANS = Object.freeze({
  'time.clock': Object.freeze({
    status: 'READY',
    revision: '1',
    route: 'attendance',
    requiredSelectors: ['body.vector-ui-active','[data-vector-route="attendance"][aria-current="page"]','.vector-page-content'],
    expectedText: null,
    safeFocusSelectors: []
  }),
  'absence.request': Object.freeze({
    status: 'READY',
    revision: '1',
    route: 'leave',
    requiredSelectors: ['body.vector-ui-active','[data-vector-route="leave"][aria-current="page"]'],
    roleSelectors: Object.freeze({
      employee: '[data-vector-leave-route="employee"]',
      manager: '[data-vector-leave-route="manager"]',
      admin: '[data-vector-leave-route="manager"]'
    }),
    expectedText: 'Absence & Leave',
    safeFocusSelectors: ['[data-vector-workflow="leave-request"]']
  }),
  'time.signoff': Object.freeze({
    status: 'READY',
    revision: '1',
    route: 'vector-weekly-signoff',
    requiredSelectors: ['body.vector-ui-active','.vw-panel'],
    expectedText: 'Weekly sign-off',
    safeFocusSelectors: ['[data-vector-workflow="sign"]']
  }),
  'schedule.recover': Object.freeze({
    status: 'READY',
    revision: '1',
    route: 'readiness',
    requiredSelectors: ['body.vector-ui-active','[data-vector-route="readiness"][aria-current="page"]','.vector-page-content'],
    expectedText: 'Factory',
    safeFocusSelectors: []
  }),
  'labour.cost': Object.freeze({
    status: 'READY',
    revision: '1',
    route: 'costs',
    requiredSelectors: ['body.vector-ui-active','[data-vector-route="costs"][aria-current="page"]','.vector-page-content'],
    expectedText: null,
    safeFocusSelectors: []
  }),
  'payroll.reconcile': Object.freeze({
    status: 'READY',
    revision: '1',
    route: 'payroll-run',
    requiredSelectors: ['body.vector-ui-active','.vw-panel'],
    expectedText: 'Payroll preparation',
    safeFocusSelectors: []
  })
});

function canonicalRole(role){
  const v=String(role||'').toLowerCase();
  if(v.includes('payroll')) return 'payroll';
  if(v.includes('admin')||v.includes('super')) return 'admin';
  if(v.includes('manager')||v.includes('leader')) return 'manager';
  return 'employee';
}
function stable(value){
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function digest(value){return createHash('sha256').update(stable(value)).digest('hex');}
function workflowFor(competencyKey){return WORKFLOWS[String(competencyKey||'')]||null;}
function captureFor(competencyKey,role){
  const plan=CAPTURE_PLANS[String(competencyKey||'')];
  if(!plan) return Object.freeze({status:'PENDING_ANCHOR',revision:'0',route:null,requiredSelectors:[],expectedText:null,safeFocusSelectors:[]});
  const canonical=canonicalRole(role);
  const required=[...(plan.requiredSelectors||[])];
  const roleSelector=plan.roleSelectors?.[canonical];
  if(roleSelector) required.push(roleSelector);
  return Object.freeze({
    status:plan.status,
    revision:plan.revision,
    route:plan.route,
    requiredSelectors:Object.freeze([...new Set(required)]),
    expectedText:plan.expectedText||null,
    safeFocusSelectors:Object.freeze([...(plan.safeFocusSelectors||[])])
  });
}
function roleCanUse(workflow,role){return Boolean(workflow&&workflow.roles.includes(canonicalRole(role)));}
function normaliseLocale(locale){
  const value=String(locale||'en-GB').trim();
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)?value:'en-GB';
}
function buildArtifactFingerprint(input={}){
  const workflow=workflowFor(input.competencyKey);
  if(!workflow) throw new Error('Unknown training competency.');
  const payload={
    contractVersion:CONTRACT_VERSION,
    competencyKey:input.competencyKey,
    role:artifact.payload.role,
    permissionClass:artifact.payload.permissionClass,
    configurationClass:artifact.payload.configurationClass,
    productSha:artifact.payload.productSha,
    uiVersion:artifact.payload.uiVersion,
    generatorVersion:artifact.payload.generatorVersion,
    workflowRevision:workflow.revision,
    role:canonicalRole(input.role),
    permissionClass:String(input.permissionClass||'default'),
    configurationClass:String(input.configurationClass||'standard'),
    locale:normaliseLocale(input.locale),
    explanationMode:String(input.explanationMode||'step-by-step'),
    productSha:String(input.productSha||'unverified'),
    uiVersion:String(input.uiVersion||UI_VERSION),
    generatorVersion:String(input.generatorVersion||GENERATOR_VERSION)
  };
  return {fingerprint:digest(payload),payload};
}
function buildTrainingModule(input={}){
  const workflow=workflowFor(input.competencyKey);
  if(!workflow) throw new Error('Unknown training competency.');
  if(!roleCanUse(workflow,input.role)) throw new Error('Training competency is not assigned to this role.');
  const mode=String(input.mode||'GUIDE_ME').toUpperCase();
  if(!DELIVERY_MODES.includes(mode)) throw new Error('Unsupported training delivery mode.');
  const artifact=buildArtifactFingerprint(input);
  const steps=workflow.steps.map(([id,title,instruction],index)=>({id,index:index+1,title,instruction}));
  return Object.freeze({
    contractVersion:CONTRACT_VERSION,
    competencyKey:input.competencyKey,
    workflowRevision:workflow.revision,
    title:workflow.title,
    surface:workflow.surface,
    dependencies:[...workflow.dependencies],
    mode,
    locale:artifact.payload.locale,
    explanationMode:artifact.payload.explanationMode,
    artifactFingerprint:artifact.fingerprint,
    artifactPublishable:artifact.payload.productSha!=='unverified',
    exposureOnly:mode==='SHOW_ME'||mode==='GUIDE_ME',
    evidencePolicy:mode==='TEST_ME'?'OBSERVED_INDEPENDENT_TASK_REQUIRED':'NO_MASTERY_FROM_DELIVERY',
    scenario:workflow.scenario,
    capture:captureFor(input.competencyKey,artifact.payload.role),
    steps
  });
}
function affectedCompetencies(dependencies=[]){
  const changed=new Set((Array.isArray(dependencies)?dependencies:[]).map(String));
  return Object.entries(WORKFLOWS)
    .filter(([,workflow])=>workflow.dependencies.some(dep=>changed.has(dep)))
    .map(([key])=>key)
    .sort();
}

module.exports=Object.freeze({
  CONTRACT_VERSION,GENERATOR_VERSION,UI_VERSION,DELIVERY_MODES,WORKFLOWS,
  canonicalRole,workflowFor,roleCanUse,captureFor,buildArtifactFingerprint,buildTrainingModule,affectedCompetencies
});
