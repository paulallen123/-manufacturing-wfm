'use strict';
const { createHash } = require('node:crypto');
const VERSION='1.0.0', OWNER='integration-data-fabric';
const SAFE_TYPES=new Set(['string','number','boolean','date','datetime','timezone','enum']);
const NEVER=new Set(['secret','credential','biometric','health-sensitive','payroll-control','security-authority','identity-authority']);
const TRANSFORMS=new Set(['identity','stable-id','trim','uppercase','lowercase','enum-map','timezone-normalize','iso-date']);
const LEVELS=new Set(['tenant-authenticated','read-roundtrip-proven','production-certified']);
function canon(v){if(Array.isArray(v))return v.map(canon);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])]));return v;}
function digest(v){return createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');}
function clone(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}
function isDigest(v){return /^[a-f0-9]{64}$/.test(String(v||''));}
function validId(v,n=160){return typeof v==='string'&&v.length>0&&v.length<=n&&/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(v);}
function allFalse(v){return v&&typeof v==='object'&&Object.values(v).every(x=>x===false);}
function sealed(v,field='evidenceDigest'){if(!v||!isDigest(v[field]))return false;const c=clone(v),e=c[field];delete c[field];return digest(c)===e;}
function fail(code,msg){const e=new Error(msg);e.code=code;throw e;}
function verifyRollout(r){
 if(!r||r.schemaVersion!==1||r.rolloutVersion!=='1.0.0'||!isDigest(r.receiptDigest)||!isDigest(r.scopeReceiptDigest)||!validId(r.tenantRef)||!allFalse(r.authority))return false;
 if(!r.guardrails||Object.values(r.guardrails).some(v=>v!==false)||!Array.isArray(r.sitePlans)||!Array.isArray(r.waves)||!Array.isArray(r.blockedSiteIds))return false;
 const ids=new Set(r.sitePlans.map(s=>s.siteId)); if(ids.size!==r.sitePlans.length)return false;
 for(const s of r.sitePlans){if(!validId(s.siteId)||!s.overlay||!validId(s.overlay.dataRegion,80)||!isDigest(s.templateDigest)||s.legalCoverageClaim!==false)return false;}
 const eligible=r.sitePlans.filter(s=>s.blocked!==true).map(s=>s.siteId).sort(); const scheduled=r.waves.flatMap(w=>w.siteIds||[]).sort();
 if(JSON.stringify(eligible)!==JSON.stringify(scheduled))return false;
 const c=clone(r);delete c.receiptDigest;return digest(c)===r.receiptDigest;
}
function schemaIndex(ev){
 if(!ev||ev.schemaEvidenceVersion!==1||ev.owner!==OWNER||ev.verified!==true||ev.modelGenerated!==false||ev.customerSpecificAuthority!==false||!sealed(ev)||!Array.isArray(ev.datasets)||ev.datasets.length<1)fail('WFM_IMPORT_SCHEMA','verified Integration/Data schema evidence required');
 const out=new Map();
 for(const d of ev.datasets){if(!d||!validId(d.datasetId)||!isDigest(d.schemaDigest)||!Array.isArray(d.fields)||d.fields.length<1)fail('WFM_IMPORT_SCHEMA','invalid canonical dataset');
  const fields=new Map(); for(const f of d.fields){if(!f||!validId(f.fieldId)||fields.has(f.fieldId)||!SAFE_TYPES.has(f.type)||typeof f.required!=='boolean'||typeof f.payrollImpacting!=='boolean'||!validId(f.classification||'business',80))fail('WFM_IMPORT_SCHEMA','invalid canonical field');fields.set(f.fieldId,clone(f));}
  if(digest(d.fields.map(canon))!==d.schemaDigest)fail('WFM_IMPORT_SCHEMA','canonical schema digest mismatch');out.set(d.datasetId,{...clone(d),fields});
 }
 return out;
}
function manifestOk(m,rollout,now,maxAge){
 if(!m||m.manifestVersion!==1||m.owner!==OWNER||m.verified!==true||m.modelGenerated!==false||m.readOnlyDiscovery!==true||m.writeAuthorityGranted!==false||m.customerMutationAuthorityGranted!==false||m.payrollMutationAuthorityGranted!==false||m.identityMutationAuthorityGranted!==false||m.productionMutationAuthorityGranted!==false||!sealed(m)||m.tenantRef!==rollout.tenantRef||!validId(m.sourceId)||!LEVELS.has(m.evidenceLevel)||!validId(m.dataRegion,80)||!Number.isSafeInteger(m.observedAtMs)||m.observedAtMs>now||now-m.observedAtMs>maxAge||!Array.isArray(m.siteIds)||!m.siteIds.length||new Set(m.siteIds).size!==m.siteIds.length||!Array.isArray(m.datasets)||!m.datasets.length)return false;
 const sites=new Map(rollout.sitePlans.map(s=>[s.siteId,s]));
 return m.siteIds.every(id=>sites.has(id)&&sites.get(id).blocked!==true&&sites.get(id).overlay.dataRegion===m.dataRegion);
}
function ruleIndex(rules,tenant){
 const out=[]; for(const r of Array.isArray(rules)?rules:[]){if(!r||r.owner!==OWNER||r.verified!==true||r.modelGenerated!==false||r.grantsAuthority!==false||r.tenantRef!==tenant||!sealed(r,'ruleDigest')||!validId(r.ruleId)||!validId(r.sourceId)||!validId(r.datasetId)||!validId(r.sourceField)||!validId(r.targetField)||!TRANSFORMS.has(r.transform)||!isDigest(r.sourceSchemaDigest)||!isDigest(r.targetSchemaDigest))continue;out.push(clone(r));}return out;
}
function checks(hasPayroll){const x=['record-count-reconciliation','source-schema-digest-freshness','target-schema-digest-freshness','tenant-site-scope-integrity','duplicate-key-detection','referential-integrity','nullability-required-fields','timezone-date-normalization','staging-only-write-boundary','rollback-checkpoint-before-real-import','independent-post-import-reconciliation'];if(hasPayroll)x.push('payroll-impacting-fields-excluded-from-automatic-import');return x;}
function planEvidenceBoundDataImport({rolloutReceipt,canonicalSchemaEvidence,sourceManifests=[],approvedMappingRules=[],nowMs=Date.now(),maxManifestAgeMs=30*60*1000}={}){
 if(!verifyRollout(rolloutReceipt))fail('WFM_IMPORT_ROLLOUT','verified rollout receipt required');if(!Number.isSafeInteger(nowMs)||!Number.isSafeInteger(maxManifestAgeMs)||maxManifestAgeMs<1)fail('WFM_IMPORT_TIME','deterministic freshness bound required');
 const targets=schemaIndex(canonicalSchemaEvidence), rules=ruleIndex(approvedMappingRules,rolloutReceipt.tenantRef), eligible=new Set(rolloutReceipt.sitePlans.filter(s=>s.blocked!==true).map(s=>s.siteId));
 const sourcePlans=[],blockers=[];let auto=0,blocked=0,validation=0,datasets=0,executable=0;
 for(const m of sourceManifests){if(!manifestOk(m,rolloutReceipt,nowMs,maxManifestAgeMs)){blockers.push({sourceId:m?.sourceId||null,reason:'source-manifest-untrusted-stale-or-out-of-scope'});continue;}
  const dplans=[];for(const sd of m.datasets){datasets++;const td=targets.get(sd?.datasetId);if(!td||!Array.isArray(sd?.fields)||digest(sd.fields.map(canon))!==sd.sourceSchemaDigest){blockers.push({sourceId:m.sourceId,datasetId:sd?.datasetId||null,reason:td?'source-schema-digest-mismatch':'canonical-target-dataset-not-approved'});dplans.push({datasetId:sd?.datasetId||null,status:'BLOCKED',mappings:[],requiredMissing:[],validationChecks:[],readyForStagingImportSimulation:false,stagingOnly:true,realDataMovementAuthorised:false});continue;}
   const mappings=[],assigned=new Set();
   for(const sf of sd.fields){const cls=sf.classification||'business';if(!sf||!validId(sf.fieldId)||!SAFE_TYPES.has(sf.type)||NEVER.has(cls)){mappings.push({sourceField:sf?.fieldId||null,sourceType:sf?.type||null,status:'BLOCKED',reason:'source-field-never-automate'});blocked++;continue;}
    const exact=td.fields.get(sf.fieldId);if(exact&&exact.type===sf.type&&!NEVER.has(exact.classification||'business')&&exact.payrollImpacting!==true){mappings.push({sourceField:sf.fieldId,sourceType:sf.type,targetField:exact.fieldId,targetType:exact.type,status:'AUTOMATIC',reason:'exact-canonical-field-match',transform:'identity',ruleId:null,ruleDigest:null});assigned.add(exact.fieldId);auto++;continue;}
    const rs=rules.filter(r=>r.sourceId===m.sourceId&&r.datasetId===sd.datasetId&&r.sourceField===sf.fieldId&&r.sourceSchemaDigest===sd.sourceSchemaDigest&&r.targetSchemaDigest===td.schemaDigest&&td.fields.has(r.targetField));
    if(rs.length!==1){mappings.push({sourceField:sf.fieldId,sourceType:sf.type,status:'BLOCKED',reason:rs.length?'ambiguous-approved-mapping-rules':'no-exact-or-single-approved-mapping-rule'});blocked++;continue;}
    const r=rs[0],tf=td.fields.get(r.targetField);if(NEVER.has(tf.classification||'business')||tf.payrollImpacting===true||assigned.has(tf.fieldId)){mappings.push({sourceField:sf.fieldId,sourceType:sf.type,status:'BLOCKED',reason:'target-field-never-automate'});blocked++;continue;}
    mappings.push({sourceField:sf.fieldId,sourceType:sf.type,targetField:tf.fieldId,targetType:tf.type,status:'AUTOMATIC',reason:'single-integration-data-approved-rule',transform:r.transform,ruleId:r.ruleId,ruleDigest:r.ruleDigest});assigned.add(tf.fieldId);auto++;
   }
   const missing=[...td.fields.values()].filter(f=>f.required===true&&f.payrollImpacting!==true&&!NEVER.has(f.classification||'business')&&!assigned.has(f.fieldId)).map(f=>f.fieldId).sort();
   const vc=checks([...td.fields.values()].some(f=>f.payrollImpacting===true));validation+=vc.length;const ready=missing.length===0;if(ready)executable++;
   dplans.push({datasetId:sd.datasetId,sourceSchemaDigest:sd.sourceSchemaDigest,targetSchemaDigest:td.schemaDigest,recordCount:Number.isSafeInteger(sd.recordCount)&&sd.recordCount>=0?sd.recordCount:null,mappings,requiredMissing:missing,validationChecks:vc,readyForStagingImportSimulation:ready,stagingOnly:true,realDataMovementAuthorised:false});
  }
  sourcePlans.push({sourceId:m.sourceId,evidenceLevel:m.evidenceLevel,evidenceDigest:m.evidenceDigest,dataRegion:m.dataRegion,siteIds:[...m.siteIds].sort(),datasets:dplans,readOnlyDiscovery:true,realDataMovementAuthorised:false});
 }
 const covered=new Set(sourcePlans.flatMap(s=>s.siteIds));for(const id of eligible)if(!covered.has(id))blockers.push({siteId:id,reason:'verified-integration-data-source-evidence-required'});
 const repeated=sourcePlans.reduce((n,s)=>n+s.datasets.reduce((a,d)=>a+d.mappings.filter(m=>m.status==='AUTOMATIC').length,0)*Math.max(0,s.siteIds.length-1),0);
 const core={schemaVersion:1,importPlanVersion:VERSION,tenantRef:rolloutReceipt.tenantRef,rolloutReceiptDigest:rolloutReceipt.receiptDigest,canonicalSchemaEvidenceDigest:canonicalSchemaEvidence.evidenceDigest,observedAtMs:nowMs,status:blockers.length===0?'IMPORT_PLAN_READY':executable>0?'PARTIAL_IMPORT_BLOCKED':'IMPORT_BLOCKED',sourcePlans,blockers,executionEnvelope:{stagingImportSimulationAllowed:executable>0,realDataMovementAuthorised:false,customerDataReadAuthorityGranted:false,customerDataMutationAuthorityGranted:false,payrollMutationAuthorityGranted:false,identityMutationAuthorityGranted:false,productionMutationAuthorityGranted:false,modelMayGrantMappings:false,modelMayGrantAuthority:false,rollbackRequiredBeforeRealImport:true,independentPostImportVerificationRequired:true},metrics:{eligibleSites:eligible.size,sourceManifestsAccepted:sourcePlans.length,sourceManifestsRejected:sourceManifests.length-sourcePlans.length,datasetsPlanned:datasets,executableDatasets:executable,automaticMappings:auto,blockedMappings:blocked,automatedValidationChecks:validation,implementationQuestionsAdded:0,simulatedManualSchemaMappingDecisionsRemoved:auto,simulatedRepeatedSiteMappingDecisionsAvoided:repeated,simulatedManualValidationStepsRemoved:validation,realDataImportStepsRemoved:0,importExecutionProven:false,autonomousCustomerImportProven:false,remainingHumanOnlyDecisions:blockers.length+blocked},authority:{integrationWriteAuthorityGranted:false,environmentProvisioningAuthorityGranted:false,customerMutation:false,payrollMutation:false,identityMutation:false,productionMutation:false,modelAuthorityGranted:false,releaseAuthorityGranted:false}};
 return {...core,receiptDigest:digest(core)};
}
function verifyEvidenceBoundDataImportPlan(r){
 if(!r||r.schemaVersion!==1||r.importPlanVersion!==VERSION||!isDigest(r.receiptDigest)||!isDigest(r.rolloutReceiptDigest)||!isDigest(r.canonicalSchemaEvidenceDigest)||!allFalse(r.authority)||!Array.isArray(r.sourcePlans)||!Array.isArray(r.blockers))return false;const e=r.executionEnvelope;
 if(!e||e.realDataMovementAuthorised!==false||e.customerDataReadAuthorityGranted!==false||e.customerDataMutationAuthorityGranted!==false||e.payrollMutationAuthorityGranted!==false||e.identityMutationAuthorityGranted!==false||e.productionMutationAuthorityGranted!==false||e.modelMayGrantMappings!==false||e.modelMayGrantAuthority!==false||e.rollbackRequiredBeforeRealImport!==true||e.independentPostImportVerificationRequired!==true)return false;
 let auto=0,blocked=0,validation=0,datasets=0,executable=0,repeated=0;const ids=new Set();
 for(const s of r.sourcePlans){if(!s||!validId(s.sourceId)||ids.has(s.sourceId)||!isDigest(s.evidenceDigest)||!validId(s.dataRegion,80)||!Array.isArray(s.siteIds)||!Array.isArray(s.datasets)||s.readOnlyDiscovery!==true||s.realDataMovementAuthorised!==false)return false;ids.add(s.sourceId);let sa=0;
  for(const d of s.datasets){datasets++;if(!d||!Array.isArray(d.mappings)||!Array.isArray(d.requiredMissing)||!Array.isArray(d.validationChecks)||d.stagingOnly!==true||d.realDataMovementAuthorised!==false)return false;validation+=d.validationChecks.length;if(d.readyForStagingImportSimulation===true){if(d.requiredMissing.length!==0) return false;executable++;}
   for(const m of d.mappings){if(m.status==='AUTOMATIC'){if(!validId(m.sourceField)||!validId(m.targetField)||!TRANSFORMS.has(m.transform))return false;if(m.reason==='exact-canonical-field-match'&&(m.sourceField!==m.targetField||m.transform!=='identity'||m.ruleId!==null||m.ruleDigest!==null))return false;if(m.reason==='single-integration-data-approved-rule'&&(!validId(m.ruleId)||!isDigest(m.ruleDigest)))return false;if(!['exact-canonical-field-match','single-integration-data-approved-rule'].includes(m.reason))return false;auto++;sa++;}else if(m.status==='BLOCKED')blocked++;else return false;}
  } repeated+=sa*Math.max(0,s.siteIds.length-1);
 }
 const m=r.metrics;if(!m||m.sourceManifestsAccepted!==r.sourcePlans.length||m.datasetsPlanned!==datasets||m.executableDatasets!==executable||m.automaticMappings!==auto||m.blockedMappings!==blocked||m.automatedValidationChecks!==validation||m.implementationQuestionsAdded!==0||m.simulatedManualSchemaMappingDecisionsRemoved!==auto||m.simulatedRepeatedSiteMappingDecisionsAvoided!==repeated||m.simulatedManualValidationStepsRemoved!==validation||m.realDataImportStepsRemoved!==0||m.importExecutionProven!==false||m.autonomousCustomerImportProven!==false||m.remainingHumanOnlyDecisions!==r.blockers.length+blocked)return false;
 if(e.stagingImportSimulationAllowed!==(executable>0))return false;if(r.status==='IMPORT_PLAN_READY'&&r.blockers.length!==0)return false;if(r.status==='IMPORT_BLOCKED'&&executable!==0)return false;if(r.status==='PARTIAL_IMPORT_BLOCKED'&&(r.blockers.length===0||executable===0))return false;if(!['IMPORT_PLAN_READY','PARTIAL_IMPORT_BLOCKED','IMPORT_BLOCKED'].includes(r.status))return false;
 const c=clone(r);delete c.receiptDigest;return digest(c)===r.receiptDigest;
}
module.exports={VERSION,planEvidenceBoundDataImport,verifyEvidenceBoundDataImportPlan,digest};
