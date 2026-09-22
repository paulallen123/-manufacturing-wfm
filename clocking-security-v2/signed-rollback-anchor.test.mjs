import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {SignedRollbackAnchorClient,createSyntheticSignedRollbackAuthority,createSyntheticSignedAuthorityKeyPolicy,authorityKeyPolicyDigest,isLifecycleBoundSignedRollbackAnchorClient} from './signed-rollback-anchor.mjs';

function fixture(){
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  let nowMs=Date.parse('2026-09-18T17:20:00Z');
  const authority=createSyntheticSignedRollbackAuthority({privateKey,now:()=>nowMs});
  const client=new SignedRollbackAnchorClient({
    transport:authority,
    authorityPublicKeys:{'authority-1':publicKey},
    authorityId:'wfm-security-anchor-authority',
    anchorId:'attendance-source-continuity',
    now:()=>nowMs,
    randomBytes:(n)=>Buffer.alloc(n,0x5a)
  });
  return {client,authority,publicKey,privateKey,get now(){return nowMs;},set now(v){nowMs=v;}};
}

function lifecycleFixture({status='active',sequence=7,expectedDigest=true}={}){
  const authorityKeys=crypto.generateKeyPairSync('ed25519');
  const trustRoot=crypto.generateKeyPairSync('ed25519');
  let nowMs=Date.parse('2026-09-18T21:30:00Z');
  const authority=createSyntheticSignedRollbackAuthority({privateKey:authorityKeys.privateKey,now:()=>nowMs});
  const policy=createSyntheticSignedAuthorityKeyPolicy({
    rootPrivateKey:trustRoot.privateKey,
    sequence,
    issuedAtMs:nowMs-1_000,
    expiresAtMs:nowMs+60_000,
    keys:[{keyId:'authority-1',status,notBeforeMs:nowMs-60_000,notAfterMs:nowMs+60_000}]
  });
  const client=new SignedRollbackAnchorClient({
    transport:authority,
    authorityPublicKeys:{'authority-1':authorityKeys.publicKey},
    authorityId:'wfm-security-anchor-authority',
    anchorId:'attendance-source-continuity',
    authorityKeyPolicy:policy,
    authorityTrustRootPublicKeys:{'trust-root-1':trustRoot.publicKey},
    minimumAuthorityPolicySequence:sequence,
    expectedAuthorityPolicyDigest:expectedDigest?authorityKeyPolicyDigest(policy):null,
    now:()=>nowMs,
    randomBytes:(n)=>Buffer.alloc(n,0x6b)
  });
  return {client,authority,policy,authorityKeys,trustRoot,get now(){return nowMs;},set now(v){nowMs=v;}};
}

test('fresh signed read and compare-and-advance succeed',()=>{
  const f=fixture();
  assert.equal(f.client.current(),0);
  assert.equal(f.client.advance(0),1);
  assert.equal(f.client.current(),1);
});

test('replayed read receipt with another challenge is rejected',()=>{
  const f=fixture();
  const captured=f.authority.read({anchorId:'attendance-source-continuity',challengeHash:crypto.createHash('sha256').update(Buffer.alloc(32,0x11)).digest('hex')});
  const replayTransport={read(){return captured;},compareAndAdvance:f.authority.compareAndAdvance.bind(f.authority)};
  const client=new SignedRollbackAnchorClient({transport:replayTransport,authorityPublicKeys:{'authority-1':f.publicKey},authorityId:'wfm-security-anchor-authority',anchorId:'attendance-source-continuity',now:()=>f.now,randomBytes:(n)=>Buffer.alloc(n,0x22)});
  assert.throws(()=>client.current(),/not fresh/);
});

test('forged authority receipt is rejected',()=>{
  const f=fixture(); const attacker=crypto.generateKeyPairSync('ed25519');
  const legit=f.authority.read({anchorId:'attendance-source-continuity',challengeHash:crypto.createHash('sha256').update(Buffer.alloc(32,0x5a)).digest('hex')});
  const {signature,...payload}=legit;
  const forged={...payload,signature:crypto.sign(null,Buffer.from(JSON.stringify(payload)),attacker.privateKey).toString('base64url')};
  const transport={read(){return forged;},compareAndAdvance:f.authority.compareAndAdvance.bind(f.authority)};
  const client=new SignedRollbackAnchorClient({transport,authorityPublicKeys:{'authority-1':f.publicKey},authorityId:'wfm-security-anchor-authority',anchorId:'attendance-source-continuity',now:()=>f.now,randomBytes:(n)=>Buffer.alloc(n,0x5a)});
  assert.throws(()=>client.current(),/signature invalid/);
});

test('cross-anchor substitution is rejected even with valid authority signature',()=>{
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const authority=createSyntheticSignedRollbackAuthority({privateKey,anchorId:'other-customer-anchor',now:()=>Date.parse('2026-09-18T17:20:00Z')});
  const transport={read({challengeHash}){return authority.read({anchorId:'other-customer-anchor',challengeHash});},compareAndAdvance(args){return authority.compareAndAdvance({...args,anchorId:'other-customer-anchor'});}};
  const client=new SignedRollbackAnchorClient({transport,authorityPublicKeys:{'authority-1':publicKey},authorityId:'wfm-security-anchor-authority',anchorId:'attendance-source-continuity',now:()=>Date.parse('2026-09-18T17:20:00Z'),randomBytes:(n)=>Buffer.alloc(n,0x5a)});
  assert.throws(()=>client.current(),/identity mismatch/);
});

test('stale signed receipt is rejected',()=>{
  const f=fixture();
  const captured=f.authority.read({anchorId:'attendance-source-continuity',challengeHash:crypto.createHash('sha256').update(Buffer.alloc(32,0x5a)).digest('hex')});
  f.now+=60_000;
  const transport={read(){return captured;},compareAndAdvance:f.authority.compareAndAdvance.bind(f.authority)};
  const client=new SignedRollbackAnchorClient({transport,authorityPublicKeys:{'authority-1':f.publicKey},authorityId:'wfm-security-anchor-authority',anchorId:'attendance-source-continuity',now:()=>f.now,randomBytes:(n)=>Buffer.alloc(n,0x5a)});
  assert.throws(()=>client.current(),/stale|validity/);
});

test('signed generation regression is rejected',()=>{
  const f=fixture();
  assert.equal(f.client.advance(0),1);
  f.authority.forceGenerationForTest(0);
  assert.throws(()=>f.client.current(),/generation regressed/);
});

test('stale compare-and-advance cannot move authority from an old view',()=>{
  const f=fixture();
  assert.equal(f.client.advance(0),1);
  assert.throws(()=>f.client.advance(0),/compare-and-set mismatch|stale/);
});

test('signed authority-key lifecycle permits an active signer and marks the client lifecycle-bound',()=>{
  const f=lifecycleFixture();
  assert.equal(isLifecycleBoundSignedRollbackAnchorClient(f.client),true);
  assert.equal(f.client.current(),0);
});

test('revoked authority key cannot mint a fresh trusted rollback receipt even when key material remains configured',()=>{
  const f=lifecycleFixture({status:'revoked'});
  assert.throws(()=>f.client.current(),/revoked/);
});

test('retiring authority key remains valid during a bounded rotation overlap',()=>{
  const f=lifecycleFixture({status:'retiring'});
  assert.equal(f.client.current(),0);
});

test('authority-key lifecycle policy signed by an untrusted root is rejected',()=>{
  const f=lifecycleFixture();
  const attacker=crypto.generateKeyPairSync('ed25519');
  const forgedPolicy=createSyntheticSignedAuthorityKeyPolicy({
    rootPrivateKey:attacker.privateKey,
    sequence:8,
    issuedAtMs:f.now-1_000,
    expiresAtMs:f.now+60_000,
    keys:[{keyId:'authority-1',status:'active',notBeforeMs:f.now-60_000,notAfterMs:f.now+60_000}]
  });
  assert.throws(()=>new SignedRollbackAnchorClient({
    transport:f.authority,
    authorityPublicKeys:{'authority-1':f.authorityKeys.publicKey},
    authorityId:'wfm-security-anchor-authority',anchorId:'attendance-source-continuity',
    authorityKeyPolicy:forgedPolicy,authorityTrustRootPublicKeys:{'trust-root-1':f.trustRoot.publicKey},
    now:()=>f.now,randomBytes:(n)=>Buffer.alloc(n,0x6b)
  }),/signature invalid/);
});

test('authority-key lifecycle rollback below the minimum accepted sequence is rejected',()=>{
  const f=lifecycleFixture({sequence:7});
  assert.throws(()=>new SignedRollbackAnchorClient({
    transport:f.authority,
    authorityPublicKeys:{'authority-1':f.authorityKeys.publicKey},
    authorityId:'wfm-security-anchor-authority',anchorId:'attendance-source-continuity',
    authorityKeyPolicy:f.policy,authorityTrustRootPublicKeys:{'trust-root-1':f.trustRoot.publicKey},
    minimumAuthorityPolicySequence:8,
    now:()=>f.now,randomBytes:(n)=>Buffer.alloc(n,0x6b)
  }),/below the required minimum/);
});

test('same-sequence authority policy equivocation is rejected by exact expected digest',()=>{
  const f=lifecycleFixture({sequence:7});
  const equivocated=createSyntheticSignedAuthorityKeyPolicy({
    rootPrivateKey:f.trustRoot.privateKey,
    sequence:7,
    issuedAtMs:f.now-1_000,
    expiresAtMs:f.now+60_000,
    keys:[{keyId:'authority-1',status:'revoked',notBeforeMs:f.now-60_000,notAfterMs:f.now+60_000}]
  });
  assert.throws(()=>new SignedRollbackAnchorClient({
    transport:f.authority,
    authorityPublicKeys:{'authority-1':f.authorityKeys.publicKey},
    authorityId:'wfm-security-anchor-authority',anchorId:'attendance-source-continuity',
    authorityKeyPolicy:equivocated,authorityTrustRootPublicKeys:{'trust-root-1':f.trustRoot.publicKey},
    minimumAuthorityPolicySequence:7,expectedAuthorityPolicyDigest:authorityKeyPolicyDigest(f.policy),
    now:()=>f.now,randomBytes:(n)=>Buffer.alloc(n,0x6b)
  }),/digest mismatch/);
});

test('expired authority-key lifecycle policy fails closed before any rollback receipt is trusted',()=>{
  const f=lifecycleFixture();
  f.now+=120_000;
  assert.throws(()=>new SignedRollbackAnchorClient({
    transport:f.authority,
    authorityPublicKeys:{'authority-1':f.authorityKeys.publicKey},
    authorityId:'wfm-security-anchor-authority',anchorId:'attendance-source-continuity',
    authorityKeyPolicy:f.policy,authorityTrustRootPublicKeys:{'trust-root-1':f.trustRoot.publicKey},
    now:()=>f.now,randomBytes:(n)=>Buffer.alloc(n,0x6b)
  }),/stale|validity/);
});
