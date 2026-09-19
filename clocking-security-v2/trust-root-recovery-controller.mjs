import {trustRootRecoveryDigest,verifyTrustRootRecovery} from './trust-root-recovery.mjs';
import {isLifecycleBoundSignedRollbackAnchorClient} from './signed-rollback-anchor.mjs';

function safeId(value,label){
  const v=String(value||'').trim();
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(v)) throw new Error(`${label} invalid.`);
  return v;
}
function safeEpoch(value,label='Recovery epoch'){
  if(!Number.isSafeInteger(value)||value<0) throw new Error(`${label} invalid.`);
  return value;
}
function sameDigest(left,right){
  return typeof left==='string' && typeof right==='string' && left.toLowerCase()===right.toLowerCase();
}

/**
 * Governs rollback trust-root recovery with a separately signed monotonic authority.
 * The recovery package itself is quorum-signed; this controller prevents local
 * rollback/replay of the accepted recovery epoch and binds crash recovery to the
 * exact previously committed package digest.
 */
export class TrustRootRecoveryController {
  constructor({
    epochAnchor,
    trustDomainId,
    epochAuthorityId='wfm-trust-recovery-epoch-authority',
    requireLifecycleBound=true
  }={}){
    if(!epochAnchor?.currentState || !epochAnchor?.advanceCommitted){
      throw new Error('Signed recovery-epoch authority client required.');
    }
    this.trustDomainId=safeId(trustDomainId,'Trust-root recovery trust domain ID');
    this.epochAuthorityId=safeId(epochAuthorityId,'Recovery-epoch authority ID');
    const expectedAnchorId=`trust-root-recovery:${this.trustDomainId}`;
    if(epochAnchor.authorityId!==this.epochAuthorityId) throw new Error('Recovery-epoch authority identity mismatch.');
    if(epochAnchor.anchorId!==expectedAnchorId) throw new Error('Recovery-epoch anchor identity mismatch.');
    if(requireLifecycleBound && !isLifecycleBoundSignedRollbackAnchorClient(epochAnchor)){
      throw new Error('Release-grade recovery epoch requires lifecycle-bound signed authority provenance.');
    }
    this.epochAnchor=epochAnchor;
  }

  verifyAndCommit({
    packageValue,
    currentRootPublicKeys,
    proposedRootPublicKeys,
    recoveryCustodianPublicKeys,
    requiredApprovals=2,
    expectedAuthorityId='wfm-security-anchor-authority',
    nowMs=Date.now(),
    maxAgeMs=15*60_000
  }={}){
    const digest=trustRootRecoveryDigest(packageValue);
    const packageEpoch=safeEpoch(packageValue?.recoveryEpoch);
    const state=this.epochAnchor.currentState();
    const acceptedEpoch=safeEpoch(state?.generation,'Recovery-epoch authority generation');
    const acceptedCommitment=state?.commitment??null;

    // Crash-recovery path: the epoch authority already committed the package, but
    // the caller may have crashed before installing the new root set. Only the
    // exact committed package can be replayed to finish that interrupted step.
    if(packageEpoch===acceptedEpoch){
      if(!sameDigest(acceptedCommitment,digest)){
        throw new Error('Recovery epoch is already committed to a different package.');
      }
      const verified=verifyTrustRootRecovery({
        packageValue,currentRootPublicKeys,proposedRootPublicKeys,recoveryCustodianPublicKeys,
        requiredApprovals,minimumRecoveryEpoch:Math.max(0,acceptedEpoch-1),expectedRecoveryDigest:digest,
        expectedAuthorityId,expectedTrustDomainId:this.trustDomainId,nowMs,maxAgeMs
      });
      return {...verified,recoveryCommitStatus:'already_committed',epochAuthorityGeneration:acceptedEpoch};
    }

    if(packageEpoch!==acceptedEpoch+1){
      throw new Error('Trust-root recovery epoch must be exactly the next independently committed epoch.');
    }

    const verified=verifyTrustRootRecovery({
      packageValue,currentRootPublicKeys,proposedRootPublicKeys,recoveryCustodianPublicKeys,
      requiredApprovals,minimumRecoveryEpoch:acceptedEpoch,expectedRecoveryDigest:digest,
      expectedAuthorityId,expectedTrustDomainId:this.trustDomainId,nowMs,maxAgeMs
    });

    const committed=this.epochAnchor.advanceCommitted(acceptedEpoch,digest);
    if(committed?.generation!==packageEpoch || !sameDigest(committed?.commitment,digest)){
      throw new Error('Recovery-epoch authority commitment mismatch.');
    }
    return {...verified,recoveryCommitStatus:'committed',epochAuthorityGeneration:committed.generation};
  }
}
