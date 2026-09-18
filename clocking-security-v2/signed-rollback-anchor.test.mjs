import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {SignedRollbackAnchorClient,createSyntheticSignedRollbackAuthority} from './signed-rollback-anchor.mjs';

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
