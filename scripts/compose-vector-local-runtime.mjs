// Reproduce the existing Dockerfile's runtime assembly for isolated local proof.
// No package install, external connection, credential access or deployment occurs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(root, 'candidate-runtime'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inputs = new Map();
const recordInput = file => { inputs.set(file, sha256(fs.readFileSync(path.join(root, file)))); };
const sealedExpected = {
  'public/onboarding-engine.js': 'c06b354826747387fe14763dba5cef681ae08a1cf64d83d2fb54c1b13338476e',
  'server.cjs': '1792f544d0fea25577f683f3df957b4f74b6a086cd0479b24b1fe77f58587dd0',
  'lib/outbound-integration.cjs': '7e7b3126ac7fdd5712fc5fc7299e3c75893bc699f7ed200dbba29b914c2bf9d4',
  'lib/transactional-outbound-bridge.cjs': '52f890d30bde3e657e8e95d2f4db25d075ebdc8c8cf3be3bd4331b40c072e81f'
};
function validateSealedRuntime(runtime) {
  const packageManifest = JSON.parse(fs.readFileSync(path.join(runtime, 'PACKAGE_MANIFEST_SHA256.json'), 'utf8'));
  const runtimeManifestBytes = fs.readFileSync(path.join(runtime, 'RUNTIME_MANIFEST.json'));
  if (sha256(runtimeManifestBytes) !== packageManifest.files?.['RUNTIME_MANIFEST.json']) throw Error('SEALED_RUNTIME_MANIFEST_DIGEST_CHANGED');
  const runtimeManifest = JSON.parse(runtimeManifestBytes);
  if (Object.keys(runtimeManifest).length !== 133) throw Error('SEALED_RUNTIME_MANIFEST_COVERAGE_CHANGED');
  for (const [relative, digest] of Object.entries(sealedExpected)) {
    if (sha256(fs.readFileSync(path.join(runtime, relative))) !== digest) throw Error('SEALED_SOURCE_DRIFT: ' + relative);
    if (runtimeManifest[relative] !== digest) throw Error('SEALED_MANIFEST_MISMATCH: ' + relative);
  }
}
function composeStaffology(runtime) {
  validateSealedRuntime(runtime);
  const operationsRuntimeDir=path.join(runtime,'operations-runtime');fs.mkdirSync(operationsRuntimeDir,{recursive:true});
  for(const source of ['operations/runtime/tenant-calendar.cjs','operations/runtime/workflow-action-evidence-contract.cjs','operations/runtime/workflow-action-evidence-bridge.cjs','operations/runtime/workflow-action-evidence-sources.cjs']){
    recordInput(source);fs.copyFileSync(path.join(root,source),path.join(operationsRuntimeDir,path.basename(source)));
  }
  // Explicit recovery correction overlay. Preserve the original archive and bind every replacement byte.
  const recoverySources = {"support-operations.cjs": "459c381fbdf517d438bcbb0a1341c0708eed1b8ba1e6e482147bb8f3b6143ddf", "integration-gateway.cjs": "03cd0caacff0a751d7c3865f2b625655f67d1155b8b2ca5af7b6246683ccc578", "provider-job-store.cjs": "1b36e5f9bc599741ab2cc8ef245ac3f5c8ac33e68aea46612cb31252965282a0", "provider-adapter-contract.cjs": "e5631bc79138e2da426daa01d0ce1af7a394758abbc5232655cf7af6e2f5f196", "provider-recovery-authority.cjs": "5a53dc665b6f4e651705d8590c91188b4e325e625fa64cb8210a0b65dbf2cb63", "provider-investigation.cjs": "c69950a2253de9479dfdc3a325fc23cb800470fab3347271e98c4e8963b4e555"};
  const recoveryAssembly = {};
  for (const [file, sealedHash] of Object.entries(recoverySources)) {
    const source = `verification/provider-recovery-correction/operations/runtime/${file}`;
    const target = path.join(runtime, 'lib', file);
    recordInput(source);
    const replacement = fs.readFileSync(path.join(root, source));
    const currentHash = sha256(fs.readFileSync(target));
    if (currentHash !== sealedHash && currentHash !== sha256(replacement)) throw Error('RECOVERY_OVERLAY_SOURCE_DRIFT: ' + file);
    fs.writeFileSync(target, replacement);
    recoveryAssembly[file] = {sealedSha256:sealedHash,replacementSha256:sha256(replacement),source};
  }

  fs.writeFileSync(path.join(runtime,'PROVIDER_RECOVERY_ASSEMBLY.json'),JSON.stringify({schemaVersion:1,files:recoveryAssembly,claimBoundary:'Explicit source overlay; scoped build metadata, not hosted recovery proof.'},null,2)+'\n');
  const supportUiSource='verification/provider-recovery-correction/ui/support-ui.js';
  const supportUiTarget=path.join(runtime,'public/support-ui.js'),supportUiReplacement=fs.readFileSync(path.join(root,supportUiSource));
  const supportUiSealed='b3089fec672bbe4ad5d12dd07293869ac9fec4b70a6f0de756efb66c19422c8e';
  if(![supportUiSealed,sha256(supportUiReplacement)].includes(sha256(fs.readFileSync(supportUiTarget))))throw Error('SUPPORT_UI_SOURCE_DRIFT');
  recordInput(supportUiSource);fs.writeFileSync(supportUiTarget,supportUiReplacement);
  fs.writeFileSync(path.join(runtime,'SUPPORT_UI_ASSEMBLY.json'),JSON.stringify({source:supportUiSource,sealedSha256:supportUiSealed,replacementSha256:sha256(supportUiReplacement)},null,2)+'\n');
  const integrationDir = path.join(runtime, 'integrations', 'staffology');
  fs.mkdirSync(integrationDir, {recursive: true});
  for (const file of ['staffology-adapter.cjs', 'canonical-runtime-bridge.cjs', 'canonical-production-boundaries.cjs', 'canonical-operations.cjs', 'configured-site-authority.cjs', 'employee-import-previews.cjs']) {
    const source = `integrations/staffology/${file}`;
    recordInput(source);
    fs.copyFileSync(path.join(root, source), path.join(integrationDir, file));
  }
  const onboardingPath = path.join(runtime, 'public/onboarding-engine.js');
  let onboarding = fs.readFileSync(onboardingPath, 'utf8');
  const normaliseAnchor = 'function normalise(s,row){';
  const payrollAnchor = 'source=sourceId(row.source_id),payroll=sourceId(row.payroll_id),name=';
  if (onboarding.split(normaliseAnchor).length !== 2 || onboarding.split(payrollAnchor).length !== 2) throw Error('SEALED_ONBOARDING_PAYROLL_ANCHOR_CHANGED');
  // Provider payroll codes may contain one safe character. Source IDs retain their stricter rule.
  const payrollValidator = "function payrollId(x){const v=String(x||'').trim();assert(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(v),'Payroll ID must be 1–64 safe characters.');return v;}\n";
  onboarding = onboarding.replace(normaliseAnchor, payrollValidator + normaliseAnchor).replace(payrollAnchor, 'source=sourceId(row.source_id),payroll=payrollId(row.payroll_id),name=');
  const acceptanceAnchor="p.status='identity_verified';p.identityVerified=true;p.revision++;return p;";
  if(onboarding.split(acceptanceAnchor).length!==2)throw Error('SEALED_ONBOARDING_ACCEPTANCE_ANCHOR_CHANGED');
  onboarding=onboarding.replace(acceptanceAnchor,"p.status='identity_verified';p.identityVerified=true;p.invitationAcceptance={inviteId:p.inviteId,acceptedAt:AS_OF,source:'authenticated-invitation-acceptance'};p.revision++;return p;");
  const contractAnchor="const effectiveFrom=x.startDate,ct={id:'onb-contract-'+staffId+'-'+effectiveFrom,effectiveFrom,type:x.contractType,weeklyHours:x.weeklyHours,overtimeBasis:'custom',overtimeAfter:Number(p.overtimeAfter??x.weeklyHours),holidayMethod:x.contractType==='zero_hours'?'irregular':'regular',requireAcceptance:x.contractType==='zero_hours'};s.workRules.contracts[staffId]=[ct];";
  if(onboarding.split(contractAnchor).length!==2)throw Error('SEALED_ONBOARDING_CONTRACT_ANCHOR_CHANGED');
  const contractReplacement="const effectiveFrom=x.startDate,baseline=Object.values(s.workRules.contracts||{}).flat().filter(c=>c&&c.type===x.contractType).sort((a,b)=>String(b.effectiveFrom||'').localeCompare(String(a.effectiveFrom||'')))[0];assert(baseline,'A reviewed '+x.contractType+' contract baseline is required before this employee can be configured.',409);const ct={...clone(baseline),id:'onb-contract-'+staffId+'-'+effectiveFrom,effectiveFrom,weeklyHours:x.weeklyHours,revision:1};if(p.overtimeAfter!==undefined){const threshold=Number(p.overtimeAfter);assert(Number.isFinite(threshold)&&threshold>0,'Reviewed overtime threshold is invalid.');ct.overtimeBasis='custom';ct.overtimeAfter=threshold;}R.validateContract(ct);s.workRules.contracts[staffId]=[ct];";
  onboarding=onboarding.replace(contractAnchor,contractReplacement);
  // A server-only fourth argument admits exact source-backed sites for this consumer.
  // All existing CSV, command and provider callers retain their original default rule.
  const siteReplacements = [
    ['function normalise(s,row){','function normalise(s,row,siteLabels){'],
    ['site=clean(row.site,100),job=','site=siteLabels===undefined?clean(row.site,100):row.site,job='],
    ["assert(site&&s.staff.some(p=>p.site===site),'Site is not configured.');","assert(typeof site==='string'&&site&&(siteLabels===undefined?s.staff.some(p=>p.site===site):Array.isArray(siteLabels)&&siteLabels.includes(site)),'Site is not configured.');"],
    ['function validateRows(s,a,rows){','function validateRows(s,a,rows,siteLabels){'],
    ['const v=normalise(s,row);','const v=normalise(s,row,siteLabels);'],
    ['function stage(s,a,p){','function stage(s,a,p,siteLabels){'],
    ['const v=validateRows(s,a,p.rows);','const v=validateRows(s,a,p.rows,siteLabels);']
  ];
  for(const [before,after] of siteReplacements){if(onboarding.split(before).length!==2)throw Error('SEALED_ONBOARDING_SITE_ANCHOR_CHANGED');onboarding=onboarding.replace(before,after);}
  fs.writeFileSync(onboardingPath, onboarding);
  const serverPath = path.join(runtime, 'server.cjs');
  let server = fs.readFileSync(serverPath, 'utf8');
  const importAnchor = "const IG=require('./lib/integration-gateway.cjs')";
  if (server.split(importAnchor).length !== 2) throw Error('SERVER_INTEGRATION_IMPORT_ANCHOR_CHANGED');
  server = server.replace(importAnchor, "const TenantCalendar=require('./operations-runtime/tenant-calendar.cjs');\nconst WorkflowActionEvidenceBridge=require('./operations-runtime/workflow-action-evidence-bridge.cjs');\nconst WorkflowActionEvidenceSources=require('./operations-runtime/workflow-action-evidence-sources.cjs');\nconst StaffologyIntegration=require('./integrations/staffology/canonical-runtime-bridge.cjs');\nconst StaffologyBoundaries=require('./integrations/staffology/canonical-production-boundaries.cjs');\nconst StaffologyOperations=require('./integrations/staffology/canonical-operations.cjs');\nconst StaffologyConfigurationAuthority=require('./integrations/staffology/configured-site-authority.cjs');\nconst StaffologyEmployeePreviews=require('./integrations/staffology/employee-import-previews.cjs');\n" + importAnchor);
  const runtimeAnchor = 'outboundSenders=new Map(outboundConfigs.map(cfg=>[cfg.id,OI.createRestSender(cfg)]));';
  if (server.split(runtimeAnchor).length !== 2) throw Error('SERVER_INTEGRATION_CONSTRUCTION_ANCHOR_CHANGED');
  server = server.replace(runtimeAnchor, runtimeAnchor + "\nconst tenantCalendar=TenantCalendar.createTenantCalendar({env:process.env});\nconst workflowActionEvidenceBridge=WorkflowActionEvidenceBridge.createWorkflowActionEvidenceBridge({dbPath:process.env.WFM_DB,tenantCalendar,...WorkflowActionEvidenceSources.createWorkflowActionEvidenceSourceReaders({db,reviewDashboard:P.reviewDashboard,sanitise,tenantCalendar})});\nconst resolveStaffologyPrincipal=({tenant,email})=>{const row=db.prepare('SELECT email,tenant,person_id,permissions FROM users WHERE email=? AND tenant=?').get(email,tenant);if(!row)return null;return {email:row.email,tenant:row.tenant,personId:row.person_id,permissions:JSON.parse(row.permissions)};};\nconst staffologyBoundaries=StaffologyBoundaries.createBoundaries({db,resolvePrincipal:resolveStaffologyPrincipal});\nconst staffologyResolution=globalThis.__WFM_STAFFOLOGY_RESOLUTION||(()=>{try{return {profile:StaffologyOperations.loadConfiguration(process.env),error:null};}catch(error){return {profile:null,error};}})();\nconst staffologyOperationProfile=staffologyResolution.profile;\nconst staffologyConfigurationError=staffologyResolution.error?String(staffologyResolution.error.code||staffologyResolution.error.message||'STAFFOLOGY_CONFIGURATION_INVALID').slice(0,160):null;\nconst resolveStaffologyStagingConnector=(actor,receipt)=>StaffologyOperations.stagingConnector({profile:staffologyOperationProfile,configured:inboundConnectorConfigs,actor,receipt});\nconst staffologyConfigurationAuthority=StaffologyConfigurationAuthority.createConfiguredSiteAuthority({db});\nlet staffologyIntegration;\nconst staffologyEmployeePreviews=StaffologyEmployeePreviews.createEmployeeImportPreviews({db,profile:staffologyOperationProfile,authority:staffologyConfigurationAuthority,assertPrincipal:actor=>staffologyBoundaries.assertCurrentPrincipal(actor),validateMappings:(actor,mappings,binding)=>staffologyIntegration.assertEmployeeMappings(actor,mappings,binding)});\nstaffologyIntegration=StaffologyIntegration.createRuntime({loadState:load,productionBoundaries:staffologyBoundaries,configuredSitesForTenant:staffologyConfigurationAuthority.configuredSitesForTenant,configurationContextForTenant:staffologyConfigurationAuthority.configurationContextForTenant,assertStagePeople:resolveStaffologyStagingConnector,stagePeople:(actor,envelope,receipt)=>{const cfg=resolveStaffologyStagingConnector(actor,receipt);return staffologyEmployeePreviews.stageWrite(actor,receipt,()=>integrations.stage(cfg,envelope,receipt.idempotencyKey,(objectType,record)=>{if(objectType!=='people')return prepareInboundIntegration(objectType,record,cfg);StaffologyIntegration.assertPeopleApplicationRecord(record);E.assert(record.operation==='upsert','People deletion/deactivation needs the reviewed employee-change workflow.',409);const sites=staffologyConfigurationAuthority.configuredSitesForTenant({tenant:actor.tenant}).siteLabels,checked=ON.validateRows(load(actor.tenant),actor,[{...record.data,source_id:record.externalId}],sites);E.assert(checked.canStage,checked.errors.map(x=>x.message).join(' ')||'People record failed validation.',400);return checked.valid[0];},write=>write()));}});\nconst staffologyOperations=StaffologyOperations.createOperations({runtime:staffologyIntegration,boundaries:staffologyBoundaries,profile:staffologyOperationProfile,employeePreviews:staffologyEmployeePreviews,audit:(actor,action,detail)=>db.prepare('INSERT INTO audit_events(tenant,actor,action,detail,created_at) VALUES(?,?,?,?,?)').run(actor.tenant,actor.personId,action,JSON.stringify(detail),tenantCalendar.snapshot({tenant:actor.tenant}).asOf)});");
  const reportAnchor = 'return json(res,200,{...report,jobs:providerJobs.report(a)';
  if (server.split(reportAnchor).length !== 2) throw Error('SERVER_INTEGRATION_REPORT_ANCHOR_CHANGED');
  server = server.replace(reportAnchor, 'return json(res,200,{...report,staffology:{...staffologyIntegration.status(),operation:{...staffologyOperations.status(a),configurationError:staffologyConfigurationError}},jobs:providerJobs.report(a)');
  const routeAnchor = "if(url.pathname==='/api/integrations'&&req.method==='GET')";
  if (server.split(routeAnchor).length !== 2) throw Error('SERVER_INTEGRATION_ROUTE_ANCHOR_CHANGED');
  // A parser-blocking same-origin script supplies the authenticated calendar before
  // core/domain modules read it. This route remains behind the existing API actor guard.
  const calendarScriptRoute = "if(url.pathname==='/api/tenant-calendar.js'&&req.method==='GET'){const calendarState=load(a.tenant),calendarPerson=(calendarState.staff||[]).find(row=>row.id===a.personId),calendar=tenantCalendar.snapshot({tenant:a.tenant,site:calendarPerson?.site||null});res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end('window.WFMTenantCalendarSnapshot=Object.freeze('+JSON.stringify(calendar).replace(/</g,'\\\\u003c')+');');return;}\n";
  server = server.replace(routeAnchor, calendarScriptRoute + routeAnchor);
  server = server.replace(routeAnchor, "if(url.pathname.startsWith('/api/workforce/lifecycle/action-evidence')){if(await workflowActionEvidenceBridge.handleRequest(req,res))return;}\nif(url.pathname==='/api/tenant-calendar'&&req.method==='GET'){const calendarState=load(a.tenant),calendarPerson=(calendarState.staff||[]).find(row=>row.id===a.personId),calendar=tenantCalendar.snapshot({tenant:a.tenant,site:calendarPerson?.site||null});return json(res,200,calendar);}\nif(url.pathname==='/api/current-review-period'&&req.method==='GET'){const calendarState=load(a.tenant),calendarPerson=(calendarState.staff||[]).find(row=>row.id===a.personId),calendar=tenantCalendar.periodForState(calendarState,{tenant:a.tenant,site:calendarPerson?.site||null});return json(res,200,calendar);}\nif(url.pathname==='/api/integrations/staffology/payroll/discover'&&req.method==='GET'){return json(res,200,await staffologyOperations.discoverPayroll(a));}\nif(url.pathname==='/api/integrations/staffology/employees/preview'&&req.method==='POST'){const input=await body(req);try{return json(res,200,staffologyOperations.prepareEmployeeImport(a,input));}catch(error){return json(res,Number(error.status||503),{error:error.message,code:error.code||'STAFFOLOGY_EMPLOYEE_PREVIEW_REQUIRED',neededFacts:error.neededFacts||[]});}}\nif(url.pathname==='/api/integrations/staffology/employees/acquire-stage'&&req.method==='POST'){const input=await body(req);try{return json(res,200,await staffologyOperations.acquireAndStage(a,input));}catch(error){return json(res,Number(error.status||503),{error:error.message,code:error.code||'STAFFOLOGY_EMPLOYEE_PREVIEW_REQUIRED',neededFacts:error.neededFacts||[]});}}\nif(url.pathname==='/api/integrations/staffology/payroll/approve-deliver'&&req.method==='POST'){const input=await body(req);return json(res,200,await staffologyOperations.approveAndDeliver(a,input));}\nif(url.pathname==='/api/integrations/staffology/payroll/recover'&&req.method==='POST'){const input=await body(req);return json(res,200,await staffologyOperations.recover(a,input));}\nif(url.pathname==='/api/integrations/staffology/payroll/readback'&&req.method==='POST'){const input=await body(req);return json(res,200,await staffologyOperations.readback(a,input));}\n" + routeAnchor);
  const payrollCommandAnchor = "if(input.command.startsWith('review-')||input.command.startsWith('payroll-'))";
  if (server.split(payrollCommandAnchor).length !== 2) throw Error('SERVER_PAYROLL_COMMAND_ANCHOR_CHANGED');
  server = server.replace(payrollCommandAnchor, "if(input.command==='time-source-ingest')return P.openPeriodFromSource(state,a,p);" + payrollCommandAnchor);
  const permissionAnchor = "new Set(['company.configure','payroll.view','payroll.export','payroll.reopen','payroll.remind'])";
  if (server.split(permissionAnchor).length !== 2) throw Error('SERVER_ACCOUNT_PERMISSION_ANCHOR_CHANGED');
  server = server.replace(permissionAnchor, "new Set(['company.configure','payroll.view','payroll.export','payroll.reopen','payroll.remind','time.ingest'])");
  // Personal business evidence shares the server-authoritative tenant clock.
  // Keep authentication/session and clock-event wall clocks unchanged.
  const personalReadAnchor = 'const id=PV.identity(s,pa);personal.register(pa,id);const now=Date.now();';
  if (server.split(personalReadAnchor).length !== 2) throw Error('SERVER_PERSONAL_CALENDAR_ANCHOR_CHANGED');
  server = server.replace(personalReadAnchor, 'const id=PV.identity(s,pa);personal.register(pa,id);const now=Date.parse(tenantCalendar.snapshot({tenant:pa.tenant,site:id.site}).asOf);');
  const personalWorkAnchor = 'PV.workCommand(state,pa,input.command,input.payload||{},Date.now())';
  if (server.split(personalWorkAnchor).length !== 2) throw Error('SERVER_PERSONAL_WORK_CALENDAR_ANCHOR_CHANGED');
  server = server.replace(personalWorkAnchor, 'PV.workCommand(state,pa,input.command,input.payload||{},Date.parse(tenantCalendar.snapshot({tenant:pa.tenant,site:PV.identity(state,pa).site}).asOf))');
  const applyGuardAnchor="db.exec('BEGIN IMMEDIATE');try{const state=load(a.tenant),result=integrations.apply(a,input.id,input.reviewed,{";
  if(server.split(applyGuardAnchor).length!==2)throw Error('STAFFOLOGY_APPLY_TRANSACTION_ANCHOR_CHANGED');
  server=server.replace(applyGuardAnchor,"db.exec('BEGIN IMMEDIATE');try{const state=load(a.tenant);E.assert(input.version===state.version,'The data changed. Refresh before applying the integration batch.',409);const staffologyApplyBinding=staffologyEmployeePreviews.beforeApply(a,input.id),staffologyApplySiteLabels=staffologyApplyBinding?staffologyConfigurationAuthority.configuredSitesForTenant({tenant:a.tenant}).siteLabels:undefined;const result=integrations.apply(a,input.id,input.reviewed,{");
  const staffologyStageAnchor="return ON.stage(state,a,{rows:raw,clientKey:'gateway:'+batch.id});";
  if(server.split(staffologyStageAnchor).length!==2)throw Error('STAFFOLOGY_APPLY_STAGE_ANCHOR_CHANGED');
  server=server.replace(staffologyStageAnchor,"return ON.stage(state,a,{rows:raw,clientKey:'gateway:'+batch.id},staffologyApplySiteLabels);");
  const applyReceiptAnchor="});if(result.replayed){db.exec('ROLLBACK');return json(res,200,{...result,version:state.version});}";
  if(server.split(applyReceiptAnchor).length!==2)throw Error('STAFFOLOGY_APPLY_RECEIPT_ANCHOR_CHANGED');
  server=server.replace(applyReceiptAnchor,"});staffologyEmployeePreviews.afterApply(a,input.id);if(result.replayed){db.exec('ROLLBACK');return json(res,200,{...result,version:state.version});}");
  fs.writeFileSync(serverPath, server);
  const receipt = {
    schemaVersion: 1,
    sealedRuntimePreserved: true,
    activationAvailable: false,
    sourceHashes: sealedExpected,
    assembledFiles: {
      onboarding: sha256(fs.readFileSync(onboardingPath)),
      adapter: sha256(fs.readFileSync(path.join(integrationDir, 'staffology-adapter.cjs'))),
      bridge: sha256(fs.readFileSync(path.join(integrationDir, 'canonical-runtime-bridge.cjs'))),
      productionBoundaries: sha256(fs.readFileSync(path.join(integrationDir, 'canonical-production-boundaries.cjs'))),
      operations: sha256(fs.readFileSync(path.join(integrationDir, 'canonical-operations.cjs'))),
      configuredSiteAuthority: sha256(fs.readFileSync(path.join(integrationDir, 'configured-site-authority.cjs'))),
      employeePreviews: sha256(fs.readFileSync(path.join(integrationDir, 'employee-import-previews.cjs'))),
      server: sha256(fs.readFileSync(serverPath))
    }
  };
  fs.writeFileSync(path.join(runtime, 'STAFFOLOGY_ASSEMBLY.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
function patchPayrollMoney(runtime) {
  recordInput('scripts/patch-payroll-money.mjs');
  recordInput('operations/runtime/payroll-money.cjs');
  execFileSync(process.execPath, [path.join(root, 'scripts/patch-payroll-money.mjs'), path.join(runtime, 'public')], {stdio:'inherit'});
}
function patchDatedLeaveBudget(runtime) {
  const operationsPath=path.join(runtime,'public','operations-engine.js'),rulesPath=path.join(runtime,'public','work-rules.js');
  const operations=fs.readFileSync(operationsPath,'utf8'),rules=fs.readFileSync(rulesPath,'utf8');
  const budgetAnchor='function leaveBudget(s,id,exclude){if(!s.operations?.leaveOpenings[id])return null;return leaveRow(s,id,currentDate(),exclude).availableMinutes/60;}';
  const capacityAnchor='const dated=root.WFMOps?.leaveBudget(s,p.employee,p.requestId);';
  if(operations.split(budgetAnchor).length!==2||rules.split(capacityAnchor).length!==2)throw Error('DATED_LEAVE_BUDGET_ANCHOR_CHANGED');
  // An existing dated opening is credit for its recorded window only. NaN keeps an
  // inapplicable entry unavailable without reviving the undated legacy fallback.
  const budgetReplacement=`/* VECTOR_DATED_LEAVE_BUDGET_V1 */
function leaveBudget(s,id,exclude,interval){
 const openings=s.operations?.leaveOpenings;if(!openings||!Object.prototype.hasOwnProperty.call(openings,id))return null;
 const o=openings[id],calendar=requireCalendar(),asOf=calendar.localDate;
 if(!o||![o.yearStart,o.yearEnd,o.asOf,asOf].every(C.validDate)||o.yearStart>o.asOf||o.asOf>asOf||asOf>o.yearEnd)return NaN;
 const hasInterval=interval!==undefined&&interval!==null;
 if(hasInterval&&(!interval||typeof interval!=='object'||typeof interval.start!=='string'||typeof interval.end!=='string'))return NaN;
 const startMs=hasInterval?Date.parse(interval.start):null,endMs=hasInterval?Date.parse(interval.end):null;
 if(hasInterval&&(!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs))return NaN;
 const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:calendar.timeZone,calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit'});
 const dateAt=ms=>{const parts=Object.fromEntries(formatter.formatToParts(new Date(ms)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return parts.year+'-'+parts.month+'-'+parts.day;};
 const start=hasInterval?dateAt(startMs):asOf,end=hasInterval?dateAt(endMs-1):asOf;
 if(start<o.asOf||end>o.yearEnd||start>end)return NaN;
 return leaveRow(s,id,asOf,exclude).availableMinutes/60;
}`;
  fs.writeFileSync(operationsPath,operations.replace(budgetAnchor,budgetReplacement));
  fs.writeFileSync(rulesPath,rules.replace(capacityAnchor,'const dated=root.WFMOps?.leaveBudget(s,p.employee,p.requestId,p);'));
}
function patchAuthoritativeCalendar(runtime){
 const indexPath=path.join(runtime,'public','index.html'),calendarScript='<script src="/api/tenant-calendar.js"></script>',coreScript='<script src="core.js"></script>';
 const index=fs.readFileSync(indexPath,'utf8');
 if(index.includes(calendarScript)||index.split(coreScript).length!==2)throw Error('BROWSER_CALENDAR_BOOTSTRAP_ANCHOR_CHANGED');
 fs.writeFileSync(indexPath,index.replace(coreScript,calendarScript+coreScript));
 const browserCalendar="const calendarSnapshot=()=>{if(typeof module!=='undefined'&&module.exports){try{return require('../operations-runtime/tenant-calendar.cjs').createTenantCalendar({env:process.env}).snapshot();}catch{return null;}}return root.WFMTenantCalendarSnapshot||null;};const requireCalendar=()=>{const value=calendarSnapshot();if(!value||!value.asOf||!value.localDate||!value.timeZone)throw Error('Tenant calendar authority unavailable.');return value;};";
 const corePath=path.join(runtime,'public','core.js');if(fs.existsSync(corePath)){let text=fs.readFileSync(corePath,'utf8');const anchor="const NOW='2026-09-14T08:38:00+01:00';";if(text.includes(anchor)){text=text.replace(anchor,browserCalendar+"\nconst currentNow=()=>requireCalendar().asOf;");text=text.replace(/\bNOW\b/g,'currentNow()').replace('const api={currentNow(),seed','const api={NOW:currentNow(),seed');fs.writeFileSync(corePath,text);}}
 const operationsPath=path.join(runtime,'public','operations-engine.js');if(fs.existsSync(operationsPath)){let text=fs.readFileSync(operationsPath,'utf8');const anchor="const assert=E.assert,clone=x=>JSON.parse(JSON.stringify(x)),MIN=60000,HOUR=60*MIN,NOW=E.AS_OF,DATE='2026-09-14';";if(text.includes(anchor)){text=text.replace(anchor,"const assert=E.assert,clone=x=>JSON.parse(JSON.stringify(x)),MIN=60000,HOUR=60*MIN;"+browserCalendar+"\nconst currentNow=()=>requireCalendar().asOf,currentDate=()=>requireCalendar().localDate;");text=text.replace(/\bNOW\b/g,'currentNow()').replace(/\bDATE\b/g,'currentDate()');fs.writeFileSync(operationsPath,text);}}
 const demandPath=path.join(runtime,'public','demand-engine.js');if(fs.existsSync(demandPath)){let text=fs.readFileSync(demandPath,'utf8');const anchor="const NOW='2026-09-14', DAY=86400000;";if(text.includes(anchor)){text=text.replace(anchor,browserCalendar+"\nconst currentDate=()=>requireCalendar().localDate, DAY=86400000;");text=text.replace(/\bNOW\b/g,'currentDate()').replace('const api={currentDate(),SOURCES','const api={NOW:currentDate(),SOURCES');fs.writeFileSync(demandPath,text);}}
 const readinessPath=path.join(runtime,'public','readiness-engine.js');if(fs.existsSync(readinessPath)){let text=fs.readFileSync(readinessPath,'utf8');const anchor="const VERSION='readiness-1',AS_OF=E.AS_OF,DATE='2026-09-14';";if(text.includes(anchor)){text=text.replace(anchor,"const VERSION='readiness-1';"+browserCalendar+"\nconst currentNow=()=>requireCalendar().asOf,currentDate=()=>requireCalendar().localDate;");text=text.replace(/\bAS_OF\b/g,'currentNow()').replace(/\bDATE\b/g,'currentDate()');text=text.replace("const api={VERSION,currentNow(),currentDate(),decorate","const api={VERSION,AS_OF:currentNow(),DATE:currentDate(),decorate");text=text.replace("let result={schemaVersion:VERSION,asOf:currentNow(),fixtureOnly:true,","let result={schemaVersion:VERSION,asOf:currentNow(),timeZone:requireCalendar().timeZone,maxAgeMs:requireCalendar().maxAgeMs,fixtureOnly:true,");fs.writeFileSync(readinessPath,text);}}
 const enginePath=path.join(runtime,'public','engine.js');if(fs.existsSync(enginePath)){let text=fs.readFileSync(enginePath,'utf8');const anchor="const DAY=86400000,HOUR=3600000,AS_OF='2026-09-14T08:38:00+01:00',REVIEWED='2026-09-14';";if(text.includes(anchor)){text=text.replace(anchor,"const DAY=86400000,HOUR=3600000,REVIEWED='2026-09-14';"+browserCalendar+"\nconst runtimeNow=()=>requireCalendar().asOf,runtimeDate=()=>requireCalendar().localDate;");text=text.replace("function audit(s,actor,type,employee,detail){s.audit.push({id:'a'+s.audit.length+'-'+Date.now(),by:actor.personId,employee,type,note:detail,at:AS_OF});","function audit(s,actor,type,employee,detail){s.audit.push({id:'a'+s.audit.length+'-'+Date.now(),by:actor.personId,employee,type,note:detail,at:runtimeNow()});");text=text.replace("function periodBounds(kind,asOf=AS_OF){assert(['daily','weekly','monthly','yearly'].includes(kind),'Unsupported reporting period.');const end=localDay(asOf),d=new Date(end+'T12:00:00Z');let start=end,previousStart;","function periodBounds(kind,asOf=null){assert(['daily','weekly','monthly','yearly'].includes(kind),'Unsupported reporting period.');const live=asOf||runtimeNow(),end=asOf?localDay(live):runtimeDate(),d=new Date(end+'T12:00:00Z');let start=end,previousStart;");text=text.replace("cutoffLocal:new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(asOf)),timezone:'Europe/London'","cutoffLocal:new Intl.DateTimeFormat('en-GB',{timeZone:requireCalendar().timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(live)),timezone:requireCalendar().timeZone");text=text.replace("p.reportedAt='08:38';","p.reportedAt=String(requireCalendar().localTime||'').slice(0,5)||null;").replace("function syncToday(s){for(const r of s.history.filter(r=>r.date==='2026-09-14'))","function syncToday(s){const current=runtimeDate();for(const r of s.history.filter(r=>r.date===current))");text=text.replace(/\bAS_OF\b/g,'runtimeNow()').replace("const api={runtimeNow(),SOURCES","const api={get AS_OF(){return runtimeNow();},SOURCES");fs.writeFileSync(enginePath,text);}}
 const rulesPath=path.join(runtime,'public','work-rules.js');if(fs.existsSync(rulesPath)){let text=fs.readFileSync(rulesPath,'utf8');const anchor="const DAY=86400000,HOUR=3600000,MIN=60000,AS_OF='2026-09-14',CHECKED='2026-09-14';";if(text.includes(anchor)){text=text.replace(anchor,"const DAY=86400000,HOUR=3600000,MIN=60000,CHECKED='2026-09-14';"+browserCalendar+"\nconst runtimeNow=()=>requireCalendar().asOf,runtimeDate=()=>requireCalendar().localDate;");text=text.replace("const plain=Date.parse(value+':00Z'),fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/London'","const plain=Date.parse(value+':00Z'),fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:requireCalendar().timeZone");text=text.replace("const infoFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London'","const infoFmt=()=>new Intl.DateTimeFormat('en-GB',{timeZone:requireCalendar().timeZone").replace('infoFmt.formatToParts','infoFmt().formatToParts');text=text.replace("r.reviewedAt=new Date().toISOString();","r.reviewedAt=runtimeNow();").replace("s.workRules.audit.push({at:new Date().toISOString(),","s.workRules.audit.push({at:runtimeNow(),").replace("effectiveFrom:AS_OF,revision:1","effectiveFrom:CHECKED,revision:1").replace("p.id==='e1'?'part-time':'weekday',AS_OF,28","p.id==='e1'?'part-time':'weekday',CHECKED,28");text=text.replace(/\bAS_OF\b/g,'runtimeDate()').replace("const api={runtimeDate(),CHECKED","const api={get AS_OF(){return runtimeDate();},CHECKED");fs.writeFileSync(rulesPath,text);}}
 const onboardingPath=path.join(runtime,'public','onboarding-engine.js');if(fs.existsSync(onboardingPath)){let text=fs.readFileSync(onboardingPath,'utf8');const anchor="const assert=E.assert,AS_OF=E.AS_OF,SCHEMA=1,LOCALES=new Set(['en-GB','fr-FR','de-DE','pl-PL']),CONTRACTS=new Set(['full_time','part_time','annualised','zero_hours']);";if(text.includes(anchor)){text=text.replace(anchor,"const assert=E.assert,SCHEMA=1,LOCALES=new Set(['en-GB','fr-FR','de-DE','pl-PL']),CONTRACTS=new Set(['full_time','part_time','annualised','zero_hours']);"+browserCalendar+"\nconst runtimeNow=()=>requireCalendar().asOf;");text=text.replace(/\bAS_OF\b/g,'runtimeNow()');fs.writeFileSync(onboardingPath,text);}}
}
function patchCustomerFacingCopy(runtime) {
  const replacements = new Map([
    ['Fictional data · Local development v0.6 · Changes saved to the local database.','Evidence mode · Source status is shown per workflow.'],
    ['One sign-in · Capability-based access · Not a live payroll service','One sign-in · Capability-based access · Provider acceptance is shown only when verified.'],
    ['No external invitation email or SMS is sent by this development build.','Invitation delivery is not yet proven for this environment.']
  ]);
  for (const relative of ['public/app.js','public/onboarding-engine.js']) {
    const file=path.join(runtime,relative);if(!fs.existsSync(file))continue;
    let text=fs.readFileSync(file,'utf8');
    for(const [from,to] of replacements)text=text.split(from).join(to);
    fs.writeFileSync(file,text);
  }
}
const run = (file, args = []) => { recordInput(file); return execFileSync(process.execPath, [path.join(root, file), ...args], { stdio: 'inherit' }); };
recordInput('scripts/compose-vector-local-runtime.mjs');
if (fs.existsSync(output)) {
  run('scripts/patch-workspace-compiler.mjs', [path.join(output,'lib/configuration-compiler.cjs')]);
  const result=composeStaffology(output);patchAuthoritativeCalendar(output);patchCustomerFacingCopy(output);patchPayrollMoney(output);patchDatedLeaveBudget(output);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
const archive = path.join(root, 'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
recordInput('artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
const expected = '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';
if (crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== expected) throw Error('RUNTIME_ARTIFACT_HASH_MISMATCH');
const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
if (names.some(name => path.isAbsolute(name) || name.split('/').includes('..'))) throw Error('UNSAFE_ARCHIVE_PATH');
fs.mkdirSync(output, { recursive: true });
execFileSync('tar', ['--no-same-owner', '-xzf', archive, '-C', output]);
const publicRoot = path.join(output, 'public');
run('scripts/patch-workspace-compiler.mjs', [path.join(output,'lib/configuration-compiler.cjs')]);
run('scripts/retire-legacy-presentation.mjs', [publicRoot]);
run('scripts/harden-attendance-integrity.mjs', [publicRoot]);
const copy = (source, destination) => { recordInput(source); const target = path.join(output, destination); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, source), target); };
const groups = {
  security: ['bootstrap.cjs', 'runtime-identity.cjs', 'identity-survival-guard.cjs', 'proof-runner-auth.cjs', 'passkey-schema.cjs', 'passkey-auth.cjs', 'federated-auth.cjs', 'federated-ui.js', 'passkey-entry.html', 'passkey-ui.js', 'passkey-ui.css', 'package.json', 'package-lock.json', 'hosted-listen-guard.cjs', 'hosted-application-user-guard.cjs', 'owner-access-recovery.cjs', 'durable-state-guard.cjs', 'retired-presentation.cjs'],
  integration: ['three-min-feed.cjs', 'autonomous-integration-hub.cjs', 'gusto-company-connector.cjs', 'gusto-oauth-landing.cjs', 'gusto-webhook-receiver.mjs', 'gusto-webhook-preload.mjs'],
  integrations: ['staffology/canonical-operations.cjs', 'staffology/configured-site-authority.cjs', 'staffology/employee-import-previews.cjs'],
  implementation: [
    'one-day-enterprise-engine.cjs', 'one-day-enterprise-engine-core.cjs',
    'agents-api-adapter.cjs', 'agents-api-bootstrap-route.cjs', 'implementation-work-controller.cjs',
    'readiness-evidence-contract.cjs', 'configuration-inference-engine.cjs',
    'implementation-digital-twin.cjs', 'tenant-environment-provisioner.cjs',
    'workspace-setup.cjs','organisation-access-setup.cjs','customer-workspace.cjs','setup-only-policy.cjs','organisation-access-lifecycle.cjs'
  ],
  learning: [
    'adaptive-learning-engine.cjs', 'training-workflow-manifest.cjs',
    'training-twin.cjs', 'training-scenario-engine.cjs',
    'training-delivery-service.cjs', 'training-video-contract.cjs',
    'training-artifact-registry.cjs', 'training-regeneration-planner.cjs'
  ],
  operations: [
    'tenant-calendar.cjs','workflow-action-evidence-contract.cjs', 'workflow-action-evidence-bridge.cjs', 'workflow-action-evidence-sources.cjs',
    'decision-episode.cjs', 'customer-demand-intelligence.cjs',
    'absence-recovery-shadow.cjs', 'demand-decision-service.cjs',
    'decision-outcome-proof.cjs', 'realtime-event-service.cjs',
    'autopilot-execution-engine.cjs', 't9-customer-guardian.cjs',
    'manufacturing-scheduling-engine.cjs', 'manufacturing-demand-forecast.cjs',
    'schedule-attendance-reconciliation.cjs', 'scheduling-intelligence-service.cjs', 'scheduling-authority.cjs', 'order-start-variance.cjs', 'production-output-gap.cjs', 'order-material-availability.cjs'
  ],
  reporting: ['vector-reporting-service.cjs'],
  trust: ['vector-trust-spine.cjs']
};
for (const [group, files] of Object.entries(groups)) for (const file of files) {const sourceRoot=group==='integrations'?'integrations':`${group}/runtime`,targetRoot=group==='integrations'?'integrations':`${group}-runtime`;copy(`${sourceRoot}/${file}`,`${targetRoot}/${file}`);}
copy('resilience/support-selfhelp.cjs', 'support-runtime/support-selfhelp.cjs');
copy('resilience/support-selfhelp-service.cjs', 'support-runtime/support-selfhelp-service.cjs');
composeStaffology(output);
patchAuthoritativeCalendar(output);
patchCustomerFacingCopy(output);
patchPayrollMoney(output);patchDatedLeaveBudget(output);
// Copy the lockfile-installed dependency closure; never install from the proof process.
const securityDependencies = path.join(root, 'security/runtime/node_modules');
if (!fs.existsSync(path.join(securityDependencies, '@simplewebauthn/server/package.json'))) throw Error('PASSKEY_DEPENDENCIES_MISSING: run npm ci --prefix security/runtime --ignore-scripts before composing proof.');
fs.cpSync(securityDependencies, path.join(output, 'security-runtime/node_modules'), {recursive:true,dereference:true});
copy('security/runtime/passkey-session-ui.js', 'public/passkey-session-ui.js');
copy('operations/runtime/workforce-lifecycle-guard.cjs', 'operations-runtime/workforce-lifecycle-core.cjs');
copy('operations/runtime/workforce-lifecycle-router.cjs', 'operations-runtime/workforce-lifecycle-guard.cjs');
copy('ux-overlay/vector-workflows.js', 'public/vector-workflows.js');
const read = file => { recordInput(file); return fs.readFileSync(path.join(root, file), 'utf8'); };
const css = '/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' + fs.readFileSync(path.join(publicRoot, 'factory-control-ui.css'), 'utf8') + '\n/* WFM_ADAPTIVE_COACH_BEGIN */\n' + read('learning/ui/adaptive-coach.css') + '\n/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\n' + read('implementation/ui/implementation-journey.css') + '\n/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' + read('ux-overlay/vector-shell.css') + read('ux-overlay/vector-workflows.css') + '\n/* VECTOR_REPORTING_UI_V1 */\n' + read('reporting/ui/vector-reporting-ui.css');
const js = "'use strict';\n/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n" + '\n;/* WFM_ADAPTIVE_COACH_BEGIN */\n' + read('learning/ui/adaptive-coach.js') + '\n;/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\n' + read('implementation/ui/implementation-journey.js') + '\n;/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' + read('ux-overlay/vector-shell.js') + '\n;/* VECTOR_REPORTING_UI_V1 */\n' + read('reporting/ui/vector-reporting-ui.js');
fs.writeFileSync(path.join(publicRoot, 'vector-ui.css'), css);
fs.writeFileSync(path.join(publicRoot, 'vector-ui.js'), js);
run('scripts/compose-vector-presentation.mjs', [publicRoot]);
const entryPath=path.join(publicRoot,'index.html');
fs.writeFileSync(entryPath,fs.readFileSync(entryPath,'utf8').replace('</head>','<script src="/passkey-session-ui.js" defer></script></head>'));
for (const file of ['factory-control-ui.js', 'factory-control-ui.css', 'value-cockpit-ui.js', 'value-cockpit-ui.css', 'review-ui.js', 'review-ui.css', 'ui-evolution.css', 'vector-shell.js']) fs.rmSync(path.join(publicRoot, file), { force: true });
execFileSync(process.execPath, ['--check', path.join(publicRoot, 'vector-ui.js')]);
execFileSync(process.execPath, ['--check', path.join(publicRoot, 'vector-workflows.js')]);
// Bootstrap has existing absolute /app imports. A local-only resolver maps those exact
// paths to this proof directory without modifying the application or the host's /app.
fs.writeFileSync(path.join(output, 'local-paths.cjs'), "'use strict';const M=require('node:module'),p=require('node:path'),old=M._resolveFilename;M._resolveFilename=function(s,...a){return old.call(this,typeof s==='string'&&s.startsWith('/app/')?p.join(__dirname,s.slice(5)):s,...a)};const fs=require('node:fs'),read=fs.readFileSync;fs.readFileSync=function(s,...a){return read.call(this,typeof s==='string'&&s.startsWith('/app/')?p.join(__dirname,s.slice(5)):s,...a)};\n");
const sourceInputs = [...inputs].sort(([a], [b]) => a.localeCompare(b)).map(([file, hash]) => ({ path: file, sha256: hash }));
const runtimeFiles = [];
function inventory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) inventory(file);
    else if (entry.isFile()) runtimeFiles.push({ path: path.relative(output, file).split(path.sep).join('/'), sha256: sha256(fs.readFileSync(file)) });
    else throw Error('UNEXPECTED_RUNTIME_FILE_TYPE: ' + file);
  }
}
inventory(output);
runtimeFiles.sort((a, b) => a.path.localeCompare(b.path));
fs.writeFileSync(path.join(output, 'LOCAL_PROOF_PROVENANCE.json'), JSON.stringify({
  schemaVersion: 1,
  sourceCommit: null,
  purpose: 'Actual local composition bytes; no inferred commit identity. Docker admission stages are not rerun. Not hosted proof.',
  node: process.version,
  artifactSha256: expected,
  sourceSetSha256: sha256(JSON.stringify(sourceInputs)),
  runtimeSetSha256: sha256(JSON.stringify(runtimeFiles)),
  sourceInputs,
  runtimeFiles
}, null, 2) + '\n');
console.log('VECTOR_LOCAL_RUNTIME=' + output);
console.log('Start with: WFM_DB=<isolated sqlite path> PORT=4100 node --require ' + path.join(output, 'local-paths.cjs') + ' ' + path.join(output, 'security-runtime/bootstrap.cjs'));
