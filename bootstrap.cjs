'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
function req(n){const v=String(process.env[n]||'').trim();if(!v)throw Error('Missing '+n);return v;}
function sha(b){return crypto.createHash('sha256').update(b).digest('hex');}
(async()=>{
 const url=req('WFM_BUNDLE_URL'), expectedEnc=req('WFM_BUNDLE_SHA256'), expectedPlain=req('WFM_RUNTIME_SHA256'), keyHex=req('WFM_BUNDLE_KEY_HEX');
 if(!/^https:\/\//.test(url))throw Error('WFM_BUNDLE_URL must be HTTPS');
 if(!/^[a-f0-9]{64}$/i.test(keyHex))throw Error('WFM_BUNDLE_KEY_HEX invalid');
 const r=await fetch(url,{redirect:'follow'}); if(!r.ok)throw Error('Artifact fetch failed: '+r.status);
 const enc=Buffer.from(await r.arrayBuffer()); if(sha(enc)!==expectedEnc)throw Error('Encrypted artifact SHA-256 mismatch');
 if(enc.length<29)throw Error('Encrypted artifact too small');
 const iv=enc.subarray(0,12),tag=enc.subarray(12,28),cipher=enc.subarray(28);
 const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(keyHex,'hex'),iv);d.setAuthTag(tag);
 const plain=Buffer.concat([d.update(cipher),d.final()]); if(sha(plain)!==expectedPlain)throw Error('Runtime SHA-256 mismatch');
 const tgz='/tmp/wfm-runtime.tar.gz', app='/app';fs.writeFileSync(tgz,plain,{mode:0o600});fs.mkdirSync(app,{recursive:true});
 execFileSync('tar',['-xzf',tgz,'-C',app],{stdio:'inherit'});fs.rmSync(tgz,{force:true});
 console.log('WFM_STAGING_ARTIFACT_VERIFIED release=0.6.76-hosted-staging-rc1 sha256='+expectedPlain);
 const c=spawn(process.execPath,[path.join(app,'server.cjs')],{stdio:'inherit',env:process.env});
 for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>c.kill(s));c.on('exit',(code,signal)=>process.exit(code??(signal?1:0)));
})().catch(e=>{console.error('WFM_STAGING_BOOTSTRAP_FAILED',e.message);process.exit(1);});
