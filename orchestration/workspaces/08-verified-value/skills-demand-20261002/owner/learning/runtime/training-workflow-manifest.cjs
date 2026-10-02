'use strict';

const { createHash } = require('node:crypto');

const CONTRACT_VERSION = 'VECTOR_TRAINING_WORKFLOW_MANIFEST_V1';
const GENERATOR_VERSION = 'training-factory-v1';
const UI_VERSION = 'VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1';
const DELIVERY_MODES = Object.freeze(['SHOW_ME','GUIDE_ME','PRACTISE','TEST_ME']);

const WORKFLOWS = Object.freeze({
  "schedule.read": {
    "revision": "1",
    "title": "Understand your schedule",
    "roles": [
      "employee",
      "manager",
      "payroll",
      "admin"
    ],
    "dependencies": [
      "schedule"
    ],
    "surface": "Plan",
    "scenario": null,
    "steps": [
      [
        "open",
        "Open your schedule",
        "Use the schedule for your own role and permitted site."
      ],
      [
        "review",
        "Review the published shift",
        "Check the date, start, finish, location and any published change."
      ],
      [
        "resolve",
        "Resolve a discrepancy",
        "Raise a conflict through the permitted workflow; a draft or proposal is not a published shift."
      ]
    ]
  },
  "absence.decide": {
    "revision": "1",
    "title": "Decide absence requests",
    "roles": [
      "manager",
      "admin"
    ],
    "dependencies": [
      "absence",
      "entitlement",
      "coverage"
    ],
    "surface": "Absence",
    "scenario": null,
    "steps": [
      [
        "open",
        "Open the pending leave request",
        "Check the employee, dates, request status and policy evidence."
      ],
      [
        "impact",
        "Review coverage and entitlement",
        "Check overlaps, available entitlement and required staffing before deciding."
      ],
      [
        "decide",
        "Record the authorised decision",
        "Approve or decline within your role and provide the required reason. Do not change source facts to clear a warning."
      ],
      [
        "verify",
        "Verify the saved result",
        "Reload the request and confirm its status and recorded decision. Escalate unresolved coverage or policy conflicts."
      ]
    ]
  },
  "time.correct": {
    "revision": "1",
    "title": "Correct time safely",
    "roles": [
      "employee",
      "manager",
      "payroll",
      "admin"
    ],
    "dependencies": [
      "attendance",
      "corrections",
      "audit"
    ],
    "surface": "Time",
    "scenario": null,
    "steps": [
      [
        "inspect",
        "Inspect the time evidence",
        "Identify the actual missing or incorrect event and its date."
      ],
      [
        "request",
        "Use the correction workflow",
        "Provide the proposed correction and reason within your permission. Keep original clock evidence intact."
      ],
      [
        "verify",
        "Verify the correction status",
        "Check the saved request and approval status. A pending request is not an approved change to payable time."
      ]
    ]
  },
  "profile.manage": {
    "revision": "1",
    "title": "Manage your details",
    "roles": [
      "employee"
    ],
    "dependencies": [
      "people",
      "profile"
    ],
    "surface": "People",
    "scenario": null,
    "steps": [
      [
        "open",
        "Open your own details",
        "Review only the personal fields available to your role."
      ],
      [
        "change",
        "Update an allowed field",
        "Use accurate information and the permitted edit or request process. Restricted fields require an authorised owner."
      ],
      [
        "verify",
        "Verify the saved information",
        "Reopen the record and confirm the change or request status."
      ]
    ]
  },
  "team.coach": {
    "revision": "1",
    "title": "Coach your team",
    "roles": [
      "manager"
    ],
    "dependencies": [
      "learning",
      "audit"
    ],
    "surface": "Guide",
    "scenario": null,
    "steps": [
      [
        "review",
        "Identify the learning need",
        "Review assigned role skills and the task that needs support."
      ],
      [
        "demonstrate",
        "Explain and demonstrate",
        "Explain the purpose, source evidence and authority boundary before guiding the task."
      ],
      [
        "observe",
        "Observe independent performance",
        "Have the learner complete the task and explain their decision. Guidance alone is not mastery."
      ],
      [
        "verify",
        "Verify recorded evidence",
        "Confirm authoritative task evidence is recorded; never self-award competence from viewing a guide."
      ]
    ]
  },
  "payroll.exception": {
    "revision": "1",
    "title": "Resolve payroll exceptions",
    "roles": [
      "payroll",
      "admin"
    ],
    "dependencies": [
      "payroll",
      "attendance",
      "exceptions"
    ],
    "surface": "Payroll",
    "scenario": null,
    "steps": [
      [
        "review",
        "Review blocked payroll items",
        "Identify the affected employee, period and source exception."
      ],
      [
        "trace",
        "Trace the discrepancy",
        "Compare time, corrections and policy evidence without overwriting original events."
      ],
      [
        "resolve",
        "Resolve within your authority",
        "Use the authorised correction or approval process and retain the reason."
      ],
      [
        "verify",
        "Verify recalculated readiness",
        "Reload payroll readiness and confirm material exceptions are resolved before release."
      ]
    ]
  },
  "payroll.export": {
    "revision": "1",
    "title": "Control payroll output",
    "roles": [
      "payroll",
      "admin"
    ],
    "dependencies": [
      "payroll",
      "reconciliation",
      "audit"
    ],
    "surface": "Payroll",
    "scenario": null,
    "steps": [
      [
        "check",
        "Check payroll readiness",
        "Confirm the period, scope and approved time evidence."
      ],
      [
        "reconcile",
        "Reconcile the output",
        "Compare generated totals with expected outcomes and resolve material variances."
      ],
      [
        "release",
        "Use the authorised release control",
        "Do not release while consequential exceptions or approvals are unresolved."
      ],
      [
        "verify",
        "Retain release evidence",
        "Confirm the actual output and release record. Downloading a preview does not prove provider acceptance."
      ]
    ]
  },
  "audit.trace": {
    "revision": "1",
    "title": "Trace decisions",
    "roles": [
      "payroll",
      "admin"
    ],
    "dependencies": [
      "audit"
    ],
    "surface": "Audit",
    "scenario": null,
    "steps": [
      [
        "identify",
        "Identify the decision",
        "Locate the affected record, period and action within your permitted scope."
      ],
      [
        "trace",
        "Follow the recorded evidence",
        "Review actor, reason, source revision and resulting state."
      ],
      [
        "verify",
        "Check the outcome",
        "Compare the audit record with current authoritative state and report any unexplained difference."
      ]
    ]
  },
  "configuration.roles": {
    "revision": "1",
    "title": "Configure roles safely",
    "roles": [
      "admin"
    ],
    "dependencies": [
      "configuration",
      "roles",
      "security"
    ],
    "surface": "Configuration",
    "scenario": null,
    "steps": [
      [
        "review",
        "Review the access need",
        "Identify the named user, tenant, job responsibilities and minimum required permissions."
      ],
      [
        "change",
        "Use the authorised role workflow",
        "Assign only required access and preserve any necessary approval record."
      ],
      [
        "verify",
        "Verify allowed and denied access",
        "Test the intended permissions and confirm unrelated or cross-tenant access remains denied."
      ]
    ]
  },
  "site.setup": {
    "revision": "1",
    "title": "Configure a site",
    "roles": [
      "admin"
    ],
    "dependencies": [
      "configuration",
      "sites",
      "calendars"
    ],
    "surface": "Configuration",
    "scenario": null,
    "steps": [
      [
        "scope",
        "Confirm the site scope",
        "Check the source-approved site, departments, time zone and calendar."
      ],
      [
        "configure",
        "Configure supported fields",
        "Enter approved values and resolve missing source information before activation."
      ],
      [
        "verify",
        "Verify downstream behaviour",
        "Confirm schedules and policy use the expected site settings and retain change evidence."
      ]
    ]
  },
  "security.audit": {
    "revision": "1",
    "title": "Operate security controls",
    "roles": [
      "admin"
    ],
    "dependencies": [
      "security",
      "identity",
      "audit"
    ],
    "surface": "Security",
    "scenario": null,
    "steps": [
      [
        "review",
        "Review identity and access evidence",
        "Check named users, active roles and permitted tenant scope."
      ],
      [
        "investigate",
        "Investigate the actual event",
        "Trace the source event and recorded action without altering the audit trail."
      ],
      [
        "contain",
        "Apply the authorised control",
        "Use the established revocation or recovery workflow within your authority."
      ],
      [
        "verify",
        "Verify the boundary",
        "Confirm access and recovery behave as intended and preserve the result."
      ]
    ]
  },
  "feature.enablement": {
    "revision": "1",
    "title": "Enable new functionality",
    "roles": [
      "employee",
      "manager",
      "payroll",
      "admin"
    ],
    "dependencies": [
      "configuration",
      "learning",
      "feature-enablement"
    ],
    "surface": "Configuration",
    "scenario": null,
    "steps": [
      [
        "review",
        "Review the assigned change",
        "Understand the capability, affected roles, dependencies and approved scope."
      ],
      [
        "validate",
        "Validate the workflow",
        "Complete assigned guidance and an independent task using the verified environment."
      ],
      [
        "enable",
        "Respect activation authority",
        "Only the authorised owner may enable the feature after its required evidence passes."
      ],
      [
        "verify",
        "Verify the outcome",
        "Confirm actual behaviour and retain recovery evidence; reading guidance is not certification."
      ]
    ]
  },
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
  if(v==='director'||v.includes('admin')||v.includes('super')) return 'admin';
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
    role:artifact.payload.role,
    permissionClass:artifact.payload.permissionClass,
    configurationClass:artifact.payload.configurationClass,
    productSha:artifact.payload.productSha,
    uiVersion:artifact.payload.uiVersion,
    generatorVersion:artifact.payload.generatorVersion,
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

