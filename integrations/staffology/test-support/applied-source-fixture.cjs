'use strict';
// Explicit synthetic persisted source custody for local/build admission tests only.
// No production writer imports this helper. It supplies owned fixture facts rather
// than allowing a request, decorated defaults or a dummy employee to authorise them.
const {DatabaseSync}=require('node:sqlite');
const {digest}=require('../configured-site-authority.cjs');
function installAppliedSourceFixture(database,{tenant,runId,site='Leeds',job='Machine operator',weeklyHours=37.5,employeeCount=2}={}){
 const db=new DatabaseSync(database);db.exec('PRAGMA busy_timeout=5000');
 try{const at='2026-09-01T00:00:00.000Z',sites=[{code:'SYNTHETIC',name:site,timezone:'Europe/London'}],
  answers={organisation:{sites}},compiled={scope:{sites},manifests:{organisation:{sites}}},
  scope={companyName:'Synthetic admission source',sites:[site],employeeCount,workspaceSetup:answers},
  configuration={...scope},applied={scopeDigest:digest(scope),configurationDigest:digest(configuration)},
  token='synthetic-source-reviewed-token';
 db.prepare('INSERT INTO customer_workspaces(customer_hash,workspace_id,tenant,initial_run_id,created_at) VALUES(?,?,?,?,?)').run('synthetic-'+runId,'synthetic-workspace-'+runId,tenant,runId,at);
 db.prepare('INSERT INTO implementation_runs(id,tenant,contract_ref_hash,state,started_at_ms,deadline_at_ms,target_hours,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(runId,tenant,'synthetic-'+runId,'IMPLEMENTING',1,9999999999999,24,at,at);
 db.prepare('INSERT INTO implementation_scope(run_id,tenant,scope_json,submitted_by_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(runId,tenant,JSON.stringify(scope),'synthetic-owner',at,at);
 db.prepare('INSERT INTO tenant_environments(tenant,environment_id,namespace,run_id,state,configuration_json,configuration_digest,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(tenant,'synthetic-env-'+runId,'synthetic-namespace-'+runId,runId,'READY',JSON.stringify(configuration),applied.configurationDigest,at,at);
 db.prepare('INSERT INTO workspace_setup_drafts(tenant,run_id,revision,status,answers_json,compiled_json,base_state_json,applied_json,applied_review_token,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(tenant,runId,1,'APPLIED',JSON.stringify(answers),JSON.stringify(compiled),'{}',JSON.stringify(applied),token,at);
 db.prepare('INSERT INTO workspace_setup_events(tenant,run_id,revision,event,actor,detail_json,created_at) VALUES(?,?,?,?,?,?,?)').run(tenant,runId,1,'CONFIGURATION_APPLIED','synthetic-fixture-owner',JSON.stringify({reviewToken:token,...applied}),at);
 const state=JSON.parse(db.prepare('SELECT state FROM tenants WHERE id=?').get(tenant).state);state.workRules??={};state.workRules.jobs=[{name:job}];state.workRules.contracts??={};state.workRules.contracts['synthetic-owned-fixture-profile']=[{id:'synthetic-owned-contract',effectiveFrom:'2026-01-01',type:'full_time',weeklyHours,overtimeBasis:'weekly',overtimeAfter:weeklyHours,holidayMethod:'regular',requireAcceptance:false}];db.prepare('UPDATE tenants SET state=? WHERE id=?').run(JSON.stringify(state),tenant);
 }finally{db.close();}
}
module.exports={installAppliedSourceFixture};
