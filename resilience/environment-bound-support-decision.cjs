'use strict';
const { createHash } = require('node:crypto');
const { verifyLivingEnvironmentModel } = require('./living-customer-environment-model.cjs');

const DECISION_VERSION = '1.0.0';
const IMPACTS = new Set(['none','site','regional','tenant']);
const SOURCES = new Set(['deterministic-detector','support-contract','runtime-health','integration-fabric']);
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');
const isDigest=v=>/^[a-f0-9]{64}$/.test(String(v||''));
const validRef=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(v);
const clone=v=>JSON.parse(JSON.stringify(v));
function fail(code,msg){const e=new Error(msg);e.code=code;throw e;}

function compileEnvironmentBoundSupportDecision({snapshot,incident}={}){
  if(!verifyLivingEnvironmentModel(snapshot))fail('WFM_SUPPORT_ENV_MODEL','verified living environment snapshot required');
  if(!incident||incident.tenantRef!==snapshot.tenantRef)fail('WFM_SUPPORT_TENANT','incident must remain in snapshot tenant');
  if(!validRef(incident.incidentId)||!validRef(incident.subjectRef)||!validRef(incident.scenarioClass))fail('WFM_SUPPORT_INCIDENT','valid incident identity required');
  if(!SOURCES.has(incident.source)||!isDigest(incident.evidenceDigest)||incident.verified!==true)fail('WFM_SUPPORT_EVIDENCE','verified deterministic incident evidence required');
  if(!IMPACTS.has(incident.blastRadius||'none'))fail('WFM_SUPPORT_BLAST_RADIUS','explicit bounded blast radius required');
  if(typeof incident.knownScenario!=='boolean')fail('WFM_SUPPORT_SCENARIO','knownScenario must be explicit');
  const consequential=incident.payrollImpact===true||incident.identityImpact===true||incident.securityImpact===true;
  const modelIncomplete=snapshot.supportDisposition==='ABSTAIN_AND_GATHER_EVIDENCE';
  const modelHighRisk=snapshot.supportDisposition==='CONTAIN_AND_REPRODUCE';
  const unknown=incident.knownScenario!==true;
  let terminalPath='DIAGNOSE_BOUNDED';
  if(modelIncomplete)terminalPath='ABSTAIN_GATHER_EVIDENCE';
  else if(modelHighRisk||unknown||consequential||incident.blastRadius==='tenant'||incident.blastRadius==='regional')terminalPath='CONTAIN_REPRODUCE_ISOLATED';
  const relevantSignals=snapshot.signals.filter(s=>s.subjectRef===incident.subjectRef||s.subjectRef==='tenant'||incident.blastRadius==='tenant').map(clone);
  const evidenceRequests=[...snapshot.missingCriticalKinds.map(kind=>({kind,reason:'critical-evidence-missing-or-stale'})),...snapshot.missingCriticalSubjects.map(clone)];
  const core={schemaVersion:1,decisionVersion:DECISION_VERSION,tenantRef:snapshot.tenantRef,incidentId:incident.incidentId,scenarioClass:incident.scenarioClass,subjectRef:incident.subjectRef,incidentEvidenceDigest:incident.evidenceDigest,environmentSnapshotDigest:snapshot.snapshotDigest,knownScenario:incident.knownScenario,blastRadius:incident.blastRadius||'none',consequential:{payroll:incident.payrollImpact===true,identity:incident.identityImpact===true,security:incident.securityImpact===true},terminalPath,relevantSignals,evidenceRequests,requiredNextSteps:{captureMoreEvidence:terminalPath==='ABSTAIN_GATHER_EVIDENCE',disposableReproduction:terminalPath==='CONTAIN_REPRODUCE_ISOLATED',boundedDiagnosis:terminalPath==='DIAGNOSE_BOUNDED',customerOrProviderAuthorisationMayBeRequired:consequential||unknown,independentVerificationRequired:true},metrics:{vendorEngineerInitialTriageRequired:false,manualEnvironmentRediscoveryRequired:false,evidenceRequests:evidenceRequests.length,predictiveSignalsApplied:relevantSignals.length},guardrails:{languageModelCanSelectAuthority:false,customerTextCanSelectAuthority:false,automaticProductionActionAllowed:false,crossTenantActionAllowed:false,legalOrPayrollDecisionAuthorityGranted:false},authority:{productionMutation:false,customerMutation:false,payrollMutation:false,identityMutation:false,environmentMutation:false,integrationWriteAuthorityGranted:false,modelAuthorityGranted:false,executionAuthorityGranted:false,releaseAuthorityGranted:false}};
  return {...core,decisionDigest:digest(core)};
}

function verifyEnvironmentBoundSupportDecision(d){
  if(!d||d.schemaVersion!==1||d.decisionVersion!==DECISION_VERSION||!isDigest(d.decisionDigest)||!isDigest(d.environmentSnapshotDigest)||!isDigest(d.incidentEvidenceDigest)||!validRef(d.tenantRef)||!validRef(d.incidentId)||!validRef(d.subjectRef)||!validRef(d.scenarioClass))return false;
  if(!d.authority||Object.values(d.authority).some(v=>v!==false)||!d.guardrails||Object.values(d.guardrails).some(v=>v!==false))return false;
  if(!['ABSTAIN_GATHER_EVIDENCE','CONTAIN_REPRODUCE_ISOLATED','DIAGNOSE_BOUNDED'].includes(d.terminalPath))return false;
  if(!d.requiredNextSteps||d.requiredNextSteps.independentVerificationRequired!==true)return false;
  if(d.requiredNextSteps.captureMoreEvidence!==(d.terminalPath==='ABSTAIN_GATHER_EVIDENCE'))return false;
  if(d.requiredNextSteps.disposableReproduction!==(d.terminalPath==='CONTAIN_REPRODUCE_ISOLATED'))return false;
  if(d.requiredNextSteps.boundedDiagnosis!==(d.terminalPath==='DIAGNOSE_BOUNDED'))return false;
  if(d.metrics?.vendorEngineerInitialTriageRequired!==false||d.metrics?.manualEnvironmentRediscoveryRequired!==false)return false;
  const core=clone(d);delete core.decisionDigest;return digest(core)===d.decisionDigest;
}
module.exports={DECISION_VERSION,compileEnvironmentBoundSupportDecision,verifyEnvironmentBoundSupportDecision,digest};
