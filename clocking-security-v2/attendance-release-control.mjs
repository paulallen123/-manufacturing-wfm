import { createPublicKey, verify as verifySignature } from 'node:crypto';

const REQUIRED_GATES=Object.freeze([
  'ci',
  'deterministic',
  'randomized',
  'durabilityRestart',
  'concurrencyExactlyOnce',
  'payrollPath',
  'tenantSiteIsolation',
  'reviewCorrectionAudit',
  'privacyDpia',
  'hostedSyntheticSoak',
  'telemetryContinuity',
  'rollbackAuthority',
  'regression'
]);

const ROLLBACK_AUTHORITY_REQUIREMENTS=Object.freeze([
  'realExternalAuthority',
  'signedReceipts',
  'commitmentBoundCas',
  'restartRecoveryProven'
]);

// A release switch must never trust a caller-created object that merely says
// `ready: true`. Assessments are executable authority, not presentation data.
// Keep their provenance in-process and non-serialisable so a forged, stale or
// JSON-replayed assessment cannot bypass the mandatory gate evaluation path.
const TRUSTED_ASSESSMENTS=new WeakSet();
const ASSESSMENT_EVIDENCE_POLICIES=new WeakMap();
const TRUSTED_EVIDENCE_POLICIES=new WeakSet();

function clone(value){ return JSON.parse(JSON.stringify(value)); }
function validSha(value){ return /^[a-f0-9]{40}$/i.test(String(value||'')); }
function validEvidenceId(value){ return /^[A-Za-z0-9._:/-]{4,240}$/.test(String(value||'')); }
function validIssuerId(value){ return /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/.test(String(value||'')); }
function validPolicyId(value){ return /^[A-Za-z0-9][A-Za-z0-9._:/-]{3,159}$/.test(String(value||'')); }
function validSignature(value){ return /^[A-Za-z0-9_-]{40,200}$/.test(String(value||'')); }
function validTime(value){ return Number.isSafeInteger(value) && value>0; }
function canonicalProviderDomain(value){
  const domain=String(value||'').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._:-]{1,79}$/.test(domain)?domain:null;
}
function validProviderSystemId(value){ return /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/.test(String(value||'')); }
function evidenceWindowIsValid(evidence,nowMs){
  return Boolean(
    validTime(nowMs) &&
    validTime(evidence?.issuedAtMs) &&
    validTime(evidence?.expiresAtMs) &&
    evidence.issuedAtMs<=nowMs &&
    evidence.expiresAtMs>nowMs &&
    evidence.expiresAtMs>evidence.issuedAtMs
  );
}

function gateAttestationPayload(policyId,name,gate){
  const payload={
    version:1,
    kind:'attendance-release-gate',
    policyId,
    gate:name,
    candidateSha:String(gate?.candidateSha||''),
    evidenceId:String(gate?.evidenceId||''),
    passed:gate?.passed===true,
    skipped:gate?.skipped,
    issuedAtMs:gate?.issuedAtMs,
    expiresAtMs:gate?.expiresAtMs
  };
  if(name==='rollbackAuthority'){
    for(const field of ROLLBACK_AUTHORITY_REQUIREMENTS) payload[field]=gate?.[field]===true;
  }
  return JSON.stringify(payload);
}

function providerAttestationPayload(policyId,proof){
  return JSON.stringify({
    version:1,
    kind:'attendance-provider-proof',
    policyId,
    domain:canonicalProviderDomain(proof?.domain),
    providerSystemId:String(proof?.providerSystemId||''),
    realProvider:proof?.realProvider===true,
    passed:proof?.passed===true,
    skipped:proof?.skipped,
    candidateSha:String(proof?.candidateSha||''),
    evidenceId:String(proof?.evidenceId||''),
    issuedAtMs:proof?.issuedAtMs,
    expiresAtMs:proof?.expiresAtMs
  });
}

function decodeSignature(signature){
  if(!validSignature(signature)) return null;
  try { return Buffer.from(signature,'base64url'); } catch { return null; }
}

export function createAttendanceReleaseEvidencePolicy({policyId,issuers=[]}={}){
  if(!validPolicyId(policyId)) throw new Error('Valid release evidence policyId required.');
  if(!Array.isArray(issuers) || issuers.length===0) throw new Error('At least one trusted evidence issuer is required.');
  const trustedIssuers=new Map();
  for(const issuer of issuers){
    if(!issuer || !validIssuerId(issuer.issuerId) || trustedIssuers.has(issuer.issuerId)) throw new Error('Unique valid evidence issuerId required.');
    let publicKey;
    try { publicKey=createPublicKey(issuer.publicKeyPem); } catch { throw new Error(`Invalid public key for issuer ${issuer.issuerId}.`); }
    if(publicKey.asymmetricKeyType!=='ed25519') throw new Error(`Issuer ${issuer.issuerId} must use Ed25519.`);
    const allowedGates=new Set(Array.isArray(issuer.allowedGates)?issuer.allowedGates:[]);
    const allowedProviderDomains=new Set((Array.isArray(issuer.allowedProviderDomains)?issuer.allowedProviderDomains:[]).map(canonicalProviderDomain).filter(Boolean));
    if(allowedGates.size===0 && allowedProviderDomains.size===0) throw new Error(`Issuer ${issuer.issuerId} has no evidence authority.`);
    for(const name of allowedGates){ if(name!=='*' && !REQUIRED_GATES.includes(name)) throw new Error(`Issuer ${issuer.issuerId} has unknown gate authority.`); }
    trustedIssuers.set(issuer.issuerId,Object.freeze({publicKey,allowedGates,allowedProviderDomains}));
  }

  const policy=Object.freeze({
    policyId,
    verifyGate(name,gate){
      if(!REQUIRED_GATES.includes(name) || gate?.policyId!==policyId || !validIssuerId(gate?.issuerId)) return false;
      const issuer=trustedIssuers.get(gate.issuerId);
      if(!issuer || (!issuer.allowedGates.has('*') && !issuer.allowedGates.has(name))) return false;
      const signature=decodeSignature(gate.signature);
      if(!signature) return false;
      try { return verifySignature(null,Buffer.from(gateAttestationPayload(policyId,name,gate)),issuer.publicKey,signature); } catch { return false; }
    },
    verifyProviderProof(proof){
      const domain=canonicalProviderDomain(proof?.domain);
      if(!domain || proof?.policyId!==policyId || !validIssuerId(proof?.issuerId)) return false;
      const issuer=trustedIssuers.get(proof.issuerId);
      if(!issuer || (!issuer.allowedProviderDomains.has('*') && !issuer.allowedProviderDomains.has(domain))) return false;
      const signature=decodeSignature(proof.signature);
      if(!signature) return false;
      try { return verifySignature(null,Buffer.from(providerAttestationPayload(policyId,proof)),issuer.publicKey,signature); } catch { return false; }
    }
  });
  TRUSTED_EVIDENCE_POLICIES.add(policy);
  return policy;
}

function gateIsValid(name,gate,candidateSha,evidencePolicy,nowMs){
  const common=Boolean(
    gate &&
    gate.passed===true &&
    gate.candidateSha===candidateSha &&
    validEvidenceId(gate.evidenceId) &&
    gate.skipped===0 &&
    evidenceWindowIsValid(gate,nowMs) &&
    evidencePolicy?.verifyGate(name,gate)===true
  );
  if(!common) return false;
  if(name==='rollbackAuthority'){
    return ROLLBACK_AUTHORITY_REQUIREMENTS.every(field=>gate[field]===true);
  }
  return true;
}

export function assessAttendanceRelease({candidateSha,gates={},providerProofs=[],evidencePolicy,nowMs=Date.now()}={}){
  if(!validSha(candidateSha)) throw new Error('A full candidate commit SHA is required.');
  if(!validTime(nowMs)) throw new Error('Valid release assessment time required.');
  if(!evidencePolicy || !TRUSTED_EVIDENCE_POLICIES.has(evidencePolicy)) throw new Error('Trusted release evidence policy required.');
  const blockers=[];
  const accepted={};
  let validUntilMs=Number.MAX_SAFE_INTEGER;

  for(const name of REQUIRED_GATES){
    const gate=gates[name];
    const valid=gateIsValid(name,gate,candidateSha,evidencePolicy,nowMs);
    accepted[name]=valid;
    if(!valid) blockers.push(name);
    else validUntilMs=Math.min(validUntilMs,gate.expiresAtMs);
  }

  // Two real provider domains must be genuinely distinct evidence, not aliases of
  // one proof. Canonicalise domain names, require zero skipped checks, verify the
  // signed proof against the trusted release-evidence policy, prevent the same
  // provider system/evidence artifact from being counted twice, and require the
  // provider evidence to be live at the assessment instant.
  const providerDomains=new Map();
  const providerSystems=new Set();
  const providerEvidenceIds=new Set();
  const providerExpiries=[];
  for(const proof of providerProofs){
    if(!proof || proof.realProvider!==true || proof.passed!==true || proof.skipped!==0 || proof.candidateSha!==candidateSha || !validEvidenceId(proof.evidenceId) || !validProviderSystemId(proof.providerSystemId) || !evidenceWindowIsValid(proof,nowMs) || evidencePolicy.verifyProviderProof(proof)!==true) continue;
    const domain=canonicalProviderDomain(proof.domain);
    if(!domain) continue;
    const systemId=String(proof.providerSystemId);
    if(providerDomains.has(domain) || providerSystems.has(systemId) || providerEvidenceIds.has(proof.evidenceId)) continue;
    providerDomains.set(domain,proof.evidenceId);
    providerSystems.add(systemId);
    providerEvidenceIds.add(proof.evidenceId);
    providerExpiries.push(proof.expiresAtMs);
  }
  if(providerDomains.size<2) blockers.push('twoRealProviderDomains');
  else {
    providerExpiries.sort((a,b)=>b-a);
    validUntilMs=Math.min(validUntilMs,providerExpiries[1]);
  }

  const assessment=Object.freeze({
    candidateSha,
    ready:blockers.length===0,
    blockers:Object.freeze([...blockers]),
    accepted:Object.freeze({...accepted}),
    providerDomains:Object.freeze([...providerDomains.keys()].sort()),
    evidencePolicyId:evidencePolicy.policyId,
    evaluatedAtMs:nowMs,
    validUntilMs:blockers.length===0?validUntilMs:null
  });
  TRUSTED_ASSESSMENTS.add(assessment);
  ASSESSMENT_EVIDENCE_POLICIES.set(assessment,evidencePolicy);
  return assessment;
}

export class AttendanceReleaseSwitch {
  constructor({expectedCandidateSha,evidencePolicy}={}){
    if(!validSha(expectedCandidateSha)) throw new Error('Exact release candidate SHA required.');
    if(!evidencePolicy || !TRUSTED_EVIDENCE_POLICIES.has(evidencePolicy)) throw new Error('Trusted release evidence policy required.');
    this.enabled=false;
    this.candidateSha=null;
    this.validUntilMs=null;
    this.expectedCandidateSha=expectedCandidateSha;
    this.evidencePolicy=evidencePolicy;
    this.audit=[];
  }

  reconcile({assessment,requestedEnabled=false,actorId='release-controller',reason='gate-reconcile',nowMs=Date.now()}={}){
    if(!assessment || typeof assessment.ready!=='boolean' || !validSha(assessment.candidateSha) || !TRUSTED_ASSESSMENTS.has(assessment)) throw new Error('Trusted release assessment required.');
    if(assessment.candidateSha!==this.expectedCandidateSha) throw new Error('Release assessment candidate does not match the bound runtime candidate.');
    if(ASSESSMENT_EVIDENCE_POLICIES.get(assessment)!==this.evidencePolicy) throw new Error('Release assessment evidence policy does not match the bound release policy.');
    if(!validTime(nowMs)) throw new Error('Valid release reconciliation time required.');
    if(!validEvidenceId(actorId)) throw new Error('Valid release actor required.');
    const assessmentFresh=assessment.ready===true && validTime(assessment.validUntilMs) && assessment.validUntilMs>nowMs;
    const shouldEnable=Boolean(requestedEnabled && assessmentFresh);
    const action=shouldEnable?'enabled':(this.enabled?'rolled_back':'disabled');
    this.enabled=shouldEnable;
    this.candidateSha=shouldEnable?assessment.candidateSha:null;
    this.validUntilMs=shouldEnable?assessment.validUntilMs:null;
    const row=Object.freeze({
      sequence:this.audit.length+1,
      action,
      actorId,
      reason:assessment.ready && !assessmentFresh?'evidence-expired':String(reason||'gate-reconcile').slice(0,240),
      candidateSha:assessment.candidateSha,
      ready:assessment.ready && assessmentFresh,
      blockers:assessment.ready && !assessmentFresh?['evidenceExpired']:[...assessment.blockers]
    });
    this.audit.push(row);
    return clone({enabled:this.enabled,candidateSha:this.candidateSha,validUntilMs:this.validUntilMs,audit:row});
  }

  rollback({actorId='release-controller',reason='manual-rollback'}={}){
    if(!validEvidenceId(actorId)) throw new Error('Valid release actor required.');
    const previousCandidateSha=this.candidateSha;
    this.enabled=false;
    this.candidateSha=null;
    this.validUntilMs=null;
    const row=Object.freeze({
      sequence:this.audit.length+1,
      action:'rolled_back',
      actorId,
      reason:String(reason||'manual-rollback').slice(0,240),
      candidateSha:previousCandidateSha,
      ready:false,
      blockers:['manualRollback']
    });
    this.audit.push(row);
    return clone({enabled:false,candidateSha:null,validUntilMs:null,audit:row});
  }

  state(){ return clone({enabled:this.enabled,candidateSha:this.candidateSha,validUntilMs:this.validUntilMs,expectedCandidateSha:this.expectedCandidateSha,evidencePolicyId:this.evidencePolicy.policyId,audit:this.audit}); }
}

export { REQUIRED_GATES, ROLLBACK_AUTHORITY_REQUIREMENTS };
