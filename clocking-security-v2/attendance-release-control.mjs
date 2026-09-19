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

function clone(value){ return JSON.parse(JSON.stringify(value)); }
function validSha(value){ return /^[a-f0-9]{40}$/i.test(String(value||'')); }
function validEvidenceId(value){ return /^[A-Za-z0-9._:/-]{4,240}$/.test(String(value||'')); }

function gateIsValid(name,gate,candidateSha){
  const common=Boolean(
    gate &&
    gate.passed===true &&
    gate.candidateSha===candidateSha &&
    validEvidenceId(gate.evidenceId) &&
    gate.skipped===0
  );
  if(!common) return false;
  if(name==='rollbackAuthority'){
    return ROLLBACK_AUTHORITY_REQUIREMENTS.every(field=>gate[field]===true);
  }
  return true;
}

export function assessAttendanceRelease({candidateSha,gates={},providerProofs=[]}={}){
  if(!validSha(candidateSha)) throw new Error('A full candidate commit SHA is required.');
  const blockers=[];
  const accepted={};

  for(const name of REQUIRED_GATES){
    const gate=gates[name];
    const valid=gateIsValid(name,gate,candidateSha);
    accepted[name]=valid;
    if(!valid) blockers.push(name);
  }

  const providerDomains=new Map();
  for(const proof of providerProofs){
    if(!proof || proof.realProvider!==true || proof.passed!==true || proof.candidateSha!==candidateSha || !validEvidenceId(proof.evidenceId)) continue;
    const domain=String(proof.domain||'').trim();
    if(!domain) continue;
    if(!providerDomains.has(domain)) providerDomains.set(domain,proof.evidenceId);
  }
  if(providerDomains.size<2) blockers.push('twoRealProviderDomains');

  const assessment=Object.freeze({
    candidateSha,
    ready:blockers.length===0,
    blockers:Object.freeze([...blockers]),
    accepted:Object.freeze({...accepted}),
    providerDomains:Object.freeze([...providerDomains.keys()].sort())
  });
  TRUSTED_ASSESSMENTS.add(assessment);
  return assessment;
}

export class AttendanceReleaseSwitch {
  constructor(){
    this.enabled=false;
    this.candidateSha=null;
    this.audit=[];
  }

  reconcile({assessment,requestedEnabled=false,actorId='release-controller',reason='gate-reconcile'}={}){
    if(!assessment || typeof assessment.ready!=='boolean' || !validSha(assessment.candidateSha) || !TRUSTED_ASSESSMENTS.has(assessment)) throw new Error('Trusted release assessment required.');
    if(!validEvidenceId(actorId)) throw new Error('Valid release actor required.');
    const shouldEnable=Boolean(requestedEnabled && assessment.ready);
    const action=shouldEnable?'enabled':(this.enabled?'rolled_back':'disabled');
    this.enabled=shouldEnable;
    this.candidateSha=shouldEnable?assessment.candidateSha:null;
    const row=Object.freeze({
      sequence:this.audit.length+1,
      action,
      actorId,
      reason:String(reason||'gate-reconcile').slice(0,240),
      candidateSha:assessment.candidateSha,
      ready:assessment.ready,
      blockers:[...assessment.blockers]
    });
    this.audit.push(row);
    return clone({enabled:this.enabled,candidateSha:this.candidateSha,audit:row});
  }

  rollback({actorId='release-controller',reason='manual-rollback'}={}){
    if(!validEvidenceId(actorId)) throw new Error('Valid release actor required.');
    const previousCandidateSha=this.candidateSha;
    this.enabled=false;
    this.candidateSha=null;
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
    return clone({enabled:false,candidateSha:null,audit:row});
  }

  state(){ return clone({enabled:this.enabled,candidateSha:this.candidateSha,audit:this.audit}); }
}

export { REQUIRED_GATES, ROLLBACK_AUTHORITY_REQUIREMENTS };
