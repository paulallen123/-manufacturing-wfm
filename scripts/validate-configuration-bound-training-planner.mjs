import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TRAINING_PLAN_VERSION, compileConfigurationBoundTrainingPlan, verifyConfigurationBoundTrainingPlan, digest } = require('../resilience/configuration-bound-training-planner.cjs');

const d = (label) => digest({ label });
const falseAuthority = () => ({
  environmentProvisioningAuthorityGranted:false,integrationWriteAuthorityGranted:false,customerMutation:false,payrollMutation:false,identityMutation:false,productionMutation:false,modelAuthorityGranted:false,executionAuthorityGranted:false,releaseAuthorityGranted:false,
});
function seal(obj, field) { const core = structuredClone(obj); delete core[field]; return { ...core, [field]: digest(core) }; }

function siteEmployees(total, sites, index) {
  const base = Math.floor(total / sites); return base + (index < total % sites ? 1 : 0);
}
function makeRollout({ employees, sites, global = false }) {
  const tenantRef = 'synthetic-manufacturer';
  const roles = ['employee','manager','ops-manager','finance','admin'];
  const sitePlans = [];
  const trainingAssignments = [];
  for (let i=0;i<sites;i++) {
    const siteId = `site-${String(i+1).padStart(3,'0')}`;
    const templateDigest = d(`template:${employees}:${sites}:${siteId}`);
    const complex = global && i === sites - 1;
    const languages = complex ? ['en-GB','pl-PL'] : ['en-GB'];
    const overlay = { device: complex ? 'shared-terminal' : 'desktop', trainingProfile: complex ? 'low-digital-confidence' : 'standard', languages, policyPackRef: { evidenceDigest: d(`policy:${siteId}`) } };
    sitePlans.push({ siteId, employeeCount:siteEmployees(employees,sites,i), baseTemplateDigest:d('base'), templateDigest, legalCoverageClaim:false, blocked:false, riskScore:complex?5:0, overlay });
    for (const role of roles) for (const language of languages) trainingAssignments.push({ siteId, role, language, device:overlay.device, profile:overlay.trainingProfile, generatedFromTemplateDigest:templateDigest });
  }
  const waves=[]; let current=null;
  for (const site of sitePlans) {
    const newWave = !current || current.siteIds.length>=10 || (current.employeeCount>0 && current.employeeCount+site.employeeCount>2000);
    if (newWave) { current={wave:waves.length+1,siteIds:[],employeeCount:0,riskCeiling:0,purpose:waves.length?'phased-rollout':'lowest-risk-proof-wave'}; waves.push(current); }
    current.siteIds.push(site.siteId); current.employeeCount+=site.employeeCount; current.riskCeiling=Math.max(current.riskCeiling,site.riskScore);
  }
  const core={schemaVersion:1,rolloutVersion:'1.0.0',scopeReceiptDigest:d(`scope:${employees}:${sites}`),tenantRef,status:'ROLLOUT_PLANNED',topology:{entities:1,sites,employees,countries:['GB'],allowedDataRegions:['eu']},baseTemplate:{digest:d('base'),fieldCount:7},sitePlans,waves,blockedItems:[],blockedSiteIds:[],clonePlans:[],trainingAssignments,driftBaseline:{scopeReceiptDigest:d(`scope:${employees}:${sites}`),siteTemplateDigests:Object.fromEntries(sitePlans.map(s=>[s.siteId,s.templateDigest])),intentionalOverrides:Object.fromEntries(sitePlans.map(s=>[s.siteId,[]]))},metrics:{questionsAskedByRolloutPlanner:0,manualRolloutPlanConstructionRequired:false,eligibleSites:sites,blockedSites:0,scheduledSites:sites,waveCount:waves.length,inheritedConfigAssignments:sites*7,simulatedRepeatedConfigEntriesAvoided:Math.max(0,sites-1)*7,clonePlans:0,trainingAssignments:trainingAssignments.length,remainingHumanOnlyDecisions:0},guardrails:{legalCoverageClaim:false,policyValuesInvented:false,crossRegionDataMovementAuthorised:false,secretCopyAuthorised:false,identityCopyAuthorised:false,productionWriteAuthorised:false},authority:falseAuthority()};
  return seal(core,'receiptDigest');
}
function makeEnvironment({ healthy=true, tenantRef='synthetic-manufacturer', sites=1 }={}) {
  const rec=(kind,subjectRef)=>({kind,subjectRef,payload:{ok:true},payloadDigest:d(`payload:${kind}:${subjectRef}`),evidenceDigest:d(`evidence:${kind}:${subjectRef}`),freshness:'FRESH'});
  const records=[rec('role','roles'),rec('workflow','core'),rec('feature','config'),rec('policy','policy-gb'),...Array.from({length:sites},(_,i)=>rec('health',`site-${String(i+1).padStart(3,'0')}`))];
  const core={schemaVersion:1,modelVersion:'1.0.0',tenantRef,observedAt:'2026-09-20T16:00:00.000Z',records,conflicts:[],ignoredEvidence:[],missingCriticalKinds:healthy?[]:['integration'],missingCriticalSubjects:[],uncertainty:{level:healthy?'LOW':'HIGH'},signals:[],detectedChanges:[],supportDisposition:healthy?'HEALTHY_EVIDENCE_READY':'ABSTAIN_AND_GATHER_EVIDENCE',metrics:{evidenceSubmitted:records.length,evidenceAccepted:records.length,evidenceIgnored:0,topologyCountries:1,topologySites:sites,manualEnvironmentFactsStillRequired:healthy?0:1,manualEnvironmentChecksRemoved:0,predictiveSignals:0,highRiskSignals:0,changesDetectedSincePriorSnapshot:0},guardrails:{untrustedTextCanBecomeAuthority:false,modelOutputCanBecomeAuthority:false,crossTenantEvidenceAllowed:false,legalCoverageClaim:false,automaticProductionActionAllowed:false},authority:{productionMutation:false,customerMutation:false,payrollMutation:false,identityMutation:false,integrationWriteAuthorityGranted:false,environmentProvisioningAuthorityGranted:false,modelAuthorityGranted:false,executionAuthorityGranted:false,releaseAuthorityGranted:false}};
  return seal(core,'snapshotDigest');
}

assert.equal(TRAINING_PLAN_VERSION,'1.0.0');
const scales=[{employees:1,sites:1},{employees:25,sites:1},{employees:100,sites:2},{employees:500,sites:5},{employees:2000,sites:10},{employees:10000,sites:50},{employees:25000,sites:120}];
const results=[];
for (const profile of scales) {
  const rollout=makeRollout({...profile,global:profile.sites>=10});
  const env=makeEnvironment({sites:profile.sites});
  const receipt=compileConfigurationBoundTrainingPlan({rolloutReceipt:rollout,environmentSnapshot:env});
  assert.equal(receipt.status,'TRAINING_MANIFEST_READY');
  assert.equal(receipt.metrics.modulesGenerated,rollout.trainingAssignments.length);
  assert.equal(receipt.metrics.manualTrainingAssignmentStepsRemoved,rollout.trainingAssignments.length);
  assert.equal(receipt.metrics.trainingQuestionsAdded,0);
  assert.equal(receipt.metrics.localChampionRequiredCount,0);
  assert.equal(verifyConfigurationBoundTrainingPlan(receipt,{rolloutReceipt:rollout,environmentSnapshot:env}),true);
  results.push({employees:profile.employees,sites:profile.sites,modules:receipt.metrics.modulesGenerated,variants:receipt.metrics.uniqueTrainingVariants,manualAssignmentStepsRemoved:receipt.metrics.manualTrainingAssignmentStepsRemoved,championRequired:receipt.metrics.localChampionRequiredCount});
}

const smallRollout=makeRollout({employees:1,sites:1});
const smallEnv=makeEnvironment({sites:1});
const small=compileConfigurationBoundTrainingPlan({rolloutReceipt:smallRollout,environmentSnapshot:smallEnv});
assert.deepEqual(small.championModel.optionalSuggestedSiteIds,[]);
assert.ok(small.modules.every(m=>m.delivery.requiresLocalChampion===false));

const globalRollout=makeRollout({employees:10000,sites:50,global:true});
const globalEnv=makeEnvironment({sites:50});
const globalPlan=compileConfigurationBoundTrainingPlan({rolloutReceipt:globalRollout,environmentSnapshot:globalEnv});
assert.ok(globalPlan.modules.some(m=>m.profile==='low-digital-confidence'&&m.delivery.mode==='guided-step-by-step'&&m.delivery.maxActionsPerCheckpoint===3));
assert.ok(globalPlan.modules.some(m=>m.device==='shared-terminal'));
assert.ok(globalPlan.championModel.optionalSuggestedSiteIds.length>0);
assert.equal(globalPlan.championModel.required,false);

const targetModule=globalPlan.modules.find(m=>m.profile==='low-digital-confidence');
const gap={tenantRef:'synthetic-manufacturer',moduleDigest:targetModule.moduleDigest,gapCode:'COMPREHENSION_FAILED',source:'deterministic-assessment',verified:true,evidenceDigest:d('gap:comprehension')};
const learned=compileConfigurationBoundTrainingPlan({rolloutReceipt:globalRollout,environmentSnapshot:globalEnv,trainingGapEvidence:[gap,{...gap,source:'llm',evidenceDigest:d('gap:llm')}]});
assert.deepEqual(learned.feedbackRules,['training-profile-guided']);
assert.equal(learned.metrics.trustedTrainingGapsAccepted,1);
assert.equal(learned.metrics.trainingGapEvidenceIgnored,1);
assert.equal(learned.authority.modelAuthorityGranted,false);
assert.equal(learned.guardrails.modelGeneratedAuthority,false);
assert.equal(verifyConfigurationBoundTrainingPlan(learned,{rolloutReceipt:globalRollout,environmentSnapshot:globalEnv}),true);

assert.throws(()=>compileConfigurationBoundTrainingPlan({rolloutReceipt:globalRollout,environmentSnapshot:globalEnv,trainingGapEvidence:[{...gap,tenantRef:'other-tenant'}]}),e=>e?.code==='WFM_TRAINING_TENANT');
const blocked=compileConfigurationBoundTrainingPlan({rolloutReceipt:smallRollout,environmentSnapshot:makeEnvironment({healthy:false,sites:1})});
assert.equal(blocked.status,'TRAINING_MANIFEST_BLOCKED');
assert.ok(blocked.modules.every(m=>m.deliveryReady===false&&m.blockedReason==='environment-evidence-not-ready'));
assert.equal(blocked.guardrails.trainingCompletionClaim,false);
assert.equal(blocked.authority.trainingDeliveryAuthorityGranted,false);

const removed=structuredClone(globalPlan); removed.modules.pop(); let core=structuredClone(removed); delete core.receiptDigest; removed.receiptDigest=digest(core); assert.equal(verifyConfigurationBoundTrainingPlan(removed,{rolloutReceipt:globalRollout,environmentSnapshot:globalEnv}),false);
const drifted=structuredClone(globalPlan); drifted.modules[0].siteTemplateDigest=d('forged-template'); core=structuredClone(drifted); delete core.receiptDigest; drifted.receiptDigest=digest(core); assert.equal(verifyConfigurationBoundTrainingPlan(drifted,{rolloutReceipt:globalRollout,environmentSnapshot:globalEnv}),false);
const authority=structuredClone(globalPlan); authority.authority.trainingDeliveryAuthorityGranted=true; core=structuredClone(authority); delete core.receiptDigest; authority.receiptDigest=digest(core); assert.equal(verifyConfigurationBoundTrainingPlan(authority,{rolloutReceipt:globalRollout,environmentSnapshot:globalEnv}),false);
const completion=structuredClone(globalPlan); completion.guardrails.trainingCompletionClaim=true; core=structuredClone(completion); delete core.receiptDigest; completion.receiptDigest=digest(core); assert.equal(verifyConfigurationBoundTrainingPlan(completion,{rolloutReceipt:globalRollout,environmentSnapshot:globalEnv}),false);
const badRollout=structuredClone(globalRollout); badRollout.authority.productionMutation=true; core=structuredClone(badRollout); delete core.receiptDigest; badRollout.receiptDigest=digest(core); assert.throws(()=>compileConfigurationBoundTrainingPlan({rolloutReceipt:badRollout,environmentSnapshot:globalEnv}),e=>e?.code==='WFM_TRAINING_ROLLOUT_AUTHORITY');

console.log(JSON.stringify({schemaVersion:1,proof:'configuration-bound-global-training-planner',status:'PASS',scaleMatrix:results,globalEnterprise:{employees:10000,sites:50,modules:globalPlan.metrics.modulesGenerated,uniqueVariants:globalPlan.metrics.uniqueTrainingVariants,guidedLowDigitalConfidence:true,sharedTerminalAdaptation:true,optionalChampionSites:globalPlan.championModel.optionalSuggestedSiteIds.length,championRequired:false},learning:{trustedGapConvertedToReusableRule:true,untrustedModelGapIgnored:true,feedbackRules:learned.feedbackRules},environmentIncompleteFailsClosed:true,crossTenantGapDenied:true,resealedModuleSuppressionDenied:true,resealedTemplateDriftDenied:true,resealedDeliveryAuthorityDenied:true,trainingCompletionCannotBeClaimed:true,customerContactPerformed:false,trainingDeliveryAuthorityGranted:false,productionMutation:false,customerMutation:false,payrollMutation:false,identityMutation:false,modelAuthorityGranted:false,executionAuthorityGranted:false,releaseAuthorityGranted:false},null,2));
