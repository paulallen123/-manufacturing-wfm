'use strict';
const { createHash } = require('node:crypto');

const MODEL_VERSION = '1.0.0';
const TRUSTED = new Set(['contract','integration-fabric','system-discovery','runtime-health','deterministic-validator','policy-catalog','identity-directory','customer-authorisation-receipt']);
const MAX_AGE = Object.freeze({topology:1440,role:1440,workflow:1440,contract:43200,policy:10080,integration:30,mapping:1440,data:30,runtime:10,permission:60,feature:1440,dependency:60,'payroll-boundary':60,'attendance-source':30,device:60,'critical-process':60,health:10,change:1440,'local-setting':1440,exception:30});
const OPTIONAL = new Set(['dependency','device','change','local-setting','exception']);
const REQUIRED_KINDS = Object.freeze(Object.keys(MAX_AGE).filter(k=>!OPTIONAL.has(k)).sort());
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');
const isDigest=v=>/^[a-f0-9]{64}$/.test(String(v||''));
const validRef=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(v);
const clone=v=>JSON.parse(JSON.stringify(v));
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function sensitive(v,d=0){if(d>10||v==null||typeof v!=='object')return false;if(Array.isArray(v))return v.some(x=>sensitive(x,d+1));return Object.entries(v).some(([k,x])=>/(password|secret|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key|credential[_-]?(value|secret))/i.test(k)||sensitive(x,d+1));}
function time(v,name){const n=Date.parse(String(v||''));if(!Number.isFinite(n))fail('WFM_ENV_TIME',`${name} must be an ISO timestamp`);return n;}

function deriveSignals(records,conflicts,now){
  const signals=[];const add=(id,severity,r,extra={})=>signals.push({id,severity,subjectRef:r.subjectRef,evidenceDigest:r.evidenceDigest,...extra});
  for(const c of conflicts)signals.push({id:'evidence-conflict',severity:'high',subjectRef:c.subjectRef,evidenceDigest:digest(c)});
  for(const r of records){const p=r.payload&&typeof r.payload==='object'?r.payload:{};if(r.freshness==='STALE')add('evidence-stale',OPTIONAL.has(r.kind)?'medium':'high',r,{kind:r.kind,ageMinutes:r.ageMinutes});
    if(r.kind==='integration'){if(p.status&&!['healthy','ready','connected'].includes(p.status))add('integration-unhealthy','high',r,{status:p.status});if(isDigest(p.expectedSchemaDigest)&&isDigest(p.observedSchemaDigest)&&p.expectedSchemaDigest!==p.observedSchemaDigest)add('integration-schema-drift','high',r);const exp=Date.parse(String(p.credentialExpiresAt||''));if(Number.isFinite(exp)){const days=Math.ceil((exp-now)/86400000);if(days<=0)add('credential-expired','high',r,{daysRemaining:days});else if(days<=7)add('credential-expiring','medium',r,{daysRemaining:days});}}
    if(r.kind==='data'&&Number(p.freshnessMinutes)>Number(p.maxFreshnessMinutes||60))add('data-freshness-deteriorating','high',r);
    if(r.kind==='health'&&Number(p.retryStormThreshold||0)>0&&Number(p.retryRatePerMinute||0)>Number(p.retryStormThreshold))add('retry-storm','high',r);
    if((r.kind==='feature'||r.kind==='local-setting')&&isDigest(p.expectedDigest)&&isDigest(p.observedDigest)&&p.expectedDigest!==p.observedDigest&&p.intentionalOverride!==true)add('configuration-drift','medium',r);
    if(r.kind==='payroll-boundary'&&(p.ready!==true||Number(p.blockingExceptions||0)>0))add('payroll-readiness-blocked','high',r,{blockingExceptions:Number(p.blockingExceptions||0)});
  }
  return signals.sort((a,b)=>({high:0,medium:1}[a.severity]-{high:0,medium:1}[b.severity])||a.id.localeCompare(b.id)||a.subjectRef.localeCompare(b.subjectRef));
}

function compileLivingEnvironmentModel({tenantRef,observedAt,evidence=[],previousSnapshot=null}={}){
  if(!validRef(tenantRef))fail('WFM_ENV_TENANT','valid tenantRef required');
  const now=time(observedAt,'observedAt');
  if(previousSnapshot&&(!verifyLivingEnvironmentModel(previousSnapshot)||previousSnapshot.tenantRef!==tenantRef))fail('WFM_ENV_PREVIOUS_SNAPSHOT','invalid prior snapshot');
  const ignored=[];const accepted=[];
  for(const x of Array.isArray(evidence)?evidence:[]){
    if(!x||typeof x!=='object'){ignored.push({reason:'malformed'});continue;}
    if(x.tenantRef!==tenantRef)fail('WFM_ENV_TENANT_ISOLATION','cross-tenant evidence denied');
    if(!(x.kind in MAX_AGE)){ignored.push({kind:x.kind||null,reason:'unsupported-kind'});continue;}
    if(x.verified!==true||!TRUSTED.has(x.source)||!isDigest(x.evidenceDigest)||!validRef(x.subjectRef)){ignored.push({kind:x.kind,subjectRef:x.subjectRef||null,reason:'untrusted-or-invalid'});continue;}
    if(sensitive(x.payload))fail('WFM_ENV_SENSITIVE_MATERIAL','secrets/tokens/passwords must not be persisted');
    const seen=time(x.observedAt,'evidence.observedAt');if(seen>now+300000){ignored.push({kind:x.kind,subjectRef:x.subjectRef,reason:'future-dated'});continue;}
    const age=Math.max(0,Math.floor((now-seen)/60000));
    accepted.push({tenantRef,kind:x.kind,subjectRef:x.subjectRef,payload:clone(x.payload),payloadDigest:digest(x.payload),source:x.source,evidenceDigest:x.evidenceDigest,observedAt:new Date(seen).toISOString(),ageMinutes:age,freshness:age<=MAX_AGE[x.kind]?'FRESH':'STALE',uncertainty:age<=MAX_AGE[x.kind]?'LOW':'HIGH'});
  }
  const grouped=new Map();for(const r of accepted){const k=`${r.kind}|${r.subjectRef}`;(grouped.get(k)||grouped.set(k,[]).get(k)).push(r);}
  const records=[];const conflicts=[];
  for(const [key,list] of grouped){list.sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt)||a.source.localeCompare(b.source)||a.evidenceDigest.localeCompare(b.evidenceDigest));const t=Date.parse(list[0].observedAt);const newest=list.filter(x=>Date.parse(x.observedAt)===t);if(new Set(newest.map(x=>x.payloadDigest)).size>1){const [kind,subjectRef]=key.split('|');conflicts.push({kind,subjectRef,reason:'conflicting-verified-evidence',evidenceDigests:newest.map(x=>x.evidenceDigest).sort()});}else records.push(list[0]);}
  records.sort((a,b)=>a.kind.localeCompare(b.kind)||a.subjectRef.localeCompare(b.subjectRef));
  const fresh=records.filter(r=>r.freshness==='FRESH');const freshKinds=new Set(fresh.map(r=>r.kind));const missingCriticalKinds=REQUIRED_KINDS.filter(k=>!freshKinds.has(k));
  const topology=fresh.filter(r=>r.kind==='topology');
  const countries=[...new Set(topology.flatMap(r=>Array.isArray(r.payload?.countries)?r.payload.countries:[]).filter(c=>/^[A-Z]{2}$/.test(c)))].sort();
  const sites=[...new Set(topology.flatMap(r=>Array.isArray(r.payload?.siteIds)?r.payload.siteIds:[]).filter(validRef))].sort();
  const policyCountries=new Set(fresh.filter(r=>r.kind==='policy'&&/^[A-Z]{2}$/.test(r.payload?.country||'')).map(r=>r.payload.country));const healthSubjects=new Set(fresh.filter(r=>r.kind==='health').map(r=>r.subjectRef));
  const missingCriticalSubjects=[...countries.filter(c=>!policyCountries.has(c)).map(subjectRef=>({kind:'policy',subjectRef,reason:'country-policy-evidence-missing-or-stale'})),...sites.filter(s=>!healthSubjects.has(s)).map(subjectRef=>({kind:'health',subjectRef,reason:'site-health-evidence-missing-or-stale'}))];
  const signals=deriveSignals(records,conflicts,now);const high=signals.filter(s=>s.severity==='high').length;
  const previous=new Map((previousSnapshot?.records||[]).map(r=>[`${r.kind}|${r.subjectRef}`,r]));const detectedChanges=records.filter(r=>previous.has(`${r.kind}|${r.subjectRef}`)&&previous.get(`${r.kind}|${r.subjectRef}`).payloadDigest!==r.payloadDigest).map(r=>({kind:r.kind,subjectRef:r.subjectRef,previousPayloadDigest:previous.get(`${r.kind}|${r.subjectRef}`).payloadDigest,currentPayloadDigest:r.payloadDigest,currentEvidenceDigest:r.evidenceDigest}));
  const incomplete=conflicts.length||missingCriticalKinds.length||missingCriticalSubjects.length;const supportDisposition=incomplete?'ABSTAIN_AND_GATHER_EVIDENCE':high>=2?'CONTAIN_AND_REPRODUCE':signals.length?'DIAGNOSE_BOUNDED':'HEALTHY_EVIDENCE_READY';
  const core={schemaVersion:1,modelVersion:MODEL_VERSION,tenantRef,observedAt:new Date(now).toISOString(),records,conflicts,ignoredEvidence:ignored,missingCriticalKinds,missingCriticalSubjects,uncertainty:{level:incomplete?'HIGH':high?'MEDIUM':'LOW'},signals,detectedChanges,supportDisposition,metrics:{evidenceSubmitted:evidence.length,evidenceAccepted:accepted.length,evidenceIgnored:ignored.length,topologyCountries:countries.length,topologySites:sites.length,manualEnvironmentFactsStillRequired:missingCriticalKinds.length+missingCriticalSubjects.length+conflicts.length,manualEnvironmentChecksRemoved:Math.max(0,(REQUIRED_KINDS.length-2)+countries.length+sites.length-missingCriticalKinds.filter(k=>!['policy','health'].includes(k)).length-missingCriticalSubjects.length),predictiveSignals:signals.length,highRiskSignals:high,changesDetectedSincePriorSnapshot:detectedChanges.length},guardrails:{untrustedTextCanBecomeAuthority:false,modelOutputCanBecomeAuthority:false,crossTenantEvidenceAllowed:false,legalCoverageClaim:false,automaticProductionActionAllowed:false},authority:{productionMutation:false,customerMutation:false,payrollMutation:false,identityMutation:false,integrationWriteAuthorityGranted:false,environmentProvisioningAuthorityGranted:false,modelAuthorityGranted:false,executionAuthorityGranted:false,releaseAuthorityGranted:false}};
  return {...core,snapshotDigest:digest(core)};
}

function verifyLivingEnvironmentModel(s){
  if(!s||s.schemaVersion!==1||s.modelVersion!==MODEL_VERSION||!validRef(s.tenantRef)||!isDigest(s.snapshotDigest)||!s.authority||Object.values(s.authority).some(v=>v!==false)||!s.guardrails||Object.values(s.guardrails).some(v=>v!==false)||!Array.isArray(s.records)||!Array.isArray(s.missingCriticalKinds)||!Array.isArray(s.missingCriticalSubjects)||!Array.isArray(s.conflicts)||!Array.isArray(s.signals)||!Array.isArray(s.detectedChanges))return false;
  const now=Date.parse(s.observedAt);if(!Number.isFinite(now))return false;
  if(s.records.some(r=>{const seen=Date.parse(r.observedAt),age=Number.isFinite(seen)?Math.max(0,Math.floor((now-seen)/60000)):-1;const freshness=age>=0&&age<=MAX_AGE[r.kind]?'FRESH':'STALE';return r.tenantRef!==s.tenantRef||!(r.kind in MAX_AGE)||!validRef(r.subjectRef)||!isDigest(r.payloadDigest)||r.payloadDigest!==digest(r.payload)||!isDigest(r.evidenceDigest)||sensitive(r.payload)||age!==r.ageMinutes||r.freshness!==freshness||r.uncertainty!==(freshness==='FRESH'?'LOW':'HIGH');}))return false;
  const keys=s.records.map(r=>`${r.kind}|${r.subjectRef}`);if(new Set(keys).size!==keys.length)return false;
  const fresh=s.records.filter(r=>r.freshness==='FRESH'),kinds=new Set(fresh.map(r=>r.kind));const missingKinds=REQUIRED_KINDS.filter(k=>!kinds.has(k));if(JSON.stringify(missingKinds)!==JSON.stringify(s.missingCriticalKinds))return false;
  const topology=fresh.filter(r=>r.kind==='topology');const countries=[...new Set(topology.flatMap(r=>Array.isArray(r.payload?.countries)?r.payload.countries:[]).filter(c=>/^[A-Z]{2}$/.test(c)))].sort();const sites=[...new Set(topology.flatMap(r=>Array.isArray(r.payload?.siteIds)?r.payload.siteIds:[]).filter(validRef))].sort();const policyCountries=new Set(fresh.filter(r=>r.kind==='policy'&&/^[A-Z]{2}$/.test(r.payload?.country||'')).map(r=>r.payload.country));const healthSubjects=new Set(fresh.filter(r=>r.kind==='health').map(r=>r.subjectRef));const missingSubjects=[...countries.filter(c=>!policyCountries.has(c)).map(subjectRef=>({kind:'policy',subjectRef,reason:'country-policy-evidence-missing-or-stale'})),...sites.filter(x=>!healthSubjects.has(x)).map(subjectRef=>({kind:'health',subjectRef,reason:'site-health-evidence-missing-or-stale'}))];if(JSON.stringify(missingSubjects)!==JSON.stringify(s.missingCriticalSubjects))return false;
  const signals=deriveSignals(s.records,s.conflicts,now);if(JSON.stringify(signals)!==JSON.stringify(s.signals))return false;const high=signals.filter(x=>x.severity==='high').length;const incomplete=s.conflicts.length||missingKinds.length||missingSubjects.length;const disposition=incomplete?'ABSTAIN_AND_GATHER_EVIDENCE':high>=2?'CONTAIN_AND_REPRODUCE':signals.length?'DIAGNOSE_BOUNDED':'HEALTHY_EVIDENCE_READY';if(s.supportDisposition!==disposition||s.uncertainty?.level!==(incomplete?'HIGH':high?'MEDIUM':'LOW'))return false;
  if(s.metrics?.topologyCountries!==countries.length||s.metrics?.topologySites!==sites.length||s.metrics?.manualEnvironmentFactsStillRequired!==missingKinds.length+missingSubjects.length+s.conflicts.length||s.metrics?.predictiveSignals!==signals.length||s.metrics?.highRiskSignals!==high||s.metrics?.changesDetectedSincePriorSnapshot!==s.detectedChanges.length)return false;
  const core=clone(s);delete core.snapshotDigest;return digest(core)===s.snapshotDigest;
}

module.exports={MODEL_VERSION,REQUIRED_KINDS,TRUSTED_SOURCES:TRUSTED,compileLivingEnvironmentModel,verifyLivingEnvironmentModel,digest};
