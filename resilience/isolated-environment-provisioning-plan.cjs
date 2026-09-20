'use strict';
const { createHash } = require('node:crypto');

const VERSION = '1.0.0';
const CAPACITY_SOURCES = new Set(['platform-control-plane','provider-control-plane','preauthorised-capacity-registry']);
const ACTIONS = new Set(['reserve-existing-capacity','create-isolated-tenant-namespace','attach-private-network','bind-secret-reference','apply-site-template-reference','install-health-probe','create-rollback-checkpoint','verify-tenant-isolation']);
const SECRET_PURPOSES = new Set(['tenant-encryption-key','runtime-signing-key','integration-credential-reference']);

function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
function digest(v){return createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');}
function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}
function hex(v){return /^[a-f0-9]{64}$/.test(String(v||''));}
function ref(v,n=160){return typeof v==='string'&&v.length>0&&v.length<=n&&/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(v);}
function fail(code,msg){const e=new Error(msg);e.code=code;throw e;}
function allFalse(v){return v&&typeof v==='object'&&Object.values(v).every(x=>x===false);}
function sealed(r,key,omit=[]){if(!r||!hex(r[key]))return false;const c=clone(r),want=c[key];delete c[key];for(const k of omit)delete c[k];return digest(c)===want;}
function instant(v){const ms=Date.parse(v);if(typeof v!=='string'||!Number.isFinite(ms))fail('WFM_PROVISIONING_TIME','valid ISO time required');return ms;}

function checkInputs(scope,rollout,policy){
  if(scope?.schemaVersion!==1||scope.status!=='SCOPED'||!sealed(scope,'stateDigest',['answers'])||!allFalse(scope.authority))fail('WFM_PROVISIONING_SCOPE','verified SCOPED receipt required');
  if(rollout?.schemaVersion!==1||!['ROLLOUT_PLANNED','PARTIAL_ROLLOUT_BLOCKED'].includes(rollout.status)||!sealed(rollout,'receiptDigest')||!allFalse(rollout.authority)||rollout.scopeReceiptDigest!==scope.stateDigest)fail('WFM_PROVISIONING_ROLLOUT','verified rollout receipt required');
  if(policy?.schemaVersion!==1||!['POLICY_RESOLUTION_READY','PARTIAL_POLICY_RESOLUTION','POLICY_RESOLUTION_BLOCKED'].includes(policy.status)||!sealed(policy,'receiptDigest')||!allFalse(policy.authority)||!allFalse(policy.guardrails)||policy.tenantRef!==rollout.tenantRef)fail('WFM_PROVISIONING_POLICY','verified policy receipt required');
  const sites=scope.facts?.['org.siteCount'],emps=scope.facts?.['workforce.employeeCount'];
  if(!Number.isSafeInteger(sites)||!Number.isSafeInteger(emps)||rollout.sitePlans?.length!==sites||rollout.sitePlans.reduce((n,s)=>n+s.employeeCount,0)!==emps)fail('WFM_PROVISIONING_SCALE','scope/rollout scale mismatch');
}

function capacities(items,now){
  const ok=new Map(),rejected=[];
  for(const x of Array.isArray(items)?items:[]){
    const reject=reason=>rejected.push({dataRegion:x?.dataRegion||null,capacityId:x?.capacityId||null,reason});
    if(!x||x.verified!==true||!CAPACITY_SOURCES.has(x.source)||!hex(x.evidenceDigest)){reject('trusted-capacity-evidence-required');continue;}
    if(!ref(x.dataRegion,80)||!ref(x.capacityId,120)||!ref(x.provider,120)){reject('invalid-capacity-identity');continue;}
    if(x.preExistingCapacity!==true||x.zeroIncrementalCost!==true||x.billingImpact!=='none'){reject('zero-incremental-cost-preexisting-capacity-required');continue;}
    if(x.privateNetworkOnly!==true||x.publicIngress!==false||x.tenantIsolationAttested!==true||x.rollbackSupported!==true){reject('private-network-without-public-ingress-required');continue;}
    if(!Number.isSafeInteger(x.maxSites)||x.maxSites<1||!Number.isSafeInteger(x.maxEmployees)||x.maxEmployees<1){reject('bounded-capacity-required');continue;}
    let observed,until;try{observed=instant(x.observedAt);until=instant(x.validUntil);}catch{reject('fresh-capacity-evidence-required');continue;}
    if(observed>now||until<now||until<=observed){reject('fresh-capacity-evidence-required');continue;}
    const n={dataRegion:x.dataRegion,capacityId:x.capacityId,provider:x.provider,evidenceDigest:x.evidenceDigest,maxSites:x.maxSites,maxEmployees:x.maxEmployees};
    if(ok.has(x.dataRegion)&&digest(ok.get(x.dataRegion))!==digest(n)){ok.delete(x.dataRegion);reject('conflicting-trusted-capacity-evidence');continue;}
    if(!ok.has(x.dataRegion))ok.set(x.dataRegion,n);
  }
  return {ok,rejected};
}

function secrets(items){
  const out=[],seen=new Set();
  for(const x of Array.isArray(items)?items:[]){
    if(!x||typeof x!=='object'||Array.isArray(x))fail('WFM_PROVISIONING_SECRET_REF','secret reference object required');
    if(Object.keys(x).some(k=>!['verified','source','purpose','ref','evidenceDigest'].includes(k)))fail('WFM_PROVISIONING_RAW_SECRET','raw secret material forbidden');
    if(x.verified!==true||x.source!=='secret-manager'||!hex(x.evidenceDigest)||!SECRET_PURPOSES.has(x.purpose)||!ref(x.ref,240)||seen.has(x.purpose))fail('WFM_PROVISIONING_SECRET_REF','invalid or duplicate secret reference');
    seen.add(x.purpose);out.push({purpose:x.purpose,ref:x.ref,source:'secret-manager',evidenceDigest:x.evidenceDigest});
  }
  return out.sort((a,b)=>a.purpose.localeCompare(b.purpose));
}

function step(tenant,region,type,target,inputs={}){
  if(!ACTIONS.has(type))fail('WFM_PROVISIONING_ACTION','unsupported action');
  const core={type,target,inputs:canonical(inputs),productionWrite:false,customerDataMutation:false,payrollMutation:false,identityMutation:false,publicExposure:false,destructive:false};
  return {...core,idempotencyKey:digest({tenant,region,...core})};
}

function planIsolatedEnvironmentProvisioning({scopeReceipt,rolloutReceipt,policyReceipt,capacityEvidence=[],secretReferences=[],asOf}={}){
  checkInputs(scopeReceipt,rolloutReceipt,policyReceipt);const now=instant(asOf),cap=capacities(capacityEvidence,now),secretRefs=secrets(secretReferences);
  const policyBySite=new Map(policyReceipt.siteResolutions.map(s=>[s.siteId,s])),blocked=new Set(rolloutReceipt.blockedSiteIds||[]),blockers=[...cap.rejected],eligible=[];
  for(const s of rolloutReceipt.sitePlans.slice().sort((a,b)=>a.siteId.localeCompare(b.siteId))){
    const p=policyBySite.get(s.siteId);if(!p)fail('WFM_PROVISIONING_SITE_IDENTITY',`policy missing ${s.siteId}`);
    if(p.dataRegion!==s.overlay?.dataRegion)fail('WFM_PROVISIONING_REGION_MISMATCH',`policy/rollout region mismatch ${s.siteId}`);
    if(blocked.has(s.siteId)||s.blocked===true){blockers.push({siteId:s.siteId,reason:'rollout-site-blocked'});continue;}
    if(p.status!=='POLICY_RESOLVED'||!hex(p.policyDigest)||p.configurationDriftDetected===true){blockers.push({siteId:s.siteId,reason:p.configurationDriftDetected?'policy-drift-must-be-resolved':'policy-not-resolved'});continue;}
    eligible.push({siteId:s.siteId,dataRegion:p.dataRegion,employeeCount:s.employeeCount,templateDigest:s.templateDigest,policyDigest:p.policyDigest});
  }
  const groups=new Map();for(const s of eligible){const a=groups.get(s.dataRegion)||[];a.push(s);groups.set(s.dataRegion,a);}
  const regionPlans=[],scheduled=new Set();
  for(const [region,sites] of [...groups.entries()].sort(([a],[b])=>a.localeCompare(b))){
    const c=cap.ok.get(region),employees=sites.reduce((n,s)=>n+s.employeeCount,0);
    if(!c||sites.length>c.maxSites||employees>c.maxEmployees){for(const s of sites)blockers.push({siteId:s.siteId,dataRegion:region,reason:c?'preexisting-capacity-insufficient':'verified-zero-cost-private-capacity-required'});continue;}
    const actions=[step(rolloutReceipt.tenantRef,region,'reserve-existing-capacity',c.capacityId,{capacityEvidenceDigest:c.evidenceDigest}),step(rolloutReceipt.tenantRef,region,'create-isolated-tenant-namespace',`${rolloutReceipt.tenantRef}:${region}`,{capacityId:c.capacityId}),step(rolloutReceipt.tenantRef,region,'attach-private-network',`${rolloutReceipt.tenantRef}:${region}`,{publicIngress:false})];
    for(const r of secretRefs)actions.push(step(rolloutReceipt.tenantRef,region,'bind-secret-reference',r.purpose,{ref:r.ref,evidenceDigest:r.evidenceDigest}));
    for(const s of sites.sort((a,b)=>a.siteId.localeCompare(b.siteId))){actions.push(step(rolloutReceipt.tenantRef,region,'apply-site-template-reference',s.siteId,{templateDigest:s.templateDigest,policyDigest:s.policyDigest}));scheduled.add(s.siteId);}
    actions.push(step(rolloutReceipt.tenantRef,region,'install-health-probe',`${rolloutReceipt.tenantRef}:${region}`,{mode:'private-only'}),step(rolloutReceipt.tenantRef,region,'create-rollback-checkpoint',`${rolloutReceipt.tenantRef}:${region}`,{beforeAnyCustomerImport:true}),step(rolloutReceipt.tenantRef,region,'verify-tenant-isolation',`${rolloutReceipt.tenantRef}:${region}`,{independentVerificationRequired:true}));
    regionPlans.push({dataRegion:region,provider:c.provider,capacityId:c.capacityId,capacityEvidenceDigest:c.evidenceDigest,siteIds:sites.map(s=>s.siteId).sort(),siteCount:sites.length,employeeCount:employees,privateNetworkOnly:true,publicIngress:false,zeroIncrementalCost:true,rollbackRequired:true,independentIsolationVerificationRequired:true,actions});
  }
  const blockedSiteIds=[...new Set(blockers.map(x=>x.siteId).filter(Boolean))].sort(),count=regionPlans.reduce((n,p)=>n+p.actions.length,0);
  const status=scheduled.size===0?'PROVISIONING_BLOCKED':blockedSiteIds.length?'PARTIAL_PROVISIONING_BLOCKED':'PROVISIONING_PLAN_READY';
  const core={schemaVersion:1,provisioningPlanVersion:VERSION,tenantRef:rolloutReceipt.tenantRef,asOf:new Date(now).toISOString(),scopeReceiptDigest:scopeReceipt.stateDigest,rolloutReceiptDigest:rolloutReceipt.receiptDigest,policyReceiptDigest:policyReceipt.receiptDigest,status,regionPlans,blockers,blockedSiteIds,secretReferences:secretRefs,executionEnvelope:{readyForPreauthorisedDeterministicExecutor:regionPlans.length>0,permitIssued:false,executionAuthorityGranted:false,requiresExistingProviderPreauthorisation:true,requiresIndependentPostActionVerification:true,killSwitchRequired:true,rollbackRequired:true,actionBudget:count,llmMayExecute:false},metrics:{sitesEvaluated:rolloutReceipt.sitePlans.length,sitesReadyForIsolatedProvisioning:scheduled.size,sitesBlocked:blockedSiteIds.length,regionsReady:regionPlans.length,deterministicActionsPlanned:count,implementationQuestionsAdded:0,simulatedManualProvisioningPlanningStepsRemoved:scheduled.size+regionPlans.length*4,manualProviderExecutionStepsRemoved:0,remainingHumanOnlyDecisions:blockers.length,realProvisioningExecuted:false,autonomousProvisioningProven:false},guardrails:{newSpendAuthorised:false,publicExposureAuthorised:false,productionWriteAuthorised:false,customerDataMutationAuthorised:false,payrollMutationAuthorised:false,identityMutationAuthorised:false,rawSecretPersistenceAuthorised:false,destructiveActionAuthorised:false,modelCreatedAuthority:false},authority:{environmentProvisioningAuthorityGranted:false,executionAuthorityGranted:false,productionMutation:false,customerMutation:false,payrollMutation:false,identityMutation:false,modelAuthorityGranted:false,releaseAuthorityGranted:false}};
  return {...core,receiptDigest:digest(core)};
}

function verifyIsolatedEnvironmentProvisioningPlan(r){
  if(!r||r.schemaVersion!==1||r.provisioningPlanVersion!==VERSION||!hex(r.receiptDigest)||!allFalse(r.authority)||!allFalse(r.guardrails))return false;
  const e=r.executionEnvelope;if(!e||e.permitIssued!==false||e.executionAuthorityGranted!==false||e.llmMayExecute!==false||e.requiresExistingProviderPreauthorisation!==true||e.requiresIndependentPostActionVerification!==true||e.killSwitchRequired!==true||e.rollbackRequired!==true)return false;
  if(!Array.isArray(r.regionPlans)||!Array.isArray(r.blockedSiteIds)||!Array.isArray(r.secretReferences))return false;const scheduled=new Set();let count=0;
  for(const p of r.regionPlans){if(p.privateNetworkOnly!==true||p.publicIngress!==false||p.zeroIncrementalCost!==true||p.rollbackRequired!==true||p.independentIsolationVerificationRequired!==true||!Array.isArray(p.actions)||new Set(p.siteIds).size!==p.siteIds.length)return false;for(const id of p.siteIds){if(scheduled.has(id)||r.blockedSiteIds.includes(id))return false;scheduled.add(id);}for(const a of p.actions){count++;if(!ACTIONS.has(a.type)||!hex(a.idempotencyKey)||a.productionWrite!==false||a.customerDataMutation!==false||a.payrollMutation!==false||a.identityMutation!==false||a.publicExposure!==false||a.destructive!==false)return false;if(JSON.stringify(a)!==JSON.stringify(step(r.tenantRef,p.dataRegion,a.type,a.target,a.inputs)))return false;}}
  if(e.actionBudget!==count||r.metrics?.deterministicActionsPlanned!==count||r.metrics?.sitesReadyForIsolatedProvisioning!==scheduled.size||r.metrics?.manualProviderExecutionStepsRemoved!==0||r.metrics?.realProvisioningExecuted!==false||r.metrics?.autonomousProvisioningProven!==false||r.metrics?.implementationQuestionsAdded!==0)return false;
  if(r.status==='PROVISIONING_PLAN_READY'&&r.blockedSiteIds.length||r.status==='PROVISIONING_BLOCKED'&&scheduled.size||r.status==='PARTIAL_PROVISIONING_BLOCKED'&&(!scheduled.size||!r.blockedSiteIds.length)||!['PROVISIONING_PLAN_READY','PARTIAL_PROVISIONING_BLOCKED','PROVISIONING_BLOCKED'].includes(r.status))return false;
  const c=clone(r),want=c.receiptDigest;delete c.receiptDigest;return digest(c)===want;
}

module.exports={PROVISIONING_PLAN_VERSION:VERSION,ALLOWED_ACTION_TYPES:ACTIONS,planIsolatedEnvironmentProvisioning,verifyIsolatedEnvironmentProvisioningPlan,digest};