'use strict';
const {randomBytes,createHash,generateKeyPairSync,sign}=require('node:crypto');
const {encodeCBOR}=require('@levischuck/tiny-cbor');
const hash=value=>createHash('sha256').update(value).digest();
const b64=value=>Buffer.from(value).toString('base64url');
// Independent test authenticator signs real WebAuthn transcripts. Production verification is never mocked.
function authenticator(options, overrides={}) {
  const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const jwk=keys.publicKey.export({format:'jwk'});
  const id=randomBytes(32);
  const cose=encodeCBOR(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
  const rp=overrides.rp||'vector.test';
  const client=(type,challenge,origin='https://vector.test')=>Buffer.from(JSON.stringify({type,challenge,origin,crossOrigin:false}));
  const data=(flags,counter)=>{const n=Buffer.alloc(4);n.writeUInt32BE(counter);return Buffer.concat([hash(rp),Buffer.from([flags]),n]);};
  const length=Buffer.alloc(2);length.writeUInt16BE(id.length);
  const authData=Buffer.concat([data(overrides.flags??0x45,0),Buffer.alloc(16),length,id,cose]);
  const attestation=encodeCBOR(new Map([['fmt','none'],['attStmt',new Map()],['authData',authData]]));
  return {id:b64(id),registration:{id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{credProps:{rk:true}},
    response:{attestationObject:b64(attestation),clientDataJSON:b64(client('webauthn.create',overrides.challenge||options.challenge,overrides.origin)),transports:['internal']}},
    assertion(authOptions, change={}) {
      const cd=client('webauthn.get',change.challenge||authOptions.challenge,change.origin);
      const ad=data(change.flags??0x05,change.counter??1);
      const signature=sign('sha256',Buffer.concat([ad,hash(cd)]),change.privateKey||keys.privateKey);
      return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(cd),authenticatorData:b64(ad),signature:b64(signature),userHandle:change.userHandle??options.user.id}};
    }};
}

module.exports={authenticator};
