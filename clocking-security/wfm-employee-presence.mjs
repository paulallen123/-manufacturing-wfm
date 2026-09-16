import crypto from 'node:crypto';

const ID=/^[A-Za-z0-9_.:-]{1,120}$/;
const b64=x=>Buffer.from(x).toString('base64url');
const unb64=x=>Buffer.from(x,'base64url');
function clone(x){return JSON.parse(JSON.stringify(x));}

/**
 * Security model for employee presence only.
 * This deliberately models server-side passkey challenge/signature verification and one-time
 * presence tokens. It is NOT a complete WebAuthn implementation: production must use a reviewed
 * WebAuthn/FIDO server library to validate origin, RP ID, authenticator data, flags, counters,
 * credential backup state and attestation policy as applicable.
 */
export class EmployeePresenceProof {
  constructor({rpId='wfm.example',origin='https://wfm.example',challengeTtlMs=60_000,presenceTtlMs=30_000}={}){
    this.rpId=rpId; this.origin=origin; this.challengeTtlMs=challengeTtlMs; this.presenceTtlMs=presenceTtlMs;
    this.credentials=new Map();
    this.challenges=new Map();
    this.presence=new Map();
    this.audit=[];
  }

  registerCredential({tenant,employee,credentialId,publicKeyPem,status='active'}){
    if(!ID.test(String(tenant||''))||!ID.test(String(employee||''))||!ID.test(String(credentialId||''))||typeof publicKeyPem!=='string')throw new Error('Valid credential registration required.');
    this.credentials.set(`${tenant}:${credentialId}`,{tenant,employee,credentialId,publicKeyPem,status});
  }

  revokeCredential({tenant,credentialId}){
    const c=this.credentials.get(`${tenant}:${credentialId}`); if(!c)return false; c.status='revoked'; return true;
  }

  issueAuthenticationChallenge({tenant,employee,site,nowMs}){
    if(!ID.test(String(tenant||''))||!ID.test(String(employee||''))||!ID.test(String(site||'')))throw new Error('Tenant, employee and site required.');
    const eligible=[...this.credentials.values()].filter(c=>c.tenant===tenant&&c.employee===employee&&c.status==='active').map(c=>c.credentialId);
    if(!eligible.length)throw Object.assign(new Error('No active passkey credential is registered for this employee.'),{status:409});
    const id='pa-'+crypto.randomUUID(),challenge=crypto.randomBytes(32).toString('base64url');
    this.challenges.set(id,{id,tenant,employee,site,challenge,rpId:this.rpId,origin:this.origin,eligible,issuedAt:nowMs,expiresAt:nowMs+this.challengeTtlMs,usedAt:null});
    return clone({challengeId:id,challenge,rpId:this.rpId,origin:this.origin,allowCredentials:eligible,expiresAt:new Date(nowMs+this.challengeTtlMs).toISOString()});
  }

  verifyAndIssuePresence({tenant,challengeId,credentialId,signature,origin,rpId,nowMs}){
    const c=this.challenges.get(challengeId);
    if(!c||c.tenant!==tenant)throw Object.assign(new Error('Authentication challenge not found.'),{status:404});
    if(c.usedAt!==null)throw Object.assign(new Error('Authentication challenge already used.'),{status:409});
    if(nowMs<c.issuedAt||nowMs>c.expiresAt)throw Object.assign(new Error('Authentication challenge expired.'),{status:409});
    if(origin!==c.origin||rpId!==c.rpId)throw Object.assign(new Error('Authentication origin or relying party rejected.'),{status:403});
    if(!c.eligible.includes(credentialId))throw Object.assign(new Error('Credential is not registered for this employee.'),{status:403});
    const credential=this.credentials.get(`${tenant}:${credentialId}`);
    if(!credential||credential.status!=='active'||credential.employee!==c.employee)throw Object.assign(new Error('Credential is not active for this employee.'),{status:403});
    const signed=this.#signedMessage(c);
    let ok=false; try{ok=crypto.verify(null,signed,credential.publicKeyPem,unb64(signature));}catch{}
    if(!ok)throw Object.assign(new Error('Passkey proof rejected.'),{status:401});
    c.usedAt=nowMs;
    const tokenId='presence-'+crypto.randomUUID();
    const row={tokenId,tenant:c.tenant,employee:c.employee,site:c.site,credentialId,issuedAt:nowMs,expiresAt:nowMs+this.presenceTtlMs,usedAt:null};
    this.presence.set(tokenId,row);
    this.audit.push({tenant,employee:c.employee,action:'employee-presence-issued',credentialId,site:c.site,at:nowMs});
    return {presenceToken:tokenId,expiresAt:new Date(row.expiresAt).toISOString(),site:c.site,employee:c.employee};
  }

  consumePresence({tenant,site,deviceId,presenceToken,nowMs}){
    if(!ID.test(String(deviceId||'')))throw Object.assign(new Error('Registered kiosk device identity required.'),{status:401});
    const p=this.presence.get(String(presenceToken||''));
    if(!p||p.tenant!==tenant)throw Object.assign(new Error('Presence token not found.'),{status:404});
    if(p.usedAt!==null)throw Object.assign(new Error('Presence token already used.'),{status:409});
    if(nowMs<p.issuedAt||nowMs>p.expiresAt)throw Object.assign(new Error('Presence token expired.'),{status:409});
    if(p.site!==site)throw Object.assign(new Error('Presence token is for a different site.'),{status:403});
    p.usedAt=nowMs;
    this.audit.push({tenant,employee:p.employee,action:'employee-presence-consumed',credentialId:p.credentialId,site,deviceId,at:nowMs});
    return {verified:true,tenant,employee:p.employee,site,deviceId,presenceToken:p.tokenId,verifiedAt:new Date(nowMs).toISOString(),assurance:'passkey+single-use-presence-token'};
  }

  challengeSigningBytes({challengeId}){
    const c=this.challenges.get(challengeId); if(!c)throw new Error('Unknown challenge.'); return this.#signedMessage(c);
  }

  #signedMessage(c){
    return Buffer.from(JSON.stringify({challenge:c.challenge,challengeId:c.id,tenant:c.tenant,employee:c.employee,site:c.site,rpId:c.rpId,origin:c.origin}));
  }
}

export function createSyntheticPasskey(){
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  return {publicKeyPem:publicKey.export({type:'spki',format:'pem'}),privateKey,sign:bytes=>b64(crypto.sign(null,bytes,privateKey))};
}
